// Verificação de saúde das integrações (Telegram, banco, Storage, Instagram, Gemini, Drive, cron, fila).
// Roda tudo em paralelo, com prazo de 10 s cada, e nunca lança: erro vira ok:false.
// Os textos de detalhe não carregam tokens nem segredos.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type Resultado = { nome: string; ok: boolean; detalhe: string };

const PRAZO_MS = 10_000;
const GRAPH = "https://graph.facebook.com/v23.0";
const PASTA_RAIZ_DRIVE = "1Du6uK4QpgrF_iVdpFViZ_GdYWwMSj0Me";

type Verificacao = { nome: string; rodar: () => Promise<{ ok: boolean; detalhe: string }> };

const sinal = () => AbortSignal.timeout(PRAZO_MS);

// deno-lint-ignore no-explicit-any
async function lerJson(r: Response): Promise<any> {
  try {
    return await r.json();
  } catch {
    return null;
  }
}

async function telegram() {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return { ok: false, detalhe: "secret ausente" };
  const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: sinal() });
  const j = await lerJson(r);
  if (!r.ok || !j?.ok) return { ok: false, detalhe: `falhou (HTTP ${r.status})` };
  return { ok: true, detalhe: `@${j.result?.username ?? "?"}` };
}

function banco(db: SupabaseClient) {
  return async () => {
    const { error } = await db.from("posts").select("id").limit(1).abortSignal(sinal());
    if (error) return { ok: false, detalhe: "consulta falhou" };
    return { ok: true, detalhe: "consulta ok" };
  };
}

function storage(db: SupabaseClient) {
  return async () => {
    const { error } = await db.storage.from("fotos").list("", { limit: 1 });
    if (error) return { ok: false, detalhe: "bucket fotos inacessível" };
    return { ok: true, detalhe: "bucket fotos ok" };
  };
}

async function instagram() {
  const token = Deno.env.get("IG_ACCESS_TOKEN");
  const igId = Deno.env.get("IG_USER_ID");
  if (!token || !igId) return { ok: false, detalhe: "secret ausente" };
  const auth = { Authorization: `Bearer ${token}` };

  const r = await fetch(`${GRAPH}/${igId}?fields=username`, { headers: auth, signal: sinal() });
  const j = await lerJson(r);
  if (r.ok && j?.username) return { ok: true, detalhe: `@${j.username}` };

  // Plano B: o ID pode ser válido mesmo sem leitura direta; confere na lista de contas do token.
  const r2 = await fetch(`${GRAPH}/me/assigned_instagram_accounts?fields=id,username`, {
    headers: auth,
    signal: sinal(),
  });
  const j2 = await lerJson(r2);
  if (r2.ok && Array.isArray(j2?.data)) {
    const conta = j2.data.find((c: { id: string }) => String(c.id) === String(igId));
    if (conta) return { ok: true, detalhe: `@${conta.username ?? "?"}` };
    return { ok: false, detalhe: "IG_USER_ID não está nas contas do token" };
  }
  const msg = j?.error?.message ?? j2?.error?.message;
  return { ok: false, detalhe: msg ? `token recusado: ${String(msg).slice(0, 80)}` : `falhou (HTTP ${r.status})` };
}

async function gemini() {
  const chave = Deno.env.get("GEMINI_API_KEY");
  if (!chave) return { ok: false, detalhe: "secret ausente" };
  const modelo = Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-latest";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}`, {
    headers: { "x-goog-api-key": chave },
    signal: sinal(),
  });
  if (r.status === 200) return { ok: true, detalhe: modelo };
  if (r.status === 429 || r.status === 503) return { ok: false, detalhe: "sobrecarregado (temporário)" };
  return { ok: false, detalhe: `falhou (HTTP ${r.status})` };
}

