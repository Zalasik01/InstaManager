// Coleta diária de métricas (Insights do Instagram) e aprendizado de hashtags.
// Chamada por pg_cron com o header x-cron-secret. Secrets: CRON_SECRET, IG_ACCESS_TOKEN.
// Não derruba por falta de permissão: devolve { ok:false, motivo:"sem_permissao_insights" }.

import { createClient } from "npm:@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v23.0";
const DIAS_JANELA = 30;
const MIN_USOS = 2; // mínimo de posts com a tag para mexer na nota
const PESO_NOVO = 0.3; // média móvel suave: nota = 0.7 * antiga + 0.3 * nova

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

class ErroGraph extends Error {
  status: number;
  codigo: number | undefined;
  constructor(status: number, codigo: number | undefined, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

/** Lê seguidores, seguindo e total de posts do perfil e grava em perfil_ig (o site lê de lá). */
async function atualizarPerfil(): Promise<{ seguidores: number | null }> {
  const ig = Deno.env.get("IG_USER_ID");
  const token = Deno.env.get("IG_ACCESS_TOKEN");
  if (!ig || !token) throw new Error("secrets do Instagram ausentes");
  const r = await fetch(
    `https://graph.facebook.com/v23.0/${ig}?fields=followers_count,follows_count,media_count`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) },
  );
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
  const { error } = await db.from("perfil_ig").upsert({
    id: 1,
    seguidores: j.followers_count ?? null,
    seguindo: j.follows_count ?? null,
    midias: j.media_count ?? null,
    atualizado_em: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return { seguidores: j.followers_count ?? null };
}

// Conjuntos de métricas, do mais completo ao mais enxuto (tipos de mídia aceitam métricas diferentes).
// `views` (visualizações) é a métrica nova que substitui impressions/plays; vem primeiro e,
// se algum tipo de mídia recusar, os conjuntos seguintes tiram `views` e seguem sem ela.
const CONJUNTOS = [
  ["reach", "views", "likes", "comments", "saved", "shares", "total_interactions"],
  ["reach", "views", "likes", "comments", "saved", "shares"],
  ["reach", "likes", "comments", "saved", "shares", "total_interactions"],
  ["reach", "likes", "comments", "saved", "shares"],
  ["reach", "saved", "shares"],
  ["reach"],
];

function semPermissao(e: unknown): boolean {
  if (!(e instanceof ErroGraph)) return false;
  const msg = e.message.toLowerCase();
  const porMensagem = /permission|permiss|manage_insights|not authorized|oauth/.test(msg);
  return e.codigo !== undefined && [10, 200, 190].includes(e.codigo) && porMensagem;
}

async function insights(mediaId: string, metricas: string[]): Promise<Record<string, number>> {
  const url = new URL(`${GRAPH}/${mediaId}/insights`);
  url.searchParams.set("metric", metricas.join(","));
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${Deno.env.get("IG_ACCESS_TOKEN")}` },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroGraph(r.status, j?.error?.code, j?.error?.message ?? `HTTP ${r.status}`);
  const saida: Record<string, number> = {};
  for (const m of j.data ?? []) {
    const v = m.values?.[0]?.value ?? m.total_value?.value;
    if (typeof v === "number") saida[m.name] = v;
  }
  return saida;
}

/** Tenta conjuntos menores quando a API recusa alguma métrica (400 que não é de permissão). */
async function buscarInsights(mediaId: string): Promise<Record<string, number>> {
  let ultimo: unknown = new Error("sem métricas aceitas");
  for (const conjunto of CONJUNTOS) {
    try {
      return await insights(mediaId, conjunto);
    } catch (e) {
      if (semPermissao(e)) throw e;
      if (e instanceof ErroGraph && e.status === 400) {
        ultimo = e;
        continue;
      }
      throw e;
    }
  }
  throw ultimo;
}

const extrairTags = (legenda: string | null): string[] =>
  [...new Set((legenda ?? "").toLowerCase().match(/#[\p{L}\p{N}_]+/gu) ?? [])];

function mediana(v: number[]): number {
  if (!v.length) return 0;
  const o = [...v].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/** Atualiza hashtags.nota e ultimo_uso a partir dos posts da janela. Só mexe em tags já cadastradas. */
async function aprenderHashtags(): Promise<{ tags_atualizadas: number }> {
  const desde = new Date(Date.now() - DIAS_JANELA * 86400_000).toISOString();
  const { data: posts } = await db
    .from("posts")
    .select("id, legenda, atualizado_em")
    .eq("status", "publicado")
    .gte("atualizado_em", desde);
  if (!posts?.length) return { tags_atualizadas: 0 };

  // Última métrica de cada post.
  const { data: mets } = await db
    .from("metricas")
    .select("post_id, alcance, coletado_em")
    .in("post_id", posts.map((p) => p.id))
    .order("coletado_em", { ascending: false });
  const alcance = new Map<string, number>();
  for (const m of mets ?? []) {
    if (!alcance.has(m.post_id) && typeof m.alcance === "number") alcance.set(m.post_id, m.alcance);
  }
  const med = mediana([...alcance.values()]);

  const { data: cadastradas } = await db.from("hashtags").select("tag, nota, ultimo_uso");
  const porTag = new Map((cadastradas ?? []).map((h) => [h.tag.toLowerCase(), h]));

  const relativos = new Map<string, number[]>();
  const ultimoUso = new Map<string, string>();
  for (const p of posts) {
    for (const tag of extrairTags(p.legenda)) {
      if (!porTag.has(tag)) continue; // tag nova nunca entra sozinha
      if (!ultimoUso.has(tag) || p.atualizado_em > ultimoUso.get(tag)!) ultimoUso.set(tag, p.atualizado_em);
      const a = alcance.get(p.id);
      if (a !== undefined && med > 0) {
        if (!relativos.has(tag)) relativos.set(tag, []);
        relativos.get(tag)!.push(a / med);
      }
    }
  }

  let atualizadas = 0;
  for (const [tag, h] of porTag) {
    const upd: Record<string, unknown> = {};
    const uso = ultimoUso.get(tag);
    if (uso && (!h.ultimo_uso || uso > h.ultimo_uso)) upd.ultimo_uso = uso;
    const rel = relativos.get(tag);
    if (rel && rel.length >= MIN_USOS) {
      const media = rel.reduce((s, x) => s + x, 0) / rel.length;
      const antiga = Number(h.nota ?? 0);
      // nota 0 = nunca avaliada: começa direto na média observada.
      const nova = antiga === 0 ? media : antiga * (1 - PESO_NOVO) + media * PESO_NOVO;
      upd.nota = Math.round(nova * 1000) / 1000;
    }
    if (Object.keys(upd).length) {
      // Usa a grafia original da chave (h.tag) para casar com a linha.
      await db.from("hashtags").update(upd).eq("tag", h.tag);
      atualizadas++;
    }
  }
  return { tags_atualizadas: atualizadas };
}

Deno.serve(async (req) => {
  const segredo = Deno.env.get("CRON_SECRET");
  if (!segredo || req.headers.get("x-cron-secret") !== segredo) return json({ erro: "não autorizado" }, 401);

  const desde = new Date(Date.now() - DIAS_JANELA * 86400_000).toISOString();
  const { data: posts, error } = await db
    .from("posts")
    .select("id, ig_media_id")
    .eq("status", "publicado")
    .not("ig_media_id", "is", null)
    .gte("atualizado_em", desde);
  if (error) return json({ ok: false, motivo: "erro_banco", detalhe: error.message }, 500);

  let gravados = 0;
  const falhas: string[] = [];

  // Números do perfil (seguidores etc.) para o site: independente dos posts e da permissão de insights.
  let perfil: { seguidores: number | null } | null = null;
  try {
    perfil = await atualizarPerfil();
  } catch (e) {
    falhas.push(`perfil: ${(e as Error).message}`);
  }

  for (const p of posts ?? []) {
    try {
      const m = await buscarInsights(p.ig_media_id!);
      const { error: e } = await db.from("metricas").insert({
        post_id: p.id,
        alcance: m.reach ?? null,
        impressoes: null, // imagem/carrossel não aceitam impressions nas versões novas
        visualizacoes: m.views ?? null,
        curtidas: m.likes ?? null,
        comentarios: m.comments ?? null,
        salvamentos: m.saved ?? null,
        compartilhamentos: m.shares ?? null,
        interacoes_total: m.total_interactions ?? null,
      });
      if (e) falhas.push(`${p.id}: ${e.message}`);
      else gravados++;
    } catch (e) {
      if (semPermissao(e)) {
        console.error("Token sem a permissão instagram_manage_insights:", (e as Error).message);
        return json({
          ok: false,
          motivo: "sem_permissao_insights",
          ajuda: "Veja docs/metricas.md para adicionar a permissão e gerar um token novo.",
        });
      }
      falhas.push(`${p.id}: ${(e as Error).message}`);
    }
  }

  let aprendizado: { tags_atualizadas: number } | null = null;
  try {
    aprendizado = await aprenderHashtags();
  } catch (e) {
    falhas.push(`hashtags: ${(e as Error).message}`);
  }
  if (falhas.length) console.error("Falhas na coleta:", falhas.slice(0, 10));
  return json({
    ok: true,
    posts: posts?.length ?? 0,
    gravados,
    falhas: falhas.length,
    detalhes: falhas.slice(0, 3).map((f) => f.slice(0, 300)),
    aprendizado,
    perfil,
  });
});
