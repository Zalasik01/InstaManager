// Web Push: avisa os navegadores inscritos no site que saiu um post novo (item 28).
// Secrets: VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY (formato do `web-push generate-vapid-keys`: base64url,
// chave pública "crua" de 65 bytes e privada de 32 bytes) e VAPID_SUBJECT (ex.: mailto:contato@dominio).
// A chave PÚBLICA também está no site (app.js, VAPID_PUBLICA): as duas precisam ser do mesmo par.
// Lib: jsr:@negrel/webpush, que usa só WebCrypto (roda no Deno das Edge Functions, sem Node nativo).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const HASHTAG = /#[\p{L}\p{N}_]+/gu;
const LOTE = 20; // envios simultâneos
const MAX_FALHAS = 5; // depois disso a inscrição é removida mesmo sem 404/410

function deBase64Url(s: string): Uint8Array {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const paraBase64Url = (u: Uint8Array) =>
  btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Converte o par VAPID em base64url (formato web-push) para JWK, que é o que a lib importa. */
function chavesJwk(publica: string, privada: string): webpush.ExportedVapidKeys {
  const pub = deBase64Url(publica);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC_KEY inválida");
  const x = paraBase64Url(pub.slice(1, 33));
  const y = paraBase64Url(pub.slice(33, 65));
  const d = paraBase64Url(deBase64Url(privada));
  const base = { kty: "EC", crv: "P-256", x, y, ext: true };
  return { publicKey: base, privateKey: { ...base, d } };
}

let servidor: Promise<webpush.ApplicationServer> | null = null;
function applicationServer(): Promise<webpush.ApplicationServer> {
  if (!servidor) {
    servidor = (async () => {
      const pub = Deno.env.get("VAPID_PUBLIC_KEY");
      const priv = Deno.env.get("VAPID_PRIVATE_KEY");
      const sujeito = Deno.env.get("VAPID_SUBJECT");
      if (!pub || !priv || !sujeito) throw new Error("secrets VAPID ausentes");
      const vapidKeys = await webpush.importVapidKeys(chavesJwk(pub, priv));
      return await webpush.ApplicationServer.new({ contactInformation: sujeito, vapidKeys });
    })();
    servidor.catch(() => { servidor = null; });
  }
  return servidor;
}

/** Início da legenda sem hashtags, numa linha só (corpo da notificação). */
function corpo(legenda: string | null | undefined): string {
  const t = String(legenda ?? "").replace(HASHTAG, "").replace(/\s+/g, " ").trim();
  if (!t) return "Tem foto nova do Polo. Toque para ver.";
  return t.length > 120 ? t.slice(0, 117).trimEnd() + "..." : t;
}

type Inscricao = { endpoint: string; p256dh: string; auth: string; falhas: number | null };

/**
 * Envia "Post novo" para todas as inscrições. Remove as que o serviço de push dá como mortas (404/410)
 * e as que falharam MAX_FALHAS vezes seguidas. `db` precisa ser o cliente com a chave de serviço.
 */
export async function notificarNovoPost(
  db: SupabaseClient,
  post: { id: string; legenda?: string | null; imagem?: string | null },
): Promise<{ enviados: number; removidos: number }> {
  const as = await applicationServer();
  const mensagem = JSON.stringify({
    title: "Post novo no @polo_9n4_12",
    body: corpo(post.legenda),
    url: `https://polo9n.com.br/#post=${encodeURIComponent(post.id)}`,
    image: post.imagem && /^https:\/\//.test(post.imagem) ? post.imagem : undefined,
    tag: `post-${post.id}`,
  });

  let enviados = 0;
  let removidos = 0;
  // Paginação por chave (endpoint em ordem): apagar inscrições no meio do caminho não faz pular ninguém.
  let depoisDe = "";
  for (;;) {
    let q = db
      .from("push_inscricoes")
      .select("endpoint, p256dh, auth, falhas")
      .order("endpoint", { ascending: true })
      .limit(1000);
    if (depoisDe) q = q.gt("endpoint", depoisDe);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const lista = (data ?? []) as Inscricao[];
    if (!lista.length) break;
    depoisDe = lista[lista.length - 1].endpoint;

    for (let i = 0; i < lista.length; i += LOTE) {
      const lote = lista.slice(i, i + LOTE);
      const resultados = await Promise.allSettled(lote.map((s) =>
        as.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } })
          .pushTextMessage(mensagem, { ttl: 86400, urgency: webpush.Urgency.Normal })
      ));
      const agora = new Date().toISOString();
      const mortos: string[] = [];
      for (let k = 0; k < lote.length; k++) {
        const s = lote[k];
        const r = resultados[k];
        if (r.status === "fulfilled") {
          enviados++;
          await db.from("push_inscricoes").update({ ultimo_envio: agora, falhas: 0 }).eq("endpoint", s.endpoint);
          continue;
        }
        const e = r.reason;
        const status = e instanceof webpush.PushMessageError ? e.response.status : 0;
        if (status === 404 || status === 410 || (s.falhas ?? 0) + 1 >= MAX_FALHAS) {
          mortos.push(s.endpoint);
        } else {
          console.error("Falha no push:", status || (e as Error)?.message);
          await db.from("push_inscricoes").update({ falhas: (s.falhas ?? 0) + 1 }).eq("endpoint", s.endpoint);
        }
      }
      if (mortos.length) {
        const { error: e } = await db.from("push_inscricoes").delete().in("endpoint", mortos);
        if (!e) removidos += mortos.length;
      }
    }
    if (lista.length < 1000) break;
  }
  return { enviados, removidos };
}
