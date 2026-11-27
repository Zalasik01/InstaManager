/// <reference lib="webworker" />
/**
 * Service worker do polo9n.com.br (estratégia "buildSW" do @vite-pwa/astro v2: este arquivo é compilado
 * no build e recebe o manifesto de pré-cache em self.__WB_MANIFEST).
 *
 * - Pré-cache: JS, CSS, fontes, ícones, manifesto e a página /offline. Cada build muda o manifesto,
 *   então o sw.js muda e o navegador instala o novo sozinho (skipWaiting + clientsClaim).
 * - Navegação: rede primeiro (4 s), cache das páginas já visitadas e, por último, /offline.
 * - /api/posts e /api/perfil: stale-while-revalidate (mostra o que tem e atualiza em segundo plano).
 * - /m/* (imagens da galeria pelo próprio domínio): cache primeiro, no máximo 120.
 * - Vídeo (.mp4) e qualquer pedido com Range (206 parcial) NUNCA passam pelo cache.
 * - Web Push: handlers "push" e "notificationclick" iguais aos do site antigo (site/public/sw.js).
 *
 * Todos os caches usam o prefixo "polo9n-" (src/lib/atualizacao.ts apaga esses na troca de versão).
 */
import { clientsClaim, setCacheNameDetails } from "@vite-pwa/workbox-swkit/core";
import { CacheableResponsePlugin } from "@vite-pwa/workbox-swkit/cacheable-response";
import { ExpirationPlugin } from "@vite-pwa/workbox-swkit/expiration";
import {
  cleanupOutdatedCaches,
  matchPrecache,
  precacheAndRoute,
} from "@vite-pwa/workbox-swkit/precaching";
import type { WorkboxPlugin } from "@vite-pwa/workbox-swkit/core/types";
import type { PrecacheEntry } from "@vite-pwa/workbox-swkit/precaching/types";
import { NavigationRoute, registerRoute } from "@vite-pwa/workbox-swkit/routing";
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from "@vite-pwa/workbox-swkit/strategies";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | PrecacheEntry)[];
};

// Prefixo único: o pré-cache vira "polo9n-precache-v2-..." e os de execução "polo9n-<nome>".
setCacheNameDetails({ prefix: "polo9n" });

void self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener("message", (event) => {
  const dados = event.data as { type?: unknown } | null;
  if (dados && dados.type === "SKIP_WAITING") void self.skipWaiting();
});

/** Vídeo e pedidos parciais ficam sempre fora do cache: o navegador cuida da reprodução. */
function semCache(request: Request, url: URL): boolean {
  return request.headers.has("range") || /\.mp4$/i.test(url.pathname);
}

// Os tipos dos plugins da swkit não fecham com "exactOptionalPropertyTypes" do tsconfig strictest
// (callbacks opcionais declarados como "X | undefined"); em execução são plugins Workbox normais.
const plugin = (p: object) => p as WorkboxPlugin;

const mesmaOrigem = (url: URL) => url.origin === self.location.origin;

// /api/posts e /api/perfil: stale-while-revalidate (máx. 12 respostas, só 200).
registerRoute(
  ({ url, request }) =>
    request.method === "GET" &&
    mesmaOrigem(url) &&
    !semCache(request, url) &&
    (url.pathname === "/api/posts" || url.pathname === "/api/perfil"),
  new StaleWhileRevalidate({
    cacheName: "polo9n-api",
    plugins: [
      plugin(new CacheableResponsePlugin({ statuses: [200] })),
      plugin(new ExpirationPlugin({ maxEntries: 12 })),
    ],
  }),
);

// Imagens da galeria pelo próprio domínio (/m/AAAA/MM/arquivo.jpg): cache primeiro, máx. 120.
registerRoute(
  ({ url, request }) =>
    request.method === "GET" &&
    mesmaOrigem(url) &&
    !semCache(request, url) &&
    url.pathname.startsWith("/m/"),
  new CacheFirst({
    cacheName: "polo9n-img",
    plugins: [
      plugin(new CacheableResponsePlugin({ statuses: [200] })),
      plugin(new ExpirationPlugin({ maxEntries: 120, purgeOnQuotaError: true })),
    ],
  }),
);

// Navegação: rede primeiro (4 s), cache das páginas já visitadas e, por último, /offline.
const paginas = new NetworkFirst({
  cacheName: "polo9n-paginas",
  networkTimeoutSeconds: 4,
  plugins: [
    plugin(new CacheableResponsePlugin({ statuses: [200] })),
    plugin(new ExpirationPlugin({ maxEntries: 10 })),
  ],
});

registerRoute(
  new NavigationRoute(
    async (opcoes) => {
      try {
        return await paginas.handle(opcoes);
      } catch {
        const offline = (await matchPrecache("/offline")) ?? (await matchPrecache("/offline/"));
        return offline ?? Response.error();
      }
    },
    // /api, /m, /version.json e o próprio sw.js nunca são "páginas".
    { denylist: [/^\/api\//, /^\/m\//, /^\/version\.json$/, /^\/sw\.js$/] },
  ),
);

/* ---------- aviso de post novo (Web Push) ----------
   O backend (notificarNovoPost) manda JSON: { title, body, url, image, tag }. Só aceita URL do próprio site. */
function urlDoSite(u: unknown): string {
  try {
    const x = new URL(typeof u === "string" && u ? u : "/", self.location.origin);
    return x.origin === self.location.origin || x.hostname === "polo9n.com.br"
      ? x.href
      : `${self.location.origin}/`;
  } catch {
    return `${self.location.origin}/`;
  }
}

interface DadosPush {
  title?: unknown;
  body?: unknown;
  url?: unknown;
  image?: unknown;
  tag?: unknown;
}

self.addEventListener("push", (event) => {
  let d: DadosPush = {};
  try {
    d = event.data ? (event.data.json() as DadosPush) : {};
  } catch {
    d = { body: event.data ? event.data.text() : "" };
  }
  const titulo = typeof d.title === "string" && d.title ? d.title : "Post novo no @polo_9n4_12";
  const opcoes: NotificationOptions & { image?: string } = {
    body: typeof d.body === "string" ? d.body : "",
    icon: "/img/icon-192.png",
    badge: "/img/favicon-32.png",
    tag: typeof d.tag === "string" ? d.tag : "post-novo",
    data: { url: urlDoSite(d.url) },
  };
  if (typeof d.image === "string" && /^https:\/\//.test(d.image)) opcoes.image = d.image;
  event.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const dados = event.notification.data as { url?: unknown } | null;
  const alvo = typeof dados?.url === "string" ? dados.url : `${self.location.origin}/`;
  event.waitUntil(
    (async () => {
      const lista = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of lista) {
        if (new URL(c.url).origin === self.location.origin && "focus" in c) {
          // Já tem o site aberto: leva para o post (o app abre o visualizador pelo #post=) e foca.
          let janela: WindowClient | null = c;
          try {
            janela = (await c.navigate(alvo)) ?? c;
          } catch {
            janela = c;
          }
          await janela.focus();
          return;
        }
      }
      await self.clients.openWindow(alvo);
    })(),
  );
});
