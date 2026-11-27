import type { Comentario, Perfil, Post, PostsResposta } from "@/types";

/**
 * Acesso de servidor ao Supabase (usado só pelas rotas /api/* e /m/* do Worker).
 * Usa apenas a chave PUBLISHABLE, pública por desenho: as tabelas têm RLS sem política e o site
 * só alcança o que as funções (RPC) públicas devolvem.
 */

export interface ConfigSupabase {
  url: string;
  chave: string;
}

/** Linha devolvida pela RPC listar_posts_publicos. `fixado` pode faltar enquanto a RPC nova não sobe. */
export interface PostRpc {
  id: string;
  legenda: string | null;
  publicado_em: string;
  permalink: string | null;
  galeria_paths: string[] | null;
  visualizacoes: number | null;
  curtidas: number | null;
  comentarios: number | null;
  video_path?: string | null;
  fixado?: boolean | null;
}

/** Caminho válido de imagem da galeria: AAAA/MM/arquivo.jpg (sem "..", sem barra extra). */
export const CAMINHO_IMAGEM = /^[0-9]{4}\/[0-9]{2}\/[A-Za-z0-9_.-]+\.jpg$/;

export function caminhoImagemValido(caminho: string): boolean {
  return CAMINHO_IMAGEM.test(caminho) && !caminho.includes("..");
}

/** Caminho com cada segmento codificado (para montar URLs). */
const codificar = (caminho: string) => caminho.split("/").map(encodeURIComponent).join("/");

/** URL pública de um arquivo do bucket "galeria" no Supabase. */
export function urlGaleria(supabaseUrl: string, caminho: string): string {
  return `${supabaseUrl}/storage/v1/object/public/galeria/${codificar(caminho)}`;
}

/**
 * URL de uma imagem para o navegador: pelo próprio domínio (/m/...), com cache de borda.
 * Caminho fora do padrão (não deveria acontecer) cai na URL direta do Supabase.
 */
export function urlImagem(supabaseUrl: string, caminho: string): string {
  return caminhoImagemValido(caminho) ? `/m/${caminho}` : urlGaleria(supabaseUrl, caminho);
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
    // Vídeo/Reel: URL do MP4 direto no Supabase (o navegador pede por partes, Range/206).
    video: p.video_path ? urlGaleria(supabaseUrl, p.video_path) : null,
    imagens: (p.galeria_paths ?? []).map((c) => urlImagem(supabaseUrl, c)),
    fixado: p.fixado === true,
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
  // RPC "returns void" responde 204 sem corpo.
  if (r.status === 204) return undefined as T;
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

export function montarPerfil(linhas: readonly PerfilRpc[]): Perfil {
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
): Promise<Perfil> {
  return montarPerfil(await rpc<PerfilRpc[]>(cfg, "obter_perfil_publico", {}, buscar));
}

/** Linha devolvida pela RPC listar_comentarios_publicos. */
interface ComentarioRpc {
  usuario: string | null;
  texto: string | null;
  curtidas: number | null;
  criado_em: string | null;
}

/** Comentários do Instagram de um post (copiados para o banco a cada 3 horas). Máximo 20. */
export async function listarComentarios(
  cfg: ConfigSupabase,
  postId: string,
  buscar: typeof fetch = fetch,
): Promise<Comentario[]> {
  const lista = await rpc<ComentarioRpc[]>(
    cfg,
    "listar_comentarios_publicos",
    { p_post_id: postId, p_limite: 20 },
    buscar,
  );
  return lista.map((c) => ({
    usuario: c.usuario ?? "",
    texto: c.texto ?? "",
    curtidas: c.curtidas,
    criado_em: c.criado_em ?? "",
  }));
}
