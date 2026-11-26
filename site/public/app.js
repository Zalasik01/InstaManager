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

  /* Como o usuário navega: teclado ou ponteiro. Só quem usa teclado precisa que o foco volte ao card
     depois de fechar o visualizador; com mouse/toque o card não deve ficar "selecionado". */
  var viaTeclado = false;
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ' || e.key.indexOf('Arrow') === 0) viaTeclado = true;
  }, true);
  document.addEventListener('pointerdown', function () { viaTeclado = false; }, true);

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

  var NF;
  try { NF = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }); } catch (e) { NF = null; }
  function num(n) { return typeof n === 'number' && isFinite(n) && n >= 0 ? n : null; }
  function fmt(n) { return NF ? NF.format(n) : n.toLocaleString('pt-BR'); }
  function plural(n, um, varios) { return fmt(n) + ' ' + (n === 1 ? um : varios); }
  function numeros(p) {
    var out = [], v = num(p.visualizacoes), c = num(p.curtidas), m = num(p.comentarios);
    if (v != null) out.push(plural(v, 'visualização', 'visualizações'));
    if (c != null) out.push(plural(c, 'curtida', 'curtidas'));
    if (m != null) out.push(plural(m, 'comentário', 'comentários'));
    return out;
  }
  function icone(inner, cls) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', cls);
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.innerHTML = inner; // texto constante, nunca dados externos
    return s;
  }
  var OLHO = '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';

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
        visualizacoes: i % 5 === 3 ? null : i === 0 ? 15230 : 1200 + i * 873,
        curtidas: i % 6 === 2 ? null : i * 37 + 5,
        comentarios: i % 3 === 0 ? null : i * 2 + 1,
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
      var li = el('li', 'card');
      var b = el('button', 'tile');
      b.type = 'button';
      var imgs = Array.isArray(p.imagens) ? p.imagens : [];
      var nums = numeros(p);
      var vis = num(p.visualizacoes);
      b.setAttribute('aria-label', 'Abrir post: ' + (resumo(p) || 'sem legenda') + (imgs.length > 1 ? ' (' + imgs.length + ' imagens)' : '') + (vis != null ? ', ' + nums[0] : ''));
      if (imgs[0]) {
        // Camada de fundo: a mesma foto desfocada, para preencher as sobras do tile 4:5.
        var bg = el('img', 'bg');
        bg.src = imgs[0];
        bg.alt = '';
        bg.setAttribute('aria-hidden', 'true');
        bg.width = 400; bg.height = 500;
        bg.loading = 'lazy';
        bg.decoding = 'async';
        b.appendChild(bg);
        var im = el('img', 'fg');
        // Esqueleto brilhando no card até a imagem chegar; depois ela aparece com fade.
        b.classList.add('carregando');
        im.addEventListener('load', function () { b.classList.remove('carregando'); b.classList.add('pronto'); });
        im.addEventListener('error', function () { b.classList.remove('carregando'); b.classList.add('falhou'); });
        im.src = imgs[0];
        im.alt = '';
        im.width = 400; im.height = 500;
        im.loading = 'lazy';
        im.decoding = 'async';
        b.appendChild(im);
      }
      if (imgs.length > 1) b.appendChild(svgIcone());
      if (vis != null) {
        b.classList.add('has-views');
        var sv = el('span', 'views');
        sv.appendChild(icone(OLHO, 'ic'));
        sv.appendChild(document.createTextNode(fmt(vis)));
        b.appendChild(sv);
      }
      b.addEventListener('click', function () { abrir(idx, b); });
      li.appendChild(b);
      var veil = el('div', 'veil');
      var legenda = separar(p.legenda).texto;
      if (legenda) { var vc = el('p', 'veil-cap', legenda); vc.setAttribute('aria-hidden', 'true'); veil.appendChild(vc); }
      if (nums.length) { var vn = el('p', 'veil-nums', nums.join(' · ')); vn.setAttribute('aria-hidden', 'true'); veil.appendChild(vn); }
      var act = el('div', 'veil-act');
      var bx = el('button', null, 'Expandir');
      bx.type = 'button';
      bx.setAttribute('aria-label', 'Expandir imagem do post');
      bx.addEventListener('click', function (e) { e.stopPropagation(); atual = idx; imgIdx = 0; abrirZoom(); });
      var bs = el('button', null, 'Compartilhar');
      bs.type = 'button';
      bs.setAttribute('aria-label', 'Compartilhar este post');
      bs.addEventListener('click', function (e) { e.stopPropagation(); compartilharPost(idx); });
      act.appendChild(bx); act.appendChild(bs);
      veil.appendChild(act);
      li.appendChild(veil);
      g.appendChild(li);
    });
  }

  function atualizarMais() {
    $('mais-wrap').hidden = !(posts.length < total);
  }

  /* Seguidores: vem do banco (atualizado todo dia), nunca direto do Instagram. Sem número, o contador fica escondido. */
  function carregarPerfil() {
    var li = $('st-seg-li');
    function mostrar(n) { $('st-seg').textContent = fmt(n); li.hidden = false; }
    if (DEMO) { mostrar(1284); return; }
    fetch('/api/perfil', { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('perfil ' + r.status); return r.json(); })
      .then(function (j) { var n = num(j.seguidores); if (n != null) mostrar(n); })
      .catch(function () { /* sem o número: o contador continua escondido */ });
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
    // Proporção do Instagram: a 1ª imagem do post define a caixa (o carrossel inteiro segue ela).
    var dlgV = $('viewer');
    var proporcao = function (cls) {
      ['r-45', 'r-11', 'r-43', 'r-191'].forEach(function (c) { dlgV.classList.toggle(c, c === cls); });
    };
    proporcao(p._cls || 'r-45'); // padrão 4:5: evita salto de layout antes de a imagem carregar
    im.onload = function () {
      if (imgIdx !== 0 && p._cls) return;
      var r = im.naturalWidth / im.naturalHeight;
      p._cls = r <= 0.9 ? 'r-45' : r < 1.15 ? 'r-11' : r < 1.6 ? 'r-43' : 'r-191';
      proporcao(p._cls);
    };
    im.src = imgs[imgIdx] || '';
    im.alt = 'Imagem ' + (imgIdx + 1) + ' de ' + imgs.length + (s.texto ? '. ' + resumo(p) : '. Foto do Polo 9n4');
    $('v-iprev').hidden = !multi;
    $('v-inext').hidden = !multi;
    var dots = $('v-dots');
    dots.textContent = '';
    if (multi) imgs.forEach(function (_, i) { dots.appendChild(el('i', i === imgIdx ? 'on' : '')); });
    $('v-box').classList.toggle('compact', !s.texto && !s.tags.length);
    $('v-count').textContent = 'Post ' + (atual + 1) + ' de ' + (total || posts.length);
    var nn = numeros(p);
    $('v-nums').textContent = nn.join(' · ');
    $('v-nums').hidden = !nn.length;
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
    if (/^#post=/.test(location.hash)) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* sem history */ } }
    if (viaTeclado) {
      if (ultimoFoco && document.contains(ultimoFoco)) ultimoFoco.focus();
    } else {
      // O navegador devolve o foco ao card que abriu o <dialog> (e acende véu e contorno): tira esse foco.
      var soltar = function () {
        var a = document.activeElement;
        if (a && a !== document.body && typeof a.blur === 'function') a.blur();
      };
      soltar();
      setTimeout(soltar, 0);
    }
  }

  /* ---------- compartilhar ---------- */
  var toastTimer = 0;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    // popover coloca o aviso na camada de cima, acima dos diálogos abertos
    if (t.showPopover) { try { if (t.matches(':popover-open')) t.hidePopover(); t.showPopover(); } catch (e) { /* segue */ } }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (t.hidePopover) { try { t.hidePopover(); } catch (e) { /* segue */ } }
      t.hidden = true;
    }, 2800);
  }

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

  function extensao(tipo) { return tipo === 'image/png' ? 'png' : tipo === 'image/webp' ? 'webp' : 'jpg'; }

  function compartilhar(dados, arquivoUrl) {
    if (!navigator.share) return copiar(dados.url);
    var apenasLink = function () {
      return navigator.share(dados).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        return copiar(dados.url);
      });
    };
    var comArquivo = false;
    try { comArquivo = !!(arquivoUrl && navigator.canShare && window.File && navigator.canShare({ files: [new File([''], 'a.jpg', { type: 'image/jpeg' })] })); } catch (e) { /* sem suporte */ }
    if (!comArquivo) return apenasLink();
    return fetch(arquivoUrl, { mode: 'cors', credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error();
      return r.blob();
    }).then(function (b) {
      var f = new File([b], 'polo9n.' + extensao(b.type), { type: b.type || 'image/jpeg' });
      if (!navigator.canShare({ files: [f] })) throw new Error();
      return navigator.share({ title: dados.title, text: dados.text + ' ' + dados.url, files: [f] });
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return;
      return apenasLink();
    });
  }

  function compartilharPost(i) {
    var p = posts[i == null ? atual : i];
    if (!p) return;
    var s = separar(p.legenda);
    compartilhar({
      title: 'Polo 9n4',
      text: s.texto ? resumo(p) : 'Foto do Polo 9n4 (@polo_9n4_12)',
      url: location.origin + '/#post=' + encodeURIComponent(p.id)
    }, Array.isArray(p.imagens) ? p.imagens[i == null ? imgIdx : 0] : '');
  }

  function compartilharPerfil() {
    compartilhar({ title: 'Polo 9n4 (@polo_9n4_12)', text: 'VW Polo 2012 branco, geração 9n4. Fotos e ficha do carro.', url: location.origin + '/' });
  }

  /* ---------- modulo sob demanda (zoom e links) ---------- */
  var extra = null;
  function usarExtra(fn) {
    if (extra) { fn(extra); return; }
    var s = el('script');
    s.src = '/extra.js';
    s.onload = function () {
      extra = window.PoloExtra({
        $: $, el: el, toast: toast, cheio: cheio, dataCurta: dataCurta, DEMO: DEMO, ext: extensao,
        post: function () { return posts[atual]; }, idx: function () { return imgIdx; }, imagem: imagem
      });
      fn(extra);
    };
    s.onerror = function () { toast('Não deu para carregar agora. Confira a conexão.'); };
    document.head.appendChild(s);
    var l = el('link');
    l.rel = 'stylesheet';
    l.href = '/extra.css';
    document.head.appendChild(l);
  }
  function abrirZoom() { usarExtra(function (x) { x.abrirZoom(); }); }
  function carregarLinks() { usarExtra(function (x) { x.carregarLinks(); }); }

  /* ---------- link direto #post=<id> ---------- */
  function idDoHash() {
    var m = /^#post=(.+)$/.exec(location.hash);
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }

  function abrirPorId(id, tentativas) {
    for (var i = 0; i < posts.length; i++) {
      if (String(posts[i].id) === id) { abrir(i, null); return; }
    }
    if (posts.length >= total || tentativas >= 5) { toast('Post não encontrado'); return; }
    carregar().then(function () { abrirPorId(id, tentativas + 1); });
  }

  /* ---------- PWA: service worker e instalação ---------- */
  var promptInstalar = null;

  function instalado() {
    var mm = window.matchMedia;
    return (mm && (mm('(display-mode: standalone)').matches || mm('(display-mode: fullscreen)').matches)) || navigator.standalone === true;
  }

  function guardado(chave) { try { return localStorage.getItem(chave); } catch (e) { return null; } }
  function guardar(chave, v) { try { localStorage.setItem(chave, v); } catch (e) { /* sem storage */ } }

  /* ---------- atualização automática ----------
     Toda publicação gera uma versão nova (o Worker injeta o id da versão no HTML e no sw.js).
     O site confere a versão ao abrir, ao voltar para o app, a cada 10 minutos e ao reconectar:
     se mudou, apaga os caches do app e recarrega, para todo mundo ficar na versão atual.
     Se um visualizador estiver aberto, espera fechar (não interrompe quem está vendo um post). */
  var versaoCarregada = (document.querySelector('meta[name="app-versao"]') || {}).content || '';
  var atualizando = false;

  function recarregarLimpo() {
    if (atualizando) return;
    if (document.querySelector('dialog[open]')) { setTimeout(recarregarLimpo, 4000); return; }
    atualizando = true;
    var limpar = ('caches' in window)
      ? caches.keys().then(function (ks) {
        return Promise.all(ks.filter(function (k) { return k.indexOf('polo9n-') === 0; }).map(function (k) { return caches.delete(k); }));
      })
      : Promise.resolve();
    limpar.catch(function () { /* recarrega mesmo assim */ }).then(function () { location.reload(); });
  }

  function checarVersao() {
    if (!versaoCarregada || DEMO) return;
    fetch('/version.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.versao || j.versao === versaoCarregada) return;
        // Trava contra laço: tenta no máximo uma vez por versão nova em cada sessão.
        if (guardadoSessao('app-versao-tentada') === j.versao) return;
        guardarSessao('app-versao-tentada', j.versao);
        if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then(function (r) { if (r) r.update().catch(function () {}); });
        recarregarLimpo();
      })
      .catch(function () { /* sem rede: tenta de novo na próxima checagem */ });
  }

  function guardadoSessao(chave) { try { return sessionStorage.getItem(chave); } catch (e) { return null; } }
  function guardarSessao(chave, v) { try { sessionStorage.setItem(chave, v); } catch (e) { /* sem storage */ } }

  function registrarSW() {
    if (!('serviceWorker' in navigator)) return;
    var seguro = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!seguro) return;
    // Só recarrega na troca de service worker se a página já tinha um (na 1ª instalação não há o que atualizar).
    var tinhaControlador = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (tinhaControlador) recarregarLimpo();
    });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').then(function (reg) {
        reg.update().catch(function () {});
      }).catch(function () { /* site funciona sem SW */ });
      setTimeout(checarVersao, 4000);
      setInterval(checarVersao, 10 * 60 * 1000);
      window.addEventListener('online', checarVersao);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        checarVersao();
        navigator.serviceWorker.getRegistration().then(function (r) { if (r) r.update().catch(function () {}); });
      });
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
  var DESTAQUES = ['ano', 'motor', 'cambio', 'cor', 'versao'];
  var SECOES = [
    { titulo: 'Mecânica', chaves: ['motor', 'cambio', 'suspensao', 'freios', 'escape'] },
    { titulo: 'Rodas e pneus', chaves: ['rodas', 'pneus'] },
    { titulo: 'Visual', chaves: ['cor'] },
    { titulo: 'Som', chaves: ['som'] }
  ];
  var CONHECIDAS = ['modelo', 'ano', 'geracao', 'cor', 'versao', 'motor', 'cambio', 'rodas', 'pneus', 'suspensao', 'freios', 'escape', 'som', 'quilometragem'];

  function cheio(v) { return typeof v === 'string' ? v.trim() !== '' : (v != null && v !== ''); }
  function rotulo(k) { return ROTULOS[k] || k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '); }

  function itemDl(dl, k, v) {
    var row = el('div');
    row.appendChild(el('dt', null, rotulo(k)));
    row.appendChild(el('dd', null, String(v)));
    dl.appendChild(row);
  }

  function secao(raiz, titulo, filho) {
    var s = el('section', 'car-sec');
    var id = 'carro-s-' + raiz.childNodes.length;
    var h = el('h2', null, titulo);
    h.id = id;
    s.setAttribute('aria-labelledby', id);
    s.appendChild(h);
    s.appendChild(filho);
    raiz.appendChild(s);
  }

  function chips(itens) {
    var ul = el('ul', 'car-chips');
    itens.forEach(function (m) { ul.appendChild(el('li', null, String(m))); });
    return ul;
  }

  function lista(itens) { return (Array.isArray(itens) ? itens : []).filter(cheio); }

  function dataCurta(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isNaN(d.getTime())) return null;
    return { txt: d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }), iso: m[0] };
  }

  function montarCabecalho(raiz, f) {
    var partes = cheio(f.modelo) ? String(f.modelo).trim().split(/\s+/) : [];
    var marca = partes.length > 1 ? partes.shift() : '';
    var nome = partes.join(' ');
    var linha = [marca, f.ano, f.geracao].filter(cheio).join(' \u00b7 ');
    if (!nome && !linha) return;
    var cab = el('header', 'car-head');
    if (linha) cab.appendChild(el('p', 'car-eyebrow', linha));
    cab.appendChild(el('h2', 'car-name', nome || 'O carro'));
    raiz.appendChild(cab);
  }

  function montarCarro(c) {
    var raiz = $('carro');
    raiz.textContent = '';
    var f = c.ficha || {};
    var usadas = { modelo: 1, geracao: 1 };

    montarCabecalho(raiz, f);

    var ver = cheio(f.versao) && cheio(f.geracao) && String(f.versao).trim().toLowerCase() === String(f.geracao).trim().toLowerCase();
    if (ver) usadas.versao = 1;
    var dest = DESTAQUES.filter(function (k) { return cheio(f[k]) && !usadas[k]; }).slice(0, 4);
    if (dest.length) {
      var dl = el('dl', 'car-hl');
      dest.forEach(function (k) { usadas[k] = 1; itemDl(dl, k, f[k]); });
      raiz.appendChild(dl);
    }

    SECOES.forEach(function (s) {
      var ks = s.chaves.filter(function (k) { return cheio(f[k]) && !usadas[k]; });
      if (!ks.length) return;
      var d = el('dl', 'car-list');
      ks.forEach(function (k) { usadas[k] = 1; itemDl(d, k, f[k]); });
      secao(raiz, s.titulo, d);
    });

    var mods = lista(c.modificacoes);
    if (mods.length) secao(raiz, 'Modificações', chips(mods));

    var resto = CONHECIDAS.concat(Object.keys(f)).filter(function (k, i, a) { return a.indexOf(k) === i && k.charAt(0) !== '_' && !usadas[k] && cheio(f[k]); });
    var extras = lista(c.extras);
    if (resto.length) {
      var dm = el('dl', 'car-list');
      resto.forEach(function (k) { itemDl(dm, k, f[k]); });
      secao(raiz, 'Mais', dm);
    }
    if (extras.length) secao(raiz, resto.length ? 'Extras' : 'Mais', chips(extras));

    var dt = dataCurta(c.atualizado_em);
    if (dt) {
      var p = el('p', 'car-upd', 'Atualizado em ');
      var t = el('time', null, dt.txt);
      t.setAttribute('datetime', dt.iso);
      p.appendChild(t);
      raiz.appendChild(p);
    }

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
        raiz.appendChild(el('p', 'car-erro', 'A ficha do carro não pôde ser carregada agora.'));
      });
  }

  /* ---------- abas ---------- */
  var ABAS = ['posts', 'carro', 'links'];
  function aba(qual, foco) {
    ABAS.forEach(function (n) {
      var sel = n === qual;
      $('tab-' + n).setAttribute('aria-selected', String(sel));
      $('tab-' + n).tabIndex = sel ? 0 : -1;
      $('painel-' + n).hidden = !sel;
    });
    if (qual === 'links') carregarLinks();
    if (foco) $('tab-' + qual).focus();
    try { history.replaceState(null, '', qual === 'posts' ? location.pathname + location.search : '#' + qual); } catch (e) { /* sem history */ }
  }

  /* ---------- init ---------- */
  function init() {
    ABAS.forEach(function (n) { $('tab-' + n).addEventListener('click', function () { aba(n); }); });
    document.querySelector('.tabs').addEventListener('keydown', function (e) {
      var k = e.key;
      if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'Home' && k !== 'End') return;
      e.preventDefault();
      var i = 0;
      ABAS.forEach(function (n, x) { if ($('tab-' + n).getAttribute('aria-selected') === 'true') i = x; });
      i = k === 'Home' ? 0 : k === 'End' ? ABAS.length - 1 : (i + (k === 'ArrowRight' ? 1 : -1) + ABAS.length) % ABAS.length;
      aba(ABAS[i], true);
    });
    $('mais').addEventListener('click', carregar);
    $('v-share').addEventListener('click', function () { compartilharPost(); });
    $('v-expand').addEventListener('click', abrirZoom);
    $('p-share').addEventListener('click', compartilharPerfil);

    var dlg = $('viewer');
    $('v-close').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('close', fecharViewer);
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    window.addEventListener('hashchange', function () { var id = idDoHash(); if (id) abrirPorId(id, 0); });
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
    else if (location.hash === '#links') aba('links');
    else if (location.hash === '#posts') { aba('posts'); $('tab-posts').scrollIntoView(); }
    registrarSW();
    iniciarInstalacao();
    carregarPerfil();
    carregar().then(function () { var id = idDoHash(); if (id) abrirPorId(id, 1); });
  }

  init();
})();
