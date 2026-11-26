// Importa os posts do perfil do Instagram para o banco. Chamada manual ou por cron.
// Valida o header x-cron-secret contra o secret CRON_SECRET (mesmo padrão das outras funções).
// Secrets: CRON_SECRET, ALLOWED_CHAT_ID, IG_USER_ID, IG_ACCESS_TOKEN.

import { createClient } from "npm:@supabase/supabase-js@2";
import { importarPostsDoInstagram } from "../_shared/importar.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  const segredo = Deno.env.get("CRON_SECRET");
  if (!segredo || req.headers.get("x-cron-secret") !== segredo) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const r = await importarPostsDoInstagram(db, Number(Deno.env.get("ALLOWED_CHAT_ID") ?? "0"));
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return Response.json({ ok: false, erro: (e as Error).message }, { status: 500 });
  }
});
