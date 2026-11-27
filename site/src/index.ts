// Worker do site polo9n.com.br.
// - /api/posts  -> lê os posts públicos no Supabase (função listar_posts_publicos) e devolve JSON.
// - /api/comentarios?post=<uuid> -> comentários do Instagram do post (listar_comentarios_publicos).
// - /api/push (POST/DELETE) -> inscreve/cancela o aviso de post novo (inscrever_push/cancelar_push).
// - qualquer outra rota -> arquivos estáticos de ./public (binding ASSETS).
//
// Só usa a chave PUBLISHABLE do Supabase, que é pública por desenho. As tabelas têm RLS sem política:
// o site só alcança o que as funções listar_posts_publicos/contar_posts_publicos devolvem
// (legenda, data, link e imagens de posts que já são públicos no Instagram).

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  // Preenchido pelo Cloudflare: cada deploy tem um id novo (vale também para deploys automáticos pelo GitHub).
  CF_VERSION_METADATA?: { id: string; tag?: string; timestamp?: string };
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
}

type PostRpc = {
  id: string;
  legenda: string | null;
  publicado_em: string;
  permalink: string | null;
  galeria_paths: string[];
  visualizacoes: number | null;
  curtidas: number | null;
  comentarios: number | null;
  video_path: string | null;
};

const json = (corpo: unknown, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });

async function rpc<T>(env: Env, funcao: string, args: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${funcao}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  return await r.json() as T;
}

async function posts(url: URL, env: Env): Promise<Response> {
  const limite = Math.min(Math.max(parseInt(url.searchParams.get("limite") ?? "12", 10) || 12, 1), 30);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
  try {
    const [lista, total] = await Promise.all([
      rpc<PostRpc[]>(env, "listar_posts_publicos", { p_limite: limite, p_offset: offset }),
      rpc<number>(env, "contar_posts_publicos", {}),
    ]);
    const base = `${env.SUPABASE_URL}/storage/v1/object/public/galeria/`;
    return json(
      {
        total,
        posts: lista.map((p) => ({
          id: p.id,
          legenda: p.legenda ?? "",
          publicado_em: p.publicado_em,
          permalink: p.permalink,
          visualizacoes: p.visualizacoes,
          curtidas: p.curtidas,
          comentarios: p.comentarios,
          // Vídeo/Reel: URL do MP4 na galeria (o site toca com <video>); null para foto.
          video: p.video_path ? base + p.video_path.split("/").map(encodeURIComponent).join("/") : null,
          imagens: p.galeria_paths.map((c) => base + c.split("/").map(encodeURIComponent).join("/")),
        })),
      },
      200,
      // 1 minuto no navegador e na borda do Cloudflare: o site não martela o banco.
      "public, max-age=60, s-maxage=60",
    );
  } catch {
    return json({ erro: "Não consegui carregar os posts agora. Tente de novo em instantes." }, 502);
  }
}

type PerfilRpc = { seguidores: number | null; seguindo: number | null; midias: number | null; atualizado_em: string };

