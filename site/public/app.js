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
  var PLAY = '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>';

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
      if (p.video) b.appendChild(icone(PLAY, 'multi')); // vídeo/Reel: ícone de play no canto
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
      if (!p.video) act.appendChild(bx); // vídeo não tem "Expandir imagem"
      act.appendChild(bs);
      veil.appendChild(act);
      li.appendChild(veil);
      g.appendChild(li);
    });
  }

  /* ---------- scroll infinito ----------
     Sem botão: uma sentinela no fim da grade dispara o carregamento da próxima página quando chega
     a ~900px da tela. Depois de cada página a sentinela é reavaliada (se a tela ainda tem espaço, já pede a próxima). */
  var io = null;
  var falhouAoPaginar = false;

  function carregarMais() {
    if (carregando || falhouAoPaginar || posts.length >= total) return;
    carregar();
  }

  function verificarScrollManual() {
    var s = $('sentinela');
    if (s && s.getBoundingClientRect().top < window.innerHeight + 900) carregarMais();
  }

  function reavaliarScroll() {
    var s = $('sentinela');
    if (!s || falhouAoPaginar || posts.length >= total) return;
    if (io) { io.unobserve(s); io.observe(s); } else verificarScrollManual();
  }

  function iniciarScrollInfinito() {
    var s = $('sentinela');
    if (!s) return;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (es) {
        for (var i = 0; i < es.length; i++) if (es[i].isIntersecting) { carregarMais(); break; }
      }, { rootMargin: '0px 0px 900px 0px' });
      io.observe(s);
    } else {
      window.addEventListener('scroll', verificarScrollManual, { passive: true });
    }
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
    if (primeira) estado('Carregando posts...', '');
    esqueleto(true); // esqueletos no fim da grade enquanto a próxima página chega
    return buscar(posts.length).then(function (j) {
      total = Number(j.total) || 0;
      esqueleto(false);
      estado('');
      falhouAoPaginar = false;
      adicionar(j.posts);
      $('st-posts').textContent = String(total);
      if (!posts.length) estado('Nada por aqui ainda', 'Os posts aparecem aqui assim que forem publicados no Instagram.');
    }).catch(function (err) {
      esqueleto(false);
      falhouAoPaginar = true; // para de pedir sozinho; só o botão "Tentar de novo" tenta outra vez
      var msg = 'Não deu para carregar agora (' + (err && err.message ? err.message : 'erro desconhecido') + '). Confira sua conexão ou veja os posts direto no Instagram.';
      estado('Falha ao carregar os posts', msg, { txt: 'Tentar de novo', fn: function () { estado(''); falhouAoPaginar = false; carregar(); } });
    }).then(function () {
      carregando = false;
      reavaliarScroll();
    });
  }

  /* ---------- visualizador ----------
     Carrossel = trilho (#v-track) com uma imagem por "slide", rolagem horizontal nativa e scroll-snap:
     o swipe é do próprio navegador (acompanha o dedo e encaixa), sem JS de gesto. O JS só acompanha a
     rolagem para saber qual imagem está na tela (bolinhas, setas, texto alternativo) e rola o trilho
     quando a troca vem das setas ou do teclado. Não dá a volta: no último item o swipe para ali.
     Trocar de POST é só pelos botões laterais e pelo teclado (nunca por swipe). */
  var trilhoPost = null; // post cujo trilho está montado (evita remontar ao só trocar de imagem)

  function suave() {
    return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function montarTrilho(p, imgs, s) {
    var tr = $('v-track');
    tr.textContent = '';
    imgs.forEach(function (u, i) {
      var sl = el('div', 'v-slide');
      var im = el('img');
      im.alt = 'Imagem ' + (i + 1) + ' de ' + imgs.length + (s.texto ? '. ' + resumo(p) : '. Foto do Polo 9n4');
      im.width = 1080; im.height = 1080;
      im.decoding = 'async';
      im.draggable = false;
      if (i === 0) {
        // Proporção do Instagram: a 1ª imagem do post define a caixa (o carrossel inteiro segue ela).
        im.addEventListener('load', function () {
          var r = im.naturalWidth / im.naturalHeight;
          p._cls = r <= 0.9 ? 'r-45' : r < 1.15 ? 'r-11' : r < 1.6 ? 'r-43' : 'r-191';
          if (posts[atual] === p) proporcao(p._cls);
        });
      } else {
        im.setAttribute('aria-hidden', 'true');
      }
      im.src = u;
      sl.appendChild(im);
      tr.appendChild(sl);
    });
    tr.scrollLeft = 0;
    trilhoPost = p;
  }

  function proporcao(cls) {
    var dlgV = $('viewer');
    ['r-45', 'r-11', 'r-43', 'r-191'].forEach(function (c) { dlgV.classList.toggle(c, c === cls); });
  }

  /* Atualiza bolinhas, setas e acessibilidade para a imagem imgIdx (sem mexer na rolagem). */
  function marcarImagem() {
    var p = posts[atual];
    var n = p && Array.isArray(p.imagens) ? p.imagens.length : 0;
    var dots = $('v-dots').children;
    for (var i = 0; i < dots.length; i++) dots[i].className = i === imgIdx ? 'on' : '';
    $('v-iprev').disabled = imgIdx <= 0;
    $('v-inext').disabled = imgIdx >= n - 1;
    var sl = $('v-track').children;
    for (var k = 0; k < sl.length; k++) {
      var im = sl[k].firstChild;
      if (im) { if (k === imgIdx) im.removeAttribute('aria-hidden'); else im.setAttribute('aria-hidden', 'true'); }
    }
  }

  /* Qual imagem está na tela, a partir da rolagem do trilho. */
  var rafTrilho = 0;
  function aoRolarTrilho() {
    if (rafTrilho) return;
    rafTrilho = requestAnimationFrame(function () {
      rafTrilho = 0;
      var tr = $('v-track');
      var w = tr.clientWidth;
      if (!w || !tr.children.length) return;
      var i = Math.max(0, Math.min(tr.children.length - 1, Math.round(tr.scrollLeft / w)));
      if (i !== imgIdx) { imgIdx = i; marcarImagem(); }
    });
  }

  function rolarPara(i, animar) {
    var tr = $('v-track');
    var w = tr.clientWidth;
    if (!w) return;
    try { tr.scrollTo({ left: i * w, behavior: animar && suave() ? 'smooth' : 'auto' }); } catch (e) { tr.scrollLeft = i * w; }
  }

  function renderViewer() {
    var p = posts[atual];
    if (!p) return;
    var imgs = Array.isArray(p.imagens) ? p.imagens : [];
    var multi = imgs.length > 1 && !p.video;
    var s = separar(p.legenda);
    var tr = $('v-track');
    proporcao(p._cls || 'r-45'); // padrão 4:5: evita salto de layout antes de a imagem carregar
    // Vídeo/Reel: toca o MP4 no lugar da imagem (a capa vira o poster).
    var vid = $('v-video');
    if (p.video) {
      tr.hidden = true;
      tr.textContent = '';
      trilhoPost = null;
      vid.hidden = false;
      vid.poster = imgs[0] || '';
      if (vid.getAttribute('src') !== p.video) vid.src = p.video;
      vid.onloadedmetadata = function () {
        var rv = vid.videoWidth / vid.videoHeight;
        p._cls = rv <= 0.9 ? 'r-45' : rv < 1.15 ? 'r-11' : rv < 1.6 ? 'r-43' : 'r-191';
        proporcao(p._cls);
      };
    } else {
      tr.hidden = false;
      if (trilhoPost !== p) montarTrilho(p, imgs, s);
      vid.hidden = true;
      if (vid.getAttribute('src')) {
        vid.pause();
        vid.removeAttribute('src');
        vid.load();
      }
    }
    $('v-expand').hidden = !!p.video;
    $('v-iprev').hidden = !multi;
    $('v-inext').hidden = !multi;
    var dots = $('v-dots');
    dots.textContent = '';
    if (multi) imgs.forEach(function () { dots.appendChild(el('i')); });
    marcarImagem();
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
    $('v-scroll').scrollTop = 0;
    carregarComentarios(p);
  }

  function abrir(i, origem) {
    atual = i; imgIdx = 0;
    trilhoPost = null; // remonta o trilho do zero (começa na 1ª imagem)
    ultimoFoco = origem || document.activeElement;
    renderViewer();
    var dlg = $('viewer');
    if (!dlg.open) dlg.showModal();
    document.body.classList.add('lock');
    $('v-close').focus();
  }

  /* Imagem anterior/próxima do carrossel. Não dá a volta. Devolve false se já está na ponta. */
  function imagem(delta) {
    var p = posts[atual];
    var n = p && !p.video ? (p.imagens || []).length : 0;
    if (n < 2) return false;
    var alvo = Math.max(0, Math.min(n - 1, imgIdx + delta));
    if (alvo === imgIdx) return false;
    imgIdx = alvo;
    marcarImagem();
    // Com o zoom aberto por cima, o trilho troca sem animação (ninguém está vendo).
    rolarPara(alvo, !$('zoom').open);
    return true;
  }

  function post(delta) {
    var alvo = atual + delta;
    if (alvo < 0) return;
    // O botão do lado que chegou na ponta fica desabilitado e perderia o foco: passa o foco para o Fechar.
    var botao = delta < 0 ? $('v-pprev') : $('v-pnext');
    if (document.activeElement === botao) setTimeout(function () { if (botao.disabled) $('v-close').focus(); }, 0);
    if (alvo >= posts.length) {
      if (posts.length >= total) return;
      carregar().then(function () { if (alvo < posts.length) { atual = alvo; imgIdx = 0; renderViewer(); } });
      return;
    }
    atual = alvo; imgIdx = 0;
    renderViewer();
  }

  /* ---------- comentários do Instagram (sob demanda, ao abrir o post) ---------- */
  var cacheComentarios = {};
  var pedidoComentarios = 0;

  function dataRelativa(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'agora';
    if (s < 3600) return Math.floor(s / 60) + ' min';
    if (s < 86400) return Math.floor(s / 3600) + ' h';
    if (s < 7 * 86400) return Math.floor(s / 86400) + ' d';
    if (s < 365 * 86400) return Math.floor(s / (7 * 86400)) + ' sem';
    return new Date(t).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function mostrarComentarios(lista) {
    var sec = $('v-com'), ul = $('v-com-lista');
    ul.textContent = '';
    sec.classList.remove('carregando');
    lista.slice(0, 20).forEach(function (c) {
      var li = el('li');
      var pp = el('p');
      if (c.usuario) pp.appendChild(el('b', null, c.usuario));
      pp.appendChild(document.createTextNode(String(c.texto || '')));
      li.appendChild(pp);
      var meta = [];
      var quando = c.criado_em ? dataRelativa(c.criado_em) : '';
      if (quando) meta.push(quando);
      var cu = num(c.curtidas);
      if (cu) meta.push(plural(cu, 'curtida', 'curtidas'));
      if (meta.length) {
        var m = el('span', 'v-com-meta', meta.join(' · '));
        if (c.criado_em) m.title = formatarData(c.criado_em).txt;
        li.appendChild(m);
      }
      ul.appendChild(li);
    });
    $('v-com-vazio').hidden = lista.length > 0;
    sec.hidden = false;
  }

  function carregarComentarios(p) {
    var sec = $('v-com');
    var meu = ++pedidoComentarios;
    var id = String(p.id);
    if (cacheComentarios[id]) { mostrarComentarios(cacheComentarios[id]); return; }
    sec.hidden = true;
    $('v-com-lista').textContent = '';
    var pedido;
    if (DEMO) {
      pedido = Promise.resolve({ comentarios: atual % 2 ? [] : [
        { usuario: 'fulano.vw', texto: 'Que Polo lindo! Ficou top com as lanternas escurecidas.', curtidas: 3, criado_em: new Date(Date.now() - 3 * 3600e3).toISOString() },
        { usuario: 'polo_clube', texto: 'Qual a medida das rodas?', curtidas: 0, criado_em: new Date(Date.now() - 9 * 86400e3).toISOString() }
      ] });
    } else if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return;
    } else {
      pedido = fetch('/api/comentarios?post=' + encodeURIComponent(id), { headers: { Accept: 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('comentarios ' + r.status); return r.json(); });
    }
    pedido.then(function (j) {
      var lista = j && Array.isArray(j.comentarios) ? j.comentarios : [];
      cacheComentarios[id] = lista;
      if (meu === pedidoComentarios) mostrarComentarios(lista);
    }).catch(function () { /* erro silencioso: a seção continua escondida */ });
  }

  function fecharViewer() {
    var vv = $('v-video');
    if (vv) vv.pause(); // não deixa o vídeo tocando por trás depois de fechar
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

  /* ---------- aviso de post novo (Web Push) ----------
     Botão discreto abaixo da bio. Só aparece se o navegador tem PushManager e a pessoa ainda não
     bloqueou as notificações. A permissão é pedida SÓ no clique. A inscrição vai para /api/push
     (o Worker grava no banco); quem envia é o backend, depois de publicar (notificarNovoPost).
     No iPhone o PushManager só existe com o app instalado na tela de início: no Safari comum o botão
     aparece e explica isso. VAPID_PUBLICA precisa ser do mesmo par do secret VAPID_PRIVATE_KEY. */
  var VAPID_PUBLICA = 'BCzsffDs0rv-uaWO2Fa83HPsT6LHLRXOHAz-jErwjQQ08QzCWe6fbcYIqTH3en9YoL1XyqBRBbaKdx-vw__b0-w';

  function chaveBytes(b64) {
    var s = b64.replace(/-/g, '+').replace(/_/g, '/');
    s += '===='.slice((s.length % 4) || 4);
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function enviarInscricao(metodo, sub) {
    var j = sub.toJSON ? sub.toJSON() : sub;
    var corpo = metodo === 'DELETE' ? { endpoint: j.endpoint } : { endpoint: j.endpoint, keys: j.keys };
    return fetch('/api/push', {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(corpo)
    }).then(function (r) { if (!r.ok) throw new Error('push ' + r.status); });
  }

  function iniciarPush() {
    var caixa = $('push'), btn = $('push-btn'), txt = $('push-txt'), dica = $('push-dica');
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var temPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    var seguro = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!seguro || DEMO) return;

    if (!temPush) {
      // iPhone/iPad no Safari comum: só funciona instalado. Mostra o caminho em vez de esconder.
      if (ios && !instalado()) {
        caixa.hidden = false;
        btn.addEventListener('click', function () { dica.hidden = !dica.hidden; });
      }
      return;
    }
    if (Notification.permission === 'denied') return; // a pessoa já decidiu: não insiste

    var ativo = false;
    function pintar() {
      txt.textContent = ativo ? 'Desativar avisos' : 'Avisar novos posts';
      btn.setAttribute('aria-pressed', String(ativo));
    }

    function registro() { return navigator.serviceWorker.ready; }

    registro().then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      ativo = !!sub && Notification.permission === 'granted';
      pintar();
      caixa.hidden = false;
    }).catch(function () { /* sem service worker: fica escondido */ });

    btn.addEventListener('click', function () {
      btn.disabled = true;
      var acao;
      if (ativo) {
        acao = registro().then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
          if (!sub) return;
          var copia = sub.toJSON();
          return sub.unsubscribe().then(function () { return enviarInscricao('DELETE', copia).catch(function () {}); });
        }).then(function () { ativo = false; toast('Avisos desativados'); });
      } else {
        acao = Notification.requestPermission().then(function (perm) {
          if (perm !== 'granted') {
            if (perm === 'denied') caixa.hidden = true;
            throw new Error('sem permissao');
          }
          return registro();
        }).then(function (reg) {
          return reg.pushManager.getSubscription().then(function (sub) {
            return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveBytes(VAPID_PUBLICA) });
          });
        }).then(function (sub) {
          return enviarInscricao('POST', sub).catch(function (e) {
            // O servidor não guardou: desfaz a inscrição local para o botão não mentir.
            return sub.unsubscribe().catch(function () {}).then(function () { throw e; });
          });
        }).then(function () { ativo = true; toast('Pronto: você será avisado de posts novos'); });
      }
      acao.catch(function (e) {
        if (!(e && e.message === 'sem permissao')) toast('Não deu para ativar os avisos agora');
      }).then(function () { btn.disabled = false; pintar(); });
    });
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
    iniciarScrollInfinito();
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
    // Teclado: com carrossel, as setas trocam a imagem; na ponta do carrossel (ou sem carrossel), trocam o post.
    // No document (não só no diálogo): se o botão focado fica desabilitado, o foco cai no body e as setas seguem valendo.
    document.addEventListener('keydown', function (e) {
      if (!dlg.open || $('zoom').open) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target && e.target.tagName === 'VIDEO') return; // setas do vídeo avançam/voltam o vídeo
      e.preventDefault();
      var d = e.key === 'ArrowRight' ? 1 : -1;
      if (!imagem(d)) post(d);
    });
    // Swipe: é a rolagem nativa do trilho (scroll-snap). Aqui só se acompanha qual imagem ficou na tela.
    var trilho = $('v-track');
    trilho.addEventListener('scroll', aoRolarTrilho, { passive: true });
    window.addEventListener('resize', function () {
      // Girar o celular muda a largura: mantém a mesma imagem encaixada.
      if (dlg.open && !trilho.hidden) rolarPara(imgIdx, false);
    });

    carregarCarro();
    if (location.hash === '#carro') aba('carro');
    else if (location.hash === '#links') aba('links');
    else if (location.hash === '#posts') { aba('posts'); $('tab-posts').scrollIntoView(); }
    registrarSW();
    iniciarInstalacao();
    iniciarPush();
    carregarPerfil();
    carregar().then(function () { var id = idDoHash(); if (id) abrirPorId(id, 1); });
  }

  init();
})();
