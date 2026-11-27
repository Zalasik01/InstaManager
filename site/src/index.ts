// Worker do site polo9n.com.br.
// - /api/posts  -> lê os posts públicos no Supabase (função listar_posts_publicos) e devolve JSON.
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

    const api = url.pathname === "/api/posts" || url.pathname === "/api/perfil";
    const resposta = api && request.method !== "GET"
      ? json({ erro: "método não permitido" }, 405)
      : url.pathname === "/api/posts"
      ? await posts(url, env)
      : url.pathname === "/api/perfil"
      ? await perfil(env)
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
