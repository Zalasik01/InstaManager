// Worker do site polo9n.com.br.
// - /api/posts  -> lê os posts públicos no Supabase (função listar_posts_publicos) e devolve JSON.
// - qualquer outra rota -> arquivos estáticos de ./public (binding ASSETS).
//
// Só usa a chave PUBLISHABLE do Supabase, que é pública por desenho. As tabelas têm RLS sem política:
// o site só alcança o que as funções listar_posts_publicos/contar_posts_publicos devolvem
// (legenda, data, link e imagens de posts que já são públicos no Instagram).

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
}

type PostRpc = {
  id: string;
  legenda: string | null;
  publicado_em: string;
  permalink: string | null;
  galeria_paths: string[];
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // www -> domínio principal, com redirecionamento permanente (um só endereço para o Google indexar).
    if (url.hostname === "www.polo9n.com.br") {
      url.hostname = "polo9n.com.br";
      return Response.redirect(url.toString(), 301);
    }

    const resposta = url.pathname === "/api/posts"
      ? (request.method !== "GET" ? json({ erro: "método não permitido" }, 405) : await posts(url, env))
      : await env.ASSETS.fetch(request);

    // O endereço provisório *.workers.dev não deve ser indexado (evita conteúdo duplicado com o domínio).
    if (url.hostname.endsWith(".workers.dev")) {
      const copia = new Response(resposta.body, resposta);
      copia.headers.set("x-robots-tag", "noindex, nofollow");
      return copia;
    }
    return resposta;
  },
};
