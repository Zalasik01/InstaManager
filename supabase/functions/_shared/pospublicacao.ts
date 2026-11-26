// Depois de publicar: manda ao dono o link do post, o código de embed e um QR code da URL.
// Secrets: TELEGRAM_BOT_TOKEN, IG_ACCESS_TOKEN. É um extra: nunca lança erro.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import QRCode from "npm:qrcode@1.5.4";

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

const escaparHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Busca o permalink; o Instagram às vezes demora a liberar, então tenta até 3 vezes. */
async function buscarPermalink(igMediaId: string): Promise<string | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`https://graph.facebook.com/v23.0/${igMediaId}?fields=permalink`, {
        headers: { Authorization: `Bearer ${Deno.env.get("IG_ACCESS_TOKEN")}` },
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) {
        const j = await r.json();
        if (typeof j.permalink === "string" && j.permalink) return j.permalink.split("?")[0];
      }
    } catch (e) {
      console.error("permalink falhou", (e as Error).message);
    }
    if (i < 2) await esperar(2000);
  }
  return null;
}

async function mensagem(chat_id: number, text: string) {
  await fetch(`https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
}

export async function enviarResumoPublicacao(
  db: SupabaseClient,
  chat_id: number,
  igMediaId: string,
  postId: string,
): Promise<void> {
  try {
    const permalink = await buscarPermalink(igMediaId);
    if (!permalink) {
      await mensagem(chat_id, "Publicado, mas não consegui pegar o link agora.");
      return;
    }
    await db.from("posts").update({ permalink }).eq("id", postId);

    const embed = `<blockquote class="instagram-media" data-instgrm-permalink="${permalink}?utm_source=ig_embed&amp;utm_campaign=loading" data-instgrm-version="14" style="max-width:540px;width:100%"><a href="${permalink}">Ver no Instagram</a></blockquote>\n<script async src="//www.instagram.com/embed.js"></script>`;
    await mensagem(
      chat_id,
      `Link do post:\n${escaparHtml(permalink)}\n\nCódigo de embed:\n<pre><code>${escaparHtml(embed)}</code></pre>`,
    );

    // QR code: se falhar, só registra (link e embed já foram).
    try {
      const png: Uint8Array = await QRCode.toBuffer(permalink, { width: 512, margin: 2 });
      const form = new FormData();
      form.append("chat_id", String(chat_id));
      form.append("caption", "QR code do post");
      form.append("photo", new Blob([new Uint8Array(png)], { type: "image/png" }), "qrcode.png");
      const r = await fetch(`https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")}/sendPhoto`, {
        method: "POST",
        body: form,
      });
      if (!r.ok) console.error("sendPhoto do QR falhou", r.status);
    } catch (e) {
      console.error("QR code falhou", (e as Error).message);
    }
  } catch (e) {
    console.error("resumo da publicação falhou", (e as Error).message);
  }
}
