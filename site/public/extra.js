/* Carregado sob demanda: imagem expandida (zoom) e aba Links. */
window.PoloExtra = function (A) {
  'use strict';
  var $ = A.$, el = A.el, toast = A.toast, cheio = A.cheio, dataCurta = A.dataCurta, DEMO = A.DEMO, extensao = A.ext;

  /* ---------- imagem expandida (zoom) ---------- */
  var Z = { nw: 0, nh: 0, s: 1, fit: true, ptrs: {}, n: 0, mov: false, t0: 0, tap: null, sx: 0, sy: 0, sl: 0, st: 0, d0: 0, s0: 1 };
  var ZMAX = 8;

  function zFit() {
    var st = $('z-stage');
    return Z.nw ? Math.min(1, st.clientWidth / Z.nw, st.clientHeight / Z.nh) : 1;
  }

  function zApply(s, cx, cy) {
    if (!Z.nw) return;
    var st = $('z-stage'), im = $('z-img'), fit = zFit();
    s = Math.min(ZMAX, Math.max(fit, s));
    var r = im.getBoundingClientRect();
    if (cx == null) { var sr = st.getBoundingClientRect(); cx = sr.left + st.clientWidth / 2; cy = sr.top + st.clientHeight / 2; }
    var fx = r.width ? Math.min(1, Math.max(0, (cx - r.left) / r.width)) : 0.5;
    var fy = r.height ? Math.min(1, Math.max(0, (cy - r.top) / r.height)) : 0.5;
    Z.s = s;
    Z.fit = Math.abs(s - fit) < 0.001;
    im.width = Math.max(1, Math.round(Z.nw * s));
    var r2 = im.getBoundingClientRect();
    st.scrollLeft += r2.left + fx * r2.width - cx;
    st.scrollTop += r2.top + fy * r2.height - cy;
    $('z-pct').textContent = Math.round(s * 100) + '%';
    $('z-in').disabled = s >= ZMAX;
    $('z-out').disabled = Z.fit;
    $('z-fit').textContent = Z.fit ? (fit < 0.99 ? '100%' : 'Ampliar') : 'Ajustar';
  }

  function zAlternar(cx, cy) { zApply(Z.fit ? (zFit() < 0.99 ? 1 : 2) : zFit(), cx, cy); }

  function carregarZoom() {
    var p = A.post();
    var imgs = p && Array.isArray(p.imagens) ? p.imagens : [];
    var u = imgs[A.idx()] || '';
    var im = $('z-img');
    Z.nw = 0; Z.nh = 0;
    im.removeAttribute('width');
    $('z-res').textContent = 'Carregando...';
    $('z-pct').textContent = '';
    $('z-prev').hidden = imgs.length < 2;
    $('z-next').hidden = imgs.length < 2;
    $('z-open').href = u || '#';
    im.alt = 'Imagem ' + (A.idx() + 1) + ' de ' + imgs.length + ' em tamanho real';
    im.onload = function () {
      Z.nw = im.naturalWidth; Z.nh = im.naturalHeight;
      $('z-res').textContent = Z.nw + ' × ' + Z.nh + ' px (arquivo original da galeria)';
      zApply(zFit());
      $('z-stage').scrollLeft = 0; $('z-stage').scrollTop = 0;
    };
    im.onerror = function () { $('z-res').textContent = 'Não deu para carregar a imagem.'; };
    im.src = u;
  }

  function abrirZoom() {
    var dlg = $('zoom');
    if (!A.post() || dlg.open) return;
    document.body.classList.add('lock');
    dlg.showModal();
    carregarZoom();
    $('z-stage').focus();
  }

  function zImagem(d) {
    var n = (A.post().imagens || []).length;
    if (n < 2) return;
    A.imagem(d);
    carregarZoom();
  }

  function baixar() {
    var p = A.post(), u = p && (p.imagens || [])[A.idx()];
    if (!u) return;
    var b = $('z-dl');
    b.disabled = true;
    fetch(u, { mode: 'cors', credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error();
      return r.blob();
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = el('a');
      a.href = url;
      a.download = 'polo9n-' + String(p.id).replace(/[^\w-]/g, '') + '-' + (A.idx() + 1) + '.' + extensao(blob.type);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    }).catch(function () {
      toast('Não deu para baixar. Tente "Abrir em nova aba".');
    }).then(function () { b.disabled = false; });
  }

  function iniciarZoom() {
    var dlg = $('zoom'), st = $('z-stage');
    $('z-close').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('close', function () {
      Z.ptrs = {}; Z.n = 0;
      $('z-img').removeAttribute('src');
      if (!$('viewer').open) document.body.classList.remove('lock');
    });
    $('z-in').addEventListener('click', function () { zApply(Z.s * 1.25); });
    $('z-out').addEventListener('click', function () { zApply(Z.s / 1.25); });
    $('z-fit').addEventListener('click', function () { zAlternar(); });
    $('z-dl').addEventListener('click', baixar);
    $('z-prev').addEventListener('click', function () { zImagem(-1); });
    $('z-next').addEventListener('click', function () { zImagem(1); });
    window.addEventListener('resize', function () { if (dlg.open && Z.nw) zApply(Z.fit ? zFit() : Z.s); });
    dlg.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var k = e.key;
      if (k === '+' || k === '=') { e.preventDefault(); zApply(Z.s * 1.25); }
      else if (k === '-' || k === '_') { e.preventDefault(); zApply(Z.s / 1.25); }
      else if (k === '0') { e.preventDefault(); zApply(zFit()); }
      else if (k === '1') { e.preventDefault(); zApply(1); }
    });
    st.addEventListener('wheel', function (e) {
      e.preventDefault();
      zApply(Z.s * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), e.clientX, e.clientY);
    }, { passive: false });

    function base() {
      var ids = Object.keys(Z.ptrs);
      if (ids.length === 1) { var q = Z.ptrs[ids[0]]; Z.sx = q.x; Z.sy = q.y; Z.sl = st.scrollLeft; Z.st = st.scrollTop; }
      else if (ids.length === 2) {
        var a = Z.ptrs[ids[0]], b = Z.ptrs[ids[1]];
        Z.d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1; Z.s0 = Z.s;
      }
    }
    st.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { st.setPointerCapture(e.pointerId); } catch (x) { /* sem captura */ }
      Z.ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      Z.n = Object.keys(Z.ptrs).length;
      if (Z.n === 1) { Z.mov = false; Z.t0 = Date.now(); }
      else Z.mov = true;
      base();
    });
    st.addEventListener('pointermove', function (e) {
      var q = Z.ptrs[e.pointerId];
      if (!q) return;
      q.x = e.clientX; q.y = e.clientY;
      var ids = Object.keys(Z.ptrs);
      if (ids.length === 2) {
        var a = Z.ptrs[ids[0]], b = Z.ptrs[ids[1]];
        zApply(Z.s0 * Math.hypot(a.x - b.x, a.y - b.y) / Z.d0, (a.x + b.x) / 2, (a.y + b.y) / 2);
      } else if (ids.length === 1) {
        var dx = q.x - Z.sx, dy = q.y - Z.sy;
        if (!Z.mov && Math.abs(dx) + Math.abs(dy) < 6) return;
        Z.mov = true;
        st.classList.add('drag');
        st.scrollLeft = Z.sl - dx;
        st.scrollTop = Z.st - dy;
      }
    });
    function fim(e) {
      if (!Z.ptrs[e.pointerId]) return;
      delete Z.ptrs[e.pointerId];
      if (Object.keys(Z.ptrs).length) { base(); return; }
      st.classList.remove('drag');
      var tap = e.type === 'pointerup' && !Z.mov && Date.now() - Z.t0 < 350;
      Z.mov = false;
      if (!tap) { Z.tap = null; return; }
      var agora = Date.now();
      if (Z.tap && agora - Z.tap.t < 350 && Math.hypot(e.clientX - Z.tap.x, e.clientY - Z.tap.y) < 30) {
        Z.tap = null;
        zAlternar(e.clientX, e.clientY);
      } else Z.tap = { t: agora, x: e.clientX, y: e.clientY };
    }
    st.addEventListener('pointerup', fim);
    st.addEventListener('pointercancel', fim);
  }


  /* ---------- links das pecas ---------- */
  var linksFeito = false;
  var DEMO_LINKS = { itens: [
    { titulo: 'Jogo de rodas aro 17 (exemplo)', url: 'https://www.example.com/rodas', categoria: 'Rodas', loja: 'Loja Exemplo', descricao: 'Texto de exemplo para testar o layout.', preco: 'R$ 1.890', data: '2026-10-12' },
    { titulo: 'Som automotivo (exemplo)', url: 'https://example.com/som', categoria: 'Som', loja: 'Outra Loja', descricao: '', preco: '', data: '' },
    { titulo: 'Item sem categoria (exemplo)', url: 'http://example.com/peca', categoria: '', loja: '', descricao: '', preco: 'R$ 99', data: '' }
  ] };

  function urlSegura(u) {
    try {
      var x = new URL(String(u));
      return x.protocol === 'https:' || x.protocol === 'http:' ? x : null;
    } catch (e) { return null; }
  }

  function dataLink(d) {
    var c = dataCurta(d);
    return c ? c.txt : (cheio(d) ? String(d).trim() : '');
  }

  function montarLinks(dados) {
    var raiz = $('links');
    raiz.textContent = '';
    var itens = (dados && Array.isArray(dados.itens) ? dados.itens : []).map(function (it) {
      var u = it && urlSegura(it.url);
      return u ? { it: it, u: u, cat: cheio(it.categoria) ? String(it.categoria).trim() : 'Outros' } : null;
    }).filter(Boolean);
    if (!itens.length) {
      raiz.appendChild(el('p', 'car-erro', 'Em breve: as peças que coloquei no Polo, com link para cada uma.'));
      return;
    }
    var cats = [];
    itens.forEach(function (x) { if (cats.indexOf(x.cat) < 0) cats.push(x.cat); });
    cats.sort(function (p, q) { return (p === 'Outros') - (q === 'Outros'); });
    var filtro = '';
    var barra = el('div', 'lk-filtro');
    barra.setAttribute('role', 'group');
    barra.setAttribute('aria-label', 'Filtrar por categoria');
    var lista = el('div', 'lk-lista');
    function desenhar() {
      lista.textContent = '';
      cats.forEach(function (c) {
        if (filtro && c !== filtro) return;
        var sec = el('section', 'car-sec');
        var h = el('h2', null, c);
        sec.appendChild(h);
        var ul = el('ul', 'lk');
        itens.filter(function (x) { return x.cat === c; }).forEach(function (x) {
          var it = x.it, li = el('li');
          var tit = cheio(it.titulo) ? String(it.titulo).trim() : x.u.hostname;
          li.appendChild(el('h3', 'lk-t', tit));
          var meta = [cheio(it.loja) ? String(it.loja).trim() : '', x.u.hostname].filter(Boolean).join(' \u00b7 ');
          li.appendChild(el('p', 'lk-m', meta));
          if (cheio(it.descricao)) li.appendChild(el('p', 'lk-d', String(it.descricao).trim()));
          var peq = [cheio(it.preco) ? String(it.preco).trim() : '', dataLink(it.data)].filter(Boolean).join(' \u00b7 ');
          if (peq) li.appendChild(el('p', 'lk-p', peq));
          var go = el('a', 'lk-go', 'Ver peça');
          go.href = x.u.href;
          go.target = '_blank';
          go.rel = 'noopener noreferrer nofollow sponsored';
          go.setAttribute('aria-label', 'Ver peça: ' + tit + ' (abre em nova aba)');
          li.appendChild(go);
          ul.appendChild(li);
        });
        sec.appendChild(ul);
        lista.appendChild(sec);
      });
      var bs = barra.querySelectorAll('button');
      for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', String((bs[i].dataset.cat || '') === filtro));
    }
    if (cats.length >= 2) {
      ['Todas'].concat(cats).forEach(function (c, i) {
        var b = el('button', null, c);
        b.type = 'button';
        b.dataset.cat = i ? c : '';
        b.addEventListener('click', function () { filtro = i ? c : ''; desenhar(); });
        barra.appendChild(b);
      });
      raiz.appendChild(barra);
    }
    raiz.appendChild(lista);
    raiz.appendChild(el('p', 'car-upd', 'Alguns links podem ser de afiliados.'));
    desenhar();
  }

  function carregarLinks() {
    if (linksFeito) return;
    linksFeito = true;
    if (DEMO) { montarLinks(DEMO_LINKS); return; }
    fetch('/links.json', { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(montarLinks)
      .catch(function () {
        linksFeito = false;
        var raiz = $('links');
        raiz.textContent = '';
        raiz.appendChild(el('p', 'car-erro', 'Os links não puderam ser carregados agora.'));
      });
  }


  iniciarZoom();
  return { abrirZoom: abrirZoom, carregarLinks: carregarLinks };
};
