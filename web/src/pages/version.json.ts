import type { APIRoute } from "astro";
import { versaoDoApp } from "@/lib/versao";

// Dinâmico: o id vem do binding CF_VERSION_METADATA (um id novo a cada deploy), o mesmo que o Worker
// (src/worker.ts) grava em <meta name="app-versao"> das páginas. Sem o binding (astro dev), usa o id do build.
export const prerender = false;

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ versao: versaoDoApp() }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // A checagem de versão nunca pode vir de cache (o service worker também não a guarda).
      "cache-control": "no-store",
    },
  });
