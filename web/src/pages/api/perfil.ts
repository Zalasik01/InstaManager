import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { obterPerfil } from "@/lib/supabase";

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

export const GET: APIRoute = async () => {
  try {
    const perfil = await obterPerfil({
      url: env.SUPABASE_URL,
      chave: env.SUPABASE_PUBLISHABLE_KEY,
    });
    // Os números mudam devagar (coleta diária): 5 minutos de cache bastam.
    return json(perfil, 200, "public, max-age=300, s-maxage=300");
  } catch {
    return json({ erro: "Não consegui carregar o perfil agora." }, 502);
  }
};

// Só GET: qualquer outro método responde 405.
export const ALL: APIRoute = () =>
  json({ erro: "método não permitido" }, 405, "no-store", { allow: "GET" });
