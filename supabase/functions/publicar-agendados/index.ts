// Publica os posts agendados que já chegaram na hora. Chamada a cada minuto pelo pg_cron (ver migração de agendamento).
// Secrets: CRON_SECRET, TELEGRAM_BOT_TOKEN, IG_ACCESS_TOKEN, IG_USER_ID.
// Deploy sem verificação de JWT (a autenticação é o header x-cron-secret): functions deploy publicar-agendados --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import { publicarNoInstagram } from "../_shared/instagram.ts";
import { arquivarPostNoDrive } from "../_shared/arquivar.ts";

const LIMITE_POR_EXECUCAO = 5;

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

/** Avisa o dono no Telegram. Falha de aviso nunca derruba a publicação. */
async function avisar(chat_id: number, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id, text }),
    });
  } catch (e) {
    console.error("aviso Telegram falhou", e);
  }
}

/** Comparação em tempo constante para o segredo do cron. */
function igual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const esperado = Deno.env.get("CRON_SECRET") ?? "";
  const recebido = req.headers.get("x-cron-secret") ?? "";
  if (!esperado || !igual(recebido, esperado)) {
    return new Response("forbidden", { status: 403 });
  }

  const agora = new Date().toISOString();
  const { data: vencidos, error } = await db
    .from("posts")
    .select("id")
    .eq("status", "agendado")
    .lte("agendado_para", agora)
    .order("agendado_para", { ascending: true })
    .limit(LIMITE_POR_EXECUCAO);
  if (error) {
    console.error(error);
    return new Response(`erro: ${error.message}`, { status: 500 });
  }

  let publicados = 0;
  let falhas = 0;

  for (const { id } of vencidos ?? []) {
    // Trava atômica: só uma execução consegue mudar agendado -> publicando.
    const { data: post } = await db
      .from("posts")
      .update({ status: "publicando", atualizado_em: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "agendado")
      .select("*")
      .maybeSingle();
    if (!post) continue; // outra execução já pegou

    try {
      const urls = post.storage_paths.map(
        (p: string) => db.storage.from("fotos").getPublicUrl(p).data.publicUrl,
      );
      const igId = await publicarNoInstagram(urls, post.legenda ?? "");
      await db.from("posts").update({
        status: "publicado",
        ig_media_id: igId,
        erro_msg: null,
        atualizado_em: new Date().toISOString(),
      }).eq("id", id);
      publicados++;
      await avisar(post.chat_id, "Post agendado publicado no Instagram.");
      await arquivarPostNoDrive(db, post);
    } catch (e) {
      const msg = (e as Error).message;
      await db.from("posts").update({
        status: "erro",
        erro_msg: msg,
        atualizado_em: new Date().toISOString(),
      }).eq("id", id);
      falhas++;
      await avisar(post.chat_id, `Falha ao publicar o post agendado: ${msg}`);
    }
  }

  return Response.json({ encontrados: vencidos?.length ?? 0, publicados, falhas });
});
