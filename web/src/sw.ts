/// <reference lib="webworker" />
/**
 * Service worker (Workbox, estratégia injectManifest do @vite-pwa/astro).
 * - Shell pré-cacheado a cada build (o manifesto muda, então o arquivo muda e o navegador atualiza).
 * - Navegação: rede primeiro; sem rede, cai na página /offline.
 * - /api/posts: stale-while-revalidate (máx. 12 entradas).
 * - Imagens da galeria: cache primeiro (máx. 80), só respostas CORS válidas (nunca opacas).
 * - Atualização automática: skipWaiting + clientsClaim + limpeza de caches antigos, sem clique.
 */
import { clientsClaim } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import {
  cleanupOutdatedCaches,
  matchPrecache,
  precacheAndRoute,
  type PrecacheEntry,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst, NetworkOnly, StaleWhileRevalidate } from "workbox-strategies";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | PrecacheEntry)[];
};

const SUPABASE_ORIGEM = "https://crzmyemggpgjcrwwuwka.supabase.co";

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// A checagem de versão nunca pode vir de cache.
registerRoute(({ url }) => url.pathname === "/version.json", new NetworkOnly());

// /api/posts: mostra o que já tem e atualiza em segundo plano.
registerRoute(
  ({ url, request }) =>
    request.method === "GET" && url.origin === self.location.origin && url.pathname === "/api/posts",
  new StaleWhileRevalidate({
    cacheName: "polo9n-api",
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 12 }),
    ],
  }),
);

// Imagens da galeria: cache primeiro. Status 0 (resposta opaca) fica de fora de propósito:
// uma opaca ocupa muito espaço e pode ser um erro escondido. As <img> usam crossorigin="anonymous".
registerRoute(
  ({ url, request }) =>
    request.method === "GET" &&
    request.mode === "cors" &&
    url.origin === SUPABASE_ORIGEM &&
    url.pathname.startsWith("/storage/v1/object/public/galeria/"),
  new CacheFirst({
    cacheName: "polo9n-img",
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 80 }),
    ],
  }),
);

// Navegação: rede primeiro (4 s), cache das páginas já visitadas e, por último, /offline.
const paginas = new NetworkFirst({
  cacheName: "polo9n-paginas",
  networkTimeoutSeconds: 4,
  plugins: [
    new CacheableResponsePlugin({ statuses: [200] }),
    new ExpirationPlugin({ maxEntries: 10 }),
  ],
});

registerRoute(
  new NavigationRoute(
    async (opcoes) => {
      try {
        return await paginas.handle(opcoes);
      } catch {
        const offline =
          (await matchPrecache("/offline/index.html")) ?? (await matchPrecache("/offline"));
        return offline ?? Response.error();
      }
    },
    { denylist: [/^\/api\//, /^\/version\.json$/] },
  ),
);
