import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { ehIos, instalado } from "@/components/avisos";

/** Evento não padrão do Chrome/Edge/Android que permite instalar o PWA. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const CHAVE_DICA_IOS = "polo9n-dica-ios";

function lerDispensada(): boolean {
  try {
    return localStorage.getItem(CHAVE_DICA_IOS) === "1";
  } catch {
    return false;
  }
}

/**
 * Botão "Instalar app" na barra do topo (beforeinstallprompt) e dica de instalação no iOS.
 * Nada aparece com o app já instalado (standalone/fullscreen).
 */
export default function InstallPrompt() {
  const reduz = useReducedMotion();
  const [evento, setEvento] = useState<BeforeInstallPromptEvent | null>(null);
  const [dicaIos, setDicaIos] = useState(false);

  useEffect(() => {
    if (instalado()) return;
    if (ehIos() && !lerDispensada()) setDicaIos(true);

    const aoOferecer = (e: Event) => {
      e.preventDefault();
      setEvento(e as BeforeInstallPromptEvent);
    };
    const aoInstalar = () => {
      setEvento(null);
      setDicaIos(false);
    };
    window.addEventListener("beforeinstallprompt", aoOferecer);
    window.addEventListener("appinstalled", aoInstalar);
    return () => {
      window.removeEventListener("beforeinstallprompt", aoOferecer);
      window.removeEventListener("appinstalled", aoInstalar);
    };
  }, []);

  function instalar() {
    if (!evento) return;
    const ev = evento;
    setEvento(null);
    void ev.prompt().catch(() => {});
    ev.userChoice?.catch(() => {});
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
        <motion.button
          type="button"
          className="so-navegador"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          whileTap={{ scale: 0.95 }}
          onClick={instalar}
        >
          Instalar app
        </motion.button>
      ) : null}
      <AnimatePresence>
        {dicaIos ? (
          <motion.div
            className="aviso so-navegador"
            role="note"
            initial={reduz ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduz ? { opacity: 0 } : { opacity: 0, y: 16 }}
            transition={{ type: "spring", stiffness: 400, damping: 34 }}
          >
            <p>Para instalar: toque em Compartilhar e depois em Adicionar à Tela de Início.</p>
            <motion.button whileTap={{ scale: 0.95 }} type="button" aria-label="Dispensar dica" onClick={dispensar}>
              OK
            </motion.button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
