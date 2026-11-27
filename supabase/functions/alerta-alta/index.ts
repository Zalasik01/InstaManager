// Alerta de post em alta: de hora em hora, olha os posts publicados nas últimas 48 h e, se algum passar de
// 2x a mediana de alcance dos outros posts (e tiver pelo menos 50 de alcance), avisa UMA vez no Telegram.
// Chamada por pg_cron com o header x-cron-secret. Publicar com --no-verify-jwt.
// Secrets: CRON_SECRET, IG_ACCESS_TOKEN, TELEGRAM_BOT_TOKEN, ALLOWED_CHAT_ID.

import { createClient } from "npm:@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v23.0";
const JANELA_MS = 48 * 3600_000;
const FATOR = 2; // precisa passar de 2x a mediana
const ALCANCE_MIN = 50;
const AMOSTRAS_MIN = 3; // mínimo de outros posts com alcance para a mediana valer
const DESLOCAMENTO_MS = 3 * 3600_000; // BRT = UTC-3

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

class ErroGraph extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

async function insights(mediaId: string, metricas: string[]): Promise<Record<string, number>> {
  const url = new URL(`${GRAPH}/${mediaId}/insights`);
  url.searchParams.set("metric", metricas.join(","));
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${Deno.env.get("IG_ACCESS_TOKEN")}` },
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroGraph(r.status, j?.error?.message ?? `HTTP ${r.status}`);
  const saida: Record<string, number> = {};
  for (const m of j.data ?? []) {
    const v = m.values?.[0]?.value ?? m.total_value?.value;
    if (typeof v === "number") saida[m.name] = v;
  }
  return saida;
}

/** reach + views; se o tipo de mídia recusar (HTTP 400), tenta só reach. */
async function alcanceAgora(mediaId: string): Promise<number | null> {
  try {
    return (await insights(mediaId, ["reach", "views"])).reach ?? null;
  } catch (e) {
    if (e instanceof ErroGraph && e.status === 400) return (await insights(mediaId, ["reach"])).reach ?? null;
    throw e;
  }
}

async function enviarTelegram(texto: string) {
  const r = await fetch(`https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: Number(Deno.env.get("ALLOWED_CHAT_ID")), text: texto.slice(0, 4000) }),
  });
  if (!r.ok) throw new Error(`Telegram ${r.status}`);
}

/** "de hoje", "de ontem" ou "de anteontem" no relógio de Brasília. */
function quando(publicado: Date, agora: Date): string {
  const diaBr = (d: Date) => Math.floor((d.getTime() - DESLOCAMENTO_MS) / 86400_000);
  const dif = diaBr(agora) - diaBr(publicado);
  return dif <= 0 ? "de hoje" : dif === 1 ? "de ontem" : "de anteontem";
}

const fator = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

type Post = { id: string; ig_media_id: string; agendado_para: string | null; atualizado_em: string; permalink: string | null };

Deno.serve(async (req) => {
  const segredo = Deno.env.get("CRON_SECRET");
  if (!segredo || req.headers.get("x-cron-secret") !== segredo) return json({ erro: "não autorizado" }, 401);

  try {
    const agora = new Date();
    const desde = new Date(agora.getTime() - JANELA_MS).toISOString();
    const { data, error } = await db
      .from("posts")
      .select("id, ig_media_id, agendado_para, atualizado_em, permalink")
      .eq("status", "publicado")
      .not("ig_media_id", "is", null)
      .is("alerta_alta_em", null)
      .or(`agendado_para.gte.${desde},and(agendado_para.is.null,atualizado_em.gte.${desde})`);
    if (error) return json({ ok: false, motivo: "erro_banco", detalhe: error.message }, 500);

    // Data real de publicação dentro da janela (e não no futuro).
    const recentes = ((data ?? []) as Post[]).filter((p) => {
      const t = new Date(p.agendado_para ?? p.atualizado_em).getTime();
      return t >= agora.getTime() - JANELA_MS && t <= agora.getTime();
    });
    if (!recentes.length) return json({ ok: true, candidatos: 0 });

    // Mediana dos OUTROS posts (exclui todos os recentes, que ainda estão crescendo).
    const { data: med, error: eMed } = await db.rpc("mediana_alcance", { p_excluir: recentes.map((p) => p.id) });
    if (eMed) return json({ ok: false, motivo: "erro_banco", detalhe: eMed.message }, 500);
    const linha = Array.isArray(med) ? med[0] : med;
    const mediana = Number(linha?.mediana ?? 0);
    const amostras = Number(linha?.amostras ?? 0);
    if (!(mediana > 0) || amostras < AMOSTRAS_MIN) {
      return json({ ok: true, candidatos: recentes.length, motivo: "mediana_sem_dados", amostras });
    }

    let alertas = 0;
    const falhas: string[] = [];
    for (const p of recentes) {
      try {
        const alcance = await alcanceAgora(p.ig_media_id);
        if (alcance === null || alcance < ALCANCE_MIN || alcance <= FATOR * mediana) continue;

        // Marca antes de enviar (só se ninguém marcou): evita alerta duplicado em execuções sobrepostas.
        const { data: marcado, error: eMarca } = await db
          .from("posts")
          .update({ alerta_alta_em: agora.toISOString() })
          .eq("id", p.id)
          .is("alerta_alta_em", null)
          .select("id");
        if (eMarca) throw new Error(eMarca.message);
        if (!marcado?.length) continue;

        const x = fator.format(alcance / mediana);
        const texto =
          `Seu post ${quando(new Date(p.agendado_para ?? p.atualizado_em), agora)} está em alta: ` +
          `${x}x o alcance médio (${inteiro.format(alcance)} contas alcançadas). ` +
          "Bom momento para um Story chamando para ele." +
          (p.permalink ? `\n${p.permalink}` : "");
        try {
          await enviarTelegram(texto);
          alertas++;
        } catch (e) {
          // Não enviou: desmarca para tentar de novo na próxima hora.
          await db.from("posts").update({ alerta_alta_em: null }).eq("id", p.id);
          throw e;
        }
      } catch (e) {
        falhas.push(`${p.id}: ${(e as Error).message}`.slice(0, 300));
      }
    }
    if (falhas.length) console.error("alerta-alta:", falhas.slice(0, 5));
    return json({ ok: true, candidatos: recentes.length, mediana, alertas, falhas: falhas.length, detalhes: falhas.slice(0, 3) });
  } catch (e) {
    console.error("alerta-alta:", (e as Error).message);
    return json({ ok: false, erro: (e as Error).message }, 500);
  }
});
