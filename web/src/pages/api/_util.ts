import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import type { ConfigSupabase } from "@/lib/supabase";

/**
 * Peças comuns das rotas /api/* (o "_" no nome deixa este arquivo fora do roteador do Astro).
 * Comportamento portado de site/src/index.ts.
 */

export const json = (corpo: unknown, status = 200, cache = "no-store", extra: HeadersInit = {}) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache,
      ...extra,
    },
  });

/** Configuração do Supabase a partir das vars do Worker (wrangler.jsonc). */
export const supabase = (): ConfigSupabase => ({
  url: env.SUPABASE_URL,
  chave: env.SUPABASE_PUBLISHABLE_KEY,
});

/** Resposta padrão para método não aceito pela rota. */
export const metodoNaoPermitido =
  (permitidos: string): APIRoute =>
  () =>
    json({ erro: "método não permitido" }, 405, "no-store", { allow: permitidos });

/** Só aceita pedidos do próprio site (o navegador sempre manda Origin em POST/DELETE com fetch). */
export function origemPermitida(request: Request): boolean {
  const origem = request.headers.get("origin");
  return !origem || origem === new URL(request.url).origin;
}

/** Lê o corpo como texto com limite de tamanho. null = grande demais. */
export async function lerCorpo(request: Request, maximo: number): Promise<string | null> {
  const declarado = Number(request.headers.get("content-length") ?? "0");
  if (declarado > maximo) return null;
  const texto = await request.text();
  return texto.length > maximo ? null : texto;
}
