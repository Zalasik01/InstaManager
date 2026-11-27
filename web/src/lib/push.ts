/**
 * Aviso de post novo (Web Push), porte do bloco "iniciarPush" de site/public/app.js.
 *
 * - A permissão de notificação é pedida SÓ em ativarPush() (chamar a partir de um clique).
 * - A inscrição vai para POST /api/push (o Worker grava no banco); quem envia é o backend
 *   (notificarNovoPost), depois de publicar.
 * - No iPhone o PushManager só existe com o app instalado na tela de início: estadoPush() devolve
 *   "precisa-instalar" no Safari comum, para a interface explicar o caminho em vez de esconder o botão.
 * - VAPID_PUBLICA precisa ser do mesmo par do secret VAPID_PRIVATE_KEY do backend.
 */

export const VAPID_PUBLICA =
  "BCzsffDs0rv-uaWO2Fa83HPsT6LHLRXOHAz-jErwjQQ08QzCWe6fbcYIqTH3en9YoL1XyqBRBbaKdx-vw__b0-w";

/**
 * - "indisponivel": navegador sem push ou página sem HTTPS (não mostrar nada);
 * - "precisa-instalar": iPhone/iPad fora do app instalado (mostrar a dica de instalar);
 * - "bloqueado": a pessoa negou as notificações (não insistir);
 * - "ativo" / "inativo": pode alternar.
 */
export type EstadoPush = "indisponivel" | "precisa-instalar" | "bloqueado" | "ativo" | "inativo";

function seguro(): boolean {
  return (
    window.location.protocol === "https:" ||
    ["localhost", "127.0.0.1"].includes(window.location.hostname)
  );
}

function ehIos(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function instalado(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** O navegador tem tudo para Web Push nesta página? */
export function pushSuportado(): boolean {
  return (
    typeof window !== "undefined" &&
    seguro() &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Chave VAPID em base64url para bytes (applicationServerKey). */
function chaveBytes(b64: string): Uint8Array<ArrayBuffer> {
  let s = b64.replace(/-/g, "+").replace(/_/g, "/");
  s += "====".slice(s.length % 4 || 4);
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function enviarInscricao(metodo: "POST" | "DELETE", sub: PushSubscriptionJSON): Promise<void> {
  const corpo = metodo === "DELETE" ? { endpoint: sub.endpoint } : { endpoint: sub.endpoint, keys: sub.keys };
  const r = await fetch("/api/push", {
    method: metodo,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error(`push ${r.status}`);
}

/** Estado atual do aviso neste navegador (não pede permissão). */
export async function estadoPush(): Promise<EstadoPush> {
  if (typeof window === "undefined" || !seguro()) return "indisponivel";
  if (!pushSuportado()) return ehIos() && !instalado() ? "precisa-instalar" : "indisponivel";
  if (Notification.permission === "denied") return "bloqueado";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub && Notification.permission === "granted" ? "ativo" : "inativo";
  } catch {
    return "indisponivel";
  }
}

/**
 * Pede a permissão, inscreve e grava no servidor. Chamar a partir de um clique.
 * Devolve o novo estado: "ativo" se deu certo, "bloqueado"/"inativo" se a pessoa recusou.
 * Lança erro se o servidor não guardou (a inscrição local é desfeita para o botão não mentir).
 */
export async function ativarPush(): Promise<EstadoPush> {
  if (!pushSuportado()) return estadoPush();
  const permissao = await Notification.requestPermission();
  if (permissao !== "granted") return permissao === "denied" ? "bloqueado" : "inativo";
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: chaveBytes(VAPID_PUBLICA),
    }));
  try {
    await enviarInscricao("POST", sub.toJSON());
  } catch (e) {
    await sub.unsubscribe().catch(() => false);
    throw e;
  }
  return "ativo";
}

/** Cancela a inscrição neste navegador e avisa o servidor (falha no servidor é ignorada). */
export async function desativarPush(): Promise<EstadoPush> {
  if (!pushSuportado()) return estadoPush();
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    const copia = sub.toJSON();
    await sub.unsubscribe();
    await enviarInscricao("DELETE", copia).catch(() => undefined);
  }
  return "inativo";
}
