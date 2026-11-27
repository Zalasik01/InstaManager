import type { APIRoute } from "astro";
import { obterPerfil } from "@/lib/supabase";
import { json, metodoNaoPermitido, supabase } from "./_util";

export const prerender = false;

/** GET /api/perfil: números públicos do Instagram (seguidores, seguindo, posts). */
export const GET: APIRoute = async () => {
  try {
    const perfil = await obterPerfil(supabase());
    // Os números mudam devagar (coleta diária): 5 minutos de cache bastam.
    return json(perfil, 200, "public, max-age=300, s-maxage=300");
  } catch {
    return json({ erro: "Não consegui carregar o perfil agora." }, 502);
  }
};

// Só GET: qualquer outro método responde 405.
export const ALL = metodoNaoPermitido("GET");
