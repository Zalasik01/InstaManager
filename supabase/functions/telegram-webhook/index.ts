// Webhook do bot do Telegram.
// Fluxo: recebe foto -> guarda no Storage -> Gemini escreve legenda -> responde com prévia e botões.
// Secrets necessários: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, ALLOWED_CHAT_ID, GEMINI_API_KEY.
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem no ambiente das Edge Functions.

import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { publicarNoInstagram } from "../_shared/instagram.ts";
import { arquivarPostNoDrive } from "../_shared/arquivar.ts";
import { formatarHorario, horaPronta, interpretarHorario } from "../_shared/horario.ts";

const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;
const ALLOWED_CHAT_ID = Number(Deno.env.get("ALLOWED_CHAT_ID") ?? "0");
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-latest";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Toda chamada externa tem prazo: sem isso, uma chamada pendurada mata a função em silêncio.
const comPrazo = (url: string, init: RequestInit = {}, ms = 20000) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(ms) });

// Registro de cada etapa (tabela eventos): se algo travar, dá para ver onde parou.
function trace(etapa: string, detalhe: string | null = null, chat_id: number | null = null) {
  db.from("eventos").insert({ chat_id, etapa, detalhe: detalhe?.slice(0, 500) ?? null })
    .then(() => {}, () => {});
}

const tg = (method: string, body: Record<string, unknown>) =>
  comPrazo(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const enviar = (chat_id: number, text: string, extra: Record<string, unknown> = {}) =>
  tg("sendMessage", { chat_id, text, ...extra });

const teclado = (postId: string) => ({
  inline_keyboard: [
    [
      { text: "Postar agora", callback_data: `agora:${postId}` },
      { text: "Agendar", callback_data: `agendar:${postId}` },
    ],
    [
      { text: "Regerar legenda", callback_data: `regerar:${postId}` },
      { text: "Definir legenda manualmente", callback_data: `manual:${postId}` },
    ],
    [{ text: "Cancelar", callback_data: `cancelar:${postId}` }],
  ],
});

// Guarda os ids das mensagens ligadas a um post (do dono e do bot) para apagá-las ao cancelar.
// Passe postId, ou chat_id+grupo para anexar a todo o álbum.
function lembrar(
  ids: Array<number | undefined>,
  alvo: { postId?: string; chat_id?: number; grupo?: string | null },
) {
  const lista = ids.filter((x): x is number => typeof x === "number");
  if (!lista.length) return Promise.resolve();
  return db.rpc("registrar_mensagens", {
    p_post_id: alvo.postId ?? null,
    p_chat_id: alvo.chat_id ?? null,
    p_media_group_id: alvo.grupo ?? null,
    p_ids: lista,
  }).then(() => {}, () => {});
}

// deno-lint-ignore no-explicit-any
const idDe = (resp: any): number | undefined => resp?.result?.message_id;

// Apaga mensagens do chat (em lotes de 100; ids inexistentes ou com mais de 48 h são ignorados).
async function apagarMensagens(chat_id: number, ids: number[]) {
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += 100) {
    await tg("deleteMessages", { chat_id, message_ids: unicos.slice(i, i + 100) }).catch(() => {});
  }
}

// /limpar: o Telegram não lista o histórico, mas os ids de um chat privado são sequenciais.
// Varre de `ate` até 1 em lotes de 100, com 5 lotes em paralelo.
async function limparChat(chat_id: number, ate: number) {
  const lotes: number[][] = [];
  for (let fim = ate; fim >= 1; fim -= 100) {
    const ids: number[] = [];
    for (let id = fim; id > Math.max(0, fim - 100); id--) ids.push(id);
    lotes.push(ids);
  }
  const trabalhador = async () => {
    for (let lote = lotes.shift(); lote; lote = lotes.shift()) {
      await tg("deleteMessages", { chat_id, message_ids: lote }).catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: 5 }, trabalhador));
}

