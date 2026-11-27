/**
 * Ajustes de resposta feitos na borda pelo Worker (src/worker.ts). Funções puras sobre Response.
 */

/** A resposta é uma página HTML? */
export function ehHtml(resposta: Response): boolean {
  return (resposta.headers.get("content-type") ?? "").includes("text/html");
}

const META_VERSAO = /<meta\s+name="app-versao"\s+content="[^"]*"\s*\/?>/i;

/**
 * Grava o id da versão em <meta name="app-versao">. O Base.astro já gera essa meta com o id do build;
 * aqui ela passa a ter o id do deploy (o mesmo de /version.json). Sem a meta, insere antes de </head>.
 * O corpo muda: sai sem ETag/Content-Length e com "no-cache" (sempre revalida, como no site antigo).
 */
export async function injetarVersao(resposta: Response, versao: string): Promise<Response> {
  const meta = `<meta name="app-versao" content="${versao.replace(/[^A-Za-z0-9_-]/g, "")}">`;
  let texto = await resposta.text();
  texto = META_VERSAO.test(texto)
    ? texto.replace(META_VERSAO, meta)
    : texto.replace("</head>", `${meta}</head>`);
  const headers = new Headers(resposta.headers);
  headers.delete("etag");
  headers.delete("content-length");
  headers.set("cache-control", "no-cache");
  return new Response(texto, { status: resposta.status, statusText: resposta.statusText, headers });
}

/**
 * Cabeçalhos de segurança que o public/_headers põe nos estáticos. O _headers não vale para o que o
 * Worker gera (API, /m/*, /version.json, HTML reescrito), então eles entram aqui quando faltarem.
 */
const SEGURANCA: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "x-frame-options": "DENY",
  "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
  "cross-origin-opener-policy": "same-origin",
};

/** CSP só de cabeçalho para páginas (a de scripts/estilos vem do Astro, por meta com hashes). */
export const CSP_PAGINA =
  "img-src 'self' data:; " +
  "media-src 'self' https://crzmyemggpgjcrwwuwka.supabase.co; " +
  "connect-src 'self' https://crzmyemggpgjcrwwuwka.supabase.co; " +
  "manifest-src 'self'; worker-src 'self'; object-src 'none'; " +
  "frame-ancestors 'none'; base-uri 'self'; form-action 'none'";

/** CSP de tudo que não é página (JSON, imagens, texto): não executa nada. */
const CSP_RECURSO = "default-src 'none'; frame-ancestors 'none'";

export function aplicarSeguranca(resposta: Response): Response {
  const faltando = Object.keys(SEGURANCA).filter((k) => !resposta.headers.has(k));
  const semCsp = !resposta.headers.has("content-security-policy");
  if (faltando.length === 0 && !semCsp) return resposta;
  // Respostas do ASSETS/fetch têm cabeçalhos imutáveis: copia antes de mexer.
  const copia = new Response(resposta.body, resposta);
  for (const k of faltando) copia.headers.set(k, SEGURANCA[k] ?? "");
  if (semCsp) copia.headers.set("content-security-policy", ehHtml(copia) ? CSP_PAGINA : CSP_RECURSO);
  return copia;
}
