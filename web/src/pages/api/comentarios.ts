import type { APIRoute } from "astro";
import { z } from "zod";
import { listarComentarios } from "@/lib/supabase";
import { json, metodoNaoPermitido, supabase } from "./_util";

export const prerender = false;

// Mesmo formato aceito pelo site antigo (8-4-4-4-12 em hexadecimal, sem checar a versão do UUID).
const postId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

/** GET /api/comentarios?post=<uuid>: até 20 comentários do Instagram do post. */
export const GET: APIRoute = async ({ url }) => {
  const post = postId.safeParse(url.searchParams.get("post") ?? "");
  if (!post.success) return json({ erro: "post inválido" }, 400);
  try {
    const comentarios = await listarComentarios(supabase(), post.data);
    // A coleta roda a cada 3 horas: 5 minutos de cache não atrasam nada e poupam o banco.
    return json({ comentarios }, 200, "public, max-age=300, s-maxage=300");
  } catch {
    return json({ erro: "Não consegui carregar os comentários agora." }, 502);
  }
};

// Só GET: qualquer outro método responde 405.
export const ALL = metodoNaoPermitido("GET");
