// Coleta dos comentários do Instagram para o visualizador do site (item 26).
// Chamada por pg_cron a cada 3 horas com o header x-cron-secret. Secrets: CRON_SECRET, IG_ACCESS_TOKEN.
// Para cada post publicado nos últimos 90 dias (com ig_media_id): lê os comentários na Graph API,
// grava/atualiza na tabela `comentarios` e apaga os que sumiram do Instagram.
// Nunca mexe na coluna `oculto` (quem esconde um comentário do site decide isso à mão).
// Publicar com --no-verify-jwt (a proteção é o x-cron-secret).

import { createClient } from "npm:@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v23.0";
const DIAS_JANELA = 90;
const POR_PAGINA = 20;
const MAX_PAGINAS = 5; // até 100 comentários por post (o site mostra só os 20 mais recentes)

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

type ComentarioGraph = {
  id?: string;
  text?: string;
  username?: string;
  timestamp?: string;
  like_count?: number;
};

/** Lê os comentários de uma mídia. `completo` = leu todas as páginas (só então dá para apagar os que sumiram). */
async function lerComentarios(mediaId: string, token: string): Promise<{ itens: ComentarioGraph[]; completo: boolean }> {
  const inicial = new URL(`${GRAPH}/${encodeURIComponent(mediaId)}/comments`);
  inicial.searchParams.set("fields", "id,text,username,timestamp,like_count");
  inicial.searchParams.set("limit", String(POR_PAGINA));

  const itens: ComentarioGraph[] = [];
  let proxima: string | null = inicial.toString();
  for (let pagina = 0; proxima && pagina < MAX_PAGINAS; pagina++) {
    const r: Response = await fetch(proxima, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    // deno-lint-ignore no-explicit-any
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
    for (const c of j.data ?? []) itens.push(c);
    // O link `next` da Graph já carrega o token na query; usa só se for do próprio graph.facebook.com.
    const next: string | null = typeof j?.paging?.next === "string" ? j.paging.next : null;
    proxima = next && next.startsWith("https://graph.facebook.com/") ? next : null;
  }
  return { itens, completo: proxima === null };
}

const corta = (s: unknown, max: number): string | null =>
  typeof s === "string" && s.trim() ? s.trim().slice(0, max) : null;

Deno.serve(async (req) => {
  const segredo = Deno.env.get("CRON_SECRET");
  if (!segredo || req.headers.get("x-cron-secret") !== segredo) return json({ erro: "não autorizado" }, 401);

  const token = Deno.env.get("IG_ACCESS_TOKEN");
  if (!token) return json({ ok: false, motivo: "sem_token" }, 500);

  const desde = new Date(Date.now() - DIAS_JANELA * 86400_000).toISOString();
  const { data: posts, error } = await db
    .from("posts")
    .select("id, ig_media_id")
    .eq("status", "publicado")
    .not("ig_media_id", "is", null)
    // Stories não têm comentários públicos nem aparecem no site (tipo nulo = post antigo, de feed).
    .or("tipo.is.null,tipo.neq.STORIES")
    .gte("atualizado_em", desde);
  if (error) return json({ ok: false, motivo: "erro_banco", detalhe: error.message }, 500);

  let gravados = 0;
  let apagados = 0;
  const falhas: string[] = [];

  for (const p of posts ?? []) {
    try {
      const { itens, completo } = await lerComentarios(p.ig_media_id!, token);
      const agora = new Date().toISOString();
      const linhas = itens
        .filter((c) => typeof c.id === "string" && c.id)
        .map((c) => ({
          id: c.id!,
          post_id: p.id,
          usuario: corta(c.username, 64),
          texto: corta(c.text, 2200),
          curtidas: typeof c.like_count === "number" ? c.like_count : null,
          criado_em: c.timestamp ?? null,
          coletado_em: agora,
        }));

      if (linhas.length) {
        const { error: e } = await db.from("comentarios").upsert(linhas, { onConflict: "id" });
        if (e) throw new Error(e.message);
        gravados += linhas.length;
      }

      // Apaga os que sumiram do Instagram (só quando a leitura foi completa).
      if (completo) {
        let q = db.from("comentarios").delete({ count: "exact" }).eq("post_id", p.id);
        if (linhas.length) q = q.not("id", "in", `(${linhas.map((l) => `"${l.id.replace(/"/g, "")}"`).join(",")})`);
        const { error: e, count } = await q;
        if (e) throw new Error(e.message);
        apagados += count ?? 0;
      }
    } catch (e) {
      falhas.push(`${p.id}: ${(e as Error).message}`);
    }
  }

  if (falhas.length) console.error("Falhas na coleta de comentários:", falhas.slice(0, 10));
  return json({
    ok: true,
    posts: posts?.length ?? 0,
    gravados,
    apagados,
    falhas: falhas.length,
    detalhes: falhas.slice(0, 3).map((f) => f.slice(0, 300)),
  });
});
