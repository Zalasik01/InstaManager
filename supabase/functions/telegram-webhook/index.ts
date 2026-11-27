// Webhook do bot do Telegram.
// Fluxo: recebe foto -> guarda no Storage -> Gemini escreve legenda -> responde com prévia e botões.
// Vídeo (MP4 até 20 MB): guarda no Storage -> legenda gerada a partir da capa -> prévia com botões de Reel/Story.
// Secrets necessários: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, ALLOWED_CHAT_ID, GEMINI_API_KEY.
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem no ambiente das Edge Functions.

import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { ehVideoPath, publicarPorTipo, type TipoPost } from "../_shared/instagram.ts";
import { ajustarProporcao, detectarFormato } from "../_shared/midia.ts";
import { concluirPublicacao } from "../_shared/concluir.ts";
import { aplicarMarcaDagua } from "../_shared/marca.ts";
import {
  alternarOpcao,
  caminhoComMarca,
  caminhoSemMarca,
  comOriginais,
  OPCAO_MARCA_DAGUA,
  OPCAO_STORY_AUTOMATICO,
  opcaoLigada,
} from "../_shared/opcoes.ts";
import { enviarResumoPublicacao } from "../_shared/pospublicacao.ts";
import { type Resultado, verificarIntegracoes } from "../_shared/status.ts";
import { executar as executarSync, planejar as planejarSync } from "../_shared/sincronizar.ts";
import { formatarHorario, horaPronta, interpretarHorario } from "../_shared/horario.ts";
import { proximosHorariosSugeridos, textoStats } from "../_shared/stats.ts";

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

// Maior arquivo que o Telegram deixa um bot baixar (getFile): 20 MB.
const LIMITE_TELEGRAM = 20 * 1024 * 1024;

const enviar = (chat_id: number, text: string, extra: Record<string, unknown> = {}) =>
  tg("sendMessage", { chat_id, text, ...extra });

// Tipo de mídia do rascunho: decide quais botões aparecem na prévia.
type Midia = "foto" | "carrossel" | "video";

// deno-lint-ignore no-explicit-any
const midiaDoPost = (post: any): Midia =>
  ehVideoPath(post?.storage_paths?.[0]) ? "video" : (post?.storage_paths?.length ?? 0) > 1 ? "carrossel" : "foto";

