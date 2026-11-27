import type { APIRoute } from "astro";
import { z } from "zod";
import { rpc } from "@/lib/supabase";
import { json, lerCorpo, metodoNaoPermitido, origemPermitida, supabase } from "./_util";

export const prerender = false;

/**
 * POST /api/clique { linkId, url, titulo } -> registrar_clique (soma 1 no contador do dia).
 * Vem de navigator.sendBeacon (corpo text/plain, para não exigir preflight de CORS) ou de fetch keepalive
 * (application/json). Responde 204 sem corpo. O banco valida de novo.
 */

const cliqueSchema = z.object({
  linkId: z.string().regex(/^[a-z0-9-]{1,80}$/),
  url: z
    .string()
    .max(500)
    .refine((u) => {
      try {
        return new URL(u).protocol === "https:";
      } catch {
        return false;
      }
    }),
  titulo: z.string().max(150),
});

export const POST: APIRoute = async ({ request }) => {
  const tipo = request.headers.get("content-type") ?? "";
  if (!tipo.includes("application/json") && !tipo.includes("text/plain")) {
    return json({ erro: "envie JSON" }, 415);
  }
  if (!origemPermitida(request)) return json({ erro: "origem não permitida" }, 403);
  const texto = await lerCorpo(request, 1024);
  if (texto === null) return json({ erro: "corpo grande demais" }, 413);

  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return json({ erro: "JSON inválido" }, 400);
  }
  const clique = cliqueSchema.safeParse(corpo);
  if (!clique.success) return json({ erro: "clique inválido" }, 400);

  try {
    await rpc<void>(supabase(), "registrar_clique", {
      p_link_id: clique.data.linkId,
      p_url: clique.data.url,
      p_titulo: clique.data.titulo,
    });
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch {
    return json({ erro: "Não deu para registrar o clique agora." }, 502);
  }
};

// Outros métodos: 405.
export const ALL = metodoNaoPermitido("POST");
