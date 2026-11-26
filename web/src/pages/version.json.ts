import type { APIRoute } from "astro";

// Gerado no build (prerender): o id é o mesmo do <meta name="app-versao"> das páginas.
// O cache é desligado pelo web/public/_headers (no-store) e o service worker nunca o guarda.
export const GET: APIRoute = () =>
  new Response(JSON.stringify({ versao: __BUILD_ID__ }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
