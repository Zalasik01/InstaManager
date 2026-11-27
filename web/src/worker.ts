/**
 * Entrada do Worker polo9n (wrangler.jsonc "main"). Envolve o handle() do @astrojs/cloudflare.
 *
 * Por que existe: com "run_worker_first" o handle() do adapter devolve os arquivos estáticos (páginas
 * prerenderizadas) direto do ASSETS, ANTES do middleware do Astro. Então o que precisa valer para TODA
 * resposta, como no site antigo (site/src/index.ts), fica aqui:
 * - www.polo9n.com.br -> 301 para polo9n.com.br;
 * - *.workers.dev -> X-Robots-Tag: noindex, nofollow;
 * - HTML: id da versão do deploy em <meta name="app-versao"> (o site compara com /version.json);
 *   o corpo é reescrito, então o pedido vai sem If-None-Match/If-Modified-Since (nunca 304) e a
 *   resposta sai sem ETag;
 * - cabeçalhos de segurança também nas respostas geradas pelo Worker (o _headers só vale para estáticos).
 */
import { handle } from "@astrojs/cloudflare/handler";
import { aplicarSeguranca, ehHtml, injetarVersao } from "@/lib/borda";
import { versaoDoApp } from "@/lib/versao";

const DOMINIO = "polo9n.com.br";

type Contexto = Parameters<typeof handle>[2];
type Ambiente = Parameters<typeof handle>[1];

export default {
  async fetch(request: Request, env: Ambiente, ctx: Contexto): Promise<Response> {
    const url = new URL(request.url);

    // www -> domínio principal, com redirecionamento permanente (um só endereço para o Google indexar).
    if (url.hostname === `www.${DOMINIO}`) {
      url.hostname = DOMINIO;
      return Response.redirect(url.toString(), 301);
    }

    // Página (navegação): tira os cabeçalhos condicionais, porque o HTML será reescrito.
    const querHtml =
      request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
    let pedido = request;
    if (querHtml) {
      const h = new Headers(request.headers);
      h.delete("if-none-match");
      h.delete("if-modified-since");
      pedido = new Request(request, { headers: h });
    }

    let resposta = await handle(pedido, env, ctx);

    if (request.method === "GET" && resposta.status === 200 && ehHtml(resposta)) {
      resposta = await injetarVersao(resposta, versaoDoApp());
    }

    resposta = aplicarSeguranca(resposta);

    // O endereço provisório *.workers.dev não deve ser indexado (evita conteúdo duplicado).
    if (url.hostname.endsWith(".workers.dev")) {
      resposta = new Response(resposta.body, resposta);
      resposta.headers.set("x-robots-tag", "noindex, nofollow");
    }
    return resposta;
  },
} satisfies { fetch: (r: Request, e: Ambiente, c: Contexto) => Promise<Response> };
