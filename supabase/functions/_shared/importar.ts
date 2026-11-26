// Importa para o banco os posts que já existem no perfil do Instagram (publicados à mão).
// Lê /{ig-user-id}/media (feed, Reels e carrosséis; Stories não aparecem nessa lista).
// Cada post vira uma linha em posts com status 'publicado' e origem 'importado', e as hashtags da
// legenda entram na contagem de uso. Posts já importados (mesmo ig_media_id) são pulados.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v23.0";

export type ResultadoImportacao = { lidos: number; novos: number; jaExistiam: number };

export async function importarPostsDoInstagram(
  db: SupabaseClient,
  chat_id: number,
  limite = 100,
): Promise<ResultadoImportacao> {
  const ig = Deno.env.get("IG_USER_ID");
  const token = Deno.env.get("IG_ACCESS_TOKEN");
  if (!ig || !token) throw new Error("IG_USER_ID ou IG_ACCESS_TOKEN ausente");

  // deno-lint-ignore no-explicit-any
  const itens: any[] = [];
  let url: string | null = `${GRAPH}/${ig}/media?fields=id,caption,media_type,permalink,timestamp&limit=50`;
  while (url && itens.length < limite) {
    const r: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    });
    // deno-lint-ignore no-explicit-any
    const j: any = await r.json();
    if (!r.ok) throw new Error(`Instagram: ${j?.error?.message ?? r.status}`);
    itens.push(...(j.data ?? []));
    url = j.paging?.next ?? null;
  }
  const lista = itens.slice(0, limite);

  const { data: existentes } = await db.from("posts").select("ig_media_id")
    .in("ig_media_id", lista.map((i) => i.id));
  const ja = new Set((existentes ?? []).map((e: { ig_media_id: string }) => e.ig_media_id));

  let novos = 0;
  for (const m of lista) {
    if (ja.has(m.id)) continue;
    const { data, error } = await db.from("posts").insert({
      chat_id,
      status: "publicado",
      ig_media_id: m.id,
      legenda: m.caption ?? "",
      origem: "importado",
      // Data real do post. O relatório usa agendado_para como "quando saiu".
      agendado_para: m.timestamp,
      criado_em: m.timestamp,
      // atualizado_em = agora: mantém o post na janela de 30 dias da coleta de métricas.
      atualizado_em: new Date().toISOString(),
    }).select("id").single();
    if (error) {
      console.error("importar: falha ao gravar", m.id, error.message);
      continue;
    }
    await db.rpc("registrar_usos_hashtags", { p_post_id: data.id, p_quando: m.timestamp });
    novos++;
  }

  return { lidos: lista.length, novos, jaExistiam: lista.length - novos };
}
