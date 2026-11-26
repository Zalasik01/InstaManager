// Relatório semanal no Telegram: últimos 7 dias de posts, alcance, tags e melhores horários.
// Chamada por pg_cron com o header x-cron-secret.
// Secrets: CRON_SECRET, TELEGRAM_BOT_TOKEN, ALLOWED_CHAT_ID, GEMINI_API_KEY (opcional).

import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-latest";
const FUSO = "America/Sao_Paulo";
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

async function enviarTelegram(texto: string) {
  const r = await fetch(`https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: Number(Deno.env.get("ALLOWED_CHAT_ID")), text: texto.slice(0, 4000) }),
  });
  if (!r.ok) throw new Error(`Telegram ${r.status}`);
}

/** Pede 3 sugestões curtas ao Gemini. Qualquer falha devolve null (o relatório segue sem sugestões). */
async function sugestoes(resumo: string): Promise<string | null> {
  const chave = Deno.env.get("GEMINI_API_KEY");
  if (!chave) return null;
  const corpo = JSON.stringify({
    contents: [{
      parts: [{
        text: "Você é gestor de Instagram de um perfil de Polo 2012 (VW). Com base no resumo abaixo, dê exatamente 3 " +
          "sugestões de ação curtas (uma linha cada, em português, numeradas, sem enfeites).\n\n" + resumo,
      }],
    }],
    generationConfig: { maxOutputTokens: 400, temperature: 0.6 },
  });
  for (const modelo of [MODEL, "gemini-flash-lite-latest"]) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": chave, "content-type": "application/json" },
        body: corpo,
      });
      if (r.ok) {
        const j = await r.json();
        const t = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
        if (t) return t;
        continue;
      }
      if (![429, 503].includes(r.status)) return null;
    } catch {
      // tenta o próximo modelo
    }
  }
  return null;
}

const partesData = (d: Date) => {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: FUSO, weekday: "short", hour: "numeric", hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { dia, hora: Number(p.hour) % 24 };
};

const media = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0);

type Post = { id: string; legenda: string | null; agendado_para: string | null; atualizado_em: string };

/** Alcance mais recente de cada post. */
async function alcances(ids: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (!ids.length) return mapa;
  const { data } = await db
    .from("metricas")
    .select("post_id, alcance, coletado_em")
    .in("post_id", ids)
    .order("coletado_em", { ascending: false });
  for (const m of data ?? []) {
    if (!mapa.has(m.post_id) && typeof m.alcance === "number") mapa.set(m.post_id, m.alcance);
  }
  return mapa;
}

const dataPost = (p: Post) => new Date(p.agendado_para ?? p.atualizado_em);

Deno.serve(async (req) => {
  const segredo = Deno.env.get("CRON_SECRET");
  if (!segredo || req.headers.get("x-cron-secret") !== segredo) return json({ erro: "não autorizado" }, 401);

  try {
    const agora = Date.now();
    const desde7 = new Date(agora - 7 * 86400_000).toISOString();
    const desde30 = new Date(agora - 30 * 86400_000).toISOString();

    const { data: posts30 } = await db
      .from("posts")
      .select("id, legenda, agendado_para, atualizado_em")
      .eq("status", "publicado")
      .gte("atualizado_em", desde30);
    const todos = (posts30 ?? []) as Post[];
    const semana = todos.filter((p) => p.atualizado_em >= desde7);

    if (!semana.length) {
      await enviarTelegram("Relatório semanal: ainda sem dados. Nenhum post publicado nos últimos 7 dias.");
      return json({ ok: true, posts: 0 });
    }

    const alc = await alcances(todos.map((p) => p.id));
    const comDados = semana.filter((p) => alc.has(p.id));
    const linhas: string[] = ["Relatório semanal (últimos 7 dias)", "", `Posts publicados: ${semana.length}`];

    if (!comDados.length) {
      linhas.push(
        "Ainda sem dados de alcance: as métricas não foram coletadas. " +
          "Confira a permissão instagram_manage_insights (veja docs/metricas.md).",
      );
      await enviarTelegram(linhas.join("\n"));
      return json({ ok: true, posts: semana.length, metricas: false });
    }

    const total = comDados.reduce((s, p) => s + alc.get(p.id)!, 0);
    const melhor = comDados.reduce((a, b) => (alc.get(a.id)! >= alc.get(b.id)! ? a : b));
    linhas.push(`Alcance total: ${total}`, `Alcance médio por post: ${Math.round(total / comDados.length)}`);
    const trecho = (melhor.legenda ?? "").replace(/#\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 70);
    linhas.push(`Melhor post: ${alc.get(melhor.id)} de alcance${trecho ? ` ("${trecho}")` : ""}`);

    // Tags: notas aprendidas (só as que já foram avaliadas).
    const { data: tags } = await db
      .from("hashtags")
      .select("tag, nota")
      .gt("nota", 0)
      .order("nota", { ascending: false });
    if (tags && tags.length >= 2) {
      const fmt = (l: { tag: string; nota: number }[]) =>
        l.map((t) => `${t.tag} (${Number(t.nota).toFixed(2)})`).join(", ");
      linhas.push("", `Melhores tags (nota 1,00 = alcance mediano): ${fmt(tags.slice(0, 3))}`);
      linhas.push(`Piores tags: ${fmt(tags.slice(-3).reverse())}`);
    } else {
      linhas.push("", "Tags: ainda sem dados suficientes (cada tag precisa de 2 usos).");
    }

    // Melhor dia e horário nos últimos 30 dias (mais dados que só a semana).
    const porDia = new Map<number, number[]>();
    const porHora = new Map<number, number[]>();
    let comAlcance = 0;
    for (const p of todos) {
      const a = alc.get(p.id);
      if (a === undefined) continue;
      comAlcance++;
      const { dia, hora } = partesData(dataPost(p));
      porDia.set(dia, [...(porDia.get(dia) ?? []), a]);
      porHora.set(hora, [...(porHora.get(hora) ?? []), a]);
    }
    const topo = (m: Map<number, number[]>) =>
      [...m.entries()].map(([k, v]) => ({ k, m: media(v), n: v.length })).sort((a, b) => b.m - a.m)[0];
    const d = topo(porDia);
    const h = topo(porHora);
    if (d && h && comAlcance >= 4) {
      linhas.push(
        `Melhor dia: ${DIAS[d.k]} (média ${Math.round(d.m)}, ${d.n} posts). ` +
          `Melhor horário: ${h.k}h (média ${Math.round(h.m)}, ${h.n} posts). Base: 30 dias.`,
      );
    } else {
      linhas.push("Melhor dia e horário: poucos posts com dados para concluir.");
    }

    const resumo = linhas.join("\n");
    const sug = await sugestoes(resumo);
    await enviarTelegram(sug ? `${resumo}\n\nSugestões:\n${sug}` : resumo);
    return json({ ok: true, posts: semana.length, sugestoes: !!sug });
  } catch (e) {
    console.error("relatorio-semanal:", (e as Error).message);
    return json({ ok: false, erro: (e as Error).message }, 500);
  }
});
