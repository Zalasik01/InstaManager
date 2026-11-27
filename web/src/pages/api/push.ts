import type { APIRoute } from "astro";
import { z } from "zod";
import { rpc } from "@/lib/supabase";
import { json, lerCorpo, metodoNaoPermitido, origemPermitida, supabase } from "./_util";

export const prerender = false;

/**
 * Inscrição de Web Push (aviso de post novo).
 * POST   /api/push  { endpoint, keys: { p256dh, auth } } -> inscrever_push
 * DELETE /api/push  { endpoint }                          -> cancelar_push
 * Valida aqui o básico (corpo pequeno, endpoint https, chaves base64url); o banco valida de novo e limita o total.
 */

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

const endpointSchema = z
  .string()
  .max(1000)
  .refine((e) => {
    try {
      return new URL(e).protocol === "https:";
    } catch {
      return false;
    }
  });

const chavesSchema = z.object({
  p256dh: z.string().max(100).regex(B64URL),
  auth: z.string().max(32).regex(B64URL),
});

type Lido = { ok: true; corpo: unknown } | { ok: false; resposta: Response };

async function ler(request: Request): Promise<Lido> {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return { ok: false, resposta: json({ erro: "envie JSON" }, 415) };
  }
  if (!origemPermitida(request)) {
    return { ok: false, resposta: json({ erro: "origem não permitida" }, 403) };
  }
  const texto = await lerCorpo(request, 4096);
  if (texto === null) return { ok: false, resposta: json({ erro: "corpo grande demais" }, 413) };
  try {
    return { ok: true, corpo: JSON.parse(texto) as unknown };
  } catch {
    return { ok: false, resposta: json({ erro: "JSON inválido" }, 400) };
  }
}

function endpointDe(corpo: unknown): string | null {
  const e = endpointSchema.safeParse((corpo as { endpoint?: unknown } | null)?.endpoint);
  return e.success ? e.data : null;
}

export const POST: APIRoute = async ({ request }) => {
  const lido = await ler(request);
  if (!lido.ok) return lido.resposta;
  const endpoint = endpointDe(lido.corpo);
  if (!endpoint) return json({ erro: "endpoint inválido" }, 400);
  const chaves = chavesSchema.safeParse((lido.corpo as { keys?: unknown }).keys);
  if (!chaves.success) return json({ erro: "chaves inválidas" }, 400);
  try {
    await rpc<boolean>(supabase(), "inscrever_push", {
      p_endpoint: endpoint,
      p_p256dh: chaves.data.p256dh,
      p_auth: chaves.data.auth,
    });
    return json({ ok: true }, 201);
  } catch {
    return json({ erro: "Não deu para salvar a inscrição agora." }, 502);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const lido = await ler(request);
  if (!lido.ok) return lido.resposta;
  const endpoint = endpointDe(lido.corpo);
  if (!endpoint) return json({ erro: "endpoint inválido" }, 400);
  try {
    await rpc<boolean>(supabase(), "cancelar_push", { p_endpoint: endpoint });
    return json({ ok: true });
  } catch {
    return json({ erro: "Não deu para salvar a inscrição agora." }, 502);
  }
};

// Outros métodos: 405.
export const ALL = metodoNaoPermitido("POST, DELETE");