// Foto: Postar agora (feed). Vídeo: Postar como Reel. Story só para foto única ou vídeo (carrossel não vira Story).
const teclado = (postId: string, midia: Midia = "foto") => ({
  inline_keyboard: [
    [
      midia === "video"
        ? { text: "Postar como Reel", callback_data: `reel:${postId}` }
        : { text: "Postar agora", callback_data: `agora:${postId}` },
      { text: "Agendar", callback_data: `agendar:${postId}` },
    ],
    ...(midia === "carrossel" ? [] : [[
      { text: "Postar como Story", callback_data: `story:${postId}` },
      { text: "Agendar Story", callback_data: `agendarstory:${postId}` },
    ]]),
    [
      { text: "Regerar legenda", callback_data: `regerar:${postId}` },
      { text: "Definir legenda manualmente", callback_data: `manual:${postId}` },
    ],
    [
      { text: "Só hashtags", callback_data: `sohash:${postId}` },
      // Guarda o post (com os arquivos) no banco de fotos, para publicar depois pelo /menu.
      { text: "Guardar no banco", callback_data: `banco:${postId}` },
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

// jpeg null (vídeo sem capa): devolve a legenda simples, que o dono pode trocar depois.
async function gerarLegenda(jpeg: Uint8Array | null, dica: string | null): Promise<string> {
  const tags = await escolherHashtags();
  if (!GEMINI_KEY || !jpeg) {
    legendaFallback = false;
    return `Polo 2012 9n4.\n\n${tags.join(" ")}`;
  }

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
  const mime = String(msg.document?.mime_type ?? "");
  if (msg.document && !mime.startsWith("image/")) {
    return enviar(chat_id, "Envie apenas imagens ou vídeo MP4.");
  }
  // HEIC (padrão do iPhone) não é suportado pela conversão: avisa antes de baixar.
  if (/^image\/hei[cf]/.test(mime)) {
    return enviar(chat_id, "Foto em HEIC não é suportada. Envie como foto normal, ou o arquivo em JPEG ou PNG.");
  }
  // O Telegram só deixa o bot baixar arquivos de até 20 MB.
  if (Number(arquivo.file_size ?? 0) > LIMITE_TELEGRAM) {
    return enviar(chat_id, "O arquivo passa de 20 MB, o máximo que o Telegram deixa o bot baixar. Envie como foto normal (comprimida).");
  }
  const dica = msg.caption?.trim() || null;

  trace("foto_recebida", `${arquivo.file_size ?? "?"} bytes, album=${msg.media_group_id ?? "não"}`, chat_id);
  // Confirma na hora que recebeu (em álbum, só a primeira foto avisa, para não encher o chat).
  const recebiId = msg.media_group_id ? undefined : idDe(await enviar(chat_id, "Recebi a foto, processando..."));
  const original = await baixarArquivoTelegram(arquivo.file_id);
  trace("foto_baixada", `${original.length} bytes`, chat_id);

  // Deixa pronta para o feed: corrige a proporção (4:5 a 1,91:1), converte PNG/WebP em JPEG e reduz
  // documentos grandes. A foto guardada no Storage já é a ajustada.
  let ajuste: Awaited<ReturnType<typeof ajustarProporcao>>;
  try {
    ajuste = await ajustarProporcao(original);
  } catch (e) {
    const fmt = detectarFormato(original);
    trace("foto_formato_falhou", `${fmt}: ${(e as Error).message}`, chat_id);
    // HEIC e formato desconhecido já vêm com mensagem pronta; falha de decodificação ganha uma genérica.
    return enviar(
      chat_id,
      fmt === "heic" || fmt === "desconhecido"
        ? (e as Error).message
        : "Não consegui ler esta imagem. Envie como foto normal ou o arquivo em JPEG ou PNG.",
    );
  }
  const bytes = ajuste.bytes;
  if (ajuste.reencodado) trace("foto_ajustada", `${ajuste.de} -> ${ajuste.para}, ${bytes.length} bytes`, chat_id);
  // O Instagram recusa JPEG acima de 8 MB.
  if (bytes.length > 8 * 1024 * 1024) {
    return enviar(chat_id, "A foto passa de 8 MB e o Instagram recusa. Envie como foto normal (comprimida).");
  }

  const hoje = new Date();
  const pasta = `${hoje.getUTCFullYear()}/${String(hoje.getUTCMonth() + 1).padStart(2, "0")}/${String(hoje.getUTCDate()).padStart(2, "0")}`;
  const caminhoOriginal = `${pasta}/${crypto.randomUUID()}.jpg`;
  const up = await db.storage.from("fotos").upload(caminhoOriginal, bytes, { contentType: "image/jpeg" });
  if (up.error) throw up.error;

  // Marca d'água opcional (/menu): a versão com marca vai para o feed e a original fica ao lado no Storage,
  // para o caso de a foto virar Story (Story não leva marca). Se a marca falhar, segue com a foto sem marca.
  let caminho = caminhoOriginal;
  let comMarca = false;
  if (await opcaoLigada(db, OPCAO_MARCA_DAGUA)) {
    try {
      const marcada = await aplicarMarcaDagua(bytes);
      if (marcada.length > 8 * 1024 * 1024) throw new Error("com a marca a foto passou de 8 MB");
      const destino = caminhoComMarca(caminhoOriginal);
      const upMarca = await db.storage.from("fotos").upload(destino, marcada, { contentType: "image/jpeg" });
      if (upMarca.error) throw upMarca.error;
      caminho = destino;
      comMarca = true;
    } catch (e) {
      trace("marca_falhou", (e as Error).message, chat_id);
    }
  }
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
    // Em carrossel, só a foto de quem criou o post é avaliada aqui; as outras são ajustadas do mesmo jeito.
    ajuste.mudou ? `Ajustei a foto para ${ajuste.para} (era ${ajuste.de}), o limite do feed do Instagram.` : "",
    comMarca ? "Com marca d'água (no feed; se virar Story, a foto vai sem a marca)." : "",
  ].filter(Boolean).join("\n");
  const previa = await enviar(chat_id, `${aviso ? aviso + "\n\n" : ""}Prévia da legenda:\n\n${legenda}`, {
    reply_markup: teclado(post.id, qtd > 1 ? "carrossel" : "foto"),
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
    // Foto extra não entra no post: apaga o arquivo órfão (e a original, se a foto tem marca d'água).
    await db.storage.from("fotos").remove(comOriginais([caminho]));
  }
  return data as number;
}

// Pasta do dia no Storage: AAAA/MM/DD.
function pastaDoDia(): string {
  const hoje = new Date();
  return `${hoje.getUTCFullYear()}/${String(hoje.getUTCMonth() + 1).padStart(2, "0")}/${String(hoje.getUTCDate()).padStart(2, "0")}`;
}

// Vídeo (msg.video ou documento video/mp4): vira rascunho de Reel. A legenda sai da capa que o Telegram manda.
// deno-lint-ignore no-explicit-any
async function tratarVideo(msg: any) {
  const chat_id: number = msg.chat.id;
  const video = msg.video ?? msg.document;
  const mime = String(video.mime_type ?? "video/mp4");
  if (mime !== "video/mp4") {
    return enviar(chat_id, "Só aceito vídeo em MP4. Envie o vídeo pelo Telegram como vídeo normal (ele converte para MP4).");
  }
  if (msg.media_group_id) {
    return enviar(chat_id, "Envie o vídeo sozinho, fora de um álbum. Reel é um vídeo por post.");
  }
  // O Telegram só deixa o bot baixar arquivos de até 20 MB (getFile).
  if (Number(video.file_size ?? 0) > LIMITE_TELEGRAM) {
    const mb = (Number(video.file_size) / 1024 / 1024).toFixed(1).replace(".", ",");
    return enviar(
      chat_id,
      `O vídeo tem ${mb} MB e o Telegram só deixa o bot baixar até 20 MB. Envie um vídeo menor (mais curto ou comprimido; enviar como vídeo normal, e não como arquivo, já reduz o tamanho).`,
    );
  }
  const duracao = Number(video.duration ?? 0); // documento não traz a duração: 0 = desconhecida
  if (duracao > 0 && duracao < 3) {
    return enviar(chat_id, "O Instagram exige vídeo de pelo menos 3 segundos.");
  }
  const dica = msg.caption?.trim() || null;

  trace("video_recebido", `${video.file_size ?? "?"} bytes, ${duracao || "?"} s`, chat_id);
  const recebiId = idDe(await enviar(chat_id, "Recebi o vídeo, processando..."));
  let bytes: Uint8Array;
  try {
    bytes = await baixarArquivoTelegram(video.file_id);
  } catch (e) {
    // Arquivo acima de 20 MB sem file_size informado cai aqui ("file is too big").
    trace("video_download_falhou", (e as Error).message, chat_id);
    return enviar(chat_id, "Não consegui baixar o vídeo. Se ele passa de 20 MB, envie um vídeo menor.");
  }
  trace("video_baixado", `${bytes.length} bytes`, chat_id);

  const caminho = `${pastaDoDia()}/${crypto.randomUUID()}.mp4`;
  const up = await db.storage.from("fotos").upload(caminho, bytes, { contentType: "video/mp4" });
  if (up.error) throw up.error;
  trace("video_no_storage", caminho, chat_id);

  // Capa (miniatura JPEG pequena). "thumb" é o nome antigo do campo na API do Telegram.
  const capaId: string | null = (video.thumbnail ?? video.thumb)?.file_id ?? null;
  const capa = await baixarCapa(capaId);

  const { data: post, error } = await db.from("posts").insert({
    chat_id,
    tipo: "REELS",
    telegram_file_ids: [video.file_id],
    storage_paths: [caminho],
    capa_file_id: capaId,
    dica,
    mensagens: [msg.message_id, recebiId].filter((x) => typeof x === "number"),
  }).select("id").single();
  if (error) throw error;

  const legenda = await gerarLegenda(capa, dica);
  await db.from("posts").update({ legenda, atualizado_em: new Date().toISOString() }).eq("id", post.id);

  const aviso = [
    !capa ? "O vídeo veio sem capa, então usei uma legenda simples. Use Definir legenda manualmente para trocar." : "",
    legendaFallback ? "O Gemini não respondeu, então usei uma legenda simples. Toque em Regerar legenda para tentar de novo." : "",
    duracao > 60 ? `Story de vídeo aceita até 60 s e este tem ${duracao} s: como Story, o Instagram deve recusar.` : "",
  ].filter(Boolean).join("\n");
  const previa = await enviar(chat_id, `${aviso ? aviso + "\n\n" : ""}Vídeo pronto. Prévia da legenda do Reel:\n\n${legenda}`, {
    reply_markup: teclado(post.id, "video"),
  });
  await lembrar([idDe(previa)], { postId: post.id });
  trace("previa_enviada", post.id, chat_id);
}

/** Baixa a capa do vídeo (JPEG). Devolve null se não houver ou se falhar: a legenda cai no plano simples. */
async function baixarCapa(capaId: string | null): Promise<Uint8Array | null> {
  if (!capaId) return null;
  try {
    const b = await baixarArquivoTelegram(capaId);
    return detectarFormato(b) === "jpeg" ? b : null;
  } catch {
    return null;
  }
}

/** Bytes da foto para a IA: a cópia ajustada do Storage (sempre JPEG); se não der, o original do Telegram. */
// deno-lint-ignore no-explicit-any
async function bytesParaLegenda(post: any): Promise<Uint8Array | null> {
  if (midiaDoPost(post) === "video") return baixarCapa(post.capa_file_id ?? null);
  const { data } = await db.storage.from("fotos").download(post.storage_paths[0]);
  if (data) return new Uint8Array(await data.arrayBuffer());
  const b = await baixarArquivoTelegram(post.telegram_file_ids[0]);
  return detectarFormato(b) === "jpeg" ? b : null;
}

/**
 * Publica agora conforme o tipo (FEED, REELS ou STORIES) e faz o pós-publicação que se aplica:
 * resumo com link/QR/embed, contagem de hashtags e arquivamento (galeria/Drive).
 */
// deno-lint-ignore no-explicit-any
async function publicarAgora(chat_id: number, post: any, tipo: TipoPost) {
  const postId: string = post.id;
  // Trava: só sai de rascunho uma vez (dois toques rápidos não publicam duas vezes).
  const { data: travou } = await db.from("posts").update({
    status: "publicando",
    tipo,
    aguardando_horario: false,
    aguardando_legenda: false,
    atualizado_em: new Date().toISOString(),
  }).eq("id", postId).eq("status", "rascunho").select("id").maybeSingle();
  if (!travou) return enviar(chat_id, "Este post já não está como rascunho.");

  const ehVideo = midiaDoPost(post) === "video";
  await enviar(
    chat_id,
    tipo === "STORIES"
      ? `Publicando o Story...${ehVideo ? " O Instagram processa o vídeo: pode levar até 1 minuto e meio." : ""}\nStory não tem legenda: a legenda da prévia não vai junto.`
      : tipo === "REELS"
      ? "Publicando o Reel... O Instagram processa o vídeo: pode levar até 1 minuto e meio."
      : "Publicando no Instagram...",
  );
  try {
    // Story usa a foto sem marca d'água (quando a marca está ligada, a original fica ao lado no Storage).
    const urls = post.storage_paths.map(
      (p: string) => db.storage.from("fotos").getPublicUrl(tipo === "STORIES" ? caminhoSemMarca(p) : p).data.publicUrl,
    );
    const igId = await publicarPorTipo(tipo, urls, post.storage_paths, post.legenda ?? "");
    await db.from("posts").update({
      status: "publicado",
      ig_media_id: igId,
      atualizado_em: new Date().toISOString(),
    }).eq("id", postId);

    if (tipo === "STORIES") {
      // Story some em 24 h e não tem permalink fixo nem hashtags: pula resumo, hashtags e galeria.
      // O arquivo sai do Storage `fotos` para poupar espaço (o Instagram já processou a mídia).
      await enviar(chat_id, "Story publicado no Instagram. Ele fica no ar por 24 horas.");
      if (post.storage_paths?.length) await db.storage.from("fotos").remove(comOriginais(post.storage_paths));
      return;
    }
    await enviar(chat_id, tipo === "REELS" ? "Reel publicado no Instagram." : "Publicado no Instagram.");
    await enviarResumoPublicacao(db, chat_id, igId, postId); // link, QR code e embed
    await db.rpc("registrar_usos_hashtags", { p_post_id: postId }); // conta o uso de cada hashtag
    // Story automático (se ligado), galeria do site + Drive (foto ou Reel) e aviso de post novo no site.
    // Nada disso derruba a publicação: concluirPublicacao trata as próprias falhas.
    await concluirPublicacao(db, post, tipo, (t) => enviar(chat_id, t))
      .catch((e) => console.error("concluir publicação:", e));
  } catch (e) {
    await db.from("posts").update({
      status: "erro",
      erro_msg: (e as Error).message,
      atualizado_em: new Date().toISOString(),
    }).eq("id", postId);
    return enviar(chat_id, `Falha ao publicar: ${(e as Error).message}`);
  }
}

// deno-lint-ignore no-explicit-any
async function tratarBotao(cb: any) {
  const chat_id: number = cb.message.chat.id;
  const [acao, postId, extra] = String(cb.data).split(":");
  trace("botao", String(cb.data), chat_id);
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
  if (acao === "bancousar") return usarDoBanco(cb, postId);
  if (acao === "bancoagendar") return agendarDoBanco(cb, postId);
  if (acao === "bancoexcluir") return excluirDoBanco(cb, postId);
  if (acao === "fixar" || acao === "desafixar") return alternarFixado(cb, postId, acao === "fixar");

  const { data: post } = await db.from("posts").select("*").eq("id", postId).maybeSingle();
  if (!post) return enviar(chat_id, "Post não encontrado.");
  if (post.status === "banco") return enviar(chat_id, "Este post está no banco de fotos. Use /menu > Banco de fotos.");
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
    if (post.storage_paths?.length) await db.storage.from("fotos").remove(comOriginais(post.storage_paths));
    return;
  }

  if (acao === "banco") {
    // Guarda no banco de fotos: sai de rascunho (o /limpar não apaga mais) e os arquivos ficam no Storage.
    const { data: guardou } = await db.from("posts").update({
      status: "banco",
      aguardando_horario: false,
      aguardando_legenda: false,
      atualizado_em: new Date().toISOString(),
    }).eq("id", postId).eq("status", "rascunho").select("id").maybeSingle();
    if (!guardou) return enviar(chat_id, "Este post já não está como rascunho.");
    return editar(
      chat_id,
      cb.message.message_id,
      `Guardado no banco de fotos. Para publicar depois: /menu > Banco de fotos.\n\n${post.legenda ?? ""}`.trim(),
    );
  }

  const midia = midiaDoPost(post);

  if (acao === "regerar") {
    // Foto: a cópia ajustada do Storage (JPEG). Vídeo: a capa que o Telegram mandou.
    const bytes = await bytesParaLegenda(post);
    const legenda = await gerarLegenda(bytes, post.dica);
    await db.from("posts").update({ legenda, atualizado_em: new Date().toISOString() }).eq("id", postId);
    const nota = !bytes
      ? "Sem imagem para a IA (o vídeo veio sem capa), então usei a legenda simples.\n\n"
      : legendaFallback
      ? "O Gemini não respondeu, então voltei à legenda simples. Tente Regerar de novo.\n\n"
      : "";
    const r = await enviar(chat_id, `${nota}Nova legenda:\n\n${legenda}`, { reply_markup: teclado(postId, midia) });
    return lembrar([idDe(r)], { postId });
  }

  if (acao === "sohash") {
    // Troca a legenda só pelas hashtags que já estão nela, e atualiza a própria prévia.
    const tags = (post.legenda ?? "").match(/#[\p{L}\p{N}_]+/gu);
    if (!tags?.length) return enviar(chat_id, "Esta legenda não tem hashtags para manter.");
    const legenda = [...new Set(tags)].join(" ");
    await db.from("posts").update({ legenda, atualizado_em: new Date().toISOString() }).eq("id", postId);
    return editar(chat_id, cb.message.message_id, `Legenda só com hashtags:\n\n${legenda}`, teclado(postId, midia));
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

  // Postar agora: foto/carrossel vai para o feed; vídeo vira Reel (teclado antigo de vídeo não existe, mas por garantia).
  if (acao === "agora" || acao === "reel") {
    if (acao === "reel" && midia !== "video") return enviar(chat_id, "Reel precisa de um vídeo.");
    return publicarAgora(chat_id, post, midia === "video" ? "REELS" : "FEED");
  }

  if (acao === "story") {
    if (midia === "carrossel") return enviar(chat_id, "Carrossel não vira Story. Envie uma foto só.");
    return publicarAgora(chat_id, post, "STORIES");
  }

  if (acao === "agendar" || acao === "agendarstory") {
    // O tipo fica gravado agora: Agendar = Feed (foto) ou Reel (vídeo); Agendar Story = Story.
    if (acao === "agendarstory" && midia === "carrossel") {
      return enviar(chat_id, "Carrossel não vira Story. Envie uma foto só.");
    }
    const tipo: TipoPost = acao === "agendarstory" ? "STORIES" : midia === "video" ? "REELS" : "FEED";
    // Só um post por vez espera horário: limpa a marca dos outros e marca este.
    await db.from("posts").update({ aguardando_horario: false, aguardando_legenda: false })
      .eq("chat_id", chat_id).or("aguardando_horario.eq.true,aguardando_legenda.eq.true");
    await db.from("posts").update({ aguardando_horario: true, tipo, atualizado_em: new Date().toISOString() })
      .eq("id", postId);
    const agora = new Date();
    const botao = (rotulo: string, d: Date) => ({
      text: `${rotulo} (${formatarHorario(d)})`,
      callback_data: `hora:${postId}:${Math.floor(d.getTime() / 1000)}`, // epoch em segundos: cabe nos 64 bytes
    });
    // Melhores horários calculados com o alcance dos seus posts (vazio enquanto não houver dados suficientes).
    const sugeridos = await proximosHorariosSugeridos(db, agora).catch(() => [] as Date[]);
    const hoje19 = horaPronta(agora, 0, 19);
    const opcoes = sugeridos.length
      ? [
        ...sugeridos.map((d) => [botao("Melhor horário", d)]),
        [botao("Amanhã 19h", horaPronta(agora, 1, 19))],
      ]
      : [
        ...(hoje19.getTime() > agora.getTime() ? [[botao("Hoje 19h", hoje19)]] : []),
        [botao("Amanhã 12h", horaPronta(agora, 1, 12))],
        [botao("Amanhã 19h", horaPronta(agora, 1, 19))],
      ];
    const rotuloTipo = tipo === "STORIES" ? "o Story" : tipo === "REELS" ? "o Reel" : "o post";
    const r = await enviar(
      chat_id,
      `Quando publicar ${rotuloTipo}? Escolha um horário ou escreva o seu (ex.: amanhã 18:30, hoje 21h, 25/12 10:00).`,
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
  }).eq("id", postId).eq("status", "rascunho").select("id,tipo").maybeSingle();
  if (!data) return enviar(chat_id, "Não consegui agendar: o post não está mais como rascunho.");
  const oque = data.tipo === "STORIES"
    ? "Story agendado (Story não tem legenda: a legenda da prévia não vai junto)"
    : data.tipo === "REELS"
    ? "Reel agendado"
    : "Agendado";
  return enviar(chat_id, `${oque} para ${formatarHorario(quando)} (horário de Brasília).`, {
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

// Teclado do /menu. As opções liga/desliga mostram o estado atual, lido da tabela config.
async function tecladoMenu() {
  const [storyAuto, marca] = await Promise.all([
    opcaoLigada(db, OPCAO_STORY_AUTOMATICO),
    opcaoLigada(db, OPCAO_MARCA_DAGUA),
  ]);
  return {
    inline_keyboard: [
      [{ text: "Status das integrações", callback_data: "menu:status" }],
      [
        { text: "Agenda (7 dias)", callback_data: "menu:agenda" },
        { text: "Agendados", callback_data: "menu:agendados" },
      ],
      [
        { text: "Banco de fotos", callback_data: "menu:banco" },
        { text: "Com erro", callback_data: "menu:erros" },
      ],
      [{ text: "Estatísticas", callback_data: "menu:stats" }, { text: "Hashtags", callback_data: "menu:hashtags" }],
      [{ text: "Fixar posts", callback_data: "menu:fixar" }],
      [{ text: `Story automático: ${storyAuto ? "Ligado" : "Desligado"}`, callback_data: "menu:storyauto" }],
      [{ text: `Marca d'água: ${marca ? "Ligada" : "Desligada"}`, callback_data: "menu:marca" }],
      [{ text: "Limpar chat", callback_data: "menu:limpar" }],
      [{ text: "Sincronizar com o Instagram", callback_data: "menu:sync" }],
      [{ text: "Fechar", callback_data: "menu:fechar" }],
    ],
  };
}

const voltar = [{ text: "Voltar", callback_data: "menu:inicio" }];

// A largura dos botões no Telegram é a largura da mensagem. Com um texto curto ("Menu:") a bolha fica
// estreita e os botões ficam apertados; a linha de espaços em braille (U+2800, invisível) alarga a bolha.
const TEXTO_MENU = `Menu do InstaManager\nEscolha uma opção:\n${"\u2800".repeat(36)}`;

async function editar(chat_id: number, message_id: number, text: string, reply_markup?: unknown) {
  const r = await tg("editMessageText", { chat_id, message_id, text, ...(reply_markup ? { reply_markup } : {}) })
    .catch((e) => ({ ok: false, description: `falha de rede: ${(e as Error).message}` }));
  // "message is not modified" é inofensivo; qualquer outro erro vai para o registro de eventos.
  if (!r.ok && !String(r.description).includes("not modified")) {
    trace("editar_falhou", `${r.description} | msg=${message_id}`, chat_id);
  }
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
  if (sub === "inicio") return editar(chat_id, message_id, TEXTO_MENU, await tecladoMenu());
  if (sub === "storyauto" || sub === "marca") {
    // Alterna a opção e redesenha o menu com o estado novo.
    try {
      await alternarOpcao(db, sub === "storyauto" ? OPCAO_STORY_AUTOMATICO : OPCAO_MARCA_DAGUA);
    } catch (e) {
      await enviar(chat_id, `Não consegui mudar a opção: ${(e as Error).message}`);
    }
    return editar(chat_id, message_id, TEXTO_MENU, await tecladoMenu());
  }
  if (sub === "agenda") return mostrarAgenda(chat_id, message_id);
  if (sub === "banco") return mostrarBanco(chat_id, message_id);
  if (sub === "fixar") return mostrarFixar(chat_id, message_id);
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
      const nada = !p.importar.length && !p.remover.length && !p.semImagem.length && !p.semLink.length;
      const linhas = [
        "Sincronizar com o Instagram",
        `No perfil: ${p.noInstagram} posts. No banco: ${p.noBanco} posts.`,
        `• Importar (novos no Instagram): ${p.importar.length}`,
        `• Remover (não existem mais no Instagram): ${p.remover.length}`,
        ...(p.semLink.length ? [`• Preencher o link do Instagram em ${p.semLink.length} post(s)`] : []),
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
  if (sub === "stats") {
    return editar(chat_id, message_id, await textoStats(db), { inline_keyboard: [voltar] });
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

/** Resumo curto do post nas listas do /menu: "Reel", "Story (vídeo)", "3 foto(s)". */
function descreverPost(p: { tipo?: string | null; storage_paths: string[] }): string {
  const video = ehVideoPath(p.storage_paths[0]);
  if (p.tipo === "REELS") return "Reel";
  if (p.tipo === "STORIES") return video ? "Story (vídeo)" : "Story (foto)";
  return `${p.storage_paths.length} foto(s)`;
}

async function mostrarAgendados(chat_id: number, message_id: number) {
  const { data } = await db.from("posts").select("id,legenda,agendado_para,storage_paths,tipo")
    .eq("chat_id", chat_id).eq("status", "agendado")
    .order("agendado_para", { ascending: true }).limit(10);
  if (!data?.length) {
    return editar(chat_id, message_id, "Posts agendados:\n\nNenhum post agendado.", { inline_keyboard: [voltar] });
  }
  const quando = (p: { agendado_para: string }) => formatarHorario(new Date(p.agendado_para));
  const linhas = data.map((p, i) =>
    `${i + 1}. ${quando(p)} · ${descreverPost(p)}\n   ${p.tipo === "STORIES" ? "(Story, sem legenda)" : (p.legenda ?? "").split("\n")[0].slice(0, 60)}`
  );
  const botoes = data.map((p, i) => [{ text: `Cancelar ${i + 1} (${quando(p)})`, callback_data: `cancelagenda:${p.id}` }]);
  botoes.push(voltar);
  return editar(chat_id, message_id, `Posts agendados:\n\n${linhas.join("\n")}`, { inline_keyboard: botoes });
}

async function mostrarErros(chat_id: number, message_id: number) {
  const { data } = await db.from("posts").select("id,erro_msg,atualizado_em,storage_paths,tipo")
    .eq("chat_id", chat_id).eq("status", "erro")
    .order("atualizado_em", { ascending: false }).limit(8);
  if (!data?.length) {
    return editar(chat_id, message_id, "Posts com erro:\n\nNenhum post com erro.", { inline_keyboard: [voltar] });
  }
  const linhas = data.map((p, i) =>
    `${i + 1}. ${formatarHorario(new Date(p.atualizado_em))} · ${descreverPost(p)}\n   ${(p.erro_msg ?? "sem detalhe").slice(0, 110)}`
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
  if (post.storage_paths?.length) await db.storage.from("fotos").remove(comOriginais(post.storage_paths));
  // Veio de uma lista (/menu ou /agenda): atualiza a lista. Veio da confirmação do agendamento: apaga essa mensagem.
  if (String(cb.message.text ?? "").startsWith("Posts agendados")) return mostrarAgendados(chat_id, message_id);
  if (String(cb.message.text ?? "").startsWith(TITULO_AGENDA)) return mostrarAgenda(chat_id, message_id);
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
  if (post?.storage_paths?.length) await db.storage.from("fotos").remove(comOriginais(post.storage_paths));
  return mostrarErros(chat_id, cb.message.message_id);
}

// ---------- Agenda dos próximos 7 dias (/agenda e /menu > Agenda) ----------

const TITULO_AGENDA = "Agenda dos próximos 7 dias";
const BRT_MS = 3 * 60 * 60 * 1000; // Brasília = UTC-3, sem horário de verão (igual a horario.ts)
const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const dois = (n: number) => String(n).padStart(2, "0");

/** Partes da data no relógio de Brasília: rótulo do dia ("dom, 30/11") e hora ("19:00"). */
function partesBr(d: Date): { dia: string; hora: string } {
  const br = new Date(d.getTime() - BRT_MS);
  return {
    dia: `${DIAS_SEMANA[br.getUTCDay()]}, ${dois(br.getUTCDate())}/${dois(br.getUTCMonth() + 1)}`,
    hora: `${dois(br.getUTCHours())}:${dois(br.getUTCMinutes())}`,
  };
}

/** Tipo do post em uma palavra: Foto, Carrossel, Reel ou Story. */
function tipoCurto(p: { tipo?: string | null; storage_paths: string[] }): string {
  if (p.tipo === "STORIES") return "Story";
  if (p.tipo === "REELS" || ehVideoPath(p.storage_paths?.[0])) return "Reel";
  return (p.storage_paths?.length ?? 0) > 1 ? "Carrossel" : "Foto";
}

/** Começo da legenda (primeira linha, sem hashtags), para as listas. */
function comecoLegenda(legenda: string | null | undefined, max = 50): string {
  const t = String(legenda ?? "").split("\n")[0].replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\s+/g, " ").trim();
  if (!t) return "(sem legenda)";
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/** Lista os agendados dos próximos 7 dias, por dia. Com message_id edita a mensagem; sem, manda uma nova. */
async function mostrarAgenda(chat_id: number, message_id?: number) {
  const agora = new Date();
  const ate = new Date(agora.getTime() + 7 * 86400_000);
  const { data } = await db.from("posts").select("id,legenda,agendado_para,storage_paths,tipo")
    .eq("chat_id", chat_id).eq("status", "agendado")
    .lte("agendado_para", ate.toISOString())
    .order("agendado_para", { ascending: true }).limit(30);
  const lista = data ?? [];

  let texto: string;
  const botoes: Array<Array<{ text: string; callback_data: string }>> = [];
  if (!lista.length) {
    texto = `${TITULO_AGENDA}\n\nNada agendado para os próximos 7 dias.`;
  } else {
    const linhas: string[] = [TITULO_AGENDA];
    let diaAtual = "";
    lista.forEach((p, i) => {
      const { dia, hora } = partesBr(new Date(p.agendado_para));
      if (dia !== diaAtual) {
        linhas.push("", dia);
        diaAtual = dia;
      }
      const tipo = tipoCurto(p);
      linhas.push(`${i + 1}. ${hora} · ${tipo} · ${tipo === "Story" ? "(Story, sem legenda)" : comecoLegenda(p.legenda)}`);
      // Mesmo callback do cancelamento dos agendados: cancelarAgendado redesenha esta lista.
      botoes.push([{ text: `Cancelar ${i + 1} (${dia} ${hora})`, callback_data: `cancelagenda:${p.id}` }]);
    });
    texto = linhas.join("\n");
  }
  botoes.push(voltar);
  if (message_id) return editar(chat_id, message_id, texto, { inline_keyboard: botoes });
  return enviar(chat_id, texto, { reply_markup: { inline_keyboard: botoes } });
}

// ---------- Banco de fotos (/menu > Banco de fotos) ----------

const TITULO_BANCO = "Banco de fotos";

async function mostrarBanco(chat_id: number, message_id: number, aviso = "") {
  const { data } = await db.from("posts").select("id,legenda,criado_em,storage_paths,tipo")
    .eq("chat_id", chat_id).eq("status", "banco")
    .order("criado_em", { ascending: true }).limit(10);
  const lista = data ?? [];
  const topo = `${TITULO_BANCO}${aviso ? `\n\n${aviso}` : ""}`;
  if (!lista.length) {
    return editar(
      chat_id,
      message_id,
      `${topo}\n\nNada guardado. Na prévia de uma foto ou vídeo, toque em "Guardar no banco".`,
      { inline_keyboard: [voltar] },
    );
  }
  const linhas = lista.map((p, i) =>
    `${i + 1}. ${partesBr(new Date(p.criado_em)).dia} · ${tipoCurto({ ...p, tipo: p.tipo === "STORIES" ? null : p.tipo })} · ${comecoLegenda(p.legenda)}`
  );
  const botoes = lista.flatMap((p, i) => [
    [
      { text: `Usar ${i + 1}`, callback_data: `bancousar:${p.id}` },
      { text: `Excluir ${i + 1}`, callback_data: `bancoexcluir:${p.id}` },
    ],
    [{ text: `Agendar ${i + 1} no melhor horário`, callback_data: `bancoagendar:${p.id}` }],
  ]);
  botoes.push(voltar);
  return editar(chat_id, message_id, `${topo}\n\nMais antigos primeiro:\n${linhas.join("\n")}`, { inline_keyboard: botoes });
}

/** Reenvia a mídia guardada (pelo file_id do Telegram). Devolve o id da mensagem, ou undefined se falhar. */
// deno-lint-ignore no-explicit-any
async function reenviarMidia(chat_id: number, post: any): Promise<number | undefined> {
  const fileId: string | undefined = post.telegram_file_ids?.[0];
  if (!fileId) return undefined;
  const video = midiaDoPost(post) === "video";
  // Foto/vídeo enviado como arquivo tem file_id de documento: sendPhoto/sendVideo recusa, então tenta sendDocument.
  for (const [metodo, campo] of video
    ? [["sendVideo", "video"], ["sendDocument", "document"]]
    : [["sendPhoto", "photo"], ["sendDocument", "document"]]) {
    const r = await tg(metodo, { chat_id, [campo]: fileId }).catch(() => null);
    if (r?.ok) return idDe(r);
  }
  return undefined;
}

// deno-lint-ignore no-explicit-any
async function usarDoBanco(cb: any, postId: string) {
  const chat_id: number = cb.message.chat.id;
  // Volta a rascunho. O tipo é refeito pela mídia (um Agendar Story antigo não fica valendo).
  const { data: post } = await db.from("posts").update({
    status: "rascunho",
    aguardando_horario: false,
    aguardando_legenda: false,
    atualizado_em: new Date().toISOString(),
  }).eq("id", postId).eq("status", "banco").select("*").maybeSingle();
  if (!post) return mostrarBanco(chat_id, cb.message.message_id, "Esse item não está mais no banco.");
  const midia = midiaDoPost(post);
  if (post.tipo === "STORIES") {
    await db.from("posts").update({ tipo: midia === "video" ? "REELS" : "FEED" }).eq("id", postId);
  }
  const idMidia = await reenviarMidia(chat_id, post);
  const previa = await enviar(chat_id, `Do banco de fotos. Prévia da legenda:\n\n${post.legenda ?? ""}`, {
    reply_markup: teclado(postId, midia),
  });
  await lembrar([idMidia, idDe(previa)], { postId });
  return mostrarBanco(chat_id, cb.message.message_id);
}

// deno-lint-ignore no-explicit-any
async function agendarDoBanco(cb: any, postId: string) {
  const chat_id: number = cb.message.chat.id;
  const message_id: number = cb.message.message_id;
  const agora = new Date();
  // Melhor horário pelos dados de alcance; sem dados suficientes, amanhã às 19h.
  const sugeridos = await proximosHorariosSugeridos(db, agora).catch(() => [] as Date[]);
  const quando = sugeridos[0] ?? horaPronta(agora, 1, 19);

  const { data: atual } = await db.from("posts").select("storage_paths").eq("id", postId).eq("status", "banco")
    .maybeSingle();
  if (!atual) return mostrarBanco(chat_id, message_id, "Esse item não está mais no banco.");
  const tipo: TipoPost = ehVideoPath(atual.storage_paths?.[0]) ? "REELS" : "FEED";
  const { data } = await db.from("posts").update({
    status: "agendado",
    tipo,
    agendado_para: quando.toISOString(),
    aguardando_horario: false,
    aguardando_legenda: false,
    atualizado_em: new Date().toISOString(),
  }).eq("id", postId).eq("status", "banco").select("id").maybeSingle();
  if (!data) return mostrarBanco(chat_id, message_id, "Esse item não está mais no banco.");
  await enviar(
    chat_id,
    `${tipo === "REELS" ? "Reel agendado" : "Agendado"} para ${formatarHorario(quando)} (horário de Brasília)${sugeridos.length ? ", o melhor horário pelos seus dados" : ""}.`,
    { reply_markup: { inline_keyboard: [[{ text: "Cancelar agendamento", callback_data: `cancelagenda:${postId}` }]] } },
  );
  return mostrarBanco(chat_id, message_id);
}

// deno-lint-ignore no-explicit-any
async function excluirDoBanco(cb: any, postId: string) {
  const chat_id: number = cb.message.chat.id;
  // Apaga a linha só se ainda estiver no banco; os arquivos saem do Storage depois.
  const { data: post } = await db.from("posts").delete()
    .eq("id", postId).eq("status", "banco").select("storage_paths").maybeSingle();
  if (!post) return mostrarBanco(chat_id, cb.message.message_id, "Esse item não está mais no banco.");
  if (post.storage_paths?.length) await db.storage.from("fotos").remove(comOriginais(post.storage_paths));
  return mostrarBanco(chat_id, cb.message.message_id, "Item excluído.");
}

// ---------- Posts fixados no site (/menu > Fixar posts) ----------

const MAX_FIXADOS = 3;

async function mostrarFixar(chat_id: number, message_id: number, aviso = "") {
  // Data real de publicação = coalesce(agendado_para, atualizado_em). O PostgREST não ordena por coalesce:
  // busca os 9 mais novos com agendado_para e os 9 mais novos sem ele, e junta aqui.
  const colunas = "id,legenda,agendado_para,atualizado_em,storage_paths,tipo,fixado_ordem";
  const [comData, semData] = await Promise.all([
    db.from("posts").select(colunas).eq("status", "publicado").neq("tipo", "STORIES")
      .not("agendado_para", "is", null).order("agendado_para", { ascending: false }).limit(9),
    db.from("posts").select(colunas).eq("status", "publicado").neq("tipo", "STORIES")
      .is("agendado_para", null).order("atualizado_em", { ascending: false }).limit(9),
  ]);
  const quando = (p: { agendado_para: string | null; atualizado_em: string }) =>
    new Date(p.agendado_para ?? p.atualizado_em).getTime();
  const lista = [...(comData.data ?? []), ...(semData.data ?? [])].sort((a, b) => quando(b) - quando(a)).slice(0, 9);
  const topo = `Fixar posts no site (até ${MAX_FIXADOS}). Os fixados aparecem primeiro.${aviso ? `\n\n${aviso}` : ""}`;
  if (!lista.length) return editar(chat_id, message_id, `${topo}\n\nNenhum post publicado.`, { inline_keyboard: [voltar] });

  const linhas = lista.map((p, i) =>
    `${i + 1}. ${p.fixado_ordem ? "📌 " : ""}${partesBr(new Date(quando(p))).dia} · ${tipoCurto(p)} · ${comecoLegenda(p.legenda, 40)}`
  );
  const botoes = lista.map((p, i) => [
    p.fixado_ordem
      ? { text: `Desafixar ${i + 1}`, callback_data: `desafixar:${p.id}` }
      : { text: `📌 Fixar ${i + 1}`, callback_data: `fixar:${p.id}` },
  ]);
  botoes.push(voltar);
  return editar(chat_id, message_id, `${topo}\n\n${linhas.join("\n")}`, { inline_keyboard: botoes });
}

/** Renumera os fixados como 1, 2, 3 (na ordem atual), para o próximo entrar no fim. */
async function compactarFixados(): Promise<number> {
  const { data } = await db.from("posts").select("id,fixado_ordem").not("fixado_ordem", "is", null)
    .order("fixado_ordem", { ascending: true });
  const fixados = data ?? [];
  for (const [i, p] of fixados.entries()) {
    if (p.fixado_ordem !== i + 1) await db.from("posts").update({ fixado_ordem: i + 1 }).eq("id", p.id);
  }
  return fixados.length;
}

// deno-lint-ignore no-explicit-any
async function alternarFixado(cb: any, postId: string, fixar: boolean) {
  const chat_id: number = cb.message.chat.id;
  const message_id: number = cb.message.message_id;
  if (!fixar) {
    await db.from("posts").update({ fixado_ordem: null }).eq("id", postId);
    await compactarFixados();
    return mostrarFixar(chat_id, message_id);
  }
  const total = await compactarFixados();
  if (total >= MAX_FIXADOS) {
    return mostrarFixar(chat_id, message_id, `Já há ${MAX_FIXADOS} posts fixados. Desafixe um antes de fixar outro.`);
  }
  const { data } = await db.from("posts").update({ fixado_ordem: total + 1 })
    .eq("id", postId).eq("status", "publicado").is("fixado_ordem", null).select("id").maybeSingle();
  return mostrarFixar(chat_id, message_id, data ? "" : "Não consegui fixar: o post não está publicado ou já está fixado.");
}

/** Texto livre do dono: se há um post esperando legenda manual, o texto vira a legenda. Devolve false se não há. */
async function tratarLegendaTexto(chat_id: number, texto: string, msgId?: number): Promise<boolean> {
  const { data: post } = await db.from("posts").select("id,legenda,storage_paths")
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
  const r = await enviar(chat_id, `Legenda definida:\n\n${legenda}`, { reply_markup: teclado(post.id, midiaDoPost(post)) });
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
      await enviar(chat_id!, TEXTO_MENU, { reply_markup: await tecladoMenu() });
    } else if (/^\/agenda/i.test(msg?.text?.trim() ?? "")) {
      await mostrarAgenda(chat_id!);
    } else if (/^\/stats/i.test(msg?.text?.trim() ?? "")) {
      await enviar(chat_id!, await textoStats(db));
    } else if (/^\/hashtags/i.test(msg?.text?.trim() ?? "")) {
      await mostrarHashtags(chat_id!);
    } else if (/^criar postagem$/i.test(msg?.text?.trim() ?? "")) {
      // O Telegram não deixa o bot abrir o seletor de arquivos: a mensagem orienta o próximo passo.
      await enviar(
        chat_id!,
        "Envie a foto ou o vídeo agora (use o clipe ao lado do campo de texto). Para carrossel, envie várias fotos de uma vez. Vídeo vira Reel (até 20 MB). Se quiser, escreva uma dica na legenda.",
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
    } else if (msg?.video || String(msg?.document?.mime_type ?? "").startsWith("video/")) {
      // Vídeo normal ou enviado como arquivo: vira rascunho de Reel (tratarVideo recusa o que não é MP4).
      await tratarVideo(msg);
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