async function perfil(env: Env): Promise<Response> {
  try {
    const linhas = await rpc<PerfilRpc[]>(env, "obter_perfil_publico", {});
    const p = linhas[0];
    return json(
      p
        ? { seguidores: p.seguidores, seguindo: p.seguindo, posts: p.midias, atualizado_em: p.atualizado_em }
        : { seguidores: null, seguindo: null, posts: null, atualizado_em: null },
      200,
      // Os números mudam devagar (coleta diária): 5 minutos de cache bastam.
      "public, max-age=300, s-maxage=300",
    );
  } catch {
    return json({ erro: "Não consegui carregar o perfil agora." }, 502);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ComentarioRpc = { usuario: string | null; texto: string | null; curtidas: number | null; criado_em: string | null };

/** Comentários do Instagram de um post (copiados para o banco a cada 3 horas pela função coletar-comentarios). */
async function comentarios(url: URL, env: Env): Promise<Response> {
  const post = url.searchParams.get("post") ?? "";
  if (!UUID.test(post)) return json({ erro: "post inválido" }, 400);
  try {
    const lista = await rpc<ComentarioRpc[]>(env, "listar_comentarios_publicos", { p_post_id: post, p_limite: 20 });
    return json(
      {
        comentarios: lista.map((c) => ({
          usuario: c.usuario ?? "",
          texto: c.texto ?? "",
          curtidas: c.curtidas,
          criado_em: c.criado_em,
        })),
      },
      200,
      // A coleta roda a cada 3 horas: 5 minutos de cache não atrasam nada e poupam o banco.
      "public, max-age=300, s-maxage=300",
    );
  } catch {
    return json({ erro: "Não consegui carregar os comentários agora." }, 502);
  }
}

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * Inscrição de Web Push (aviso de post novo).
 * POST   /api/push  { endpoint, keys: { p256dh, auth } } -> inscrever_push
 * DELETE /api/push  { endpoint }                          -> cancelar_push
 * Valida aqui o básico (corpo pequeno, endpoint https, chaves base64url); o banco valida de novo e limita o total.
 */
async function push(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST" && request.method !== "DELETE") return json({ erro: "método não permitido" }, 405);
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return json({ erro: "envie JSON" }, 415);
  // Só aceita pedidos do próprio site (o navegador sempre manda Origin em POST/DELETE com fetch).
  const origem = request.headers.get("origin");
  if (origem && origem !== new URL(request.url).origin) return json({ erro: "origem não permitida" }, 403);

  const texto = await request.text();
  if (texto.length > 4096) return json({ erro: "corpo grande demais" }, 413);
  let corpo: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  try {
    corpo = JSON.parse(texto);
  } catch {
    return json({ erro: "JSON inválido" }, 400);
  }
  const endpoint = typeof corpo?.endpoint === "string" ? corpo.endpoint : "";
  let endpointOk = false;
  try {
    endpointOk = endpoint.length <= 1000 && new URL(endpoint).protocol === "https:";
  } catch { /* endpoint inválido */ }
  if (!endpointOk) return json({ erro: "endpoint inválido" }, 400);

  try {
    if (request.method === "DELETE") {
      await rpc<boolean>(env, "cancelar_push", { p_endpoint: endpoint });
      return json({ ok: true });
    }
    const p256dh = typeof corpo.keys?.p256dh === "string" ? corpo.keys.p256dh : "";
    const auth = typeof corpo.keys?.auth === "string" ? corpo.keys.auth : "";
    if (!B64URL.test(p256dh) || p256dh.length > 100 || !B64URL.test(auth) || auth.length > 32) {
      return json({ erro: "chaves inválidas" }, 400);
    }
    await rpc<boolean>(env, "inscrever_push", { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth });
    return json({ ok: true }, 201);
  } catch {
    return json({ erro: "Não deu para salvar a inscrição agora." }, 502);
  }
}

const versaoDoApp = (env: Env) => (env.CF_VERSION_METADATA?.id ?? "dev").slice(0, 8);

/**
 * Arquivos estáticos. O sw.js e as páginas HTML levam o id da versão do deploy:
 * - sw.js: troca __APP_VERSION__ (o arquivo muda a cada deploy, então todo navegador instala o novo);
 * - HTML: injeta <meta name="app-versao">, que o site compara com /version.json para se atualizar sozinho.
 * Como o corpo é reescrito, tira os cabeçalhos condicionais do pedido (nunca recebe 304 de um arquivo
 * reescrito) e o ETag da resposta.
 */
async function estatico(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const ehSw = url.pathname === "/sw.js";
  const querHtml = (request.headers.get("accept") ?? "").includes("text/html");

  let pedido = request;
  if (ehSw || querHtml) {
    const h = new Headers(request.headers);
    h.delete("if-none-match");
    h.delete("if-modified-since");
    pedido = new Request(request, { headers: h });
  }
  const r = await env.ASSETS.fetch(pedido);
  if (r.status !== 200 || request.method !== "GET") return r;

  const tipo = r.headers.get("content-type") ?? "";
  if (!ehSw && !tipo.includes("text/html")) return r;

  const versao = versaoDoApp(env);
  let texto = await r.text();
  texto = ehSw
    ? texto.replaceAll("__APP_VERSION__", versao)
    : texto.replace("</head>", `<meta name="app-versao" content="${versao}"></head>`);

  const headers = new Headers(r.headers);
  headers.delete("etag");
  headers.delete("content-length");
  headers.set("cache-control", "no-cache");
  return new Response(texto, { status: 200, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // www -> domínio principal, com redirecionamento permanente (um só endereço para o Google indexar).
    if (url.hostname === "www.polo9n.com.br") {
      url.hostname = "polo9n.com.br";
      return Response.redirect(url.toString(), 301);
    }

    const api = url.pathname === "/api/posts" || url.pathname === "/api/perfil" || url.pathname === "/api/comentarios";
    const resposta = url.pathname === "/api/push"
      ? await push(request, env)
      : api && request.method !== "GET"
      ? json({ erro: "método não permitido" }, 405)
      : url.pathname === "/api/posts"
      ? await posts(url, env)
      : url.pathname === "/api/perfil"
      ? await perfil(env)
      : url.pathname === "/api/comentarios"
      ? await comentarios(url, env)
      : url.pathname === "/version.json"
      ? json({ versao: versaoDoApp(env) }, 200, "no-store")
      : await estatico(request, env);

    // O endereço provisório *.workers.dev não deve ser indexado (evita conteúdo duplicado com o domínio).
    if (url.hostname.endsWith(".workers.dev")) {
      const copia = new Response(resposta.body, resposta);
      copia.headers.set("x-robots-tag", "noindex, nofollow");
      return copia;
    }
    return resposta;
  },
};
