import type { PerfilPublico, Post, PostsResposta } from "@/types";

/**
 * Acesso de servidor ao Supabase (só usado por /api/posts).
 * Usa apenas a chave PUBLISHABLE, pública por desenho: as tabelas têm RLS sem política e o site
 * só alcança o que as funções listar_posts_publicos/contar_posts_publicos devolvem.
 */

export interface ConfigSupabase {
  url: string;
  chave: string;
}

/** Linha devolvida pela RPC listar_posts_publicos. */
export interface PostRpc {
  id: string;
  legenda: string | null;
  publicado_em: string;
  permalink: string | null;
  galeria_paths: string[];
  visualizacoes: number | null;
  curtidas: number | null;
  comentarios: number | null;
}

/** URL pública de um arquivo do bucket "galeria", com cada segmento do caminho codificado. */
export function urlImagem(supabaseUrl: string, caminho: string): string {
  const segmentos = caminho.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl}/storage/v1/object/public/galeria/${segmentos}`;
}

export function montarResposta(
  supabaseUrl: string,
  lista: readonly PostRpc[],
  total: number,
): PostsResposta {
  const posts: Post[] = lista.map((p) => ({
    id: p.id,
    legenda: p.legenda ?? "",
    publicado_em: p.publicado_em,
    permalink: p.permalink,
    visualizacoes: p.visualizacoes,
    curtidas: p.curtidas,
    comentarios: p.comentarios,
    imagens: (p.galeria_paths ?? []).map((c) => urlImagem(supabaseUrl, c)),
  }));
  return { total, posts };
}

export async function rpc<T>(
  cfg: ConfigSupabase,
  funcao: string,
  args: Record<string, unknown>,
  buscar: typeof fetch = fetch,
): Promise<T> {
  const r = await buscar(`${cfg.url}/rest/v1/rpc/${funcao}`, {
    method: "POST",
    headers: {
      apikey: cfg.chave,
      authorization: `Bearer ${cfg.chave}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  return (await r.json()) as T;
}

export async function listarPosts(
  cfg: ConfigSupabase,
  limite: number,
  offset: number,
  buscar: typeof fetch = fetch,
): Promise<PostsResposta> {
  const [lista, total] = await Promise.all([
    rpc<PostRpc[]>(cfg, "listar_posts_publicos", { p_limite: limite, p_offset: offset }, buscar),
    rpc<number>(cfg, "contar_posts_publicos", {}, buscar),
  ]);
  return montarResposta(cfg.url, lista, total);
}

/** Linha devolvida pela RPC obter_perfil_publico. */
export interface PerfilRpc {
  seguidores: number | null;
  seguindo: number | null;
  midias: number | null;
  atualizado_em: string;
}

export function montarPerfil(linhas: readonly PerfilRpc[]): PerfilPublico {
  const p = linhas[0];
  return p
    ? {
        seguidores: p.seguidores,
        seguindo: p.seguindo,
        posts: p.midias,
        atualizado_em: p.atualizado_em,
      }
    : { seguidores: null, seguindo: null, posts: null, atualizado_em: null };
}

export async function obterPerfil(
  cfg: ConfigSupabase,
  buscar: typeof fetch = fetch,
): Promise<PerfilPublico> {
  return montarPerfil(await rpc<PerfilRpc[]>(cfg, "obter_perfil_publico", {}, buscar));
}
