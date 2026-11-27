import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { caminhoImagemValido, urlGaleria } from "@/lib/supabase";

export const prerender = false;

/**
 * GET /m/AAAA/MM/arquivo.jpg -> imagem da galeria pelo próprio domínio (item 24).
 *
 * - Busca em ${SUPABASE_URL}/storage/v1/object/public/galeria/<caminho> só na primeira vez em cada
 *   data center; depois sai do cache de borda do Cloudflare (Cache API, caches.default, chave = URL).
 * - Navegador: "public, max-age=604800, immutable" (o nome do arquivo nunca muda de conteúdo).
 * - Só JPEG e só caminhos no formato AAAA/MM/nome.jpg (sem "..", sem outros diretórios).
 * - Mesma origem: o CSP img-src 'self' basta e o service worker guarda a resposta (cache primeiro).
 */

const CACHE_NAVEGADOR = "public, max-age=604800, immutable";

const naoEncontrado = () =>
  new Response("não encontrado", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=60" },
  });

export const GET: APIRoute = async ({ params, request, locals }) => {
  const caminho = params.caminho ?? "";
  if (!caminhoImagemValido(caminho)) return naoEncontrado();

  // Chave do cache: a URL sem query string (a query não muda a imagem e evita furar o cache).
  const url = new URL(request.url);
  const chave = new Request(`${url.origin}${url.pathname}`, { method: "GET" });
  const borda = caches.default;

  const emCache = await borda.match(chave);
  if (emCache) {
    const copia = new Response(emCache.body, emCache);
    copia.headers.set("x-cache", "HIT");
    return copia;
  }

  let origem: Response;
  try {
    origem = await fetch(urlGaleria(env.SUPABASE_URL, caminho), {
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return new Response("falha ao buscar a imagem", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (origem.status === 404 || origem.status === 400) return naoEncontrado();
  if (!origem.ok) {
    return new Response("falha ao buscar a imagem", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  // Só JPEG: qualquer outra coisa no bucket não sai por esta rota.
  const tipo = (origem.headers.get("content-type") ?? "").toLowerCase();
  if (!tipo.startsWith("image/jpeg")) return naoEncontrado();

  const headers = new Headers({
    "content-type": "image/jpeg",
    "cache-control": CACHE_NAVEGADOR,
    "x-content-type-options": "nosniff",
  });
  const tamanho = origem.headers.get("content-length");
  if (tamanho) headers.set("content-length", tamanho);
  const etag = origem.headers.get("etag");
  if (etag) headers.set("etag", etag);
  const modificado = origem.headers.get("last-modified");
  if (modificado) headers.set("last-modified", modificado);

  const resposta = new Response(origem.body, { status: 200, headers });
  // Grava no cache de borda sem atrasar a resposta.
  const paraCache = resposta.clone();
  locals.cfContext.waitUntil(borda.put(chave, paraCache));

  const final = new Response(resposta.body, resposta);
  final.headers.set("x-cache", "MISS");
  return final;
};

// Só GET (HEAD é atendido pelo Astro a partir do GET): outros métodos respondem 405.
export const ALL: APIRoute = () =>
  new Response("método não permitido", {
    status: 405,
    headers: { allow: "GET", "cache-control": "no-store" },
  });
