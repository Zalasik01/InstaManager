import { z } from "zod";
import type { Clique, Comentario, Perfil, PostsResposta } from "@/types";

/**
 * Cliente tipado das rotas /api/* (navegador). Os mesmos schemas validam a resposta aqui
 * e a consulta no servidor (consultaPostsSchema).
 */

export const postSchema = z.object({
  id: z.string(),
  legenda: z.string(),
  publicado_em: z.string(),
  permalink: z.string().nullable(),
  visualizacoes: z.number().nullable(),
  curtidas: z.number().nullable(),
  comentarios: z.number().nullable(),
  video: z.string().nullable(),
  imagens: z.array(z.string()),
  fixado: z.boolean(),
});

export const postsRespostaSchema = z.object({
  total: z.number().int().nonnegative(),
  posts: z.array(postSchema),
});

/**
 * Parâmetros de /api/posts, com o mesmo comportamento do site antigo: valor ausente, inválido ou 0
 * vira o padrão (limite 12, offset 0) e o limite fica preso entre 1 e 30. Nunca falha.
 */
const inteiro = (padrao: number) =>
  z
    .unknown()
    .transform((v) => (typeof v === "string" ? Number.parseInt(v, 10) : Number.NaN))
    .transform((n) => (Number.isFinite(n) && n !== 0 ? n : padrao));

export const consultaPostsSchema = z.object({
  limite: inteiro(12).transform((n) => Math.min(Math.max(n, 1), 30)),
  offset: inteiro(0).transform((n) => Math.max(n, 0)),
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

async function obterJson(caminho: string, padrao: string, sinal?: AbortSignal): Promise<unknown> {
  const init: RequestInit = { headers: { Accept: "application/json" } };
  if (sinal) init.signal = sinal;
  const r = await fetch(caminho, init);
  if (!r.ok) {
    let msg = padrao;
    try {
      const corpo = z.object({ erro: z.string() }).safeParse(await r.json());
      if (corpo.success) msg = corpo.data.erro;
    } catch {
      /* corpo não era JSON: mantém a mensagem padrão */
    }
    throw new ErroApi(msg, r.status);
  }
  return r.json();
}

export async function buscarPosts(
  offset: number,
  limite = TAMANHO_PAGINA,
  sinal?: AbortSignal,
): Promise<PostsResposta> {
  const corpo = await obterJson(
    `/api/posts?limite=${limite}&offset=${offset}`,
    "Não consegui carregar os posts agora.",
    sinal,
  );
  return postsRespostaSchema.parse(corpo);
}

export const perfilSchema = z.object({
  seguidores: z.number().nullable(),
  seguindo: z.number().nullable(),
  posts: z.number().nullable(),
  atualizado_em: z.string().nullable(),
});

export async function buscarPerfil(sinal?: AbortSignal): Promise<Perfil> {
  const corpo = await obterJson("/api/perfil", "Não consegui carregar o perfil agora.", sinal);
  return perfilSchema.parse(corpo);
}

export const comentarioSchema = z.object({
  usuario: z.string(),
  texto: z.string(),
  curtidas: z.number().nullable(),
  criado_em: z.string(),
});

export async function buscarComentarios(
  postId: string,
  sinal?: AbortSignal,
): Promise<Comentario[]> {
  const corpo = await obterJson(
    `/api/comentarios?post=${encodeURIComponent(postId)}`,
    "Não consegui carregar os comentários agora.",
    sinal,
  );
  return z.object({ comentarios: z.array(comentarioSchema) }).parse(corpo).comentarios;
}

/**
 * Conta um clique num link (POST /api/clique). Não espera resposta e nunca lança erro:
 * usa navigator.sendBeacon (sobrevive à troca de página) e, sem ele, fetch com keepalive.
 * O corpo vai como text/plain para o sendBeacon não precisar de preflight; o servidor aceita os dois tipos.
 */
export function registrarClique({ linkId, url, titulo }: Clique): void {
  try {
    const corpo = JSON.stringify({ linkId, url, titulo: titulo.slice(0, 150) });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([corpo], { type: "text/plain;charset=UTF-8" });
      if (navigator.sendBeacon("/api/clique", blob)) return;
    }
    void fetch("/api/clique", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: corpo,
      keepalive: true,
    }).catch(() => {
      /* contagem é só estatística: falha em silêncio */
    });
  } catch {
    /* idem */
  }
}
