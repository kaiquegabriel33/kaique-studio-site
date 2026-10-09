// Kaique Studio — editor visual (só no computador, com o servidor local).
// Clicar seleciona um elemento da página; arrastar move; a alça do canto
// muda a largura; o painel ajusta texto, tamanho, peso e alinhamento.
// Salvar grava o JSON do carrossel; Publicar faz commit, push e atualiza o site.
(function (global) {
  'use strict';
  const R = global.KSRender;

  function abrir(cfg) {
    // cfg: { d, canvases, trilho, palco, paginaAtual(), irPara(i), redesenhar(i), lado, el, aoMudarPaginas() }
    const { d, el } = cfg;
    let sel = null;             // { pagina, idx }
    let lays = [];              // layout de cada página (do último desenho)
    const desfazer = [];
    let sujo = false;

    const camada = el('canvas', { class: 'camada-editor' });
    cfg.palco.append(camada);
    const painel = el('section', { class: 'bloco editor' });
    cfg.lado.prepend(painel);
    const estado = el('p', { class: 'status', role: 'status' });

    function snapshot() { desfazer.push(JSON.stringify(d.slides)); if (desfazer.length > 60) desfazer.shift(); }
    function marcarSujo() { sujo = true; btnSalvar.textContent = 'Salvar alterações •'; }
    function slideAtual() { return d.slides[cfg.paginaAtual()]; }
    // selecionado só vale na página que está na tela (trocar de página pelos pontos não apaga o elemento errado)
    function elAtual() { return sel && sel.pagina === cfg.paginaAtual() && d.slides[sel.pagina] ? d.slides[sel.pagina].elementos[sel.idx] : null; }

    function redesenhar(i = cfg.paginaAtual()) {
      lays[i] = cfg.redesenhar(i);
      desenharCamada();
    }
    function redesenharTudo() { d.slides.forEach((_, i) => { lays[i] = cfg.redesenhar(i); }); desenharCamada(); }

    // camada por cima da página visível: só a moldura da seleção
    function desenharCamada() {
      const i = cfg.paginaAtual(), c = cfg.canvases[i];
      if (!c) return;
      camada.width = c.width; camada.height = c.height;
      camada.style.width = cfg.trilho.clientWidth + 'px';
      camada.style.height = (cfg.trilho.clientWidth * c.height / c.width) + 'px';
      const g = camada.getContext('2d');
      g.clearRect(0, 0, camada.width, camada.height);
      if (!sel || sel.pagina !== i) return;
      const e = (lays[i] || { elementos: [] }).elementos.find((x) => x._idx === sel.idx);
      if (!e) return;
      const b = caixa(e);
      g.save();
      g.translate(0, (lays[i] && lays[i].deslocamento) || 0);   // Reels: conteúdo desenhado mais abaixo
      g.strokeStyle = '#1a73e8'; g.lineWidth = 4; g.setLineDash([14, 8]);
      g.strokeRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
      g.setLineDash([]); g.fillStyle = '#1a73e8';
      g.fillRect(b.x + b.w - 8, b.y + b.h - 8, 28, 28);   // alça de largura
      g.restore();
    }
    function caixa(e) { return { x: e.x ?? R.MARGEM, y: e.y, w: e.w ?? R.LARG_UTIL, h: e._h }; }
    function pontoPagina(ev) {
      const r = camada.getBoundingClientRect();
      const dy = (lays[cfg.paginaAtual()] && lays[cfg.paginaAtual()].deslocamento) || 0;
      return { x: (ev.clientX - r.left) * camada.width / r.width, y: (ev.clientY - r.top) * camada.height / r.height - dy };
    }

    let arrasto = null;
    camada.addEventListener('pointerdown', (ev) => {
      const i = cfg.paginaAtual(), p = pontoPagina(ev);
      const els = (lays[i] || { elementos: [] }).elementos;
      // alça de largura do selecionado?
      if (sel && sel.pagina === i) {
        const e = els.find((x) => x._idx === sel.idx);
        if (e) {
          const b = caixa(e);
          if (p.x > b.x + b.w - 14 && p.x < b.x + b.w + 30 && p.y > b.y + b.h - 14 && p.y < b.y + b.h + 30) {
            snapshot();
            arrasto = { modo: 'largura', p0: p, w0: b.w, h0: b.h };
            camada.setPointerCapture(ev.pointerId); return;
          }
        }
      }
      const alvo = [...els].reverse().find((e) => { const b = caixa(e); return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h; });
      sel = alvo ? { pagina: i, idx: alvo._idx } : null;
      montarPainel();
      desenharCamada();
      if (alvo) {
        snapshot();
        const b = caixa(alvo);
        arrasto = { modo: 'mover', p0: p, x0: b.x, y0: b.y };
        camada.setPointerCapture(ev.pointerId);
      }
    });
    camada.addEventListener('pointermove', (ev) => {
      if (!arrasto) return;
      const p = pontoPagina(ev), e = elAtual();
      if (!e) return;
      if (arrasto.modo === 'mover') {
        e.x = Math.round(arrasto.x0 + p.x - arrasto.p0.x);
        e.y = Math.round(arrasto.y0 + p.y - arrasto.p0.y);
      } else {
        e.w = Math.max(160, Math.round(arrasto.w0 + p.x - arrasto.p0.x));
        if (typeof e.h === 'number') e.h = Math.max(120, Math.round(arrasto.h0 + p.y - arrasto.p0.y));
      }
      arrasto.mexeu = true;
      redesenhar();
    });
    const soltar = () => {
      if (arrasto && arrasto.mexeu) { marcarSujo(); montarPainel(); } else if (arrasto) desfazer.pop();
      arrasto = null;
    };
    camada.addEventListener('pointerup', soltar);
    camada.addEventListener('pointercancel', soltar);

    // ---------- painel ----------
    const btnSalvar = el('button', { text: 'Salvar alterações', onclick: salvar });
    const btnPublicar = el('button', { class: 'sec', text: 'Publicar no site', onclick: publicar });
    const btnDesfazer = el('button', { class: 'sec', text: 'Desfazer', onclick: () => {
      if (!desfazer.length) return;
      d.slides = JSON.parse(desfazer.pop());
      sel = null; cfg.aoMudarPaginas(); redesenharTudo(); montarPainel(); marcarSujo();
    } });
    const campos = el('div', { class: 'edicao' });

    function campo(rotulo, tipo, valor, aoMudar, extra = {}) {
      const idc = 'ed-' + rotulo.replace(/\W+/g, '-').toLowerCase();
      let inp;
      if (tipo === 'textarea') { inp = el('textarea', { id: idc }); inp.value = valor ?? ''; }
      else if (tipo === 'select') {
        inp = el('select', { id: idc });
        extra.opcoes.forEach(([v, t]) => { const o = el('option', { value: String(v), text: t }); if (String(v) === String(valor)) o.selected = true; inp.append(o); });
      } else { inp = el('input', { id: idc, type: tipo }); inp.value = valor ?? ''; }
      let primeiro = true;
      inp.addEventListener(tipo === 'select' ? 'change' : 'input', () => {
        if (primeiro) { snapshot(); primeiro = false; }
        aoMudar(tipo === 'number' ? (inp.value === '' ? undefined : Number(inp.value)) : inp.value);
        marcarSujo(); redesenhar();
      });
      return el('div', {}, el('label', { for: idc, text: rotulo }), inp);
    }

    function montarPainel() {
      campos.innerHTML = '';
      const s = slideAtual();
      // página
      campos.append(el('h2', { text: `Página ${cfg.paginaAtual() + 1}` }));
      campos.append(el('div', { class: 'acoes' },
        el('button', { class: 'sec', text: '← Mover', onclick: () => moverPagina(-1) }),
        el('button', { class: 'sec', text: 'Mover →', onclick: () => moverPagina(1) }),
        el('button', { class: 'sec', text: 'Duplicar', onclick: duplicarPagina }),
        el('button', { class: 'sec', text: 'Apagar página', onclick: apagarPagina }),
        el('button', { class: 'sec', text: '+ Texto', onclick: novoTexto })));
      campos.append(campo('Tema', 'select', s.tema || 'claro', (v) => { s.tema = v; }, { opcoes: [['claro', 'Claro'], ['escuro', 'Escuro']] }));
      campos.append(campo('Centralizar na vertical', 'select', s.centralizar ? '1' : '', (v) => { s.centralizar = !!v; }, { opcoes: [['', 'Não'], ['1', 'Sim (capa)']] }));
      campos.append(campo('Rodapé de fonte', 'textarea', s.fonte || '', (v) => { s.fonte = v; }));
      // elemento
      const e = elAtual();
      if (!e) { campos.append(el('p', { class: 'nota', text: 'Clique num elemento da página para editar. Arraste para mover; a alça azul do canto muda a largura.' })); return; }
      campos.append(el('h2', { text: `Elemento: ${e.tipo}` }));
      const textuais = { texto: ['texto'], noticia: ['manchete', 'linhaFina', 'veiculo', 'data'], numero: ['valor', 'rotulo', 'contexto'],
        grafico: ['titulo', 'subtitulo', 'fonte'], tabela: ['titulo', 'subtitulo', 'fonte'], citacao: [], manchetes: [], linha_tempo: ['titulo'],
        comparacao: [], imagem: ['credito'], video: ['credito'] };
      (textuais[e.tipo] || []).forEach((k) => campos.append(campo(k, 'textarea', e[k], (v) => { e[k] = v; })));
      if (e.tipo === 'citacao') (e.citacoes || []).forEach((c, k) => campos.append(campo(`citação ${k + 1}`, 'textarea', c, (v) => { e.citacoes[k] = v; })));
      if (e.tipo === 'manchetes') (e.itens || []).forEach((it, k) => campos.append(campo(`manchete ${k + 1}`, 'textarea', it.manchete, (v) => { it.manchete = v; })));
      if (e.tipo === 'comparacao') (e.itens || []).forEach((it, k) => {
        campos.append(campo(`item ${k + 1} — título`, 'textarea', it.titulo, (v) => { it.titulo = v; }));
        campos.append(campo(`item ${k + 1} — texto`, 'textarea', it.texto, (v) => { it.texto = v; }));
      });
      if ('tam' in e || e.tipo === 'texto') campos.append(campo('Tamanho da letra', 'number', e.tam ?? 37, (v) => { e.tam = v; }));
      if (e.tipo === 'texto') {
        campos.append(campo('Peso', 'select', e.peso ?? 700, (v) => { e.peso = Number(v); }, { opcoes: [[500, 'Médio'], [600, 'Semi-negrito'], [700, 'Negrito (modelo)'], [800, 'Extra-negrito']] }));
        campos.append(campo('Alinhamento', 'select', e.alinhar || 'inicio', (v) => { e.alinhar = v === 'inicio' ? undefined : v; }, { opcoes: [['inicio', 'Esquerda'], ['centro', 'Centro'], ['fim', 'Direita']] }));
      }
      if (typeof e.h === 'number') campos.append(campo('Altura', 'number', e.h, (v) => { e.h = v; }));
      campos.append(el('div', { class: 'acoes' },
        el('button', { class: 'sec', text: 'Posição automática', onclick: () => { snapshot(); delete e.x; delete e.y; delete e.w; marcarSujo(); redesenhar(); montarPainel(); } }),
        el('button', { class: 'sec', text: 'Subir na ordem', onclick: () => trocarOrdem(-1) }),
        el('button', { class: 'sec', text: 'Descer na ordem', onclick: () => trocarOrdem(1) }),
        el('button', { class: 'sec', text: 'Apagar elemento', onclick: () => {
          snapshot(); slideAtual().elementos.splice(sel.idx, 1); sel = null; marcarSujo(); redesenhar(); montarPainel();
        } })));
      campos.append(el('p', { class: 'nota', text: 'No texto: **negrito** e ==marca-texto==.' }));
    }

    function trocarOrdem(dir) {
      const els = slideAtual().elementos, j = sel.idx + dir;
      if (j < 0 || j >= els.length) return;
      snapshot(); [els[sel.idx], els[j]] = [els[j], els[sel.idx]]; sel.idx = j;
      marcarSujo(); redesenhar(); montarPainel();
    }
    function moverPagina(dir) {
      const i = cfg.paginaAtual(), j = i + dir;
      if (j < 0 || j >= d.slides.length) return;
      snapshot(); [d.slides[i], d.slides[j]] = [d.slides[j], d.slides[i]];
      sel = null; cfg.aoMudarPaginas(); redesenharTudo(); cfg.irPara(j); marcarSujo(); montarPainel();
    }
    function duplicarPagina() {
      if (d.slides.length >= 10) { estado.textContent = 'O Instagram aceita até 10 páginas por carrossel.'; return; }
      const i = cfg.paginaAtual();
      snapshot(); d.slides.splice(i + 1, 0, JSON.parse(JSON.stringify(d.slides[i])));
      cfg.aoMudarPaginas(); redesenharTudo(); cfg.irPara(i + 1); marcarSujo(); montarPainel();
    }
    function apagarPagina() {
      if (d.slides.length <= 1) return;
      const i = cfg.paginaAtual();
      snapshot(); d.slides.splice(i, 1); sel = null;
      cfg.aoMudarPaginas(); redesenharTudo(); cfg.irPara(Math.max(0, i - 1)); marcarSujo(); montarPainel();
    }
    function novoTexto() {
      snapshot(); slideAtual().elementos.push({ tipo: 'texto', tam: 37, texto: 'Texto novo' });
      sel = { pagina: cfg.paginaAtual(), idx: slideAtual().elementos.length - 1 };
      marcarSujo(); redesenhar(); montarPainel();
    }

    async function salvar() {
      estado.textContent = 'Salvando…';
      const limpo = JSON.parse(JSON.stringify(d, (k, v) => (k.startsWith('_') ? undefined : v)));
      try {
        const r = await fetch(`/api/carrossel/${encodeURIComponent(d.id)}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-KS': '1' }, body: JSON.stringify(limpo) });
        const j = await r.json();
        if (!j.ok) { estado.textContent = 'Não salvou: ' + j.erro; return false; }
        sujo = false; btnSalvar.textContent = 'Salvar alterações';
        estado.textContent = 'Salvo no computador. Use “Publicar no site” para mandar para o celular.';
        return true;
      } catch { estado.textContent = 'Servidor local não respondeu.'; return false; }
    }
    async function publicar() {
      if (sujo && !(await salvar())) return;
      estado.textContent = 'Publicando… (testes, GitHub e site, uns 20 segundos)';
      btnPublicar.disabled = true;
      try {
        const j = await (await fetch('/api/publicar', { method: 'POST', headers: { 'X-KS': '1' } })).json();
        estado.textContent = j.ok ? 'Publicado. Em cerca de 1 minuto aparece no site.' : `Não publicou: ${j.erro}`;
        global.__ksPublicacao = j;
      } catch { estado.textContent = 'Servidor local não respondeu.'; }
      btnPublicar.disabled = false;
    }

    painel.append(el('h2', { text: 'Editor' }), el('div', { class: 'acoes' }, btnSalvar, btnPublicar, btnDesfazer), estado, campos);
    cfg.trilho.addEventListener('scroll', () => { requestAnimationFrame(() => { desenharCamada(); montarPainel(); }); }, { passive: true });
    global.addEventListener('resize', desenharCamada);
    global.addEventListener('beforeunload', (ev) => { if (sujo) { ev.preventDefault(); ev.returnValue = ''; } });
    redesenharTudo();
    montarPainel();
    return { selecionar: (pagina, idx) => { sel = { pagina, idx }; montarPainel(); desenharCamada(); }, salvar, get sujo() { return sujo; } };
  }

  global.KSEditor = { abrir };
})(window);
