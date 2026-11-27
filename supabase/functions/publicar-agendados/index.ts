// Publica os posts agendados que já chegaram na hora. Chamada a cada minuto pelo pg_cron (ver migração de agendamento).
// Publica conforme posts.tipo: FEED (foto/carrossel), REELS (vídeo) ou STORIES (foto ou vídeo).
// Secrets: CRON_SECRET, TELEGRAM_BOT_TOKEN, IG_ACCESS_TOKEN, IG_USER_ID.
// Deploy sem verificação de JWT (a autenticação é o header x-cron-secret): functions deploy publicar-agendados --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import { publicarPorTipo, type TipoPost } from "../_shared/instagram.ts";
import { concluirPublicacao } from "../_shared/concluir.ts";
import { caminhoSemMarca, comOriginais } from "../_shared/opcoes.ts";
import { enviarResumoPublicacao } from "../_shared/pospublicacao.ts";

const LIMITE_POR_EXECUCAO = 5;
// Reel pode levar até ~90 s para o Instagram processar. Passado este tempo, não pega post novo:
// o cron roda de novo no minuto seguinte e continua de onde parou (a função morre perto de 150 s).
const ORCAMENTO_MS = 40000;

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

  // Recupera posts travados em 'publicando' (a função morreu no meio, por exemplo por timeout).
  // Vão para 'erro' num único update atômico. Não republica sozinho, para não duplicar o post.
  const limiteTravado = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: travados, error: erroTravados } = await db
    .from("posts")
    .update({
      status: "erro",
      erro_msg: "Travou ao publicar (sem resposta por mais de 10 min). Confira o Instagram antes de tentar de novo.",
      atualizado_em: new Date().toISOString(),
    })
    .eq("status", "publicando")
    .lt("atualizado_em", limiteTravado)
    .select("id,chat_id");
  if (erroTravados) console.error("recuperar travados falhou", erroTravados);
  for (const t of travados ?? []) {
    await avisar(
      t.chat_id,
      "Um post travou ao publicar e foi marcado com erro. Confira o Instagram e, se não saiu, use /menu > Com erro para tentar de novo.",
    );
  }
  const recuperados = travados?.length ?? 0;

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
  const inicio = Date.now();

  for (const { id } of vencidos ?? []) {
    if (Date.now() - inicio > ORCAMENTO_MS) break; // o resto fica para a próxima execução
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
      // Publica conforme o tipo: FEED (foto/carrossel), REELS (vídeo) ou STORIES (foto ou vídeo).
      const tipo: TipoPost = post.tipo ?? "FEED";
      // Story usa a foto sem marca d'água (quando a marca está ligada, a original fica ao lado no Storage).
      const urls = post.storage_paths.map(
        (p: string) => db.storage.from("fotos").getPublicUrl(tipo === "STORIES" ? caminhoSemMarca(p) : p).data.publicUrl,
      );
      const igId = await publicarPorTipo(tipo, urls, post.storage_paths, post.legenda ?? "");
      await db.from("posts").update({
        status: "publicado",
        ig_media_id: igId,
        erro_msg: null,
        atualizado_em: new Date().toISOString(),
      }).eq("id", id);
      publicados++;
      if (tipo === "STORIES") {
        // Story não tem legenda, hashtags nem link fixo (some em 24 h): pula resumo, hashtags e galeria.
        // O arquivo sai do Storage `fotos` para poupar espaço (o Instagram já processou a mídia).
        await avisar(post.chat_id, "Story agendado publicado no Instagram.");
        if (post.storage_paths?.length) await db.storage.from("fotos").remove(comOriginais(post.storage_paths));
      } else {
        await avisar(
          post.chat_id,
          tipo === "REELS" ? "Reel agendado publicado no Instagram." : "Post agendado publicado no Instagram.",
        );
        await enviarResumoPublicacao(db, post.chat_id, igId, post.id); // link, QR code e embed
        await db.rpc("registrar_usos_hashtags", { p_post_id: post.id }); // conta o uso de cada hashtag
        // Story automático (se ligado), galeria do site + Drive (foto ou Reel) e aviso de post novo no site.
        // Nada disso derruba a publicação: concluirPublicacao trata as próprias falhas.
        await concluirPublicacao(db, post, tipo, (t) => avisar(post.chat_id, t))
          .catch((e) => console.error("concluir publicação:", e));
      }
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

  return Response.json({ encontrados: vencidos?.length ?? 0, publicados, falhas, recuperados });
});
