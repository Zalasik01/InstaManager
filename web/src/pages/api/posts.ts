import type { APIRoute } from "astro";
import { consultaPostsSchema } from "@/lib/api";
import { listarPosts } from "@/lib/supabase";
import { json, metodoNaoPermitido, supabase } from "./_util";

// Endpoint dinâmico: roda no Worker. As páginas do site são estáticas.
export const prerender = false;

/**
 * GET /api/posts?limite=12&offset=0
 * Igual ao site antigo: valor ausente ou inválido vira o padrão, e o limite fica entre 1 e 30.
 * `imagens` saem como /m/<caminho> (mesma origem, cache de borda); `video` é a URL do Supabase.
 */
export const GET: APIRoute = async ({ url }) => {
  const { limite, offset } = consultaPostsSchema.parse({
    limite: url.searchParams.get("limite") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });
  try {
    const dados = await listarPosts(supabase(), limite, offset);
    // 1 minuto no navegador e na borda do Cloudflare: o site não martela o banco.
    return json(dados, 200, "public, max-age=60, s-maxage=60");
  } catch {
    return json({ erro: "Não consegui carregar os posts agora. Tente de novo em instantes." }, 502);
  }
};

// Só GET: qualquer outro método responde 405.
export const ALL = metodoNaoPermitido("GET");
