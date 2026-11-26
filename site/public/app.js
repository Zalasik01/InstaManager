(function () {
  'use strict';

  var LIMITE = 12;
  var DEMO = new URLSearchParams(location.search).get('demo') === '1';
  var HASHTAG = /#[\p{L}\p{N}_]+/gu;

  var $ = function (id) { return document.getElementById(id); };
  var posts = [];
  var total = 0;
  var carregando = false;
  var atual = -1;
  var imgIdx = 0;
  var ultimoFoco = null;

  /* ---------- utilidades ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function svgIcone() {
    var ns = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'multi');
    s.setAttribute('aria-hidden', 'true');
    var a = document.createElementNS(ns, 'rect');
    a.setAttribute('x', '8'); a.setAttribute('y', '3'); a.setAttribute('width', '13'); a.setAttribute('height', '13');
    a.setAttribute('rx', '2'); a.setAttribute('fill', 'currentColor');
    var b = document.createElementNS(ns, 'path');
    b.setAttribute('d', 'M5 7v11a2 2 0 0 0 2 2h11'); b.setAttribute('fill', 'none');
    b.setAttribute('stroke', 'currentColor'); b.setAttribute('stroke-width', '2'); b.setAttribute('stroke-linecap', 'round');
    s.appendChild(a); s.appendChild(b);
    return s;
  }

  function separar(legenda) {
    var texto = String(legenda || '');
    var tags = texto.match(HASHTAG) || [];
    var unicas = [];
    tags.forEach(function (t) { if (unicas.indexOf(t) < 0) unicas.push(t); });
    var limpo = texto.replace(HASHTAG, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
    return { texto: limpo, tags: unicas };
  }

  function formatarData(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return { txt: '', iso: '' };
    return {
      txt: d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }),
      iso: d.toISOString()
    };
  }

  function resumo(p) {
    var t = separar(p.legenda).texto.replace(/\s+/g, ' ');
    return t.length > 90 ? t.slice(0, 87) + '...' : t;
  }

  /* ---------- demo (sem rede) ---------- */
  function svgDados(i, n) {
    var tons = ['#d9d6cf', '#8f949a', '#3b4148', '#b6b0a2', '#6b7078', '#e8e6e0'];
    var c = tons[(i + n) % tons.length];
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#17181a"/>' +
      '<rect x="40" y="170" width="320" height="90" rx="22" fill="' + c + '"/>' +
      '<rect x="95" y="115" width="200" height="70" rx="18" fill="' + c + '"/>' +
      '<circle cx="110" cy="265" r="30" fill="#0c0c0d"/><circle cx="290" cy="265" r="30" fill="#0c0c0d"/>' +
      '<text x="200" y="340" text-anchor="middle" font-family="Arial" font-size="22" fill="#a3a3a0">exemplo ' + (i + 1) + (n ? '.' + (n + 1) : '') + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function demoPosts(offset, limite) {
    var TOTAL = 20, out = [];
    for (var i = offset; i < Math.min(TOTAL, offset + limite); i++) {
      var qtd = i % 4 === 1 ? 3 : 1, imgs = [];
      for (var k = 0; k < qtd; k++) imgs.push(svgDados(i, k));
      out.push({
        id: 'demo-' + i,
        legenda: 'Post de exemplo número ' + (i + 1) + '. Só para testar o layout.\n\n#polo #9n4 #vwpolo #carro_branco',
        publicado_em: new Date(Date.UTC(2026, 10, 25 - i, 21, 57)).toISOString(),
        permalink: 'https://www.instagram.com/polo_9n4_12/',
        imagens: imgs
      });
    }
    return Promise.resolve({ total: TOTAL, posts: out });
  }

  /* ---------- API ---------- */
  function buscar(offset) {
    if (DEMO) return demoPosts(offset, LIMITE);
    return fetch('/api/posts?limite=' + LIMITE + '&offset=' + offset, { headers: { Accept: 'application/json' } })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error(j && j.erro ? j.erro : 'Erro ' + r.status);
          if (!j || !Array.isArray(j.posts)) throw new Error('Resposta inesperada do servidor.');
          return j;
        });
      });
  }

  /* ---------- grade ---------- */
  function estado(titulo, msg, acao) {
    var e = $('estado');
    e.textContent = '';
    if (!titulo) { e.hidden = true; return; }
    e.appendChild(el('strong', null, titulo));
    if (msg) e.appendChild(document.createTextNode(msg));
    if (acao) {
      var b = el('button', null, acao.txt);
      b.type = 'button';
      b.addEventListener('click', acao.fn);
      e.appendChild(document.createElement('br'));
      e.appendChild(b);
    }
    e.hidden = false;
  }

  function esqueleto(sim) {
    var g = $('grade');
    var old = g.querySelectorAll('.skel-i');
    for (var i = 0; i < old.length; i++) old[i].remove();
    if (!sim) return;
    for (var k = 0; k < 6; k++) { g.appendChild(el('li', 'skel-i')); }
  }

  function adicionar(lista) {
    var g = $('grade');
    lista.forEach(function (p) {
      var idx = posts.length;
      posts.push(p);
      var li = el('li');
      var b = el('button', 'tile');
      b.type = 'button';
      var imgs = Array.isArray(p.imagens) ? p.imagens : [];
      b.setAttribute('aria-label', 'Abrir post: ' + (resumo(p) || 'sem legenda') + (imgs.length > 1 ? ' (' + imgs.length + ' imagens)' : ''));
      if (imgs[0]) {
        var im = el('img');
        im.src = imgs[0];
        im.alt = '';
        im.width = 400; im.height = 400;
        im.loading = 'lazy';
        im.decoding = 'async';
        b.appendChild(im);
      }
      if (imgs.length > 1) b.appendChild(svgIcone());
      b.addEventListener('click', function () { abrir(idx, b); });
      li.appendChild(b);
      g.appendChild(li);
    });
  }

  function atualizarMais() {
    $('mais-wrap').hidden = !(posts.length < total);
  }

  function carregar() {
    if (carregando) return Promise.resolve();
    carregando = true;
    var primeira = posts.length === 0;
    var btn = $('mais');
    btn.disabled = true;
    if (primeira) { estado('Carregando posts...', ''); esqueleto(true); }
    return buscar(posts.length).then(function (j) {
      total = Number(j.total) || 0;
      esqueleto(false);
      estado('');
      adicionar(j.posts);
      $('st-posts').textContent = String(total);
      if (!posts.length) estado('Nada por aqui ainda', 'Os posts aparecem aqui assim que forem publicados no Instagram.');
      atualizarMais();
    }).catch(function (err) {
      esqueleto(false);
      var msg = 'Não deu para carregar agora (' + (err && err.message ? err.message : 'erro desconhecido') + '). Confira sua conexão ou veja os posts direto no Instagram.';
      estado('Falha ao carregar os posts', msg, { txt: 'Tentar de novo', fn: function () { estado(''); carregar(); } });
    }).then(function () {
      carregando = false;
      btn.disabled = false;
    });
  }

  /* ---------- visualizador ---------- */
  function renderViewer() {
    var p = posts[atual];
    if (!p) return;
    var imgs = Array.isArray(p.imagens) ? p.imagens : [];
    var multi = imgs.length > 1;
    var s = separar(p.legenda);
    var im = $('v-img');
    im.src = imgs[imgIdx] || '';
    im.alt = 'Imagem ' + (imgIdx + 1) + ' de ' + imgs.length + (s.texto ? '. ' + resumo(p) : '. Foto do Polo 9n4');
    $('v-iprev').hidden = !multi;
    $('v-inext').hidden = !multi;
    var dots = $('v-dots');
    dots.textContent = '';
    if (multi) imgs.forEach(function (_, i) { dots.appendChild(el('i', i === imgIdx ? 'on' : '')); });
    $('v-count').textContent = 'Post ' + (atual + 1) + ' de ' + (total || posts.length);
    $('v-cap').textContent = s.texto;
    $('v-cap').hidden = !s.texto;
    var chips = $('v-chips');
    chips.textContent = '';
    s.tags.forEach(function (t) { chips.appendChild(el('li', null, t)); });
    chips.hidden = !s.tags.length;
    var d = formatarData(p.publicado_em);
    var t = $('v-date');
    t.textContent = d.txt;
    if (d.iso) t.setAttribute('datetime', d.iso); else t.removeAttribute('datetime');
    var link = $('v-link');
    var ok = typeof p.permalink === 'string' && /^https:\/\/(www\.)?instagram\.com\//.test(p.permalink);
    link.hidden = !ok;
    if (ok) link.href = p.permalink;
    var sh = $('v-share');
    sh.hidden = !podeCompartilhar();
    $('v-pprev').disabled = atual <= 0;
    $('v-pnext').disabled = atual >= posts.length - 1 && posts.length >= total;
  }

  function abrir(i, origem) {
    atual = i; imgIdx = 0;
    ultimoFoco = origem || document.activeElement;
    renderViewer();
    var dlg = $('viewer');
    if (!dlg.open) dlg.showModal();
    document.body.classList.add('lock');
    $('v-close').focus();
  }

  function imagem(delta) {
    var n = (posts[atual].imagens || []).length;
    if (n < 2) return;
    imgIdx = (imgIdx + delta + n) % n;
    renderViewer();
  }

  function post(delta) {
    var alvo = atual + delta;
    if (alvo < 0) return;
    if (alvo >= posts.length) {
      if (posts.length >= total) return;
      carregar().then(function () { if (alvo < posts.length) { atual = alvo; imgIdx = 0; renderViewer(); } });
      return;
    }
    atual = alvo; imgIdx = 0;
    renderViewer();
  }

  function fecharViewer() {
    document.body.classList.remove('lock');
    if (ultimoFoco && document.contains(ultimoFoco)) ultimoFoco.focus();
  }

  /* ---------- compartilhar ---------- */
  var toastTimer = 0;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2500);
  }

  function podeCompartilhar() { return true; }

  function copiar(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texto).then(function () { toast('Link copiado'); }, function () { toast('Não deu para copiar o link'); });
    }
    try {
      var ta = el('textarea');
      ta.value = texto;
      ta.setAttribute('readonly', '');
      ta.className = 'sr-only';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      toast(ok ? 'Link copiado' : 'Não deu para copiar o link');
    } catch (e) { toast('Não deu para copiar o link'); }
    return Promise.resolve();
  }

  function compartilhar(dados) {
    if (navigator.share) {
      return navigator.share(dados).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        return copiar(dados.url);
      });
    }
    return copiar(dados.url);
  }

  function compartilharPost() {
    var p = posts[atual];
    if (!p) return;
    var ok = typeof p.permalink === 'string' && /^https:\/\/(www\.)?instagram\.com\//.test(p.permalink);
    var s = separar(p.legenda);
    compartilhar({ title: 'Polo 9n4', text: s.texto ? resumo(p) : 'Foto do Polo 9n4 (@polo_9n4_12)', url: ok ? p.permalink : location.origin + '/' });
  }

  function compartilharPerfil() {
    compartilhar({ title: 'Polo 9n4 (@polo_9n4_12)', text: 'VW Polo 2012 branco, geração 9n4. Fotos e ficha do carro.', url: location.origin + '/' });
  }

  /* ---------- PWA: service worker e instalação ---------- */
  var promptInstalar = null;
  var recarregarAoTrocar = false;

  function instalado() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }

  function guardado(chave) { try { return localStorage.getItem(chave); } catch (e) { return null; } }
  function guardar(chave, v) { try { localStorage.setItem(chave, v); } catch (e) { /* sem storage */ } }

  function avisoUpdate(reg) {
    var box = $('aviso-update');
    box.hidden = false;
    $('aviso-update-ok').onclick = function () {
      recarregarAoTrocar = true;
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' }); else location.reload();
    };
  }

  function registrarSW() {
    if (!('serviceWorker' in navigator)) return;
    var seguro = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!seguro) return;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (recarregarAoTrocar) location.reload();
    });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').then(function (reg) {
        if (reg.waiting && navigator.serviceWorker.controller) avisoUpdate(reg);
        reg.addEventListener('updatefound', function () {
          var novo = reg.installing;
          if (!novo) return;
          novo.addEventListener('statechange', function () {
            if (novo.state === 'installed' && navigator.serviceWorker.controller) avisoUpdate(reg);
          });
        });
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible') reg.update().catch(function () {});
        });
      }).catch(function () { /* site funciona sem SW */ });
    });
  }

  function iniciarInstalacao() {
    if (instalado()) return;
    var btn = $('instalar');
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      promptInstalar = e;
      btn.hidden = false;
    });
    btn.addEventListener('click', function () {
      if (!promptInstalar) return;
      var ev = promptInstalar;
      promptInstalar = null;
      btn.hidden = true;
      ev.prompt();
      if (ev.userChoice) ev.userChoice.catch(function () {});
    });
    window.addEventListener('appinstalled', function () { btn.hidden = true; promptInstalar = null; $('dica-ios').hidden = true; });

    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios && !guardado('polo9n-dica-ios')) {
      $('dica-ios').hidden = false;
      $('dica-ios-x').addEventListener('click', function () { $('dica-ios').hidden = true; guardar('polo9n-dica-ios', '1'); });
    }
  }

  /* ---------- ficha do carro ---------- */
  var ROTULOS = {
    modelo: 'Modelo', ano: 'Ano', geracao: 'Geração', cor: 'Cor', versao: 'Versão', motor: 'Motor', cambio: 'Câmbio',
    rodas: 'Rodas', pneus: 'Pneus', suspensao: 'Suspensão', freios: 'Freios', escape: 'Escape', som: 'Som', quilometragem: 'Quilometragem'
  };
  var ORDEM = ['modelo', 'ano', 'geracao', 'cor', 'versao', 'motor', 'cambio', 'rodas', 'pneus', 'suspensao', 'freios', 'escape', 'som', 'quilometragem'];

  function cheio(v) { return typeof v === 'string' ? v.trim() !== '' : (v != null && v !== ''); }

  function secaoLista(raiz, titulo, itens) {
    var lista = (Array.isArray(itens) ? itens : []).filter(cheio);
    if (!lista.length) return;
    raiz.appendChild(el('h3', null, titulo));
    var ul = el('ul', 'mods');
    lista.forEach(function (m) { ul.appendChild(el('li', null, String(m))); });
    raiz.appendChild(ul);
  }

  function montarCarro(c) {
    var raiz = $('carro');
    raiz.textContent = '';
    var f = c.ficha || {};
    var chaves = ORDEM.concat(Object.keys(f).filter(function (k) { return ORDEM.indexOf(k) < 0 && k.charAt(0) !== '_'; }));
    var linhas = chaves.filter(function (k) { return cheio(f[k]); });
    var nome = [f.modelo, f.ano, f.geracao].filter(cheio).join(' ');
    raiz.appendChild(el('h2', null, nome || 'O carro'));
    if (cheio(f.cor)) raiz.appendChild(el('p', 'sub', f.cor));
    if (linhas.length) {
      raiz.appendChild(el('h3', null, 'Ficha técnica'));
      var dl = el('dl', 'spec');
      linhas.forEach(function (k) {
        var row = el('div');
        row.appendChild(el('dt', null, ROTULOS[k] || k.charAt(0).toUpperCase() + k.slice(1)));
        row.appendChild(el('dd', null, String(f[k])));
        dl.appendChild(row);
      });
      raiz.appendChild(dl);
    }
    secaoLista(raiz, 'Modificações', c.modificacoes);
    secaoLista(raiz, 'Extras', c.extras);
    var st = function (id, v) { if (cheio(v)) { $(id).textContent = String(v); $(id + '-li').hidden = false; } };
    st('st-desde', c.desde);
    st('st-fotos', c.fotos);
  }

  function carregarCarro() {
    fetch('/carro.json', { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(montarCarro)
      .catch(function () {
        var raiz = $('carro');
        raiz.textContent = '';
        raiz.appendChild(el('p', 'sub', 'A ficha do carro não pôde ser carregada agora.'));
      });
  }

  /* ---------- abas ---------- */
  function aba(qual, foco) {
    var carro = qual === 'carro';
    $('tab-posts').setAttribute('aria-selected', String(!carro));
    $('tab-carro').setAttribute('aria-selected', String(carro));
    $('tab-posts').tabIndex = carro ? -1 : 0;
    $('tab-carro').tabIndex = carro ? 0 : -1;
    $('painel-posts').hidden = carro;
    $('painel-carro').hidden = !carro;
    if (foco) (carro ? $('tab-carro') : $('tab-posts')).focus();
    try { history.replaceState(null, '', carro ? '#carro' : location.pathname + location.search); } catch (e) { /* sem history */ }
  }

  /* ---------- init ---------- */
  function init() {
    $('tab-posts').addEventListener('click', function () { aba('posts'); });
    $('tab-carro').addEventListener('click', function () { aba('carro'); });
    document.querySelector('.tabs').addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        var vaiCarro = e.key === 'End' ? true : e.key === 'Home' ? false : $('tab-posts').getAttribute('aria-selected') === 'true';
        aba(vaiCarro ? 'carro' : 'posts', true);
      }
    });
    $('mais').addEventListener('click', carregar);
    $('v-share').addEventListener('click', compartilharPost);
    $('p-share').addEventListener('click', compartilharPerfil);

    var dlg = $('viewer');
    $('v-close').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('close', fecharViewer);
    $('v-iprev').addEventListener('click', function () { imagem(-1); });
    $('v-inext').addEventListener('click', function () { imagem(1); });
    $('v-pprev').addEventListener('click', function () { post(-1); });
    $('v-pnext').addEventListener('click', function () { post(1); });
    dlg.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var d = e.key === 'ArrowRight' ? 1 : -1;
      if ((posts[atual].imagens || []).length > 1) imagem(d); else post(d);
    });
    var x0 = null;
    dlg.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    dlg.addEventListener('touchend', function (e) {
      if (x0 == null) return;
      var dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) < 60) return;
      if ((posts[atual].imagens || []).length > 1) imagem(dx < 0 ? 1 : -1); else post(dx < 0 ? 1 : -1);
    }, { passive: true });

    carregarCarro();
    if (location.hash === '#carro') aba('carro');
    else if (location.hash === '#posts') { aba('posts'); $('tab-posts').scrollIntoView(); }
    registrarSW();
    iniciarInstalacao();
    carregar();
  }

  init();
})();
