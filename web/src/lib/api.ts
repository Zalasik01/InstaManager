import { z } from "zod";
import type { PerfilPublico, PostsResposta } from "@/types";

/** Cliente tipado de /api/posts. Os mesmos schemas validam a consulta e a resposta. */

export const postSchema = z.object({
  id: z.string(),
  legenda: z.string(),
  publicado_em: z.string(),
  permalink: z.string().nullable(),
  visualizacoes: z.number().nullable(),
  curtidas: z.number().nullable(),
  comentarios: z.number().nullable(),
  imagens: z.array(z.string()),
});

export const postsRespostaSchema = z.object({
  total: z.number().int().nonnegative(),
  posts: z.array(postSchema),
});

/** Parâmetros de consulta aceitos por /api/posts. */
export const consultaPostsSchema = z.object({
  limite: z.coerce.number().int().min(1).max(30).default(12),
  offset: z.coerce.number().int().min(0).default(0),
});

export const TAMANHO_PAGINA = 12;

export class ErroApi extends Error {
  readonly status: number;
  constructor(mensagem: string, status: number) {
    super(mensagem);
    this.name = "ErroApi";
    this.status = status;
  }
}

export async function buscarPosts(
  offset: number,
  limite = TAMANHO_PAGINA,
  sinal?: AbortSignal,
): Promise<PostsResposta> {
  const init: RequestInit = { headers: { Accept: "application/json" } };
  if (sinal) init.signal = sinal;
  const r = await fetch(`/api/posts?limite=${limite}&offset=${offset}`, init);
  if (!r.ok) {
    let msg = "Não consegui carregar os posts agora.";
    try {
      const corpo = z.object({ erro: z.string() }).safeParse(await r.json());
      if (corpo.success) msg = corpo.data.erro;
    } catch {
      /* corpo não era JSON: mantém a mensagem padrão */
    }
    throw new ErroApi(msg, r.status);
  }
  return postsRespostaSchema.parse(await r.json());
}

export const perfilSchema = z.object({
  seguidores: z.number().nullable(),
  seguindo: z.number().nullable(),
  posts: z.number().nullable(),
  atualizado_em: z.string().nullable(),
});

export async function buscarPerfil(sinal?: AbortSignal): Promise<PerfilPublico> {
  const init: RequestInit = { headers: { Accept: "application/json" } };
  if (sinal) init.signal = sinal;
  const r = await fetch("/api/perfil", init);
  if (!r.ok) throw new ErroApi("Não consegui carregar o perfil agora.", r.status);
  return perfilSchema.parse(await r.json());
}
