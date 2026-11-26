// Sincroniza o banco com o perfil do Instagram. Chamada manual ou por cron; o dono usa o botão do /menu.
// POST sem parâmetro: só devolve o plano (nada é alterado). POST ?aplicar=1: executa o plano.
// Valida o header x-cron-secret contra o secret CRON_SECRET (mesmo padrão das outras funções).
// Secrets: CRON_SECRET, ALLOWED_CHAT_ID, IG_USER_ID, IG_ACCESS_TOKEN (+ GOOGLE_* para as imagens).

import { createClient } from "npm:@supabase/supabase-js@2";
import { executar, planejar } from "../_shared/sincronizar.ts";

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
    const plano = await planejar(db);
    const resumo = {
      noInstagram: plano.noInstagram,
      noBanco: plano.noBanco,
      importar: plano.importar.length,
      remover: plano.remover.length,
      semImagem: plano.semImagem.length,
      semLink: plano.semLink.length,
      driveAtivo: plano.driveAtivo,
      avisoRemocao: plano.avisoRemocao ?? null,
    };
    if (new URL(req.url).searchParams.get("aplicar") !== "1") return Response.json({ ok: true, plano: resumo });
    const r = await executar(db, Number(Deno.env.get("ALLOWED_CHAT_ID") ?? "0"), plano);
    return Response.json({ ok: true, plano: resumo, resultado: r });
  } catch (e) {
    return Response.json({ ok: false, erro: (e as Error).message }, { status: 500 });
  }
});
