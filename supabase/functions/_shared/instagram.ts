// Publicação no Instagram pela Graph API (token SUAT, não expira).
// Secrets: IG_ACCESS_TOKEN, IG_USER_ID. Usado pelo bot (postar agora) e pelo agendador.

const GRAPH = "https://graph.facebook.com/v23.0";

async function graph(path: string, params: Record<string, string>, method = "POST") {
  const url = new URL(`${GRAPH}/${path}`);
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${Deno.env.get("IG_ACCESS_TOKEN")}` },
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

async function aguardarContainer(id: string) {
  for (let i = 0; i < 20; i++) {
    const s = await graph(id, { fields: "status_code,status" }, "GET");
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
      throw new Error(`Instagram recusou a mídia: ${s.status ?? s.status_code}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Instagram demorou demais para processar a imagem");
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
  const p = await graph(`${ig}/media_publish`, { creation_id: creationId });
  return p.id as string;
}
