(function () {
  'use strict';

  document.getElementById('retry').addEventListener('click', function () { location.reload(); });
  window.addEventListener('online', function () { location.reload(); });

  // Mostra posts do cache da API, se existirem. Qualquer falha é ignorada.
  if (!('caches' in window)) return;
  caches.keys().then(function (nomes) {
    var api = nomes.filter(function (n) { return n.indexOf('polo9n-api-') === 0; });
    if (!api.length) return;
    return caches.open(api[api.length - 1]).then(function (cache) {
      return cache.keys().then(function (chaves) {
        var req = chaves.filter(function (r) { return new URL(r.url).pathname === '/api/posts'; })[0];
        return req ? cache.match(req) : null;
      });
    });
  }).then(function (resp) {
    return resp ? resp.json() : null;
  }).then(function (j) {
    if (!j || !Array.isArray(j.posts) || !j.posts.length) return;
    var grade = document.getElementById('salvos-grade');
    j.posts.slice(0, 9).forEach(function (p) {
      var url = Array.isArray(p.imagens) ? p.imagens[0] : null;
      if (typeof url !== 'string' || url.indexOf('https://') !== 0) return;
      var li = document.createElement('li');
      var im = document.createElement('img');
      im.src = url; im.alt = 'Foto de um post salvo'; im.width = 400; im.height = 400; im.decoding = 'async'; im.loading = 'lazy';
      li.appendChild(im);
      grade.appendChild(li);
    });
    if (grade.children.length) document.getElementById('salvos').hidden = false;
  }).catch(function () { /* sem posts salvos */ });
})();
