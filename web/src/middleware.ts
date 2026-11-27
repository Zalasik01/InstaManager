import { defineMiddleware } from "astro:middleware";

/**
 * Middleware do Astro: só roda nas rotas dinâmicas (/api/*, /m/*, /version.json).
 * As páginas estáticas saem do ASSETS antes dele, por isso a regra completa (www -> domínio, noindex no
 * workers.dev, versão no HTML, cabeçalhos de segurança) está em src/worker.ts. Isto aqui é só reforço,
 * para valer também se a rota for chamada sem passar pelo worker.ts (ex.: astro dev).
 */
const DOMINIO = "polo9n.com.br";

export const onRequest = defineMiddleware(async ({ url }, next) => {
  // www -> domínio principal, com redirecionamento permanente (um só endereço para o Google indexar).
  if (url.hostname === `www.${DOMINIO}`) {
    const destino = new URL(url);
    destino.hostname = DOMINIO;
    return Response.redirect(destino.toString(), 301);
  }

  const resposta = await next();

  // O endereço provisório *.workers.dev não deve ser indexado (evita conteúdo duplicado).
  if (url.hostname.endsWith(".workers.dev")) {
    const copia = new Response(resposta.body, resposta);
    copia.headers.set("x-robots-tag", "noindex, nofollow");
    return copia;
  }
  return resposta;
});
