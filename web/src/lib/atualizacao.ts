/**
 * Atualização automática do site para todos os usuários, sem clique.
 *
 * Cada build gera um id (BUILD_ID) gravado em <meta name="app-versao"> e em /version.json.
 * O navegador compara os dois ao abrir, ao voltar para o app, a cada 10 min e ao reconectar.
 * Se forem diferentes: atualiza o service worker, apaga os caches do app e recarrega.
 * Se houver um diálogo aberto, espera fechar (não interrompe quem está vendo um post).
 */

const INTERVALO_MS = 10 * 60 * 1000;
const CHAVE_TENTADA = "app-versao-tentada";

/** Confere se uma versão nova deve ser aplicada. Pura (testada). */
export function deveAtualizar(
  carregada: string,
  remota: string | null | undefined,
  jaTentada: string | null,
): boolean {
  if (!carregada || !remota) return false;
  if (remota === carregada) return false;
  // Trava contra laço: no máximo uma tentativa por versão nova em cada sessão.
  return jaTentada !== remota;
}

/** Nomes de cache que o app criou (src/sw.ts usa o prefixo "polo9n-"; "workbox-" é de versões antigas). */
export function cacheDoApp(nome: string): boolean {
  return nome.startsWith("polo9n-") || nome.startsWith("workbox-");
}

function lerSessao(chave: string): string | null {
  try {
    return sessionStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravarSessao(chave: string, valor: string): void {
  try {
    sessionStorage.setItem(chave, valor);
  } catch {
    /* sem storage: a trava fica só em memória (variável `atualizando`) */
  }
}

function dialogoAberto(): boolean {
  return document.querySelector('dialog[open], [role="dialog"][data-state="open"]') !== null;
}

let atualizando = false;

async function recarregarLimpo(): Promise<void> {
  if (atualizando) return;
  if (dialogoAberto()) {
    window.setTimeout(() => void recarregarLimpo(), 4000);
    return;
  }
  atualizando = true;
  try {
    if ("caches" in window) {
      const nomes = await caches.keys();
      await Promise.all(nomes.filter(cacheDoApp).map((n) => caches.delete(n)));
    }
  } catch {
    /* recarrega mesmo assim */
  }
  window.location.reload();
}

async function atualizarRegistro(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg?.update();
  } catch {
    /* sem rede ou sem SW */
  }
}

async function checarVersao(carregada: string): Promise<void> {
  try {
    const r = await fetch("/version.json", { cache: "no-store" });
    if (!r.ok) return;
    const corpo = (await r.json()) as { versao?: unknown };
    const remota = typeof corpo.versao === "string" ? corpo.versao : null;
    if (!deveAtualizar(carregada, remota, lerSessao(CHAVE_TENTADA)) || !remota) return;
    gravarSessao(CHAVE_TENTADA, remota);
    await atualizarRegistro();
    await recarregarLimpo();
  } catch {
    /* sem rede: tenta de novo na próxima checagem */
  }
}

let iniciado = false;

/**
 * Registra o service worker (/sw.js) e liga todas as checagens de versão. Chamar uma vez por página
 * (chamadas repetidas são ignoradas). Porte de registrarSW/checarVersao/recarregarLimpo do site antigo.
 */
export function iniciarAtualizacaoAutomatica(): void {
  if (iniciado || typeof window === "undefined") return;
  iniciado = true;
  if (!("serviceWorker" in navigator)) return;
  const seguro =
    window.location.protocol === "https:" ||
    ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (!seguro) return;

  const carregada =
    document.querySelector<HTMLMetaElement>('meta[name="app-versao"]')?.content ?? "";

  // Só recarrega na troca de service worker se a página já tinha um (na 1ª instalação não há o que atualizar).
  const tinhaControlador = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (tinhaControlador) void recarregarLimpo();
  });

  const ligar = () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => reg.update())
      .catch(() => {
        /* o site funciona sem service worker */
      });

    window.setTimeout(() => void checarVersao(carregada), 4000);
    window.setInterval(() => void checarVersao(carregada), INTERVALO_MS);
    window.addEventListener("online", () => void checarVersao(carregada));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      void checarVersao(carregada);
      void atualizarRegistro();
    });
  };
  // Como no site antigo: registra depois do "load", para não disputar banda com a primeira pintura.
  if (document.readyState === "complete") ligar();
  else window.addEventListener("load", ligar, { once: true });
}

/** Nome antigo, mantido para quem já importa (components/AutoUpdate.tsx). */
export const iniciarAtualizacao = iniciarAtualizacaoAutomatica;
