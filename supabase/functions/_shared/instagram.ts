// Publicação no Instagram pela Graph API (token SUAT, não expira).
// Secrets: IG_ACCESS_TOKEN, IG_USER_ID. Usado pelo bot (postar agora) e pelo agendador.
// Tipos: foto/carrossel no feed, Reel (vídeo) e Story (foto ou vídeo).

const GRAPH = "https://graph.facebook.com/v23.0";

async function graph(path: string, params: Record<string, string>, method = "POST") {
  const url = new URL(`${GRAPH}/${path}`);
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${Deno.env.get("IG_ACCESS_TOKEN")}` },
    // Prazo por chamada: sem isso, uma chamada pendurada mata a função em silêncio.
    signal: AbortSignal.timeout(30000),
  };
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  } else {
    init.body = new URLSearchParams(params);
  }
  const r = await fetch(url, init);
  const j = await r.json();
  if (!r.ok) throw new Error(`Instagram: ${j?.error?.message ?? r.status}`);
  return j;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Espera o container ficar pronto (status_code=FINISHED).
 * Foto: até ~30 s em passos de 1,5 s. Vídeo: até ~90 s com espera crescente (2 s, 3 s, ... até 10 s),
 * porque o Instagram baixa e processa o vídeo antes de liberar.
 */
async function aguardarContainer(id: string, video = false) {
  const prazo = Date.now() + (video ? 90000 : 30000);
  let espera = video ? 2000 : 1500;
  while (true) {
    const s = await graph(id, { fields: "status_code,status" }, "GET");
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
      throw new Error(`Instagram recusou a mídia: ${s.status ?? s.status_code}`);
    }
    if (Date.now() + espera > prazo) break;
    await esperar(espera);
    if (video) espera = Math.min(espera + 1000, 10000);
  }
  throw new Error(
    video
      ? "O Instagram ainda processava o vídeo depois de 90 s. Nada foi publicado: tente de novo daqui a pouco."
      : "Instagram demorou demais para processar a imagem",
  );
}

/** Publica um container pronto e devolve o id da mídia publicada. */
async function publicarContainer(creationId: string): Promise<string> {
  const ig = Deno.env.get("IG_USER_ID")!;
  const p = await graph(`${ig}/media_publish`, { creation_id: creationId });
  return p.id as string;
}

/** Publica uma foto (ou carrossel, se vierem 2+ URLs). Devolve o id da mídia publicada. */
export async function publicarNoInstagram(urls: string[], legenda: string): Promise<string> {
  const ig = Deno.env.get("IG_USER_ID")!;

  let creationId: string;
  if (urls.length === 1) {
    const c = await graph(`${ig}/media`, { image_url: urls[0], caption: legenda });
    creationId = c.id;
  } else {
    const filhos: string[] = [];
    for (const u of urls.slice(0, 10)) {
      const c = await graph(`${ig}/media`, { image_url: u, is_carousel_item: "true" });
      await aguardarContainer(c.id);
      filhos.push(c.id);
    }
    const pai = await graph(`${ig}/media`, {
      media_type: "CAROUSEL",
      children: filhos.join(","),
      caption: legenda,
    });
    creationId = pai.id;
  }

  await aguardarContainer(creationId);
  return publicarContainer(creationId);
}

/**
 * Publica um Reel (vídeo MP4 por URL pública). share_to_feed=true: o Reel aparece também na grade do perfil.
 * capaUrl é opcional (JPEG público); sem ela, o Instagram escolhe o quadro da capa.
 * Devolve o id da mídia publicada.
 */
export async function publicarReel(videoUrl: string, legenda: string, capaUrl?: string): Promise<string> {
  const ig = Deno.env.get("IG_USER_ID")!;
  const c = await graph(`${ig}/media`, {
    media_type: "REELS",
    video_url: videoUrl,
    caption: legenda,
    share_to_feed: "true",
    ...(capaUrl ? { cover_url: capaUrl } : {}),
  });
  await aguardarContainer(c.id, true);
  return publicarContainer(c.id);
}

/**
 * Publica um Story (foto JPEG ou vídeo MP4 por URL pública). Story não tem legenda na API.
 * Devolve o id da mídia publicada.
 */
export async function publicarStory(url: string, ehVideo: boolean): Promise<string> {
  const ig = Deno.env.get("IG_USER_ID")!;
  const c = await graph(`${ig}/media`, {
    media_type: "STORIES",
    ...(ehVideo ? { video_url: url } : { image_url: url }),
  });
  await aguardarContainer(c.id, ehVideo);
  return publicarContainer(c.id);
}

/** Tipos de post gravados em posts.tipo. */
export type TipoPost = "FEED" | "REELS" | "STORIES";

/** Um post é vídeo quando o arquivo guardado no Storage é MP4. */
export const ehVideoPath = (caminho: string | undefined) => !!caminho && caminho.toLowerCase().endsWith(".mp4");

/**
 * Publica conforme o tipo do post. `urls` são as URLs públicas do Storage, na ordem de storage_paths.
 * FEED: foto ou carrossel. REELS: o primeiro arquivo (MP4). STORIES: o primeiro arquivo (foto ou vídeo).
 */
export async function publicarPorTipo(
  tipo: TipoPost,
  urls: string[],
  caminhos: string[],
  legenda: string,
): Promise<string> {
  if (tipo === "REELS") {
    if (!ehVideoPath(caminhos[0])) throw new Error("Reel precisa de um vídeo MP4.");
    return publicarReel(urls[0], legenda);
  }
  if (tipo === "STORIES") return publicarStory(urls[0], ehVideoPath(caminhos[0]));
  if (ehVideoPath(caminhos[0])) throw new Error("Vídeo não vai para o feed como foto: publique como Reel.");
  return publicarNoInstagram(urls, legenda);
}