async function baixarArquivoTelegram(file_id: string): Promise<Uint8Array> {
  const info = await tg("getFile", { file_id });
  if (!info.ok) throw new Error(`getFile falhou: ${info.description}`);
  const r = await comPrazo(`https://api.telegram.org/file/bot${TOKEN}/${info.result.file_path}`, {}, 40000);
  if (!r.ok) throw new Error(`download falhou: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function escolherHashtags(): Promise<string[]> {
  const { data } = await db.from("hashtags").select("tag,tamanho,nota,ultimo_uso");
  const todas = data ?? [];
  const sorteio = (lista: typeof todas, n: number) =>
    lista
      .map((h) => ({ h, r: Math.random() + Number(h.nota) * 0.05 - (h.ultimo_uso ? 0.3 : 0) }))
      .sort((a, b) => b.r - a.r)
      .slice(0, n)
      .map((x) => x.h.tag);
  return [
    ...sorteio(todas.filter((h) => h.tamanho === "grande"), 3),
    ...sorteio(todas.filter((h) => h.tamanho === "media"), 6),
    ...sorteio(todas.filter((h) => h.tamanho === "nicho"), 8),
  ];
}

const CONTEXTO_PADRAO =
  "O carro é um VW Polo 2012 (geração 9n4) e a página é do dono. Escreva em primeira pessoa, focando só no carro, e ignore o cenário.";

// Texto de contexto que o dono edita pelo Telegram (/contexto). Fica na tabela config.
async function carregarContexto(): Promise<string> {
  const { data } = await db.from("config").select("valor").eq("chave", "contexto").maybeSingle();
  return data?.valor ?? CONTEXTO_PADRAO;
}

async function gerarLegenda(jpeg: Uint8Array, dica: string | null): Promise<string> {
  const tags = await escolherHashtags();
  if (!GEMINI_KEY) return `Polo 2012 9n4.\n\n${tags.join(" ")}`;

  const contexto = await carregarContexto();
  const prompt = [
    "Escreva a legenda de um post do Instagram.",
    `Contexto da página (siga à risca): ${contexto}`,
    "Regras:",
    "- Português do Brasil, 1 a 2 linhas curtas.",
    "- A página não tem seguidores: NÃO faça perguntas e NÃO peça comentário, curtida ou marcação.",
    "- Descreva só o que aparece na foto sobre o carro. Não invente.",
    "- No máximo 1 emoji.",
    "- Responda apenas com a legenda, sem hashtags e sem aspas.",
    dica ? `Dica do dono para esta foto (tem prioridade sobre o resto): ${dica}` : "",
  ].filter(Boolean).join("\n");

  const imagem64 = encodeBase64(jpeg);
  // O modelo "lite" recusa thinkingConfig (erro 400): só o modelo principal recebe essa opção.
  const montarCorpo = (modelo: string) =>
    JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: "image/jpeg", data: imagem64 } },
          { text: prompt },
        ],
      }],
      generationConfig: {
        maxOutputTokens: 1000,
        ...(modelo.includes("lite") ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
      },
    });

  // 503/429 são picos temporários: tenta de novo e, se persistir, cai para o modelo lite.
  let texto = "";
  let ultimoErro = "";
  const limite = Date.now() + 45000; // orçamento total: nunca passa de ~45 s
  for (const modelo of [MODEL, "gemini-flash-lite-latest"]) {
    for (let tentativa = 0; tentativa < 2 && !texto && Date.now() < limite; tentativa++) {
      try {
        const r = await comPrazo(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
          {
            method: "POST",
            headers: { "x-goog-api-key": GEMINI_KEY, "content-type": "application/json" },
            body: montarCorpo(modelo),
          },
          15000,
        );
        if (r.ok) {
          const j = await r.json();
          const cand = j.candidates?.[0];
          const t = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
          // Legenda cortada no meio (MAX_TOKENS) não serve: tenta de novo.
          if (t && cand?.finishReason === "STOP") texto = t;
          else ultimoErro = `resposta incompleta (${cand?.finishReason ?? "vazia"})`;
        } else {
          ultimoErro = `${modelo} ${r.status}: ${(await r.text()).replace(/\s+/g, " ").slice(0, 150)}`;
        }
      } catch (e) {
        ultimoErro = `Gemini sem resposta (${(e as Error).name})`;
      }
      if (!texto) await new Promise((res) => setTimeout(res, 1000));
    }
    if (texto) break;
  }
  trace(texto ? "legenda_ok" : "legenda_falhou", texto ? null : ultimoErro);
  if (!texto) {
    // Plano B: nunca deixa o dono sem resposta. A legenda simples pode ser trocada com "Regerar".
    legendaFallback = true;
    return `Polo 2012 9n4.\n\n${tags.join(" ")}`;
  }
  legendaFallback = false;
  return `${texto}\n\n${tags.join(" ")}`;
}

// Indica se a última legenda gerada foi o plano B (Gemini fora do ar).
let legendaFallback = false;

async function tratarFoto(msg: any) {
  const chat_id: number = msg.chat.id;
  const arquivo = msg.photo
    ? msg.photo[msg.photo.length - 1] // maior resolução
    : msg.document;
  if (msg.document && !String(msg.document.mime_type).startsWith("image/")) {
    return enviar(chat_id, "Envie apenas imagens.");
  }
  const dica = msg.caption?.trim() || null;

  trace("foto_recebida", `${arquivo.file_size ?? "?"} bytes, album=${msg.media_group_id ?? "não"}`, chat_id);
  // Confirma na hora que recebeu (em álbum, só a primeira foto avisa, para não encher o chat).
  const recebiId = msg.media_group_id ? undefined : idDe(await enviar(chat_id, "Recebi a foto, processando..."));
  const bytes = await baixarArquivoTelegram(arquivo.file_id);
  trace("foto_baixada", `${bytes.length} bytes`, chat_id);
  // O Instagram recusa JPEG acima de 8 MB.
  if (bytes.length > 8 * 1024 * 1024) {
    return enviar(chat_id, "A foto passa de 8 MB e o Instagram recusa. Envie como foto normal (comprimida).");
  }

  // Storage só aceita JPEG (é o que o Instagram exige). PNG/HEIC: conversão fica para a fase 7.
  const ehJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!ehJpeg) return enviar(chat_id, "Por enquanto só aceito JPEG. Envie como foto normal ou arquivo .jpg.");

  const hoje = new Date();
  const pasta = `${hoje.getUTCFullYear()}/${String(hoje.getUTCMonth() + 1).padStart(2, "0")}/${String(hoje.getUTCDate()).padStart(2, "0")}`;
  const caminho = `${pasta}/${crypto.randomUUID()}.jpg`;
  const up = await db.storage.from("fotos").upload(caminho, bytes, { contentType: "image/jpeg" });
  if (up.error) throw up.error;
  trace("foto_no_storage", caminho, chat_id);

  const grupo: string | null = msg.media_group_id ?? null;

  // Álbum: se já existe rascunho do mesmo grupo, só anexa a foto e termina (sem nova prévia).
  if (grupo) {
    const r = await anexarFotoAoAlbum(chat_id, grupo, arquivo.file_id, caminho, dica);
    if (r !== 0) {
      await lembrar([msg.message_id], { chat_id, grupo });
      return;
    }
  }

  // Cria o post. Numa corrida de álbum, o índice único decide quem cria; quem perde vira anexo.
  const { data: post, error } = await db.from("posts").insert({
    chat_id,
    media_group_id: grupo,
    telegram_file_ids: [arquivo.file_id],
    storage_paths: [caminho],
    dica,
    mensagens: [msg.message_id, recebiId].filter((x) => typeof x === "number"),
  }).select("id").single();
  if (error) {
    if (grupo && error.code === "23505") {
      await anexarFotoAoAlbum(chat_id, grupo, arquivo.file_id, caminho, dica);
      await lembrar([msg.message_id], { chat_id, grupo });
      return;
    }
    throw error;
  }

  // Quem criou espera as outras fotos do álbum chegarem (o webhook já respondeu 200, então é seguro).
  if (grupo) await new Promise((res) => setTimeout(res, 4000));

  const { data: atual, error: erroLer } = await db.from("posts")
    .select("storage_paths,dica,fotos_excedentes").eq("id", post.id).single();
  if (erroLer) throw erroLer;

  // A legenda sai da primeira foto (a do criador), com a dica que o dono escreveu em qualquer foto do álbum.
  const legenda = await gerarLegenda(bytes, atual.dica ?? dica);
  await db.from("posts").update({ legenda, atualizado_em: new Date().toISOString() }).eq("id", post.id);

  const qtd: number = atual.storage_paths.length;
  const aviso = [
    legendaFallback ? "O Gemini não respondeu, então usei uma legenda simples. Toque em Regerar legenda para tentar de novo." : "",
    qtd > 1 ? `Carrossel com ${qtd} fotos.` : "",
    atual.fotos_excedentes > 0 ? `Limite de 10 fotos: ${atual.fotos_excedentes} ignorada(s).` : "",
  ].filter(Boolean).join("\n");
  const previa = await enviar(chat_id, `${aviso ? aviso + "\n\n" : ""}Prévia da legenda:\n\n${legenda}`, {
    reply_markup: teclado(post.id),
  });
  await lembrar([idDe(previa)], { postId: post.id });
  trace("previa_enviada", post.id, chat_id);
}

// Anexa a foto ao rascunho do álbum (RPC atômica). Retorna 0 se não há rascunho desse álbum.
async function anexarFotoAoAlbum(
  chat_id: number,
  grupo: string,
  file_id: string,
  caminho: string,
  dica: string | null,
): Promise<number> {
  const { data, error } = await db.rpc("anexar_foto_post", {
    p_chat_id: chat_id,
    p_media_group_id: grupo,
    p_file_id: file_id,
    p_path: caminho,
    p_dica: dica,
  });
  if (error) throw error;
  if (data === -1) {
    // Foto extra não entra no post: apaga o arquivo órfão.
    await db.storage.from("fotos").remove([caminho]);
  }
  return data as number;
}

async function tratarBotao(cb: any) {
  const chat_id: number = cb.message.chat.id;
  const [acao, postId, extra] = String(cb.data).split(":");
  // Cancelar responde com um aviso rápido na tela (sem deixar mensagem no chat).
  await tg("answerCallbackQuery", {
    callback_query_id: cb.id,
    ...(acao === "cancelar" ? { text: "Cancelado" } : {}),
  });

  const { data: post } = await db.from("posts").select("*").eq("id", postId).maybeSingle();
  if (!post) return enviar(chat_id, "Post não encontrado.");
  if (post.status !== "rascunho") return enviar(chat_id, `Este post já está: ${post.status}.`);

  if (acao === "cancelar") {
    await db.from("posts").update({
      status: "cancelado",
      aguardando_horario: false,
      aguardando_legenda: false,
      atualizado_em: new Date().toISOString(),
    }).eq("id", postId);
    // Apaga do chat a foto do dono e tudo o que o bot mandou para este post, e as fotos do Storage.
    await apagarMensagens(chat_id, [...(post.mensagens ?? []), cb.message.message_id]);
    if (post.storage_paths?.length) await db.storage.from("fotos").remove(post.storage_paths);
    return;
  }

  if (acao === "regerar") {
    const bytes = await baixarArquivoTelegram(post.telegram_file_ids[0]);
    const legenda = await gerarLegenda(bytes, post.dica);
    await db.from("posts").update({ legenda, atualizado_em: new Date().toISOString() }).eq("id", postId);
    const nota = legendaFallback ? "O Gemini não respondeu, então voltei à legenda simples. Tente Regerar de novo.\n\n" : "";
    const r = await enviar(chat_id, `${nota}Nova legenda:\n\n${legenda}`, { reply_markup: teclado(postId) });
    return lembrar([idDe(r)], { postId });
  }

  if (acao === "manual") {
    // O próximo texto do dono vira a legenda deste post. Só um post por vez espera texto.
    await db.from("posts").update({ aguardando_legenda: false, aguardando_horario: false })
      .eq("chat_id", chat_id).or("aguardando_legenda.eq.true,aguardando_horario.eq.true");
    await db.from("posts").update({ aguardando_legenda: true, atualizado_em: new Date().toISOString() }).eq("id", postId);
    const r = await enviar(
      chat_id,
      "Escreva a legenda que você quer e envie como mensagem. Se não colocar hashtags (#), eu mantenho as que já estão na prévia.",
    );
    return lembrar([idDe(r)], { postId });
  }

  if (acao === "agora") {
    await db.from("posts").update({ status: "publicando", atualizado_em: new Date().toISOString() }).eq("id", postId);
    await enviar(chat_id, "Publicando no Instagram...");
    try {
      const urls = post.storage_paths.map(
        (p: string) => db.storage.from("fotos").getPublicUrl(p).data.publicUrl,
      );
      const igId = await publicarNoInstagram(urls, post.legenda);
      await db.from("posts").update({
        status: "publicado",
        ig_media_id: igId,
        atualizado_em: new Date().toISOString(),
      }).eq("id", postId);
      await enviar(chat_id, "Publicado no Instagram.");
      await arquivarPostNoDrive(db, post);
      return;
    } catch (e) {
      await db.from("posts").update({
        status: "erro",
        erro_msg: (e as Error).message,
        atualizado_em: new Date().toISOString(),
      }).eq("id", postId);
      return enviar(chat_id, `Falha ao publicar: ${(e as Error).message}`);
    }
  }

  if (acao === "agendar") {
    // Só um post por vez espera horário: limpa a marca dos outros e marca este.
    await db.from("posts").update({ aguardando_horario: false, aguardando_legenda: false })
      .eq("chat_id", chat_id).or("aguardando_horario.eq.true,aguardando_legenda.eq.true");
    await db.from("posts").update({ aguardando_horario: true, atualizado_em: new Date().toISOString() }).eq("id", postId);
    const agora = new Date();
    const botao = (rotulo: string, d: Date) => ({
      text: `${rotulo} (${formatarHorario(d)})`,
      callback_data: `hora:${postId}:${Math.floor(d.getTime() / 1000)}`, // epoch em segundos: cabe nos 64 bytes
    });
    const hoje19 = horaPronta(agora, 0, 19);
    const opcoes = [
      ...(hoje19.getTime() > agora.getTime() ? [[botao("Hoje 19h", hoje19)]] : []),
      [botao("Amanhã 12h", horaPronta(agora, 1, 12))],
      [botao("Amanhã 19h", horaPronta(agora, 1, 19))],
    ];
    const r = await enviar(
      chat_id,
      "Escolha um horário ou escreva o seu (ex.: amanhã 18:30, hoje 21h, 25/12 10:00).",
      { reply_markup: { inline_keyboard: opcoes } },
    );
    return lembrar([idDe(r)], { postId });
  }

  if (acao === "hora") {
    const quando = new Date(Number(extra) * 1000);
    if (!Number.isFinite(quando.getTime())) return enviar(chat_id, "Horário inválido.");
    return confirmarAgendamento(chat_id, postId, quando);
  }

  return enviar(chat_id, "Ação desconhecida.");
}

/** Grava o agendamento (se o horário ainda não passou) e confirma ao dono. */
async function confirmarAgendamento(chat_id: number, postId: string, quando: Date) {
  if (quando.getTime() <= Date.now()) {
    return enviar(chat_id, `Esse horário (${formatarHorario(quando)}) já passou. Escolha um horário futuro.`);
  }
  const { data } = await db.from("posts").update({
    status: "agendado",
    agendado_para: quando.toISOString(),
    aguardando_horario: false,
    atualizado_em: new Date().toISOString(),
  }).eq("id", postId).eq("status", "rascunho").select("id").maybeSingle();
  if (!data) return enviar(chat_id, "Não consegui agendar: o post não está mais como rascunho.");
  return enviar(chat_id, `Agendado para ${formatarHorario(quando)} (horário de Brasília).`);
}

/** Texto livre do dono: se há um post esperando horário, interpreta como horário. Devolve false se não há. */
async function tratarHorarioTexto(chat_id: number, texto: string, msgId?: number): Promise<boolean> {
  const { data: post } = await db.from("posts").select("id")
    .eq("chat_id", chat_id).eq("status", "rascunho").eq("aguardando_horario", true)
    .order("atualizado_em", { ascending: false }).limit(1).maybeSingle();
  if (!post) return false;
  await lembrar([msgId], { postId: post.id });
  const quando = interpretarHorario(texto);
  if (!quando) {
    await enviar(chat_id, "Não entendi o horário. Exemplos: amanhã 18:30, hoje 21h, 25/12 10:00.");
    return true;
  }
  await confirmarAgendamento(chat_id, post.id, quando);
  return true;
}

/** Texto livre do dono: se há um post esperando legenda manual, o texto vira a legenda. Devolve false se não há. */
async function tratarLegendaTexto(chat_id: number, texto: string, msgId?: number): Promise<boolean> {
  const { data: post } = await db.from("posts").select("id,legenda")
    .eq("chat_id", chat_id).eq("status", "rascunho").eq("aguardando_legenda", true)
    .order("atualizado_em", { ascending: false }).limit(1).maybeSingle();
  if (!post) return false;

  let legenda = texto.trim();
  // Sem hashtags no texto: mantém o bloco de hashtags que já estava na prévia.
  if (!legenda.includes("#")) {
    const ultimo = (post.legenda ?? "").split("\n\n").pop() ?? "";
    if (ultimo.trim().startsWith("#")) legenda = `${legenda}\n\n${ultimo.trim()}`;
  }

  await db.from("posts").update({
    legenda,
    aguardando_legenda: false,
    atualizado_em: new Date().toISOString(),
  }).eq("id", post.id);
  const r = await enviar(chat_id, `Legenda definida:\n\n${legenda}`, { reply_markup: teclado(post.id) });
  await lembrar([msgId, idDe(r)], { postId: post.id });
  return true;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await req.json();
  // Responde 200 na hora e processa em segundo plano: se demorar, o Telegram não reenvia o update.
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime.waitUntil(processar(update));
  return new Response("ok");
});

// Rede de segurança: o dono SEMPRE recebe resposta. Se o processamento passar de 110 s
// (a função morre perto de 150 s), avisa que não terminou em vez de ficar em silêncio.
// deno-lint-ignore no-explicit-any
async function processar(update: any) {
  const chat_id: number | undefined = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
  let terminou = false;
  const vigia = setTimeout(async () => {
    if (terminou || chat_id !== ALLOWED_CHAT_ID) return;
    trace("estourou_prazo", null, chat_id ?? null);
    await enviar(chat_id!, "Isso demorou demais e não terminei. Mande a foto de novo.").catch(() => {});
  }, 110000);
  try {
    await processarUpdate(update);
  } finally {
    terminou = true;
    clearTimeout(vigia);
  }
}

// deno-lint-ignore no-explicit-any
async function processarUpdate(update: any) {
  const msg = update.message;
  const cb = update.callback_query;
  const chat_id: number | undefined = msg?.chat?.id ?? cb?.message?.chat?.id;

  try {
    if (msg?.text?.startsWith("/start")) {
      // Único caso aceito de qualquer chat: mostra o chat_id para configurar ALLOWED_CHAT_ID.
      await enviar(chat_id!, `Seu chat_id: ${chat_id}\n${chat_id === ALLOWED_CHAT_ID ? "Autorizado." : "Não autorizado ainda."}`);
    } else if (chat_id !== ALLOWED_CHAT_ID) {
      // ignora em silêncio
    } else if (msg?.text?.trim().startsWith("/contexto")) {
      // /contexto mostra o texto atual; /contexto <texto> troca por um novo.
      const novo = msg.text.trim().replace(/^\/contexto(@\S+)?/, "").trim();
      if (!novo) {
        await enviar(
          chat_id!,
          `Contexto atual, que a IA usa nas legendas:\n\n${await carregarContexto()}\n\nPara trocar, envie:\n/contexto seu texto novo`,
        );
      } else {
        await db.from("config").upsert({ chave: "contexto", valor: novo, atualizado_em: new Date().toISOString() });
        await enviar(chat_id!, "Contexto atualizado. As próximas legendas já usam o texto novo.");
      }
    } else if (msg?.text?.trim().startsWith("/limpar")) {
      // Descarta rascunhos pendentes (os botões deles vão sumir junto com as mensagens).
      await db.from("posts").update({
        status: "cancelado",
        aguardando_horario: false,
        aguardando_legenda: false,
        atualizado_em: new Date().toISOString(),
      }).eq("chat_id", chat_id).eq("status", "rascunho");
      trace("limpar", `ate=${msg.message_id}`, chat_id);
      await limparChat(chat_id!, msg.message_id);
      await enviar(chat_id!, "Chat limpo.");
    } else if (cb) {
      await tratarBotao(cb);
    } else if (msg?.photo || msg?.document) {
      await tratarFoto(msg);
    } else if (msg?.text) {
      if (await tratarLegendaTexto(chat_id!, msg.text, msg.message_id)) return;
      if (await tratarHorarioTexto(chat_id!, msg.text, msg.message_id)) return;
      await enviar(chat_id!, "Envie uma foto (pode escrever uma dica na legenda da foto).");
    }
  } catch (e) {
    console.error(e);
    trace("erro", (e as Error).message, chat_id ?? null);
    if (chat_id === ALLOWED_CHAT_ID) {
      await enviar(chat_id!, `Erro: ${(e as Error).message}`).catch(() => {});
    }
  }
}
