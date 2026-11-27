'use strict';

// VERSAO é preenchida pelo Worker a cada publicação (id da versão do Cloudflare). Como o arquivo muda a
// cada deploy, o navegador instala o service worker novo sozinho e os caches antigos são apagados.
const VERSAO = '__APP_VERSION__';
const CACHE_SHELL = 'polo9n-shell-' + VERSAO;
const CACHE_API = 'polo9n-api-' + VERSAO;
const CACHE_IMG = 'polo9n-img-' + VERSAO;
const CACHES_ATUAIS = [CACHE_SHELL, CACHE_API, CACHE_IMG];

const MAX_API = 12;
const MAX_IMG = 80;

// "/" e "/offline" são as URLs finais (o Cloudflare redireciona /offline.html para /offline).
const SHELL = [
  '/',
  '/offline',
  '/offline.js',
  '/style.css',
  '/app.js',
  '/extra.js',
  '/extra.css',
  '/carro.json',
  '/links.json',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/img/favicon-32.png',
  '/img/apple-touch-icon.png',
  '/img/icon-192.png'
];

const REGEX_GALERIA = /^\/storage\/v1\/object\/public\/galeria\//;

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_SHELL).then(function (cache) {
      // Um arquivo que falhe não deve impedir a instalação inteira.
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () { /* tenta de novo na próxima visita */ });
      }));
    })
  );
  // Assume na hora: a versão nova vale para todos sem esperar fechar as abas.
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.filter(function (n) {
        return n.indexOf('polo9n-') === 0 && CACHES_ATUAIS.indexOf(n) < 0;
      }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ---------- aviso de post novo (Web Push) ----------
   O backend (notificarNovoPost) manda JSON: { title, body, url, image, tag }. Só aceita URL do próprio site. */
function urlDoSite(u) {
  try {
    var x = new URL(String(u || '/'), self.location.origin);
    return x.origin === self.location.origin || x.hostname === 'polo9n.com.br' ? x.href : self.location.origin + '/';
  } catch (e) { return self.location.origin + '/'; }
}

self.addEventListener('push', function (event) {
  var d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  var titulo = typeof d.title === 'string' && d.title ? d.title : 'Post novo no @polo_9n4_12';
  var opcoes = {
    body: typeof d.body === 'string' ? d.body : '',
    icon: '/img/icon-192.png',
    badge: '/img/favicon-32.png',
    tag: typeof d.tag === 'string' ? d.tag : 'post-novo',
    data: { url: urlDoSite(d.url) }
  };
  if (typeof d.image === 'string' && /^https:\/\//.test(d.image)) opcoes.image = d.image;
  event.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var alvo = (event.notification.data && event.notification.data.url) || self.location.origin + '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (lista) {
      for (var i = 0; i < lista.length; i++) {
        var c = lista[i];
        if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
          // Já tem o site aberto: leva para o post (o app abre o visualizador pelo #post=) e foca.
          return (c.navigate ? c.navigate(alvo).catch(function () { return c; }) : Promise.resolve(c))
            .then(function (w) { return (w || c).focus(); });
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(alvo) : undefined;
    })
  );
});

function limitar(nomeCache, max) {
  return caches.open(nomeCache).then(function (cache) {
    return cache.keys().then(function (chaves) {
      // keys() volta na ordem de inserção: apaga as mais antigas.
      var excesso = chaves.length - max;
      if (excesso <= 0) return;
      return Promise.all(chaves.slice(0, excesso).map(function (k) { return cache.delete(k); }));
    });
  });
}

function guardavel(resp) {
  return resp && resp.ok && resp.status === 200 && resp.type !== 'opaque';
}

function staleWhileRevalidate(event, nomeCache, max, ignorarQuery) {
  var req = event.request;
  var opcoes = ignorarQuery ? { ignoreSearch: true } : undefined;
  return caches.open(nomeCache).then(function (cache) {
    return cache.match(req, opcoes).then(function (emCache) {
      var rede = fetch(req).then(function (resp) {
        if (guardavel(resp)) {
          var copia = resp.clone();
          var chave = ignorarQuery ? new Request(new URL(req.url).pathname) : req;
          event.waitUntil(cache.put(chave, copia).then(function () { return max ? limitar(nomeCache, max) : undefined; }));
        }
        return resp;
      }).catch(function () { return emCache || Response.error(); });
      if (emCache) { event.waitUntil(rede.catch(function () {})); return emCache; }
      return rede;
    });
  });
}

function imagemGaleria(event) {
  var req = event.request;
  return caches.open(CACHE_IMG).then(function (cache) {
    return cache.match(req.url).then(function (emCache) {
      if (emCache) return emCache;
      // Pedido CORS devolve resposta legível (nunca opaca). O Supabase libera CORS no storage público.
      return fetch(new Request(req.url, { mode: 'cors', credentials: 'omit' })).then(function (resp) {
        if (guardavel(resp)) {
          event.waitUntil(cache.put(req.url, resp.clone()).then(function () { return limitar(CACHE_IMG, MAX_IMG); }));
          return resp;
        }
        return fetch(req); // sem cache de respostas opacas ou com erro
      }).catch(function () { return fetch(req); });
    });
  });
}

function navegacao(event) {
  return fetch(event.request).then(function (resp) {
    if (resp.ok && event.request.url.indexOf('?') < 0) {
      var copia = resp.clone();
      event.waitUntil(caches.open(CACHE_SHELL).then(function (c) { return c.put(event.request, copia); }));
    }
    return resp;
  }).catch(function () {
    return caches.match(event.request, { ignoreSearch: true }).then(function (r) {
      return r || caches.match('/offline');
    }).then(function (r) { return r || Response.error(); });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  if (url.hostname.slice(-12) === '.supabase.co' && REGEX_GALERIA.test(url.pathname)) {
    event.respondWith(imagemGaleria(event));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') { event.respondWith(navegacao(event)); return; }
  if (url.pathname === '/sw.js') return;
  // Vídeo e requisições com Range (206 parcial) não passam pelo cache: o navegador cuida da reprodução.
  if (/\.mp4$/i.test(url.pathname) || req.headers.has('range')) return;

  if (url.pathname === '/api/posts' || url.pathname === '/api/perfil') {
    event.respondWith(staleWhileRevalidate(event, CACHE_API, MAX_API, false));
    return;
  }
  if (url.pathname.indexOf('/api/') === 0) return;

  if (/\.(?:css|js|json|png|svg|webmanifest|ico)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, CACHE_SHELL, 0, true));
  }
});