async function drive() {
  const refresh = Deno.env.get("GOOGLE_REFRESH_TOKEN");
  if (!refresh) return { ok: false, detalhe: "não configurado" };
  const id = Deno.env.get("GOOGLE_CLIENT_ID");
  const segredo = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!id || !segredo) return { ok: false, detalhe: "secret ausente" };

  const rt = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: id,
      client_secret: segredo,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
    signal: sinal(),
  });
  const jt = await lerJson(rt);
  if (!rt.ok || !jt?.access_token) {
    if (jt?.error === "invalid_grant") return { ok: false, detalhe: "token do Google expirou/foi revogado" };
    return { ok: false, detalhe: `não renovou o acesso (HTTP ${rt.status})` };
  }

  const params = new URLSearchParams({ fields: "name", supportsAllDrives: "true" });
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${PASTA_RAIZ_DRIVE}?${params}`, {
    headers: { Authorization: `Bearer ${jt.access_token}` },
    signal: sinal(),
  });
  const j = await lerJson(r);
  if (!r.ok) return { ok: false, detalhe: `pasta raiz inacessível (HTTP ${r.status})` };
  return { ok: true, detalhe: String(j?.name ?? "pasta ok") };
}

function cron(db: SupabaseClient) {
  return async () => {
    const { data, error } = await db.rpc("status_cron").abortSignal(sinal());
    if (error) return { ok: false, detalhe: "status_cron indisponível" };
    const job = (data ?? []).find((j: { jobname: string }) => j.jobname === "publicar-agendados");
    if (!job) return { ok: false, detalhe: "job publicar-agendados não existe" };
    if (!job.ultima_execucao) return { ok: false, detalhe: "nunca rodou" };
    const min = Math.floor((Date.now() - new Date(job.ultima_execucao).getTime()) / 60_000);
    if (job.status !== "succeeded") return { ok: false, detalhe: `última execução: ${job.status} (há ${min} min)` };
    if (min > 3) return { ok: false, detalhe: `rodou há ${min} min (esperado até 3)` };
    return { ok: true, detalhe: `rodou há ${min} min` };
  };
}

function fila(db: SupabaseClient) {
  return async () => {
    const limite = new Date(Date.now() - 10 * 60_000).toISOString();
    const [presos, erros] = await Promise.all([
      db.from("posts").select("id", { count: "exact", head: true }).eq("status", "publicando").lt("atualizado_em", limite)
        .abortSignal(sinal()),
      // Só erros das últimas 48 h: erro antigo e já tratado não deixa a fila vermelha para sempre.
      db.from("posts").select("id", { count: "exact", head: true }).eq("status", "erro")
        .gt("atualizado_em", new Date(Date.now() - 48 * 3600 * 1000).toISOString()).abortSignal(sinal()),
    ]);
    if (presos.error || erros.error) return { ok: false, detalhe: "consulta falhou" };
    const p = presos.count ?? 0;
    const e = erros.count ?? 0;
    return { ok: p === 0 && e === 0, detalhe: `${p} preso(s), ${e} com erro` };
  };
}

function mensagemErro(e: unknown): string {
  const nome = (e as { name?: string })?.name;
  if (nome === "TimeoutError" || nome === "AbortError") return "sem resposta em 10 s";
  return "erro ao verificar";
}

export async function verificarIntegracoes(db: SupabaseClient): Promise<Resultado[]> {
  const lista: Verificacao[] = [
    { nome: "Telegram", rodar: telegram },
    { nome: "Banco de dados", rodar: banco(db) },
    { nome: "Storage", rodar: storage(db) },
    { nome: "Instagram", rodar: instagram },
    { nome: "Gemini", rodar: gemini },
    { nome: "Google Drive", rodar: drive },
    { nome: "Agendador (cron)", rodar: cron(db) },
    { nome: "Fila de posts", rodar: fila(db) },
  ];
  const saidas = await Promise.allSettled(lista.map((v) => v.rodar()));
  return saidas.map((s, i) =>
    s.status === "fulfilled"
      ? { nome: lista[i].nome, ok: s.value.ok, detalhe: s.value.detalhe }
      : { nome: lista[i].nome, ok: false, detalhe: mensagemErro(s.reason) }
  );
}
