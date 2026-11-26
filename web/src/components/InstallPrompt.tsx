import { useEffect, useState } from "react";

/** Evento não padrão do Chrome/Edge/Android que permite instalar o PWA. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const CHAVE_DICA_IOS = "polo9n:dica-ios-dispensada";

function emModoApp(): boolean {
  const navegadorIos = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches || navegadorIos;
}

function ehIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function lerDispensada(): boolean {
  try {
    return localStorage.getItem(CHAVE_DICA_IOS) === "1";
  } catch {
    return false;
  }
}

/** Botão "Instalar app" (beforeinstallprompt) e dica para iOS. Some quando já está instalado. */
export default function InstallPrompt() {
  const [evento, setEvento] = useState<BeforeInstallPromptEvent | null>(null);
  const [instalado, setInstalado] = useState(false);
  const [dicaIos, setDicaIos] = useState(false);

  useEffect(() => {
    if (emModoApp()) {
      setInstalado(true);
      return;
    }
    if (ehIos() && !lerDispensada()) setDicaIos(true);

    const aoOferecer = (e: Event) => {
      e.preventDefault();
      setEvento(e as BeforeInstallPromptEvent);
    };
    const aoInstalar = () => {
      setInstalado(true);
      setEvento(null);
    };
    window.addEventListener("beforeinstallprompt", aoOferecer);
    window.addEventListener("appinstalled", aoInstalar);
    return () => {
      window.removeEventListener("beforeinstallprompt", aoOferecer);
      window.removeEventListener("appinstalled", aoInstalar);
    };
  }, []);

  if (instalado) return null;

  async function instalar() {
    if (!evento) return;
    await evento.prompt();
    await evento.userChoice;
    setEvento(null);
  }

  function dispensar() {
    setDicaIos(false);
    try {
      localStorage.setItem(CHAVE_DICA_IOS, "1");
    } catch {
      /* armazenamento bloqueado: a dica volta na próxima visita */
    }
  }

  return (
    <>
      {evento ? (
        <button
          type="button"
          onClick={() => void instalar()}
          className="border-accent text-accent rounded-lg border px-3 py-1 text-sm font-bold"
        >
          Instalar app
        </button>
      ) : null}
      {dicaIos ? (
        <div
          role="note"
          className="bg-surface border-line fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-md items-start justify-between gap-3 rounded-xl border p-4 text-sm"
        >
          <p>
            Para instalar no iPhone: toque em Compartilhar e depois em &quot;Adicionar à Tela de
            Início&quot;.
          </p>
          <button type="button" onClick={dispensar} className="text-muted font-bold">
            Dispensar
          </button>
        </div>
      ) : null}
    </>
  );
}
