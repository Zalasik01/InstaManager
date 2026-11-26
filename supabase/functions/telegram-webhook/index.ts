// Webhook do bot do Telegram.
// Fluxo: recebe foto -> guarda no Storage -> Gemini escreve legenda -> responde com prévia e botões.
// Secrets necessários: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, ALLOWED_CHAT_ID, GEMINI_API_KEY.
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem no ambiente das Edge Functions.

import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { publicarNoInstagram } from "../_shared/instagram.ts";
import { arquivarPostNoDrive } from "../_shared/arquivar.ts";
import { enviarResumoPublicacao } from "../_shared/pospublicacao.ts";
import { type Resultado, verificarIntegracoes } from "../_shared/status.ts";
import { executar as executarSync, planejar as planejarSync } from "../_shared/sincronizar.ts";
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
    [
      { text: "Só hashtags", callback_data: `sohash:${postId}` },
      { text: "Cancelar", callback_data: `cancelar:${postId}` },
    ],
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
  const { data } = await db.from("hashtags").select("tag,tamanho,nota,ultimo_uso,usos").eq("ativa", true);
  const todas = data ?? [];
  const tresDias = Date.now() - 3 * 24 * 3600 * 1000;
  // Pontuação: tag com 2+ usos medidos vale a sua nota (alcance relativo, ~1 = média dos posts);
  // tag ainda não testada vale 1 (neutra), para ser explorada. Sorteio (0 a 0,5) mantém a variedade
  // e tag usada nos últimos 3 dias perde pontos, para não repetir sempre o mesmo bloco.
  const pontos = (h: (typeof todas)[number]) =>
    (Number(h.usos) >= 2 && Number(h.nota) > 0 ? Number(h.nota) : 1) +
    Math.random() * 0.5 -
    (h.ultimo_uso && new Date(h.ultimo_uso).getTime() > tresDias ? 0.6 : 0);
  const sorteio = (lista: typeof todas, n: number) =>
    lista
      .map((h) => ({ h, r: pontos(h) }))
      .sort((a, b) => b.r - a.r)
      .slice(0, n)
      .map((x) => x.h.tag);
  return [
    ...sorteio(todas.filter((h) => h.tamanho === "grande"), 2),
    ...sorteio(todas.filter((h) => h.tamanho === "media"), 4),
    ...sorteio(todas.filter((h) => h.tamanho === "nicho"), 4),
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
    "- Português do Brasil. UMA única frase curta, com no máximo 8 palavras (até 60 caracteres).",
    "- Escolha UM só destaque do carro. Não encadeie vários detalhes nem adjetivos.",
    "- Cite só o que você vê com certeza na foto. Na dúvida, fale apenas da cor e do ângulo.",
    "- Evite clichês de IA: brilhando, destacando, imponente, estilo, elegância, show.",
    "- A página não tem seguidores: NÃO faça perguntas e NÃO peça comentário, curtida ou marcação.",
    "- No máximo 1 emoji, ou nenhum.",
    "- Exemplos só do tamanho e do tom (não copie): \"Polo branco, visão traseira.\" / \"Traseira limpa do meu Polo.\"",
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
  // Rede de segurança: se a IA passar de 90 caracteres, pede uma versão mais curta (só texto, sem imagem).
  if (texto.length > 90) {
    try {
      const r = await comPrazo(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: "POST",
          headers: { "x-goog-api-key": GEMINI_KEY, "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `Reescreva em uma única frase de no máximo 8 palavras, mantendo o sentido e sem inventar nada. Responda só com a frase, sem aspas:\n${texto}`,
              }],
            }],
            generationConfig: { maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } },
          }),
        },
        10000,
      );
      if (r.ok) {
        const j = await r.json();
        const cand = j.candidates?.[0];
        const curto = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
        if (curto && cand?.finishReason === "STOP" && curto.length < texto.length) texto = curto;
      }
    } catch { /* mantém a versão original */ }
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

  // Ações do /menu e de posts que não são rascunho (agendados, com erro).
  if (acao === "menu") return tratarMenu(cb, postId);
  if (acao === "cancelagenda") return cancelarAgendado(cb, postId);
  if (acao === "retentar") return retentarPost(cb, postId);
  if (acao === "descartar") return descartarPost(cb, postId);

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

  if (acao === "sohash") {
    // Troca a legenda só pelas hashtags que já estão nela, e atualiza a própria prévia.
    const tags = (post.legenda ?? "").match(/#[\p{L}\p{N}_]+/gu);
    if (!tags?.length) return enviar(chat_id, "Esta legenda não tem hashtags para manter.");
    const legenda = [...new Set(tags)].join(" ");
    await db.from("posts").update({ legenda, atualizado_em: new Date().toISOString() }).eq("id", postId);
    return editar(chat_id, cb.message.message_id, `Legenda só com hashtags:\n\n${legenda}`, teclado(postId));
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
      await enviarResumoPublicacao(db, chat_id, igId, postId); // link, QR code e embed
      await db.rpc("registrar_usos_hashtags", { p_post_id: postId }); // conta o uso de cada hashtag
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
  return enviar(chat_id, `Agendado para ${formatarHorario(quando)} (horário de Brasília).`, {
    reply_markup: { inline_keyboard: [[{ text: "Cancelar agendamento", callback_data: `cancelagenda:${postId}` }]] },
  });
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

// /hashtags: ranking das tags medidas e quantas ainda não têm dados.
async function textoHashtags(): Promise<string> {
  const { data } = await db.from("hashtags").select("tag,tamanho,nota,usos,ativa").order("usos", { ascending: false });
  const todas = data ?? [];
  const medidas = todas.filter((h) => Number(h.usos) >= 2 && Number(h.nota) > 0)
    .sort((a, b) => Number(b.nota) - Number(a.nota));
  const linha = (h: (typeof todas)[number]) => `${h.tag} · nota ${Number(h.nota).toFixed(2)} · ${h.usos} uso(s)`;
  const sem = todas.filter((h) => !(Number(h.usos) >= 2 && Number(h.nota) > 0)).length;
  const partes = [
    `Hashtags: ${todas.length} no banco, ${medidas.length} já medidas, ${sem} ainda sem dados.`,
    "A nota é o alcance médio dos posts que usaram a tag, comparado à mediana (1,00 = média). Uma tag só é medida depois de 2 usos com métricas coletadas.",
  ];
  if (medidas.length) {
    partes.push("Melhores:\n" + medidas.slice(0, 5).map(linha).join("\n"));
    if (medidas.length > 5) partes.push("Piores:\n" + medidas.slice(-3).reverse().map(linha).join("\n"));
  } else {
    partes.push("Ainda não há métricas coletadas. Enquanto isso o bot varia as tags, priorizando as não testadas.");
  }
  return partes.join("\n\n");
}

const mostrarHashtags = async (chat_id: number) => { await enviar(chat_id, await textoHashtags()); };

// ---------- /menu: status das integrações, agendados e posts com erro ----------

// Botões fixos no lugar do teclado do chat: tocar neles envia o texto "Criar postagem" ou "Menu".
const tecladoFixo = {
  keyboard: [[{ text: "Criar postagem" }, { text: "Menu" }]],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "Toque em um botão ou envie a foto",
};

const tecladoMenu = {
  inline_keyboard: [
    [{ text: "Status das integrações", callback_data: "menu:status" }],
    [
      { text: "Posts agendados", callback_data: "menu:agendados" },
      { text: "Posts com erro", callback_data: "menu:erros" },
    ],
    [{ text: "Hashtags", callback_data: "menu:hashtags" }, { text: "Limpar chat", callback_data: "menu:limpar" }],
    [{ text: "Sincronizar com o Instagram", callback_data: "menu:sync" }],
    [{ text: "Fechar", callback_data: "menu:fechar" }],
  ],
};

const voltar = [{ text: "Voltar", callback_data: "menu:inicio" }];

async function editar(chat_id: number, message_id: number, text: string, reply_markup?: unknown) {
  await tg("editMessageText", { chat_id, message_id, text, ...(reply_markup ? { reply_markup } : {}) })
    .catch(() => {});
}

// Grava na tabela logs o resultado das integrações, os últimos eventos e os posts com problema.
async function salvarLogs(res: Resultado[]): Promise<number | null> {
  const { data: eventos } = await db.from("eventos").select("em,etapa,detalhe")
    .order("id", { ascending: false }).limit(30);
  const { data: posts } = await db.from("posts").select("id,status,erro_msg,atualizado_em")
    .in("status", ["erro", "publicando"]).order("atualizado_em", { ascending: false }).limit(10);
  const falhas = res.filter((r) => !r.ok);
  const { data, error } = await db.from("logs").insert({
    nivel: falhas.length ? "erro" : "info",
    origem: "menu_status",
    mensagem: falhas.length ? `Falhas: ${falhas.map((f) => f.nome).join(", ")}` : "Todas as integrações ok",
    detalhe: { integracoes: res, eventos_recentes: eventos, posts_com_problema: posts },
  }).select("id").single();
  return error ? null : (data.id as number);
}

// deno-lint-ignore no-explicit-any
async function tratarMenu(cb: any, sub: string) {
  const chat_id: number = cb.message.chat.id;
  const message_id: number = cb.message.message_id;

  if (sub === "fechar" || sub === "ok") {
    await apagarMensagens(chat_id, [message_id]);
    return;
  }
  if (sub === "inicio") return editar(chat_id, message_id, "Menu:", tecladoMenu);
  if (sub === "limpar") {
    // Mesmo efeito do /limpar: descarta rascunhos pendentes e apaga o chat até esta mensagem.
    await db.from("posts").update({
      status: "cancelado",
      aguardando_horario: false,
      aguardando_legenda: false,
      atualizado_em: new Date().toISOString(),
    }).eq("chat_id", chat_id).eq("status", "rascunho");
    await limparChat(chat_id, message_id);
    await enviar(chat_id, "Chat limpo.", { reply_markup: tecladoFixo });
    return;
  }
  if (sub === "sync") {
    // Passo 1: só compara e mostra o plano. Nada é alterado até o dono confirmar.
    await editar(chat_id, message_id, "Comparando o banco com o Instagram...");
    try {
      const p = await planejarSync(db);
      const nada = !p.importar.length && !p.remover.length && !p.semImagem.length;
      const linhas = [
        "Sincronizar com o Instagram",
        `No perfil: ${p.noInstagram} posts. No banco: ${p.noBanco} posts.`,
        `• Importar (novos no Instagram): ${p.importar.length}`,
        `• Remover (não existem mais no Instagram): ${p.remover.length}`,
        ...p.remover.slice(0, 6).map((x) =>
          `   - ${formatarHorario(new Date(x.agendado_para ?? x.atualizado_em))}: ${(x.legenda ?? "").split("\n")[0].slice(0, 40) || "(sem legenda)"}`
        ),
        `• Imagens a guardar (galeria do site${p.driveAtivo ? " e Drive" : ""}): ${p.importar.length + p.semImagem.length} post(s)`,
      ];
      if (p.avisoRemocao) linhas.push("", `Atenção: ${p.avisoRemocao}`);
      if (p.remover.length) {
        linhas.push("", "As fotos removidas vão para a lixeira do Drive (dá para recuperar por 30 dias). As linhas do banco e as métricas deles são apagadas de vez.");
      }
      if (nada) {
        return editar(chat_id, message_id, `${linhas.join("\n")}\n\nTudo sincronizado, nada a fazer.`, { inline_keyboard: [voltar] });
      }
      return editar(chat_id, message_id, linhas.join("\n"), {
        inline_keyboard: [[{ text: "Confirmar sincronização", callback_data: "menu:syncok" }], voltar],
      });
    } catch (e) {
      return editar(chat_id, message_id, `Não consegui comparar: ${(e as Error).message}\nNada foi alterado.`, { inline_keyboard: [voltar] });
    }
  }
  if (sub === "syncok") {
    // Passo 2: recalcula o plano na hora (pode ter mudado) e executa.
    await editar(chat_id, message_id, "Sincronizando... pode levar até 1 minuto.");
    try {
      const plano = await planejarSync(db);
      const r = await executarSync(db, chat_id, plano);
      // Coleta as métricas na hora (a função de métricas valida o mesmo segredo do cron).
      let metricas = "";
      try {
        const resp = await comPrazo(`${Deno.env.get("SUPABASE_URL")}/functions/v1/coletar-metricas`, {
          method: "POST",
          headers: { "x-cron-secret": Deno.env.get("CRON_SECRET") ?? "" },
        }, 45000);
        const j = await resp.json();
        metricas = j.ok === false
          ? `\nMétricas: ${j.motivo ?? "não coletadas"}.`
          : `\nMétricas gravadas: ${j.gravados} (falhas: ${j.falhas}).`;
      } catch {
        metricas = "\nMétricas: rodam sozinhas todo dia.";
      }
      const linhas = [
        "Sincronização concluída.",
        `Importados: ${r.importados}`,
        `Removidos: ${r.removidos} (${r.arquivosNaLixeira} arquivo(s) na lixeira do Drive)`,
        `Imagens arquivadas no Drive: ${r.imagensArquivadas}`,
      ];
      if (r.restantes) linhas.push(`Faltam ${r.restantes} imagem(ns). Sincronize de novo para continuar.`);
      if (r.falhas.length) linhas.push("", `Falhas (${r.falhas.length}):`, ...r.falhas.slice(0, 4));
      return editar(chat_id, message_id, linhas.join("\n") + metricas, { inline_keyboard: [voltar] });
    } catch (e) {
      return editar(chat_id, message_id, `Não consegui sincronizar: ${(e as Error).message}`, { inline_keyboard: [voltar] });
    }
  }
  if (sub === "hashtags") {
    return editar(chat_id, message_id, await textoHashtags(), { inline_keyboard: [voltar] });
  }
  if (sub === "agendados") return mostrarAgendados(chat_id, message_id);
  if (sub === "erros") return mostrarErros(chat_id, message_id);

  if (sub === "status" || sub === "logs") {
    await editar(chat_id, message_id, "Verificando integrações...");
    const res = await verificarIntegracoes(db);
    const comErro = res.some((r) => !r.ok);
    let extra = "";
    if (sub === "logs") {
      const id = await salvarLogs(res);
      extra = id ? `\n\nLogs salvos (#${id}).` : "\n\nNão consegui salvar os logs.";
    }
    const texto = res.map((r) => `${r.ok ? "✅" : "❌"} ${r.nome}: ${r.detalhe}`).join("\n") + extra;
    const linha = [{ text: "Confirmar", callback_data: "menu:ok" }];
    if (comErro && sub !== "logs") linha.push({ text: "Salvar logs", callback_data: "menu:logs" });
    return editar(chat_id, message_id, texto, { inline_keyboard: [linha] });
  }
}

async function mostrarAgendados(chat_id: number, message_id: number) {
  const { data } = await db.from("posts").select("id,legenda,agendado_para,storage_paths")
    .eq("chat_id", chat_id).eq("status", "agendado")
    .order("agendado_para", { ascending: true }).limit(10);
  if (!data?.length) {
    return editar(chat_id, message_id, "Posts agendados:\n\nNenhum post agendado.", { inline_keyboard: [voltar] });
  }
  const quando = (p: { agendado_para: string }) => formatarHorario(new Date(p.agendado_para));
  const linhas = data.map((p, i) =>
    `${i + 1}. ${quando(p)} · ${p.storage_paths.length} foto(s)\n   ${(p.legenda ?? "").split("\n")[0].slice(0, 60)}`
  );
  const botoes = data.map((p, i) => [{ text: `Cancelar ${i + 1} (${quando(p)})`, callback_data: `cancelagenda:${p.id}` }]);
  botoes.push(voltar);
  return editar(chat_id, message_id, `Posts agendados:\n\n${linhas.join("\n")}`, { inline_keyboard: botoes });
}

async function mostrarErros(chat_id: number, message_id: number) {
  const { data } = await db.from("posts").select("id,erro_msg,atualizado_em,storage_paths")
    .eq("chat_id", chat_id).eq("status", "erro")
    .order("atualizado_em", { ascending: false }).limit(8);
  if (!data?.length) {
    return editar(chat_id, message_id, "Posts com erro:\n\nNenhum post com erro.", { inline_keyboard: [voltar] });
  }
  const linhas = data.map((p, i) =>
    `${i + 1}. ${formatarHorario(new Date(p.atualizado_em))} · ${p.storage_paths.length} foto(s)\n   ${(p.erro_msg ?? "sem detalhe").slice(0, 110)}`
  );
  const botoes = data.map((p, i) => [
    { text: `Tentar de novo ${i + 1}`, callback_data: `retentar:${p.id}` },
    { text: `Descartar ${i + 1}`, callback_data: `descartar:${p.id}` },
  ]);
  botoes.push(voltar);
  return editar(
    chat_id,
    message_id,
    `Posts com erro:\n\n${linhas.join("\n")}\n\nAntes de tentar de novo, confira o Instagram: se o post já saiu, descarte para não duplicar.`,
    { inline_keyboard: botoes },
  );
}

// deno-lint-ignore no-explicit-any
async function cancelarAgendado(cb: any, postId: string) {
  const chat_id: number = cb.message.chat.id;
  const message_id: number = cb.message.message_id;
  const { data: post } = await db.from("posts")
    .update({ status: "cancelado", atualizado_em: new Date().toISOString() })
    .eq("id", postId).eq("status", "agendado").select("mensagens,storage_paths").maybeSingle();
  if (!post) {
    await enviar(chat_id, "Esse post não está mais agendado (talvez já tenha sido publicado).");
    return;
  }
  // Apaga as mensagens do post e as fotos do Storage, como no cancelamento de rascunho.
  await apagarMensagens(chat_id, post.mensagens ?? []);
  if (post.storage_paths?.length) await db.storage.from("fotos").remove(post.storage_paths);
  // Veio da lista do /menu: atualiza a lista. Veio da confirmação do agendamento: apaga essa mensagem.
  if (String(cb.message.text ?? "").startsWith("Posts agendados")) return mostrarAgendados(chat_id, message_id);
  await apagarMensagens(chat_id, [message_id]);
}

// deno-lint-ignore no-explicit-any
async function retentarPost(cb: any, postId: string) {
  const chat_id: number = cb.message.chat.id;
  const { data } = await db.from("posts").update({
    status: "agendado",
    agendado_para: new Date().toISOString(),
    erro_msg: null,
    atualizado_em: new Date().toISOString(),
  }).eq("id", postId).eq("status", "erro").select("id").maybeSingle();
  if (!data) {
    await enviar(chat_id, "Esse post não está mais com erro.");
  } else {
    await enviar(chat_id, "Vou tentar publicar de novo. Sai em até 1 minuto e eu aviso o resultado.");
  }
  return mostrarErros(chat_id, cb.message.message_id);
}

// deno-lint-ignore no-explicit-any
async function descartarPost(cb: any, postId: string) {
  const chat_id: number = cb.message.chat.id;
  const { data: post } = await db.from("posts")
    .update({ status: "cancelado", atualizado_em: new Date().toISOString() })
    .eq("id", postId).eq("status", "erro").select("storage_paths").maybeSingle();
  if (post?.storage_paths?.length) await db.storage.from("fotos").remove(post.storage_paths);
  return mostrarErros(chat_id, cb.message.message_id);
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
  // "digitando..." dura só 5 s no Telegram: reenvia a cada 4 s até terminar, para indicar que está processando.
  const sinal = () => {
    if (chat_id === ALLOWED_CHAT_ID) tg("sendChatAction", { chat_id, action: "typing" }).catch(() => {});
  };
  sinal();
  const indicador = setInterval(sinal, 4000);
  try {
    await processarUpdate(update);
  } finally {
    terminou = true;
    clearTimeout(vigia);
    clearInterval(indicador);
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
      // Autorizado: manda também os botões fixos no lugar do teclado.
      if (chat_id === ALLOWED_CHAT_ID) await enviar(chat_id!, "Use os botões abaixo.", { reply_markup: tecladoFixo });
    } else if (chat_id !== ALLOWED_CHAT_ID) {
      // ignora em silêncio
    } else if (/^(\/menu|menu)$/i.test(msg?.text?.trim() ?? "")) {
      // Vale para o comando /menu e para o botão fixo "Menu".
      await enviar(chat_id!, "Menu:", { reply_markup: tecladoMenu });
    } else if (/^\/hashtags/i.test(msg?.text?.trim() ?? "")) {
      await mostrarHashtags(chat_id!);
    } else if (/^criar postagem$/i.test(msg?.text?.trim() ?? "")) {
      // O Telegram não deixa o bot abrir o seletor de arquivos: a mensagem orienta o próximo passo.
      await enviar(
        chat_id!,
        "Envie a foto agora (use o clipe ao lado do campo de texto). Para carrossel, envie várias de uma vez. Se quiser, escreva uma dica na legenda da foto.",
      );
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
      await enviar(chat_id!, "Chat limpo.", { reply_markup: tecladoFixo });
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
