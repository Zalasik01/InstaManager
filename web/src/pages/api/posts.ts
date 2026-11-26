import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { consultaPostsSchema } from "@/lib/api";
import { listarPosts } from "@/lib/supabase";

// Endpoint dinâmico: roda no Worker. As páginas do site são estáticas.
export const prerender = false;

const json = (corpo: unknown, status = 200, cache = "no-store", extra: HeadersInit = {}) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache,
      ...extra,
    },
  });

export const GET: APIRoute = async ({ url }) => {
  const consulta = consultaPostsSchema.safeParse({
    limite: url.searchParams.get("limite") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });
  if (!consulta.success) {
    return json({ erro: "Parâmetros inválidos: limite de 1 a 30 e offset a partir de 0." }, 400);
  }
  try {
    const dados = await listarPosts(
      { url: env.SUPABASE_URL, chave: env.SUPABASE_PUBLISHABLE_KEY },
      consulta.data.limite,
      consulta.data.offset,
    );
    // 1 minuto no navegador e na borda do Cloudflare: o site não martela o banco.
    return json(dados, 200, "public, max-age=60, s-maxage=60");
  } catch {
    return json({ erro: "Não consegui carregar os posts agora. Tente de novo em instantes." }, 502);
  }
};

// Só GET: qualquer outro método responde 405.
export const ALL: APIRoute = () =>
  json({ erro: "método não permitido" }, 405, "no-store", { allow: "GET" });
