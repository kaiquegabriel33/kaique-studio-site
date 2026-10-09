// Kaique Studio — motor de renderização.
// Um único desenho serve prévia, miniaturas e exportação: o PNG final é
// exatamente o que aparece na tela. Medidas do cabeçalho tiradas do modelo
// original do Canva (página 1080 × 1350).
(function (global) {
  'use strict';

  const W = 1080, H = 1350;
  const FONTE = 'Montserrat';

  const TEMAS = {
    claro: { fundo: '#f8f8f8', texto: '#000000', suave: '#5f5f5f', fraco: '#8a8a8a',
             cartao: '#ffffff', borda: '#e4e4e4', linha: '#ececec', marca: '#ffec8a',
             barra: '#000000', barraSec: '#cfcfcf', nome: '#000000', arroba: '#000000',
             positivo: '#14743a', fundoPos: '#e6f3ea', negativo: '#b42318', fundoNeg: '#fbe9e7' },
    escuro: { fundo: '#000000', texto: '#ffffff', suave: '#b5b5b5', fraco: '#8d8d8d',
              cartao: '#111111', borda: '#2a2a2a', linha: '#222222', marca: '#6b5a00',
              barra: '#ffffff', barraSec: '#4a4a4a', nome: '#f8f8f8', arroba: '#ffffff',
              positivo: '#6fd391', fundoPos: '#0f2a18', negativo: '#ff8a7a', fundoNeg: '#311512' },
  };

  // Cabeçalho fixo — posições do modelo do Canva. Não é elemento editável.
  const CAB = {
    foto: { x: 108, y: 130.55, d: 123.23 },
    nome: { x: 243.97, topo: 130.55, tam: 55.03, peso: 600, texto: 'Kaique Gabriel' },
    selo: { x: 684.42, y: 136.52, w: 48.53, h: 51.01 },
    arroba: { x: 243.97, topo: 196.2, tam: 35.95, peso: 400, opac: 0.5, texto: '@kaiquegabriel.i' },
  };
  const MARGEM = 120;               // margem lateral do texto no modelo
  const LARG_UTIL = W - 2 * MARGEM; // 840
  const TOPO_CONTEUDO = 297;        // onde o texto começa no modelo
  const LIMITE_INFERIOR = 1262;     // acima do rodapé de fonte (página 1350)
  const alturaDe = (slide) => (slide && slide.altura) || H;
  // Reels/Stories (9:16): o Instagram cobre o topo (título "Reels", câmera) e a base (nome, legenda,
  // botões). Cabeçalho e conteúdo descem REELS_TOPO px e nada passa de altura - REELS_BASE.
  const REELS_TOPO = 220, REELS_BASE = 420;
  const eReels = (slide) => alturaDe(slide) > 1600;
  const deslocamentoDe = (slide) => (eReels(slide) ? REELS_TOPO : 0);
  // limite em coordenadas do conteúdo (já deslocado)
  // no Reels a linha de fonte também precisa ficar fora da faixa que o Instagram cobre: reserva o espaço dela
  const limiteDe = (slide) => (eReels(slide) ? alturaDe(slide) - REELS_BASE - REELS_TOPO - (slide.fonte ? 76 : 0) : alturaDe(slide) - (H - LIMITE_INFERIOR));

  // Caminhos relativos à página que carrega o motor (o site em site/).
  const ATIVOS = Object.assign({
    foto: 'marca/foto_kaique_original.png',
    selo: 'marca/selo.png',
  }, global.KS_ATIVOS || {});

  // ---------- imagens ----------
  const cacheImg = new Map();
  function carregarImagem(src) {
    if (!src) return Promise.resolve(null);
    if (cacheImg.has(src)) return cacheImg.get(src);
    const p = new Promise((ok) => {
      const img = new Image();
      img.onload = () => ok(img);
      // falhou (internet instável): sai do cache para a próxima tentativa carregar de novo
      img.onerror = () => { console.warn('imagem não carregou', src); cacheImg.delete(src); ok(null); };
      img.src = src;
    });
    cacheImg.set(src, p);
    return p;
  }
  function imagemPronta(src) {
    const p = cacheImg.get(src);
    return p && p._img;
  }
  async function preCarregar(slides) {
    const srcs = new Set([ATIVOS.foto, ATIVOS.selo]);
    for (const s of slides) for (const el of s.elementos || []) {
      if (el.src) srcs.add(el.src);
      if (el.imagem) srcs.add(el.imagem);
    }
    const falhas = [];
    await Promise.all([...srcs].map(async (src) => {
      const p = carregarImagem(src);
      const img = await p;
      p._img = img;
      if (!img) falhas.push(src);
    }));
    return falhas;   // a tela avisa: "uma imagem não carregou, atualize"
  }

  async function carregarFontes() {
    const pesos = [400, 500, 600, 700, 800];
    const r = await Promise.allSettled([
      ...pesos.map((p) => document.fonts.load(`${p} 40px ${FONTE}`, 'ÁáçãéêíóõúKq@')),
      document.fonts.load('400 36px "Open Sans"', '@kaiquegabriel.i'),
    ]);
    return r.every((x) => x.status === 'fulfilled');   // false: desenha com a fonte do sistema e a tela avisa
  }

  // ---------- texto rico ----------
  // **negrito**  ==marca-texto==   \n = quebra de linha
  function tokenizar(texto) {
    const paragrafos = String(texto || '').split('\n');
    // ==/** valem até fechar, mesmo atravessando uma quebra de linha
    let negrito = false, marca = false;
    return paragrafos.map((par) => {
      const runs = [];
      let buf = '';
      const flush = () => { if (buf) runs.push({ t: buf, negrito, marca }); buf = ''; };
      for (let i = 0; i < par.length; i++) {
        if (par[i] === '*' && par[i + 1] === '*') { flush(); negrito = !negrito; i++; continue; }
        if (par[i] === '=' && par[i + 1] === '=') { flush(); marca = !marca; i++; continue; }
        buf += par[i];
      }
      flush();
      // quebra em palavras preservando o espaço que vem depois
      const palavras = [];
      for (const r of runs) {
        const partes = r.t.match(/[^\s]+\s*|\s+/g) || [];
        for (const p of partes) palavras.push({ t: p, negrito: r.negrito, marca: r.marca });
      }
      return palavras;
    });
  }

  function fonteDe(tam, peso) { return `${peso} ${tam}px ${FONTE}`; }

  function diagramarTexto(ctx, texto, o) {
    const tam = o.tam, lh = o.lh || 1.4;
    const peso = o.peso || 700, pesoDest = o.pesoDestaque || 800;
    const larg = o.w;
    const linhas = [];
    for (const palavras of tokenizar(texto)) {
      let linha = [], x = 0;
      const fechar = () => {
        // remove espaço final da última palavra para alinhar certo
        if (linha.length) {
          const u = linha[linha.length - 1];
          const semEsp = u.t.replace(/\s+$/, '');
          if (semEsp !== u.t) { ctx.font = fonteDe(tam, u.negrito ? pesoDest : peso); u.t = semEsp; u.w = ctx.measureText(semEsp).width; }
        }
        linhas.push({ runs: linha, largura: linha.reduce((a, r) => Math.max(a, r.x + r.w), 0) });
        linha = []; x = 0;
      };
      if (!palavras.length) { linhas.push({ runs: [], largura: 0 }); continue; }
      for (const p of palavras) {
        ctx.font = fonteDe(tam, p.negrito ? pesoDest : peso);
        const wTot = ctx.measureText(p.t).width;
        const wSem = ctx.measureText(p.t.replace(/\s+$/, '')).width;
        if (x > 0 && x + wSem > larg) fechar();
        if (x === 0 && /^\s+$/.test(p.t)) continue;
        if (wSem > larg) {
          // palavra maior que a linha (link, número enorme): quebra por letra em vez de vazar da página
          let pedaco = '';
          for (const ch of p.t) {
            if (pedaco && ctx.measureText(pedaco + ch).width > larg) {
              linha.push({ t: pedaco, x: 0, w: ctx.measureText(pedaco).width, negrito: p.negrito, marca: p.marca });
              fechar();
              pedaco = '';
            }
            pedaco += ch;
          }
          const wp = ctx.measureText(pedaco).width;
          linha.push({ t: pedaco, x: 0, w: wp, negrito: p.negrito, marca: p.marca });
          x = wp;
          continue;
        }
        linha.push({ t: p.t, x, w: wTot, negrito: p.negrito, marca: p.marca });
        x += wTot;
      }
      fechar();
    }
    return { linhas, altura: linhas.length * tam * lh, passo: tam * lh };
  }

  // baseline dentro da caixa de linha (calibrado contra o export do Canva)
  function baseline(topoLinha, tam, lh) { return topoLinha + (lh * tam) / 2 + tam * 0.457; }

  function desenharTexto(ctx, diag, o, tema) {
    const tam = o.tam, lh = o.lh || 1.4;
    const peso = o.peso || 700, pesoDest = o.pesoDestaque || 800;
    ctx.textBaseline = 'alphabetic';
    diag.linhas.forEach((ln, i) => {
      const topo = o.y + i * diag.passo;
      const by = baseline(topo, tam, lh);
      let dx = o.x;
      if (o.alinhar === 'centro') dx = o.x + (o.w - ln.largura) / 2;
      else if (o.alinhar === 'fim') dx = o.x + o.w - ln.largura;
      // marca-texto primeiro (atrás das letras)
      // marca contínua entre palavras marcadas vizinhas; só a última perde o espaço
      ln.runs.forEach((r, k) => {
        if (!r.marca) return;
        const seguinteMarcada = ln.runs[k + 1] && ln.runs[k + 1].marca;
        ctx.font = fonteDe(tam, r.negrito ? pesoDest : peso);
        const w = seguinteMarcada ? r.w : ctx.measureText(r.t.replace(/\s+$/, '')).width;
        const anteriorMarcada = k > 0 && ln.runs[k - 1].marca;
        ctx.fillStyle = o.corMarca || tema.marca;
        ctx.fillRect(dx + r.x - (anteriorMarcada ? 0 : 4), by - tam * 0.78, w + (anteriorMarcada ? 0 : 4) + (seguinteMarcada ? 0.5 : 4), tam * 1.02);
      });
      for (const r of ln.runs) {
        ctx.font = fonteDe(tam, r.negrito ? pesoDest : peso);
        ctx.fillStyle = o.cor || tema.texto;
        ctx.fillText(r.t, dx + r.x, by);
      }
    });
  }

  // ---------- primitivas ----------
  function retRedondo(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function cartao(ctx, x, y, w, h, tema, o = {}) {
    retRedondo(ctx, x, y, w, h, o.raio ?? 28);
    ctx.fillStyle = o.fundo || tema.cartao; ctx.fill();
    if (o.borda !== false) { ctx.lineWidth = 2; ctx.strokeStyle = tema.borda; ctx.stroke(); }
  }
  function desenharImagemAjustada(ctx, img, x, y, w, h, ajuste, foco) {
    if (!img) return;
    const ri = img.width / img.height, rc = w / h;
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    const fonte = img._el || img;
    if (ajuste === 'conter') {
      let dw = w, dh = h;
      if (ri > rc) dh = w / ri; else dw = h * ri;
      ctx.drawImage(fonte, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      return;
    }
    if (ri > rc) { sw = img.height * rc; sx = (img.width - sw) * (foco?.x ?? 0.5); }
    else { sh = img.width / rc; sy = (img.height - sh) * (foco?.y ?? 0.35); }
    ctx.drawImage(fonte, sx, sy, sw, sh, x, y, w, h);
  }

  // ---------- cabeçalho fixo ----------
  function desenharCabecalho(ctx, tema) {
    const f = CAB.foto;
    const foto = imagemPronta(ATIVOS.foto);
    if (foto) {
      ctx.save();
      ctx.beginPath(); ctx.arc(f.x + f.d / 2, f.y + f.d / 2, f.d / 2, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(foto, f.x, f.y, f.d, f.d);
      ctx.restore();
    }
    ctx.textBaseline = 'alphabetic';
    const n = CAB.nome;
    ctx.font = fonteDe(n.tam, n.peso); ctx.fillStyle = tema.nome;
    ctx.fillText(n.texto, n.x + 0.4, n.topo + n.tam * 0.946);
    const s = CAB.selo, selo = imagemPronta(ATIVOS.selo);
    if (selo) ctx.drawImage(selo, s.x, s.y, s.w, s.h);
    const a = CAB.arroba;
    ctx.save(); ctx.globalAlpha = a.opac;
    ctx.font = `${a.peso} ${a.tam}px "Open Sans"`; ctx.fillStyle = tema.arroba;
    ctx.fillText(a.texto, a.x + 1.6, a.topo + a.tam * 0.93);
    ctx.restore();
  }

  // ---------- elementos ----------
  // Cada tipo tem medir(ctx, el) -> altura e desenhar(ctx, el, tema).
  const TIPOS = {};

  TIPOS.texto = {
    medir(ctx, el) { return diagramarTexto(ctx, el.texto, opcTexto(el)).altura; },
    desenhar(ctx, el, tema) {
      const o = opcTexto(el);
      desenharTexto(ctx, diagramarTexto(ctx, el.texto, o), o, tema);
    },
  };
  function opcTexto(el) {
    return { x: el.x ?? MARGEM, y: el.y, w: el.w ?? LARG_UTIL, tam: el.tam ?? 37, lh: el.lh ?? 1.4,
             peso: el.peso ?? 700, pesoDestaque: el.pesoDestaque ?? 800, alinhar: el.alinhar,
             cor: el.cor, corMarca: el.corMarca };
  }

  TIPOS.imagem = {
    medir(ctx, el) { return (el.h ?? 500) + (el.credito ? 40 : 0); },
    desenhar(ctx, el, tema) {
      const img = imagemPronta(el.src);
      const x = el.x ?? MARGEM, w = el.w ?? LARG_UTIL, h = el.h ?? 500;
      ctx.save();
      retRedondo(ctx, x, el.y, w, h, el.raio ?? 24); ctx.clip();
      if (img) desenharImagemAjustada(ctx, img, x, el.y, w, h, el.ajuste || 'cobrir', el.foco);
      else { ctx.fillStyle = tema.linha; ctx.fillRect(x, el.y, w, h); }
      ctx.restore();
      if (el.borda !== false) { retRedondo(ctx, x, el.y, w, h, el.raio ?? 24); ctx.lineWidth = 2; ctx.strokeStyle = tema.borda; ctx.stroke(); }
      if (el.credito) {
        ctx.font = fonteDe(20, 500); ctx.fillStyle = tema.fraco; ctx.textBaseline = 'alphabetic';
        ctx.fillText(el.credito, x, el.y + h + 30);
      }
    },
  };

  // Recorte de notícia re-diagramado: veículo · data, manchete, linha fina.
  TIPOS.noticia = {
    _lay(ctx, el) {
      const pad = 44, w = el.w ?? LARG_UTIL, inner = w - 2 * pad;
      const imgH = el.imagem ? Math.round(w * 0.5) : 0;
      const tamM = el.tamManchete ?? 46, tamL = el.tamLinhaFina ?? 29;
      const dm = diagramarTexto(ctx, el.manchete, { tam: tamM, peso: 800, pesoDestaque: 800, w: inner, lh: 1.18 });
      const dl = el.linhaFina ? diagramarTexto(ctx, el.linhaFina, { tam: tamL, peso: 500, pesoDestaque: 700, w: inner, lh: 1.38 }) : null;
      const topoTxt = imgH + pad;
      const hMeta = 22 * 1.4 + 18;
      const h = topoTxt + hMeta + dm.altura + (dl ? 22 + dl.altura : 0) + pad - 6;
      return { pad, w, inner, imgH, tamM, tamL, dm, dl, topoTxt, hMeta, h };
    },
    medir(ctx, el) { return this._lay(ctx, el).h; },
    desenhar(ctx, el, tema) {
      const L = this._lay(ctx, el), x = el.x ?? MARGEM, y = el.y;
      cartao(ctx, x, y, L.w, L.h, tema);
      if (L.imgH) {
        ctx.save(); retRedondo(ctx, x, y, L.w, L.h, 28); ctx.clip();
        desenharImagemAjustada(ctx, imagemPronta(el.imagem), x, y, L.w, L.imgH, 'cobrir', el.foco);
        if (el.credito) {
          ctx.font = fonteDe(18, 600);
          const tw = ctx.measureText(el.credito).width;
          ctx.fillStyle = 'rgba(0,0,0,.55)';
          retRedondo(ctx, x + L.w - tw - 34, y + L.imgH - 40, tw + 20, 28, 8); ctx.fill();
          ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle';
          ctx.fillText(el.credito, x + L.w - tw - 24, y + L.imgH - 26);
          ctx.textBaseline = 'alphabetic';
        }
        ctx.restore();
      }
      let cy = y + L.topoTxt;
      ctx.textBaseline = 'alphabetic';
      ctx.font = fonteDe(22, 700); ctx.fillStyle = tema.fraco;
      const meta = [el.veiculo, el.data].filter(Boolean).join('  ·  ').toUpperCase();
      ctx.fillText(meta, x + L.pad, cy + 22);
      cy += L.hMeta;
      desenharTexto(ctx, L.dm, { x: x + L.pad, y: cy, w: L.inner, tam: L.tamM, lh: 1.18, peso: 800, pesoDestaque: 800 }, tema);
      cy += L.dm.altura;
      if (L.dl) desenharTexto(ctx, L.dl, { x: x + L.pad, y: cy + 22, w: L.inner, tam: L.tamL, lh: 1.38, peso: 500, pesoDestaque: 700, cor: tema.suave }, tema);
    },
  };

  // Várias manchetes empilhadas num só cartão (comparar enquadramentos).
  TIPOS.manchetes = {
    _lay(ctx, el) {
      const pad = 40, w = el.w ?? LARG_UTIL, inner = w - 2 * pad, tam = el.tam ?? 31;
      const itens = (el.itens || []).map((it) => {
        const d = diagramarTexto(ctx, it.manchete, { tam, peso: 700, pesoDestaque: 800, w: inner, lh: 1.28 });
        return { it, d, h: 20 * 1.3 + 14 + d.altura };
      });
      const gap = el.gap ?? 24;
      const h = pad * 2 - 8 + itens.reduce((a, i) => a + i.h, 0) + gap * Math.max(0, itens.length - 1) * 2;
      return { pad, w, inner, tam, itens, gap, h };
    },
    medir(ctx, el) { return this._lay(ctx, el).h; },
    desenhar(ctx, el, tema) {
      const L = this._lay(ctx, el), x = el.x ?? MARGEM;
      cartao(ctx, x, el.y, L.w, L.h, tema);
      let cy = el.y + L.pad - 4;
      L.itens.forEach((r, i) => {
        if (i > 0) {
          cy += L.gap;
          ctx.fillStyle = tema.linha; ctx.fillRect(x + L.pad, cy - 1, L.inner, 2);
          cy += L.gap;
        }
        ctx.textBaseline = 'alphabetic';
        ctx.font = fonteDe(20, 700); ctx.fillStyle = tema.fraco;
        ctx.fillText([r.it.veiculo, r.it.hora].filter(Boolean).join('  ·  ').toUpperCase(), x + L.pad, cy + 20);
        desenharTexto(ctx, r.d, { x: x + L.pad, y: cy + 20 * 1.3 + 14, w: L.inner, tam: L.tam, lh: 1.28, peso: 700, pesoDestaque: 800 }, tema);
        cy += r.h;
      });
    },
  };

  // Citação literal, com aspas grandes e atribuição.
  TIPOS.citacao = {
    _lay(ctx, el) {
      const pad = 48, w = el.w ?? LARG_UTIL, inner = w - 2 * pad - 18, tam = el.tam ?? 38;
      const blocos = (el.citacoes || []).map((c) => diagramarTexto(ctx, c, { tam, peso: 600, pesoDestaque: 800, w: inner, lh: 1.32 }));
      const gap = 30;
      const hAtrib = el.autor ? 24 * 1.4 + 26 : 0;
      const h = pad + 18 + blocos.reduce((a, b) => a + b.altura, 0) + gap * Math.max(0, blocos.length - 1) + hAtrib + pad - 6;
      return { pad, w, inner, tam, blocos, gap, hAtrib, h };
    },
    medir(ctx, el) { return this._lay(ctx, el).h; },
    desenhar(ctx, el, tema) {
      const L = this._lay(ctx, el), x = el.x ?? MARGEM;
      cartao(ctx, x, el.y, L.w, L.h, tema);
      ctx.fillStyle = tema.texto;
      ctx.fillRect(x + L.pad, el.y + L.pad, 6, L.h - 2 * L.pad - L.hAtrib + 4);
      let cy = el.y + L.pad + 2;
      L.blocos.forEach((b, i) => {
        if (i) cy += L.gap;
        desenharTexto(ctx, b, { x: x + L.pad + 30, y: cy, w: L.inner, tam: L.tam, lh: 1.32, peso: 600, pesoDestaque: 800 }, tema);
        cy += b.altura;
      });
      if (el.autor) {
        ctx.textBaseline = 'alphabetic';
        ctx.font = fonteDe(24, 700); ctx.fillStyle = tema.texto;
        const by = el.y + L.h - L.pad + 2;
        ctx.fillText(el.autor, x + L.pad, by);
        if (el.contexto) {
          const wA = ctx.measureText(el.autor + '  ').width;
          ctx.font = fonteDe(24, 500); ctx.fillStyle = tema.fraco;
          ctx.fillText(el.contexto, x + L.pad + wA, by);
        }
      }
    },
  };

  // Gráfico: barras horizontais, barras verticais ou linha.
  TIPOS.grafico = {
    // barras_h precisa de ~92 px por linha (rótulo + barra + valor); com h menor
    // as linhas se atropelam, então o cartão cresce e o aviso de área útil acusa
    medir(ctx, el) {
      const h = el.h ?? 560;
      if ((el.formato || 'barras_h') !== 'barras_h') return h;
      const w = el.w ?? LARG_UTIL, pad = 44;
      let cab = 0;
      if (el.titulo) cab += diagramarTexto(ctx, el.titulo, { tam: 32, peso: 800, pesoDestaque: 800, w: w - 2 * pad, lh: 1.22 }).altura + 4;
      if (el.subtitulo) cab += 24 * 1.4 + 6;
      const linha = el.notas ? 118 : 92;
      return Math.max(h, Math.ceil(2 * pad + cab + 24 + (el.rotulos || []).length * linha + (el.fonte ? 44 : 0)));
    },
    desenhar(ctx, el, tema) {
      const x = el.x ?? MARGEM, y = el.y, w = el.w ?? LARG_UTIL, h = this.medir(ctx, el), pad = 44;
      cartao(ctx, x, y, w, h, tema);
      let cy = y + pad;
      ctx.textBaseline = 'alphabetic';
      if (el.titulo) {
        const d = diagramarTexto(ctx, el.titulo, { tam: 32, peso: 800, pesoDestaque: 800, w: w - 2 * pad, lh: 1.22 });
        desenharTexto(ctx, d, { x: x + pad, y: cy, w: w - 2 * pad, tam: 32, lh: 1.22, peso: 800, pesoDestaque: 800 }, tema);
        cy += d.altura + 4;
      }
      if (el.subtitulo) {
        ctx.font = fonteDe(23, 500); ctx.fillStyle = tema.fraco;
        ctx.fillText(el.subtitulo, x + pad, cy + 24); cy += 24 * 1.4 + 6;
      }
      const rodapeH = el.fonte ? 44 : 0;
      const area = { x: x + pad, y: cy + 24, w: w - 2 * pad, h: y + h - pad - rodapeH - (cy + 24) };
      const formato = el.formato || 'barras_h';
      if (formato === 'barras_h') barrasH(ctx, el, area, tema);
      else if (formato === 'barras_div') barrasDiv(ctx, el, area, tema);
      else if (formato === 'barras') barrasV(ctx, el, area, tema);
      else linha(ctx, el, area, tema);
      if (el.fonte) {
        ctx.font = fonteDe(19, 500); ctx.fillStyle = tema.fraco;
        ctx.fillText(el.fonte, x + pad, y + h - pad + 6);
      }
    },
  };
  function fmt(v, el) {
    const casas = el.casas ?? (Number.isInteger(v) ? 0 : 1);
    const n = Math.abs(Number(v)).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
    const sinal = Number(v) < 0 ? '−' : (el.sinal ? '+' : '');
    return `${sinal}${el.prefixo || ''}${n}${el.sufixo || ''}`;
  }
  // Barras divergentes: eixo no zero, positivos à direita (preto), negativos à esquerda (cinza).
  function barrasDiv(ctx, el, a, tema) {
    const rot = el.rotulos || [], val = (el.valores || []).map(Number), n = rot.length;
    if (!n) return;
    // Mesma escala dos dois lados; rótulo em cima de cada barra para a barra
    // usar a largura toda. O zero fica onde cabem as duas pontas + valores.
    const reservaValor = 165;
    const maxPos = Math.max(0, ...val), maxNeg = Math.max(0, ...val.map((v) => -v));
    const util = a.w - 2 * reservaValor;
    const esc = util / ((maxPos + maxNeg) || 1);
    const meio = a.x + reservaValor + maxNeg * esc;
    const slot = a.h / n, barH = Math.min(56, slot * 0.42), rotH = 36;
    ctx.strokeStyle = tema.borda; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(meio, a.y + rotH - 4); ctx.lineTo(meio, a.y + a.h - 10); ctx.stroke();
    val.forEach((v, i) => {
      const sy = a.y + i * slot;
      const cy = sy + rotH;
      const pos = v >= 0, dest = (el.destaques || []).includes(i);
      const bw = Math.max(6, esc * Math.abs(v));
      const bx = pos ? meio : meio - bw;
      retRedondo(ctx, bx, cy, bw, barH, 10);
      ctx.fillStyle = pos ? tema.barra : tema.barraSec; ctx.fill();
      ctx.textBaseline = 'alphabetic';
      ctx.font = fonteDe(26, dest ? 800 : 700); ctx.fillStyle = dest ? tema.texto : tema.suave;
      ctx.textAlign = pos ? 'left' : 'right';
      ctx.fillText(rot[i], pos ? meio + 2 : meio - 2, sy + 26);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = fonteDe(34, 800); ctx.fillStyle = pos ? tema.texto : tema.suave;
      if (pos) ctx.fillText(fmt(v, el), bx + bw + 16, cy + barH / 2 + 1);
      else { ctx.textAlign = 'right'; ctx.fillText(fmt(v, el), bx - 16, cy + barH / 2 + 1); ctx.textAlign = 'left'; }
      ctx.textBaseline = 'alphabetic';
    });
  }
  function barrasH(ctx, el, a, tema) {
    const rot = el.rotulos || [], val = el.valores || [], n = rot.length;
    if (!n) return;
    const max = (el.max ?? Math.max(...val.map((v) => Math.abs(Number(v))))) || 1;   // tudo zero: sem NaN
    const slot = a.h / n, barH = Math.min(52, slot * 0.3);
    const reservaValor = el.reservaValor ?? 225;
    rot.forEach((r, i) => {
      const sy = a.y + i * slot;
      const dest = (el.destaques || []).includes(i);
      ctx.textBaseline = 'alphabetic';
      ctx.font = fonteDe(26, dest ? 700 : 600); ctx.fillStyle = dest ? tema.texto : tema.suave;
      ctx.fillText(r, a.x, sy + 24);
      const by = sy + 36;
      const neg = Number(val[i]) < 0;
      const bw = Math.max(8, (a.w - reservaValor) * (Math.abs(Number(val[i])) / max));
      retRedondo(ctx, a.x, by, bw, barH, 10);
      ctx.fillStyle = dest && !neg ? tema.barra : tema.barraSec; ctx.fill();
      ctx.font = fonteDe(40, 800); ctx.fillStyle = dest || neg ? tema.texto : tema.suave;
      ctx.fillText(fmt(val[i], el), a.x + bw + 22, by + barH / 2 + 14);
      if (el.notas && el.notas[i]) {
        ctx.font = fonteDe(21, 500); ctx.fillStyle = tema.fraco;
        ctx.fillText(el.notas[i], a.x, by + barH + 30);
      }
    });
  }
  function barrasV(ctx, el, a, tema) {
    const rot = el.rotulos || [], val = (el.valores || []).map(Number), n = rot.length;
    if (!n) return;
    const max = el.max ?? Math.max(0, ...val), min = Math.min(0, ...val);   // só negativos: zero no topo
    const baseH = a.h - 44, slot = a.w / n, bw = Math.min(110, slot * 0.6);
    const zeroY = a.y + baseH * (max / (max - min || 1));
    val.forEach((v, i) => {
      const dest = (el.destaques || []).includes(i);
      const bh = baseH * (Math.abs(v) / (max - min || 1));
      const bx = a.x + i * slot + (slot - bw) / 2;
      const by = v >= 0 ? zeroY - bh : zeroY;
      retRedondo(ctx, bx, by, bw, Math.max(bh, 3), 8);
      ctx.fillStyle = dest ? tema.barra : tema.barraSec; ctx.fill();
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = fonteDe(24, 800); ctx.fillStyle = tema.texto;
      ctx.fillText(fmt(v, el), bx + bw / 2, v >= 0 ? by - 12 : by + bh + 28);
      ctx.font = fonteDe(21, 600); ctx.fillStyle = tema.suave;
      ctx.fillText(rot[i], bx + bw / 2, a.y + a.h);
      ctx.textAlign = 'left';
    });
  }
  // Linha com área, grade, todos os rótulos do eixo X e anotações por ponto:
  // anotacoes: [{i, texto, lado: 'acima'|'abaixo', alinhar: 'centro'|'esq'|'dir'}]
  function linha(ctx, el, a, tema) {
    const rot = el.rotulos || [], val = (el.valores || []).map(Number), n = val.length;
    if (n < 2) return;
    let max = el.max ?? Math.max(...val);
    const min = el.min ?? Math.min(0, ...val);
    if (!(max > min)) max = min + 1;                          // série constante ou vazia: escala válida
    const eixoY = el.eixoY ? 56 : 0, folgaX = 26;
    const x0 = a.x + eixoY + folgaX, x1 = a.x + a.w - folgaX;
    const topo = a.y + 46, ph = a.h - 46 - 40;
    const sx = (i) => x0 + (x1 - x0) * (i / (n - 1));
    const sy = (v) => topo + ph - ph * ((v - min) / (max - min || 1));
    // grade
    ctx.textBaseline = 'middle'; ctx.font = fonteDe(19, 600);
    for (const g of el.grade || []) {
      ctx.strokeStyle = tema.linha; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x0 - folgaX, sy(g)); ctx.lineTo(x1 + folgaX, sy(g)); ctx.stroke();
      if (el.eixoY) { ctx.fillStyle = tema.fraco; ctx.fillText(fmt(g, { casas: 0 }), a.x, sy(g)); }
    }
    // área
    ctx.beginPath(); ctx.moveTo(sx(0), sy(min));
    val.forEach((v, i) => ctx.lineTo(sx(i), sy(v)));
    ctx.lineTo(sx(n - 1), sy(min)); ctx.closePath();
    ctx.fillStyle = tema.linha; ctx.fill();
    // linha
    ctx.beginPath(); val.forEach((v, i) => (i ? ctx.lineTo(sx(i), sy(v)) : ctx.moveTo(sx(i), sy(v))));
    ctx.strokeStyle = tema.barra; ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    // série longa (diária, por exemplo): sem bolinha em cada ponto, que vira borrão
    if (n <= 14) val.forEach((v, i) => { ctx.beginPath(); ctx.arc(sx(i), sy(v), 6, 0, Math.PI * 2); ctx.fillStyle = tema.cartao; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = tema.barra; ctx.stroke(); });
    // tendência: tracejado do primeiro ao último ponto
    if (el.tendencia) {
      ctx.save(); ctx.setLineDash([14, 12]); ctx.strokeStyle = tema.fraco; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(sx(0), sy(val[0])); ctx.lineTo(sx(n - 1), sy(val[n - 1])); ctx.stroke(); ctx.restore();
    }
    // começo e fim em destaque (bolha amarela com o valor): quem só bate o olho entende a história
    if (el.inicioFim) {
      for (const i of [0, n - 1]) {
        const px = sx(i), py = sy(val[i]), txt = fmt(val[i], el);
        ctx.font = fonteDe(28, 800);
        const r = Math.max(46, ctx.measureText(txt).width / 2 + 16);
        const cx = Math.min(Math.max(px, a.x + r), a.x + a.w - r);
        let cy = py - r - 22;
        if (cy - r < a.y - 30) cy = py + r + 22;            // sem espaço em cima: a bolha vai para baixo
        ctx.strokeStyle = tema.texto; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx, cy + (cy > py ? -r : r)); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = tema.marca; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = tema.texto; ctx.stroke();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = tema.texto; ctx.fillText(txt, cx, cy + 1);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fillStyle = tema.texto; ctx.fill();
      }
    }
    // eixo X
    ctx.textBaseline = 'alphabetic'; ctx.font = fonteDe(20, 600); ctx.fillStyle = tema.fraco; ctx.textAlign = 'center';
    rot.forEach((r, i) => ctx.fillText(r, sx(i), a.y + a.h));
    ctx.textAlign = 'left';
    // anotações
    for (const an of el.anotacoes || []) {
      const px = sx(an.i), py = sy(val[an.i]);
      ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.fillStyle = tema.barra; ctx.fill();
      const linhas = String(an.texto).split('\n');
      const acima = (an.lado || 'acima') === 'acima';
      ctx.textAlign = an.alinhar === 'dir' ? 'right' : an.alinhar === 'esq' ? 'left' : 'center';
      const ax = an.alinhar === 'dir' ? px + 8 : an.alinhar === 'esq' ? px - 8 : px;
      linhas.forEach((t, k) => {
        const off = acima ? -24 - (linhas.length - 1 - k) * 28 : 40 + k * 28;
        ctx.font = fonteDe(k === 0 ? 24 : 20, k === 0 ? 800 : 600);
        ctx.fillStyle = k === 0 ? tema.texto : tema.suave;
        ctx.fillText(t, ax, py + off);
      });
      ctx.textAlign = 'left';
    }
  }

  // Linha do tempo vertical.
  TIPOS.linha_tempo = {
    _lay(ctx, el) {
      const pad = 44, w = el.w ?? LARG_UTIL, col = 150, inner = w - 2 * pad - col;
      const marcos = (el.marcos || []).map((m) => {
        const dt = diagramarTexto(ctx, m.titulo, { tam: 30, peso: 800, pesoDestaque: 800, w: inner, lh: 1.25 });
        const dx = m.texto ? diagramarTexto(ctx, m.texto, { tam: 25, peso: 500, pesoDestaque: 700, w: inner, lh: 1.36 }) : null;
        return { m, dt, dx, h: dt.altura + (dx ? 8 + dx.altura : 0) };
      });
      const gap = 34, hT = el.titulo ? 32 * 1.3 + 22 : 0, hF = el.fonte ? 40 : 0;
      const h = pad * 2 + hT + marcos.reduce((a, m) => a + m.h, 0) + gap * Math.max(0, marcos.length - 1) + hF;
      return { pad, w, col, inner, marcos, gap, hT, hF, h };
    },
    medir(ctx, el) { return this._lay(ctx, el).h; },
    desenhar(ctx, el, tema) {
      const L = this._lay(ctx, el), x = el.x ?? MARGEM;
      cartao(ctx, x, el.y, L.w, L.h, tema);
      let cy = el.y + L.pad;
      ctx.textBaseline = 'alphabetic';
      if (el.titulo) { ctx.font = fonteDe(32, 800); ctx.fillStyle = tema.texto; ctx.fillText(el.titulo, x + L.pad, cy + 30); cy += L.hT; }
      const xl = x + L.pad + 112;
      const pts = [];
      L.marcos.forEach((r, i) => {
        if (i) cy += L.gap;
        pts.push(cy + 20);
        ctx.font = fonteDe(30, 800); ctx.fillStyle = r.m.destaque ? tema.texto : tema.suave;
        ctx.fillText(r.m.ano, x + L.pad, cy + 31);
        desenharTexto(ctx, r.dt, { x: x + L.pad + L.col, y: cy, w: L.inner, tam: 30, lh: 1.25, peso: 800, pesoDestaque: 800, cor: r.m.destaque ? tema.texto : undefined }, tema);
        if (r.dx) desenharTexto(ctx, r.dx, { x: x + L.pad + L.col, y: cy + r.dt.altura + 8, w: L.inner, tam: 25, lh: 1.36, peso: 500, pesoDestaque: 700, cor: tema.suave }, tema);
        cy += r.h;
      });
      ctx.strokeStyle = tema.borda; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(xl, pts[0]); ctx.lineTo(xl, pts[pts.length - 1]); ctx.stroke();
      L.marcos.forEach((r, i) => {
        ctx.beginPath(); ctx.arc(xl, pts[i], r.m.destaque ? 11 : 8, 0, Math.PI * 2);
        ctx.fillStyle = r.m.destaque ? tema.barra : tema.cartao; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = r.m.destaque ? tema.barra : tema.barraSec; ctx.stroke();
      });
      if (el.fonte) { ctx.font = fonteDe(19, 500); ctx.fillStyle = tema.fraco; ctx.fillText(el.fonte, x + L.pad, el.y + L.h - L.pad + 6); }
    },
  };

  // Lista de conceitos/afirmações lado a lado com um sinal (≠, vs, →).
  TIPOS.comparacao = {
    _lay(ctx, el) {
      const pad = 40, w = el.w ?? LARG_UTIL, inner = w - 2 * pad;
      const itens = (el.itens || []).map((it) => {
        const dt = diagramarTexto(ctx, it.titulo, { tam: 33, peso: 800, pesoDestaque: 800, w: inner, lh: 1.24 });
        const dx = it.texto ? diagramarTexto(ctx, it.texto, { tam: 27, peso: 500, pesoDestaque: 700, w: inner, lh: 1.36 }) : null;
        return { it, dt, dx, h: pad * 2 - 12 + dt.altura + (dx ? 10 + dx.altura : 0) };
      });
      // sinal: '' empilha os cartões sem sinal entre eles (lista de 3–4 itens)
      const gapSinal = el.gapSinal ?? (el.sinal === '' ? 18 : 54);
      const h = itens.reduce((a, i) => a + i.h, 0) + gapSinal * Math.max(0, itens.length - 1);
      return { pad, w, inner, itens, gapSinal, h };
    },
    medir(ctx, el) { return this._lay(ctx, el).h; },
    desenhar(ctx, el, tema) {
      const L = this._lay(ctx, el), x = el.x ?? MARGEM;
      let cy = el.y;
      L.itens.forEach((r, i) => {
        if (i) {
          if (el.sinal !== '') {
            ctx.font = fonteDe(44, 800); ctx.fillStyle = tema.texto; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(el.sinal || '≠', x + L.w / 2, cy + L.gapSinal / 2 + 2);
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          }
          cy += L.gapSinal;
        }
        cartao(ctx, x, cy, L.w, r.h, tema, { raio: 24, fundo: r.it.destaque ? tema.texto : undefined });
        desenharTexto(ctx, r.dt, { x: x + L.pad, y: cy + L.pad - 6, w: L.inner, tam: 33, lh: 1.24, peso: 800, pesoDestaque: 800, cor: r.it.destaque ? tema.fundo : undefined }, tema);
        if (r.dx) desenharTexto(ctx, r.dx, { x: x + L.pad, y: cy + L.pad - 6 + r.dt.altura + 10, w: L.inner, tam: 27, lh: 1.36, peso: 500, pesoDestaque: 700, cor: r.it.destaque ? tema.barraSec : tema.suave }, tema);
        cy += r.h;
      });
    },
  };

  // Tabela de dados (ex.: fluxo por investidor: dia, mês, ano). Com cores: true,
  // positivo em verde e negativo em vermelho, em pílulas discretas.
  TIPOS.tabela = {
    _lay(ctx, el) {
      const pad = 44, w = el.w ?? LARG_UTIL;
      let hT = 0;
      if (el.titulo) hT += diagramarTexto(ctx, el.titulo, { tam: 32, peso: 800, pesoDestaque: 800, w: w - 2 * pad, lh: 1.22 }).altura + 4;
      if (el.subtitulo) hT += 24 * 1.4 + 6;
      const nCol = (el.colunas || []).length, linhaH = el.alturaLinha ?? 76;
      const hCab = nCol ? 50 : 0, hF = el.fonte ? 44 : 0;
      const h = pad * 2 + hT + (hT ? 18 : 0) + hCab + (el.linhas || []).length * linhaH + hF - 8;
      return { pad, w, hT, nCol, linhaH, hCab, hF, h };
    },
    medir(ctx, el) { return this._lay(ctx, el).h; },
    desenhar(ctx, el, tema) {
      const L = this._lay(ctx, el), x = el.x ?? MARGEM, y = el.y;
      cartao(ctx, x, y, L.w, L.h, tema);
      let cy = y + L.pad;
      ctx.textBaseline = 'alphabetic';
      if (el.titulo) {
        const d = diagramarTexto(ctx, el.titulo, { tam: 32, peso: 800, pesoDestaque: 800, w: L.w - 2 * L.pad, lh: 1.22 });
        desenharTexto(ctx, d, { x: x + L.pad, y: cy, w: L.w - 2 * L.pad, tam: 32, lh: 1.22, peso: 800, pesoDestaque: 800 }, tema);
        cy += d.altura + 4;
      }
      if (el.subtitulo) { ctx.font = fonteDe(23, 500); ctx.fillStyle = tema.fraco; ctx.fillText(el.subtitulo, x + L.pad, cy + 24); cy += 24 * 1.4 + 6; }
      if (L.hT) cy += 18;
      const colW = el.larguraColuna ?? 170, gapCol = 12;
      const colX = (k) => x + L.w - L.pad - (L.nCol - k) * colW - (L.nCol - 1 - k) * gapCol;
      if (L.nCol) {
        ctx.font = fonteDe(20, 700); ctx.fillStyle = tema.fraco; ctx.textAlign = 'center';
        el.colunas.forEach((c, k) => ctx.fillText(String(c).toUpperCase(), colX(k) + colW / 2, cy + 28));
        ctx.textAlign = 'left';
        cy += L.hCab;
      }
      (el.linhas || []).forEach((ln, i) => {
        if (i) { ctx.fillStyle = tema.linha; ctx.fillRect(x + L.pad, cy, L.w - 2 * L.pad, 2); }
        const meio = cy + L.linhaH / 2;
        const dest = (el.destaques || []).includes(i);
        ctx.textBaseline = 'middle';
        ctx.font = fonteDe(27, dest ? 800 : 700); ctx.fillStyle = tema.texto;
        ctx.fillText(ln.rotulo, x + L.pad, meio + 1);
        (ln.valores || []).forEach((v, k) => {
          const num = typeof v === 'number';
          const txt = num ? fmt(v, el) : String(v);
          const cx = colX(k);
          if (el.cores && num && v !== 0) {
            retRedondo(ctx, cx, meio - 23, colW, 46, 10);
            ctx.fillStyle = v > 0 ? tema.fundoPos : tema.fundoNeg; ctx.fill();
          }
          ctx.font = fonteDe(26, 800);
          ctx.fillStyle = el.cores && num && v !== 0 ? (v > 0 ? tema.positivo : tema.negativo) : tema.texto;
          ctx.textAlign = 'center'; ctx.fillText(txt, cx + colW / 2, meio + 1); ctx.textAlign = 'left';
        });
        ctx.textBaseline = 'alphabetic';
        cy += L.linhaH;
      });
      if (el.fonte) { ctx.font = fonteDe(19, 500); ctx.fillStyle = tema.fraco; ctx.fillText(el.fonte, x + L.pad, y + L.h - L.pad + 6); }
    },
  };

  // Número em destaque, para capas: valor gigante, rótulo e contexto.
  TIPOS.numero = {
    _lay(ctx, el) {
      const w = el.w ?? LARG_UTIL, tamV = el.tamValor ?? 132;
      const dv = diagramarTexto(ctx, el.valor, { tam: tamV, peso: 800, pesoDestaque: 800, w, lh: 1.05 });
      const dr = el.rotulo ? diagramarTexto(ctx, el.rotulo, { tam: el.tamRotulo ?? 36, peso: 700, pesoDestaque: 800, w, lh: 1.3 }) : null;
      const dc = el.contexto ? diagramarTexto(ctx, el.contexto, { tam: 26, peso: 500, pesoDestaque: 700, w, lh: 1.4 }) : null;
      const h = dv.altura + (dr ? 18 + dr.altura : 0) + (dc ? 14 + dc.altura : 0);
      return { w, tamV, dv, dr, dc, h };
    },
    medir(ctx, el) { return this._lay(ctx, el).h; },
    desenhar(ctx, el, tema) {
      const L = this._lay(ctx, el), x = el.x ?? MARGEM;
      let cy = el.y;
      desenharTexto(ctx, L.dv, { x, y: cy, w: L.w, tam: L.tamV, lh: 1.05, peso: 800, pesoDestaque: 800, alinhar: el.alinhar }, tema);
      cy += L.dv.altura;
      if (L.dr) { cy += 18; desenharTexto(ctx, L.dr, { x, y: cy, w: L.w, tam: el.tamRotulo ?? 36, lh: 1.3, peso: 700, pesoDestaque: 800, alinhar: el.alinhar }, tema); cy += L.dr.altura; }
      if (L.dc) { cy += 14; desenharTexto(ctx, L.dc, { x, y: cy, w: L.w, tam: 26, lh: 1.4, peso: 500, pesoDestaque: 700, alinhar: el.alinhar, cor: tema.suave }, tema); }
    },
  };

  // Vídeo comentado: o quadro atual do <video> (el._quadro) desenhado na caixa.
  // Sem vídeo escolhido, mostra um marcador. h: 'resto' ocupa até o rodapé.
  TIPOS.video = {
    // Caixa disponível (até o rodapé) e caixa real: quando o vídeo já está
    // carregado, a caixa toma o formato dele (sem faixas pretas) e centraliza.
    _caixa(el) {
      const x0 = el.x ?? MARGEM, wMax = el.w ?? LARG_UTIL;
      // 'resto' deixa 160 px embaixo para a legenda da fala (o corte põe a legenda abaixo do vídeo,
      // fora da tarja da TV e acima da faixa que o Instagram cobre)
      const hMax = (el.h === 'resto' || el.h === undefined)
        ? Math.max(320, (el._limite ?? LIMITE_INFERIOR) - el.y - (el.credito ? 40 : 0) - (el.reservaLegenda ?? 160)) : el.h;
      const v = el._quadro;
      if (!v || !v.videoWidth || el.ajuste === 'cobrir') return { x: x0, w: wMax, h: hMax };
      const ar = v.videoWidth / v.videoHeight;
      if (wMax / ar <= hMax) return { x: x0, w: wMax, h: Math.round(wMax / ar) };
      const w = Math.round(hMax * ar);
      return { x: x0 + Math.round((wMax - w) / 2), w, h: hMax };
    },
    medir(ctx, el) { return this._caixa(el).h + (el.credito ? 40 : 0); },
    desenhar(ctx, el, tema) {
      const c = this._caixa(el), r = el.raio ?? 24, v = el._quadro;
      ctx.save();
      retRedondo(ctx, c.x, el.y, c.w, c.h, r); ctx.clip();
      ctx.fillStyle = '#000'; ctx.fillRect(c.x, el.y, c.w, c.h);
      if (v && v.videoWidth) {
        desenharImagemAjustada(ctx, { width: v.videoWidth, height: v.videoHeight, _el: v }, c.x, el.y, c.w, c.h, el.ajuste === 'cobrir' ? 'cobrir' : 'conter', el.foco);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        const cx = c.x + c.w / 2, cy = el.y + c.h / 2;
        ctx.beginPath(); ctx.arc(cx, cy, 54, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#000'; ctx.beginPath();
        ctx.moveTo(cx - 16, cy - 26); ctx.lineTo(cx - 16, cy + 26); ctx.lineTo(cx + 28, cy); ctx.closePath(); ctx.fill();
        ctx.font = fonteDe(24, 600); ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.textAlign = 'center';
        ctx.fillText('o vídeo entra aqui', cx, cy + 100); ctx.textAlign = 'left';
      }
      ctx.restore();
      if (el.credito) {
        ctx.font = fonteDe(20, 500); ctx.fillStyle = tema.fraco; ctx.textBaseline = 'alphabetic';
        ctx.fillText(el.credito, Math.max(c.x, MARGEM), el.y + c.h + 30);
      }
    },
  };

  // ---------- página ----------
  // Elementos com y "auto" são empilhados a partir do topo do conteúdo.
  // Se estourar, aperta primeiro os espaços e depois a fonte (até 4 px a
  // menos, nunca abaixo de 32 px no corpo). Com auto: false, respeita o slide.
  // Página de feed com pouco conteúdo: em vez de centralizar (o nome mudava de lugar de uma página
  // para outra), o texto cresce até ocupar uns 3/4 da área útil. Cabeçalho sempre no mesmo lugar.
  const TEXTO_MAX = 58, PREENCHER_ALVO = 0.78, PREENCHER_SE_MENOS = 0.6;
  function preencher(ctx, slide, lay) {
    if (slide.auto === false || slide.preencher === false || eReels(slide)) return lay;
    const topo = slide.topo ?? TOPO_CONTEUDO, limite = limiteDe(slide), util = limite - topo;
    if (!(slide.elementos || []).some((e) => e.tipo === 'texto' && (e.y === undefined || e.y === 'auto'))) return lay;
    if ((lay.fundo - topo) / util >= PREENCHER_SE_MENOS) return lay;
    let melhor = lay;
    for (const cresce of [3, 6, 9, 12, 15, 18, 21]) {
      const t = empilhar(ctx, slide, 44, 0, cresce);
      if (t.estoura || (t.fundo - topo) / util > PREENCHER_ALVO) break;
      melhor = t;
    }
    return melhor;
  }

  function diagramarSlide(ctx, slide) {
    let lay = empilhar(ctx, slide, slide.espaco ?? 40, 0);
    if (!lay.estoura) return preencher(ctx, slide, lay);
    if (slide.auto === false) return lay;
    for (const gap of [36, 32, 28]) {
      lay = empilhar(ctx, slide, gap, 0);
      if (!lay.estoura) return lay;
    }
    for (let reduz = 1; reduz <= 4; reduz++) {
      lay = empilhar(ctx, slide, 28, reduz);
      if (!lay.estoura) return lay;
    }
    return lay;
  }

  function empilhar(ctx, slide, gap, reduz, cresce = 0) {
    let cy = slide.topo ?? TOPO_CONTEUDO;
    const out = [];
    (slide.elementos || []).forEach((el, idx) => {
      const e = { ...el, _idx: idx };
      const tipo = TIPOS[e.tipo];
      if (!tipo) return;
      // encolhe também o texto sem tamanho definido (padrão 37) e nunca aumenta o que já é pequeno
      if (reduz && (e.tam || e.tipo === 'texto')) {
        const base = e.tam ?? 37, piso = e.tipo === 'texto' ? 32 : 26;
        e.tam = Math.max(Math.min(base, piso), base - reduz);
      }
      if (reduz && e.tipo === 'comparacao' && e.sinal !== '') e.gapSinal = Math.max(44, (e.gapSinal ?? 54) - reduz * 3);
      if (cresce && e.tipo === 'texto') { const base = e.tam ?? 37; e.tam = Math.max(base, Math.min(TEXTO_MAX, base + cresce)); }
      e._auto = e.y === undefined || e.y === 'auto';
      e._limite = limiteDe(slide);
      if (e._auto) { e.y = cy + (e.antes ?? 0); }
      e._h = tipo.medir(ctx, e);
      cy = Math.max(cy, e.y + e._h + gap);
      out.push(e);
    });
    let fundo = out.reduce((a, e) => Math.max(a, e.y + e._h), 0);
    // Centralizar: só em tela em pé (story/Reels, uma tela só). O bloco inteiro (cabeçalho + texto) desce
    // junto. No feed não: o nome tem de ficar no mesmo lugar em todas as páginas do carrossel.
    const limite = limiteDe(slide);
    let desloc = 0;
    if (slide.centralizar && eReels(slide) && fundo < limite) {
      desloc = Math.round((limite - fundo) / 2);
      out.forEach((e) => { if (e._auto) e.y += desloc; });
      fundo += desloc;
    }
    return { elementos: out, fundo, estoura: fundo > limite, cabecalhoDy: desloc };
  }

  function desenharSlide(ctx, slide, opts = {}) {
    const tema = TEMAS[slide.tema] || TEMAS.claro;
    ctx.save();
    const AH = alturaDe(slide);
    ctx.clearRect(0, 0, W, AH);
    ctx.fillStyle = tema.fundo; ctx.fillRect(0, 0, W, AH);
    const dy = deslocamentoDe(slide);
    ctx.save();
    ctx.translate(0, dy);
    const lay = diagramarSlide(ctx, slide);
    ctx.save(); ctx.translate(0, lay.cabecalhoDy || 0); desenharCabecalho(ctx, tema); ctx.restore();
    for (const e of lay.elementos) TIPOS[e.tipo].desenhar(ctx, e, tema);
    if (slide.fonte) {
      ctx.textBaseline = 'alphabetic'; ctx.font = fonteDe(20, 500); ctx.fillStyle = tema.fraco;
      const d = diagramarTexto(ctx, slide.fonte, { tam: 20, peso: 500, pesoDestaque: 700, w: LARG_UTIL, lh: 1.35 });
      const base = eReels(slide) ? limiteDe(slide) + 44 : AH - 52;   // Reels: a última linha termina antes da faixa coberta
      desenharTexto(ctx, d, { x: MARGEM, y: base - d.altura + 20 * 1.35, w: LARG_UTIL, tam: 20, lh: 1.35, peso: 500, pesoDestaque: 700, cor: tema.fraco }, tema);
    }
    ctx.restore();
    lay.deslocamento = dy;
    if (opts.numerar) {
      ctx.font = fonteDe(22, 700); ctx.fillStyle = tema.fraco; ctx.textAlign = 'right';
      ctx.fillText(opts.numerar, W - 64, 196); ctx.textAlign = 'left';
    }
    ctx.restore();
    return lay;
  }

  async function renderizarParaCanvas(slide, canvas, opts) {
    await carregarFontes();
    await preCarregar([slide]);
    canvas.width = W; canvas.height = alturaDe(slide);
    return desenharSlide(canvas.getContext('2d'), slide, opts);
  }

  function canvasParaBlob(canvas) {
    return new Promise((ok, erro) => {
      try {
        canvas.toBlob((b) => (b ? ok(b) : erro(new Error('sem memória para gerar a imagem'))), 'image/png');
      } catch (e) { erro(e); }
    });
  }

  // Texto da página para leitor de tela (o canvas em si é só desenho).
  function textoDoSlide(slide) {
    const limpo = (t) => String(t || '').replace(/\*\*|==/g, '').replace(/\s+/g, ' ').trim();
    const partes = [];
    for (const e of (slide && slide.elementos) || []) {
      if (e.tipo === 'texto') partes.push(limpo(e.texto));
      else if (e.tipo === 'noticia') partes.push(`Notícia, ${limpo(e.veiculo)}: ${limpo(e.manchete)}. ${limpo(e.linhaFina)}`);
      else if (e.tipo === 'manchetes') (e.itens || []).forEach((m) => partes.push(`${limpo(m.veiculo)}: ${limpo(m.manchete)}`));
      else if (e.tipo === 'citacao') partes.push(`${(e.citacoes || []).map(limpo).join(' ')} (${limpo(e.autor)})`);
      else if (e.tipo === 'numero') partes.push(`${limpo(e.valor)} ${limpo(e.rotulo)}. ${limpo(e.contexto)}`);
      else if (e.tipo === 'grafico') partes.push(`Gráfico: ${limpo(e.titulo)}. ` + (e.rotulos || []).map((r, i) => `${limpo(r)}: ${(e.valores || [])[i]}`).join('; '));
      else if (e.tipo === 'comparacao') (e.itens || []).forEach((i) => partes.push(`${limpo(i.titulo)}: ${limpo(i.texto)}`));
      else if (e.tipo === 'linha_tempo') (e.marcos || []).forEach((m) => partes.push(`${limpo(m.ano)}: ${limpo(m.titulo)}`));
      else if (e.tipo === 'tabela') partes.push(`Tabela: ${limpo(e.titulo)}`);
      else if (e.tipo === 'video') partes.push('Vídeo');
    }
    return partes.filter(Boolean).join(' · ').slice(0, 900);
  }

  global.KSRender = { W, H, alturaDe, deslocamentoDe, limiteDe, TEMAS, CAB, MARGEM, LARG_UTIL, TOPO_CONTEUDO, LIMITE_INFERIOR, TIPOS,
    carregarFontes, preCarregar, desenharSlide, diagramarSlide, renderizarParaCanvas, canvasParaBlob, diagramarTexto, textoDoSlide };
})(window);
