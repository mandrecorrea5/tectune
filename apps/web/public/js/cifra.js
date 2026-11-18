// Prévia em HTML e geração do PDF (web). A lógica da cifra vem do núcleo compartilhado.
import { songCols, norm, esc, parseSong, wrapRows, rowHasTop, chordParts, isRest, REST_PTS, barLines, rowIsTall, sectionLengths, COVER_LAYOUTS, COVER_STEPS, coverOpts, viewOf, staffBarWidth, flowStaff, buildTimeline, lyricEvents, voiceLines } from '/core/index.js';
export { norm, esc, parseSong, transposeText, validateSong, meterOf, layoutBar, isRest, viewOf } from '/core/index.js';

const REST_SVG = `<svg viewBox="0 0 12 28" aria-label="pausa"><polyline points="${REST_PTS.map(p => p.map(v => +v.toFixed(2)).join(',')).join(' ')}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ---------------- prévia HTML ---------------- */
function tokenHTML(t) {
  if (t === '%') return '<span class="sim">%</span>';
  if (t === '/' || t === '.') return '<span class="beat">/</span>';
  if (t === '_') return '';
  if (isRest(t)) return `<span class="rest" title="pausa">${REST_SVG}</span>`;
  const p = chordParts(t);
  if (!p) return `<span class="txt">${esc(t)}</span>`;
  return '<span class="ch">' + p.map(x => x.k === 'root' ? esc(x.s) : `<span class="${x.k}">${esc(x.s)}</span>`).join('') + '</span>';
}
// linha com algo em cima (casa, anotação, entrada da voz) ou embaixo (letra)
const rowTop = row => rowHasTop(row) || row.some(b => b.voice);
// quantas linhas de letra a linha da grade precisa embaixo (uma por passada, se houver)
const rowLyr = row => Math.max(0, ...row.map(b => voiceLines(b.voice).length));
function barHTML(b, pauta, pos = {}) {
  const L = b.layout;
  const cls = ['bar']; if (b.start) cls.push('rs'); if (b.end) cls.push('re');
  if (pos.first) cls.push('first'); if (pos.secEnd) cls.push(pos.fin ? 'fin' : 'secend');
  if (L.error || b.mel?.error) cls.push('err'); else if (L.warn && !b.melody) cls.push('warn');
  let above = '';
  if (b.passes || b.note || b.voice) above = `<div class="above${b.passes ? ' e' : ''}${b.endingCont ? ' c' : ''}">${b.ending ? `<span class="en">${b.ending}.</span>` : ''}${b.voice ? '<span class="vz">VOZ</span>' : ''}${b.note ? `<span class="bn">${esc(b.note)}</span>` : ''}</div>`;
  const rt = (b.end && b.times) ? `<span class="rt">${b.times}x</span>` : '';
  let beats = '';
  if (L.spans.length) {
    const multi = L.spans.length > 1 || L.error;
    // mais de 2 acordes → duas linhas (metade dos tempos em cada); na pauta fica tudo numa linha só
    const lines = pauta ? [{ grid: L.grid, spans: L.spans }] : barLines(L);
    beats = lines.map((ln, li) => {
      const starts = new Set(ln.spans.map(s => s.start));
      return `<div class="beats${multi ? ' multi' : ''}${li ? ' l2' : ''}" style="--g:${ln.grid}">`
        + ln.spans.map((sp, i) => `<div class="slot${i ? ' sep' : ''}" data-len="${sp.len}" style="grid-column:${sp.start + 1} / span ${sp.len}">${tokenHTML(sp.tok)}</div>`).join('')
        + (multi ? `<div class="ticks">${Array.from({ length: ln.grid }, (_, i) => `<i${starts.has(i) ? ' class="on"' : ''}></i>`).join('')}</div>` : '')
        + '</div>';
    }).join('');
    if (lines.length > 1) beats = `<div class="stack">${beats}</div>`;
  }
  const msg = b.mel?.error || L.error || (b.melody ? '' : L.warn);
  const tip = msg ? ` title="${esc(msg)}"` : b.melody ? ` title="Frase: ${esc(b.melody)}"` : '';
  const flag = L.error || b.mel?.error ? '<span class="flag">!</span>' : '';
  const mel = b.melody ? '<span class="mel" aria-label="frase com notas">♪</span>' : '';
  const ll = voiceLines(b.voice);
  const lyr = ll.length ? `<div class="lyr">${ll.map(esc).join('<br>')}</div>` : '';
  return `<div class="${cls.join(' ')}"${tip} data-line="${b.line}" data-id="${b.id}" data-g="${L.grid}"${pauta ? ` data-w="${staffBarWidth(b).toFixed(2)}"` : ''}>${above}${rt}${flag}${mel}${beats}${lyr}</div>`;
}
/**
 * Visão do cantor (modo Show): só a letra, na ordem em que a música é tocada.
 * Cada linha/seção leva data-k = passo do roteiro em que começa (o player destaca e rola).
 */
export function lyricsHTML(text) {
  const song = parseSong(text); const m = song.meta;
  const ev = lyricEvents(song, buildTimeline(song));
  let h = `<div class="ph"><div><h1>${esc(m.title || 'Sem título')}</h1>${m.artist ? `<div class="artist">${esc(m.artist)}</div>` : ''}</div>
    <div class="metas">${m.bpm ? `<div class="meta"><span>BPM</span><b>${esc(m.bpm)}</b></div>` : ''}</div></div>`;
  if (!ev.some(e => e.kind === 'line')) {
    return h + `<div class="lyempty"><b>Esta música ainda não tem letra.</b><p>No editor, escreva a letra embaixo de cada seção, uma linha por vez:</p>
      <pre>voz: primeira linha da letra\nvoz: segunda linha\nvoz 5: linha que entra no compasso 5</pre></div>`;
  }
  if (!ev.some(e => e.kind === 'line' && e.text)) h += '<p class="lyhint">Só as entradas da voz estão marcadas — a letra ainda não foi escrita.</p>';
  h += '<div class="lyrics">';
  for (const e of ev) {
    if (e.kind === 'sec') h += `<div class="ly lysec" data-k="${e.k}"><span class="pill">${esc((e.name || 'Seção').toUpperCase())}</span>${e.lines ? '' : `<span class="lyinst">instrumental · ${e.bars} ${e.bars === 1 ? 'compasso' : 'compassos'}</span>`}</div>`;
    else h += `<div class="ly lyline${e.text ? '' : ' cue'}" data-k="${e.k}">${e.text ? esc(e.text) : '♪ entra a voz'}</div>`;
  }
  return h + '</div>';
}

export function sheetHTML(text, cols, maxCols = 8) {
  const song = parseSong(text); const m = song.meta;
  // compassos por linha: da música (o do show só vale para músicas antigas); tela estreita limita (celular: 4)
  cols = Math.min(songCols(song, cols), maxCols);
  const timeLabel = m.time ? (song.meter.invalid ? m.time : song.meter.label) : null;
  const metas = [['TOM', m.key], ['BPM', m.bpm], ['COMPASSO', timeLabel], ['CAPO', m.capo]].filter(x => x[1]);
  let h = `<div class="ph"><div><h1>${esc(m.title || 'Sem título')}</h1>${m.artist ? `<div class="artist">${esc(m.artist)}</div>` : ''}</div>
    <div class="metas">${metas.map(x => `<div class="meta"><span>${x[0]}</span><b>${esc(x[1])}</b></div>`).join('')}</div></div>`;
  if (m.notes) h += `<div class="gnotes">${esc(m.notes)}</div>`;
  if (!song.sections.length) h += `<div class="empty">Esta música ainda não tem nenhuma seção.</div>`;
  const pauta = viewOf(song) === 'pauta';
  h += `<div class="body${pauta ? ' pauta' : ''}">`;
  const lens = sectionLengths(song);
  const lastSec = song.sections.reduce((k, s, i) => (s.rows.length ? i : k), -1);
  song.sections.forEach((s, si) => {
    h += '<div class="sec">';
    const len = lens[si];
    if (s.name || s.times || len) h += `<div class="sec-h">${s.name ? `<span class="pill">${esc(s.name)}</span>` : ''}${s.times ? `<span class="sx">${s.times}x</span>` : ''}${len ? `<span class="slen">${len} ${len === 1 ? 'compasso' : 'compassos'}</span>` : ''}</div>`;
    if (s.notes.length) h += `<div class="sec-notes">${esc(s.notes.join(' · '))}</div>`;
    if (pauta) {
      // pauta: sem "compassos por linha" — os compassos correm em sequência e a largura de cada um
      // é ajustada na tela (layoutStaff) para todas as cifras ficarem no mesmo tamanho
      const bars = s.rows.flat();
      const nl = rowLyr(bars);
      h += `<div class="srow${bars.some(b => b.passes || b.note || b.voice) ? ' withtop' : ''}${nl ? ' withlyr' : ''}" style="--lyn:${nl || 1}">`
        + bars.map((b, bi) => barHTML(b, true, { secEnd: bi === bars.length - 1, fin: si === lastSec })).join('') + '</div></div>';
      return;
    }
    const rows = wrapRows(s.rows, cols);
    rows.forEach((row, ri) => {
      const lastRow = ri === rows.length - 1;
      const nl = rowLyr(row);
      h += `<div class="row${rowTop(row) ? ' withtop' : ''}${!pauta && rowIsTall(row) ? ' tall' : ''}${nl ? ' withlyr' : ''}" style="--cols:${cols};--lyn:${nl || 1}">`
        + row.map((b, bi) => barHTML(b, pauta, { first: bi === 0, secEnd: lastRow && bi === row.length - 1, fin: si === lastSec })).join('') + '</div>';
    });
    h += '</div>';
  });
  return h + '</div>';
}

/* ---------------- PDF ---------------- */
// Todas as medidas em mm. `s` = escala do conteúdo da música (1 = 100%).
const PW = 210, PH = 297, M = 14, CW = PW - 2 * M;
const LYR_LH = 3.9; // mm entre linhas de letra (uma por passada)
const INK = [28, 25, 23], MUTED = [120, 113, 108], ACC = [194, 65, 12];
function fit(doc, txt, size, maxW) { doc.setFontSize(size); const w = doc.getTextWidth(String(txt)); return w > maxW ? size * maxW / w : size; }
const SIZES = { root: [16, 0], acc: [10, 2.5], mi: [13, 0], q: [9.5, 2.8], bs: [12, 0] };
const TALL = 1.75; // altura da linha da grade quando algum compasso está em duas linhas

// largura natural do acorde (sem reduzir), para usar o mesmo tamanho em todo o compasso
function natWidth(doc, t, s) {
  if (t === '%' || t === '/' || t === '.' || t === '_') return 0;
  if (isRest(t)) return 3.2 * s;
  const parts = chordParts(t); doc.setFont('helvetica', 'bold');
  if (!parts) { doc.setFontSize(11 * s); return doc.getTextWidth(t); }
  let w = 0; parts.forEach(p => { doc.setFontSize(SIZES[p.k][0] * s); w += doc.getTextWidth(p.s); }); return w;
}

function drawToken(doc, t, cx, cy, maxW, s, fixedK) {
  doc.setTextColor(...INK);
  if (t === '_') return;
  if (t === '%') { doc.setFont('helvetica', 'bold'); doc.setFontSize(18 * s); doc.setTextColor(168, 162, 158); doc.text('%', cx, cy + 2.3 * s, { align: 'center' }); return; }
  if (t === '/' || t === '.') { doc.setFont('helvetica', 'normal'); doc.setFontSize(16 * s); doc.setTextColor(181, 174, 165); doc.text('/', cx, cy + 2.1 * s, { align: 'center' }); return; }
  if (isRest(t)) {
    const hgt = 6.6 * s * Math.min(1, fixedK ?? 1), f = hgt / 28;
    const x0 = cx - 6 * f, y0 = cy - hgt / 2 + 0.3 * s;
    doc.setDrawColor(...INK); doc.setLineWidth(2.6 * f); doc.setLineCap('round'); doc.setLineJoin('round');
    for (let i = 1; i < REST_PTS.length; i++) {
      const [a, b] = REST_PTS[i - 1], [c2, d] = REST_PTS[i];
      doc.line(x0 + a * f, y0 + b * f, x0 + c2 * f, y0 + d * f);
    }
    doc.setLineCap('butt'); doc.setLineJoin('miter');
    return;
  }
  const parts = chordParts(t);
  if (!parts) { doc.setFont('helvetica', 'bold'); doc.setFontSize(fixedK ? 11 * s * fixedK : fit(doc, t, 11 * s, maxW)); doc.text(t, cx, cy + 1.5 * s, { align: 'center' }); return; }
  doc.setFont('helvetica', 'bold');
  let total = 0;
  parts.forEach(p => { doc.setFontSize(SIZES[p.k][0] * s); p.w = doc.getTextWidth(p.s); total += p.w; });
  const sc = (fixedK ?? Math.min(1, maxW / total)) * s;   // escala final dos acordes
  const k = sc / s;                            // fator de largura já aplicado
  let x = cx - total * k / 2; const base = cy + 2.1 * Math.max(sc, .75 * s);
  parts.forEach(p => { const [sz, raise] = SIZES[p.k]; doc.setFontSize(sz * sc); doc.text(p.s, x, base - raise * sc); x += p.w * k; });
}

function drawBar(doc, b, x, y, cw, h, s) {
  const bx = x + 0.7, bw = cw - 1.4, L = b.layout;
  if (L.error) { doc.setFillColor(254, 242, 242); doc.setDrawColor(220, 38, 38); doc.setLineWidth(0.6); }
  else { doc.setFillColor(247, 245, 241); doc.setDrawColor(206, 199, 189); doc.setLineWidth(0.25); }
  doc.roundedRect(bx, y, bw, h, 1.3 * s, 1.3 * s, 'FD');
  let inL = bx + 1.5, inR = bx + bw - 1.5;
  // barras de repetição proporcionais ao tamanho (não "engordam" quando a fonte diminui)
  const k2 = Math.max(0.55, s), dot = 1.6 * s, pad = 1.5 * s, r = 0.55 * Math.min(1, s * 1.25);
  doc.setFillColor(...INK);
  if (b.start) { doc.rect(bx + 1.1 * k2, y + pad, 0.9 * k2, h - 2 * pad, 'F'); doc.circle(bx + 3.2 * k2, y + h / 2 - dot, r, 'F'); doc.circle(bx + 3.2 * k2, y + h / 2 + dot, r, 'F'); inL = bx + 4.4 * k2; }
  if (b.end) {
    doc.rect(bx + bw - 2 * k2, y + pad, 0.9 * k2, h - 2 * pad, 'F'); doc.circle(bx + bw - 3.2 * k2, y + h / 2 - dot, r, 'F'); doc.circle(bx + bw - 3.2 * k2, y + h / 2 + dot, r, 'F'); inR = bx + bw - 4.4 * k2;
    if (b.times) { doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.max(5, 8 * s)); doc.setTextColor(...ACC); doc.text(b.times + 'x', bx + bw - 0.5, y - 1.1 * s, { align: 'right' }); }
  }
  let nx = bx + 1;
  if (b.passes) { // chave da casa (1. / 2. / 1-3. …); continua sobre os compassos seguintes até o :|
    doc.setDrawColor(...INK); doc.setLineWidth(0.35 * k2);
    const ly = y - 3.8 * s, x1 = bx + bw - (b.end && b.times ? 5 * s : 0);
    if (!b.endingCont) doc.line(bx, y - 0.6 * s, bx, ly);
    doc.line(b.endingCont ? bx - 1.4 : bx, ly, x1, ly);
    if (b.ending) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.max(4.8, 7.5 * s)); doc.setTextColor(...INK); doc.text(b.ending + '.', bx + 1, y - 1.1 * s);
      nx = bx + 1 + doc.getTextWidth(b.ending + '.') + 1.2 * s;
    }
  }
  nx = drawVoice(doc, b, nx, y, s);
  if (b.note) {
    doc.setFont('helvetica', 'italic'); doc.setTextColor(...MUTED);
    const room = bx + bw - nx - (b.end && b.times ? 5 : 0.5);
    doc.setFontSize(Math.max(5, fit(doc, b.note, 7.5 * s, room))); doc.text(b.note, nx, y - 1.1 * s);
  }
  drawLyric(doc, b, bx + 1, y + h, s); drawMelMark(doc, b, bx + 1.2 * s, y + 1.2 * s, s);
  if (!L.spans.length) return;
  // cada acorde ocupa a fração do compasso correspondente aos seus tempos;
  // com mais de 2 acordes o compasso vira duas linhas (metade dos tempos em cada)
  const multi = L.spans.length > 1 || !!L.error;
  const lines = barLines(L), lh = h / lines.length;
  // mesmo tamanho para todos os acordes do compasso: o que precisar encolher mais define
  let k = 1;
  lines.forEach(ln => {
    const u = (inR - inL) / ln.grid;
    ln.spans.forEach(sp => { const nw = natWidth(doc, sp.tok, s); if (nw > 0) k = Math.min(k, (u * sp.len - 1) / nw); });
  });
  const dash = () => { doc.setLineDashPattern([0.7, 0.7], 0); doc.setDrawColor(196, 188, 176); doc.setLineWidth(0.25); };
  lines.forEach((ln, li) => {
    const ly = y + lh * li, unit = (inR - inL) / ln.grid;
    const cy = ly + lh / 2 - (multi ? 0.7 * s : 0);
    if (li > 0) { dash(); doc.line(inL, ly, inR, ly); doc.setLineDashPattern([], 0); }
    ln.spans.forEach((sp, i) => {
      const x0 = inL + unit * sp.start, w = unit * sp.len;
      if (i > 0) { dash(); doc.line(x0, ly + 1.6 * s, x0, ly + lh - 2.6 * s); doc.setLineDashPattern([], 0); }
      drawToken(doc, sp.tok, x0 + w / 2, cy, w - 1, s, k);
    });
    if (multi && s >= 0.45) { // marcadores de tempo (some em tamanhos muito pequenos, para não embolar)
      const starts = new Set(ln.spans.map(sp => sp.start));
      const ty = ly + lh - 1.6 * s, th = Math.max(0.35, 0.55 * s);
      for (let i = 0; i < ln.grid; i++) {
        if (starts.has(i)) doc.setFillColor(150, 143, 136); else doc.setFillColor(226, 220, 211);
        doc.roundedRect(inL + unit * i + 0.5, ty, unit - 1, th, th / 2, th / 2, 'F');
      }
    }
  });
  if (L.error) { doc.setFont('helvetica', 'bold'); doc.setFontSize(7 * s); doc.setTextColor(220, 38, 38); doc.text('!', bx + bw - 1.2, y + 2.6 * s, { align: 'right' }); }
}

// "VOZ" em cima do compasso onde a voz entra; devolve onde o texto seguinte começa
function drawVoice(doc, b, nx, y, s) {
  if (!b.voice) return nx;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.max(4.5, 6.3 * s));
  const w = doc.getTextWidth('VOZ') + 2 * s, hh = Math.max(2.4, 3.2 * s);
  doc.setFillColor(...ACC); doc.roundedRect(nx, y - 1.1 * s - hh + 0.7 * s, w, hh, 0.6, 0.6, 'F');
  doc.setTextColor(255, 255, 255); doc.text('VOZ', nx + 1 * s, y - 1.1 * s);
  return nx + w + 1.2 * s;
}
// letra embaixo do compasso (pode passar por baixo dos compassos seguintes)
function drawLyric(doc, b, x, yBottom, s) {
  const ll = b._lyr || voiceLines(b.voice); if (!ll.length) return; // _lyr = já quebrada na largura (wrapLyrics)
  doc.setFont('helvetica', 'italic'); doc.setFontSize(Math.max(5.5, 9 * s)); doc.setTextColor(...INK);
  ll.forEach((t, i) => doc.text(t, x, yBottom + 3.6 * s + i * LYR_LH * s));
}
// Quebra a letra de cada compasso na largura que ela tem: até o próximo compasso com letra ou o fim
// da linha (não vaza da folha). Guarda em b._lyr e devolve quantas linhas a linha da grade precisa.
function wrapLyrics(doc, row, widths, s, full) {
  doc.setFont('helvetica', 'italic'); doc.setFontSize(Math.max(5.5, 9 * s));
  let n = 0;
  row.forEach((b, i) => {
    const ll = voiceLines(b.voice); b._lyr = null; if (!ll.length) return;
    let w = 0, j = i;
    for (; j < row.length; j++) { if (j > i && voiceLines(row[j].voice).length) break; w += widths[j]; }
    // último trecho da linha: pode usar o espaço livre até a margem da coluna
    if (j === row.length && full) w += Math.max(0, full - widths.reduce((a, x) => a + x, 0));
    b._lyr = ll.flatMap(t => doc.splitTextToSize(t, Math.max(10, w - 3)));
    n = Math.max(n, b._lyr.length);
  });
  return n;
}
// colcheia pequena: o compasso tem uma frase escrita em notas
function drawMelMark(doc, b, x, y, s) {
  if (!b.melody) return;
  const k = Math.max(0.6, s);
  doc.setFillColor(...ACC); doc.setDrawColor(...ACC); doc.setLineWidth(0.3 * k);
  doc.ellipse(x + 0.9 * k, y + 2.6 * k, 0.9 * k, 0.65 * k, 'F');
  doc.line(x + 1.75 * k, y + 2.5 * k, x + 1.75 * k, y); doc.line(x + 1.75 * k, y, x + 2.8 * k, y + 1 * k);
}

// Compasso na pauta: 5 linhas, barras de compasso e de repetição, cifra em destaque sobre as linhas
function drawStaffBar(doc, b, x, y, cw, h, s, pos = {}) {
  const L = b.layout, sp = h / 4, k2 = Math.max(0.55, s);
  const x1 = x + cw;
  if (L.error || b.mel?.error) { doc.setFillColor(254, 242, 242); doc.rect(x, y, cw, h, 'F'); }
  doc.setDrawColor(120, 113, 108); doc.setLineWidth(0.2);
  for (let i = 0; i < 5; i++) doc.line(x, y + i * sp, x1, y + i * sp);
  doc.setDrawColor(...INK); doc.setFillColor(...INK);
  const thin = w => { doc.setLineWidth(0.3); doc.line(w, y, w, y + h); };
  const thick = (w, side) => doc.rect(side < 0 ? w : w - 1 * k2, y, 1 * k2, h, 'F');
  const dots = cx => { const r = 0.5 * Math.min(1.1, k2 * 1.2); doc.circle(cx, y + 1.5 * sp, r, 'F'); doc.circle(cx, y + 2.5 * sp, r, 'F'); };
  let inL = x + 1.2 * s, inR = x1 - 1.2 * s;
  if (b.start) { thick(x, -1); doc.setLineWidth(0.3); doc.line(x + 1.6 * k2, y, x + 1.6 * k2, y + h); dots(x + 2.8 * k2); inL = x + 4 * k2; }
  else if (pos.first) thin(x);
  if (b.end) { thick(x1, 1); doc.setLineWidth(0.3); doc.line(x1 - 1.6 * k2, y, x1 - 1.6 * k2, y + h); dots(x1 - 2.8 * k2); inR = x1 - 4 * k2; }
  else if (pos.secEnd && pos.fin) { thick(x1, 1); doc.setLineWidth(0.3); doc.line(x1 - 1.7 * k2, y, x1 - 1.7 * k2, y + h); inR = x1 - 2.5 * k2; }
  else if (pos.secEnd) { thin(x1); doc.line(x1 - 1 * k2, y, x1 - 1 * k2, y + h); inR = x1 - 1.8 * k2; }
  else thin(x1);
  // em cima: casa, "VOZ", anotação, nº de vezes
  if (b.end && b.times) { doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.max(5, 8 * s)); doc.setTextColor(...ACC); doc.text(b.times + 'x', x1 - 0.3, y - 1.4 * s, { align: 'right' }); }
  let nx = x + 1;
  if (b.passes) {
    doc.setDrawColor(...INK); doc.setLineWidth(0.35 * k2);
    const ly = y - 4.4 * s, xe = x1 - (b.end && b.times ? 5 * s : 0.3);
    if (!b.endingCont) doc.line(x + 0.2, y - 1 * s, x + 0.2, ly);
    doc.line(x + (b.endingCont ? -0.2 : 0.2), ly, xe, ly);
    if (b.ending) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.max(4.8, 7.5 * s)); doc.setTextColor(...INK); doc.text(b.ending + '.', x + 1, y - 1.5 * s);
      nx = x + 1 + doc.getTextWidth(b.ending + '.') + 1.2 * s;
    }
  }
  nx = drawVoice(doc, b, nx, y - 0.4 * s, s);
  if (b.note) {
    doc.setFont('helvetica', 'italic'); doc.setTextColor(...MUTED);
    const room = x1 - nx - (b.end && b.times ? 5 : 0.5);
    doc.setFontSize(Math.max(5, fit(doc, b.note, 7.5 * s, room))); doc.text(b.note, nx, y - 1.5 * s);
  }
  drawLyric(doc, b, x + 1, y + h + 0.6 * s, s);
  drawMelMark(doc, b, x1 - 3.6 * k2, y - 3.6 * k2, s);
  if (!L.spans.length) return;
  // cifras numa linha só, cada uma no centro dos seus tempos, com fundo branco sobre as linhas
  const unit = (inR - inL) / L.grid;
  let k = 1;
  L.spans.forEach(sp2 => { const nw = natWidth(doc, sp2.tok, s); if (nw > 0) k = Math.min(k, (unit * sp2.len - 1) / nw); });
  const cy = y + h / 2 - 0.2 * s;
  L.spans.forEach(sp2 => {
    const x0 = inL + unit * sp2.start, w = unit * sp2.len, cx = x0 + w / 2;
    const nw = natWidth(doc, sp2.tok, s) * k;
    if (nw > 0 && sp2.tok !== '/' && sp2.tok !== '.') {
      doc.setFillColor(255, 255, 255);
      const pad = 0.9 * s, hh = Math.min(h - 0.6, 7.4 * Math.max(k, 0.6) * s);
      doc.rect(cx - nw / 2 - pad, y + h / 2 - hh / 2, nw + 2 * pad, hh, 'F');
    }
    if (sp2.tok === '%') { doc.setFont('helvetica', 'bold'); doc.setFontSize(19 * s); doc.setTextColor(...INK); doc.text('%', cx, cy + 2.3 * s, { align: 'center' }); return; }
    drawToken(doc, sp2.tok, cx, cy, w - 1, s, k);
  });
}

function footer(doc, left, right) {
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
  if (left) doc.text(left, M, PH - 8);
  if (right) doc.text(right, PW - M, PH - 8, { align: 'right' });
}

function drawSong(doc, text, cols, footLeft, footRight, s = 1) {
  const song = parseSong(text);
  cols = songCols(song, cols);
  const m = song.meta; const title = m.title || 'Sem título';
  const hs = 0.55 + 0.45 * s; // o cabeçalho encolhe menos que a grade
  let y = M;
  footer(doc, footLeft, footRight);
  const metas = [['TOM', m.key], ['BPM', m.bpm], ['COMPASSO', m.time && (song.meter.invalid ? m.time : song.meter.label)], ['CAPO', m.capo]].filter(x => x[1]);
  const bw = 19 * hs, bh = 12 * hs, gap = 2;
  const bx0 = PW - M - (metas.length * bw + Math.max(0, metas.length - 1) * gap);
  metas.forEach((mt, i) => {
    const x = bx0 + i * (bw + gap);
    doc.setDrawColor(...INK); doc.setLineWidth(0.4); doc.roundedRect(x, y, bw, bh, 1.5, 1.5, 'S');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.3 * hs); doc.setTextColor(...MUTED); doc.text(mt[0], x + bw / 2, y + 3.8 * hs, { align: 'center' });
    doc.setTextColor(...INK); doc.setFontSize(fit(doc, mt[1], 12.5 * hs, bw - 3)); doc.text(String(mt[1]), x + bw / 2, y + 9.7 * hs, { align: 'center' });
  });
  const tmax = metas.length ? bx0 - M - 4 : CW;
  doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK); doc.setFontSize(fit(doc, title, 22 * hs, tmax)); doc.text(title, M, y + 7.5 * hs);
  let hy = y + 7.5 * hs;
  if (m.artist) { doc.setFont('helvetica', 'normal'); doc.setFontSize(11 * hs); doc.setTextColor(...MUTED); doc.text(m.artist, M, hy + 5.5 * hs); hy += 5.5 * hs; }
  y = Math.max(hy + 3.5 * hs, y + bh + 2.5 * hs);
  doc.setDrawColor(...INK); doc.setLineWidth(0.7); doc.line(M, y, PW - M, y); y += 5 * s;
  if (m.notes) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(Math.max(7, 9.5 * s)); doc.setTextColor(...MUTED);
    const ls = doc.splitTextToSize(m.notes, CW); doc.text(ls, M, y + 3 * s); y += ls.length * Math.max(3.2, 4.3 * s) + 2 * s;
  }
  // Fonte menor → a folha se divide em colunas (como jornal): os compassos diminuem na largura
  // e na altura na mesma proporção, sem achatar, e cabe muito mais numa folha.
  const pc = pageColumns(s), GAPC = 7;
  const colW = (CW - GAPC * (pc - 1)) / pc;
  const pauta = viewOf(song) === 'pauta';
  const cw = colW / cols, rowH = (pauta ? 11 : 14) * s, rowGap = (pauta ? 4 : 2.2) * s, topX = (pauta ? 5.6 : 4.8) * s, bottom = PH - M - 6;
  const lyrX = 4.4 * s; // espaço para a letra embaixo da linha
  const lastSec = song.sections.reduce((k, x, i) => (x.rows.length ? i : k), -1);
  const noteSize = Math.max(6, 9 * s), noteLH = Math.max(2.8, 4.2 * s);
  let col = 0, colTop = y;
  const cx = () => M + col * (colW + GAPC);
  const newPage = () => {
    doc.addPage(); y = M; footer(doc, footLeft, footRight);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK); doc.text(title, M, y + 4);
    const tw = doc.getTextWidth(title);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED); doc.text('  (continuação)', M + tw, y + 4);
    y += 9; col = 0; colTop = y;
  };
  const nextCol = () => { if (col < pc - 1) { col++; y = colTop; } else newPage(); };
  const lens = sectionLengths(song);
  song.sections.forEach((sec, si) => {
    let rows;
    if (pauta) {
      // pauta: cada compasso com a largura que as cifras pedem; as linhas quebram e esticam como numa partitura
      const bars = sec.rows.flat();
      const widths = bars.map(b => Math.max(staffBarWidth(b, t => natWidth(doc, t, s), { gap: 3.4 * s, pad: 2.8 * s, repeat: 3.2 * s }), 20 * s, colW / 8));
      rows = flowStaff(widths, colW).map(line => Object.assign(line.map(x => bars[x.i]), { w: line.map(x => x.w) }));
    } else rows = wrapRows(sec.rows, cols);
    doc.setFont('helvetica', 'italic'); doc.setFontSize(noteSize);
    const nl = sec.notes.length ? doc.splitTextToSize(sec.notes.join(' · '), colW) : [];
    const headH = (sec.name || sec.times || lens[si] ? 7.5 * s : 0) + nl.length * noteLH + (nl.length ? Math.max(1 * s, noteSize * 0.12) : 0);
    // letra quebrada na largura de cada compasso → quantas linhas cada linha da grade precisa embaixo
    const lyrN = rows.map(r => wrapLyrics(doc, r, pauta ? r.w : r.map(() => cw), s, colW));
    const rowsH = rows.map((r, i) => (rowTop(r) ? topX : 0) + (!pauta && rowIsTall(r) ? rowH * TALL : rowH) + rowGap + (lyrN[i] ? lyrX + (lyrN[i] - 1) * LYR_LH * s : 0));
    const total = headH + rowsH.reduce((x, v) => x + v, 0);
    // a seção não é cortada entre colunas quando cabe inteira numa coluna
    if (y > colTop && y + total > bottom && colTop + total <= bottom) nextCol();
    else if (y + headH + (rowsH[0] || 0) > bottom) nextCol();
    const x0 = cx();
    if (sec.name || sec.times || lens[si]) {
      let px = x0;
      if (sec.name) {
        const lab = sec.name.toUpperCase();
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5 * s);
        const w = doc.getTextWidth(lab) + 5 * s;
        doc.setFillColor(...INK); doc.roundedRect(x0, y, w, 5.6 * s, 1.1 * s, 1.1 * s, 'F');
        doc.setTextColor(255, 255, 255); doc.text(lab, x0 + 2.5 * s, y + 3.95 * s); px = x0 + w + 2.2 * s;
      }
      if (sec.times) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5 * s); doc.setTextColor(...ACC); doc.text(sec.times + 'x', px, y + 4.3 * s); px += doc.getTextWidth(sec.times + 'x') + 2.2 * s; }
      if (lens[si]) { doc.setFont('helvetica', 'normal'); doc.setFontSize(Math.max(4.8, 7.5 * s)); doc.setTextColor(...MUTED); doc.text(`${lens[si]} ${lens[si] === 1 ? 'compasso' : 'compassos'}`, px, y + 4 * s); }
      y += 7.5 * s;
    }
    if (nl.length) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(noteSize); doc.setTextColor(...MUTED);
      doc.text(nl, x0, y + Math.max(2.6 * s, noteSize * 0.3)); y += nl.length * noteLH + 1 * s;
    }
    rows.forEach((row, ri) => {
      const top = rowTop(row) ? topX : 0;
      const rh = !pauta && rowIsTall(row) ? rowH * TALL : rowH; // linha com compasso em duas linhas fica mais alta
      const lx = lyrN[ri] ? lyrX + (lyrN[ri] - 1) * LYR_LH * s : 0;
      if (y + top + rh + lx > bottom) nextCol();
      y += top;
      const xr = cx();
      if (pauta) {
        const lastRow = ri === rows.length - 1;
        let bx = xr;
        row.forEach((b, i) => { drawStaffBar(doc, b, bx, y, row.w[i], rh, s, { first: i === 0, secEnd: lastRow && i === row.length - 1, fin: si === lastSec }); bx += row.w[i]; });
      } else row.forEach((b, i) => drawBar(doc, b, xr + i * cw, y, cw, rh, s));
      y += rh + rowGap + lx;
    });
    y += 3.8 * s;
  });
}

/** Quantas colunas a folha usa para a escala dada (1 = 100%). */
export function pageColumns(s) { return s < 0.45 ? 3 : s < 0.75 ? 2 : 1; }

/* ---------------- tamanho / encaixe em 1 folha ---------------- */
export const SCALE_STEPS = [100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30];
export const MIN_SCALE = 30;
const pageCache = new Map();

/** Quantas folhas a música ocupa com a escala dada (em %). */
export function pagesFor(text, cols, pct) {
  const key = pct + '|' + cols + '|' + text;
  if (pageCache.has(key)) return pageCache.get(key);
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  drawSong(doc, text, cols, '', '', pct / 100);
  const n = doc.getNumberOfPages();
  if (pageCache.size > 400) pageCache.clear();
  pageCache.set(key, n);
  return n;
}

/**
 * Resolve a escala de uma música: font_scale 0 = automático (maior tamanho que cabe em 1 folha).
 * Retorna { pct, pages }.
 */
export function resolveScale(text, cols, fontScale) {
  if (fontScale && fontScale > 0) return { pct: fontScale, pages: pagesFor(text, cols, fontScale) };
  for (const pct of SCALE_STEPS) {
    const pages = pagesFor(text, cols, pct);
    if (pages === 1) return { pct, pages };
  }
  return { pct: MIN_SCALE, pages: pagesFor(text, cols, MIN_SCALE) };
}

function fmtDate(d) { if (!d) return ''; const [Y, Mo, D] = d.split('-'); return `${D}/${Mo}/${Y}`; }

// Folha do setlist (capa do PDF do show).
// layout: 'detalhada' (título + artista) | 'compacta' (uma linha por música) | 'colunas' (compacta em 2 colunas)
// s: escala (1 = 100%)
function drawCover(doc, setlist, texts, layout = 'detalhada', s = 1, opts = coverOpts(setlist.cover_opts)) {
  const detail = layout === 'detalhada';
  const ncol = layout === 'colunas' ? 2 : 1;
  const hs = Math.max(Math.min(s, 1.25), 0.7); // o cabeçalho varia menos que a lista
  let y = M + 4 * hs;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9 * hs); doc.setTextColor(...ACC); doc.text('SETLIST', M, y);
  y += 10 * hs; doc.setTextColor(...INK); doc.setFontSize(fit(doc, setlist.name, 28 * hs, CW)); doc.text(setlist.name, M, y);
  const info = [opts.info && fmtDate(setlist.event_date), opts.info && setlist.venue, texts.length + (texts.length === 1 ? ' música' : ' músicas')].filter(Boolean).join('   ·   ');
  y += 7 * hs; doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5 * hs); doc.setTextColor(...MUTED);
  doc.text(info, M, y);
  if (opts.notes && setlist.notes) {
    y += 5.5 * hs; doc.setFont('helvetica', 'italic'); doc.setFontSize(9.5 * hs);
    const ls = doc.splitTextToSize(setlist.notes, CW); doc.text(ls, M, y); y += (ls.length - 1) * 4.3 * hs;
  }
  y += 4 * hs;

  // medidas da lista
  const metas = texts.map(t => parseSong(t).meta);
  const withArtist = opts.artist && metas.some(m => m.artist);
  const GAP = 8, colW = (CW - GAP * (ncol - 1)) / ncol;
  const big = (detail ? 14 : 11.5) * s;                                      // número e título
  const rowH = (detail ? (withArtist ? 12.5 : 9.5) : 7.2) * s;               // altura de cada música
  const valW = (ncol > 1 ? 13 : 20) * Math.max(s, 0.7);                      // largura das colunas Tom e BPM
  const vals = [opts.key && ['TOM', m => m.key], opts.bpm && ['BPM', m => m.bpm && String(m.bpm).replace(/\s*bpm\s*/i, '')]].filter(Boolean);
  const bottom = PH - M - 4;
  const lead = rowH * (detail ? (withArtist ? 0.72 : 0.85) : 0.95);
  let col = 0, top = y, first = true;
  const colX = () => M + col * (colW + GAP);
  const valX = (x, k) => x + colW - valW / 2 - (vals.length - 1 - k) * valW; // centro de cada coluna de valor
  const heads = () => {
    const x = colX();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.max(6, 8 * Math.min(s, 1.3))); doc.setTextColor(...MUTED);
    vals.forEach(([h], k) => doc.text(h, valX(x, k), y - 1.6 * Math.max(s, 0.6), { align: 'center' }));
    doc.setDrawColor(...INK); doc.setLineWidth(0.7 * Math.max(s, 0.6)); doc.line(x, y, x + colW, y);
  };
  // em "colunas" o cabeçalho aparece em cima das duas
  y += 4 * Math.max(s, 0.6); top = y;
  for (col = 0; col < ncol; col++) { y = top; heads(); }
  col = 0; y = top + lead;

  const perCol = ncol > 1 ? Math.ceil(texts.length / ncol) : Infinity; // divide meio a meio entre as colunas
  metas.forEach((m, i) => {
    if (i > 0 && i % perCol === 0 && col < ncol - 1 && y > top) { col++; y = top + lead; }
    else if (!first && y - rowH * 0.35 + rowH > bottom) {
      if (col < ncol - 1) { col++; y = top + lead; }
      else { doc.addPage(); col = 0; y = M + 6; top = y; for (let k = 0; k < ncol; k++) { col = k; y = top; heads(); } col = 0; y = top + lead; }
    }
    first = false;
    const x = colX();
    const artist = opts.artist ? m.artist : '';
    doc.setFont('helvetica', 'bold'); doc.setFontSize(big);
    let tx = x;
    if (opts.num) {
      doc.setTextColor(...ACC); doc.text(String(i + 1).padStart(2, '0'), x, y);
      tx = x + big * 0.9 + 2 * s;
    }
    const maxT = (vals.length ? valX(x, 0) - valW / 2 : x + colW) - tx - 2;
    doc.setTextColor(...INK);
    const title = m.title || 'Sem título';
    if (detail) {
      doc.setFontSize(fit(doc, title, big, maxT)); doc.text(title, tx, y);
      if (artist) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5 * s); doc.setTextColor(...MUTED); doc.text(doc.splitTextToSize(artist, maxT)[0], tx, y + 4.8 * s); }
    } else {
      // compacta: "Título  artista" numa linha só
      doc.setFontSize(big);
      const tw = doc.getTextWidth(title);
      if (tw > maxT) { doc.setFontSize(fit(doc, title, big, maxT)); doc.text(title, tx, y); }
      else {
        doc.text(title, tx, y);
        if (artist) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(big * 0.78); doc.setTextColor(...MUTED);
          const room = maxT - tw - 3 * s;
          if (room > 8) { const a = doc.splitTextToSize(artist, room)[0]; doc.text(a + (a.length < artist.length ? '…' : ''), tx + tw + 3 * s, y); }
        }
      }
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(big * (detail ? 0.86 : 0.9)); doc.setTextColor(...INK);
    vals.forEach(([, get], k) => { const v = get(m); if (v) doc.text(fitText(doc, String(v), valW - 1), valX(x, k), y, { align: 'center' }); });
    const ly = y + (detail ? (withArtist ? 8 : 4) : 2.6) * s;
    doc.setDrawColor(225, 219, 210); doc.setLineWidth(0.25); doc.line(x, ly, x + colW, ly);
    y += rowH;
  });
}
// encurta o texto (com …) até caber na largura
function fitText(doc, t, w) {
  if (doc.getTextWidth(t) <= w) return t;
  while (t.length > 1 && doc.getTextWidth(t + '…') > w) t = t.slice(0, -1);
  return t + '…';
}

/** Escala da folha do setlist: a escolhida, ou (automático) a maior que cabe em 1 folha. */
export function resolveCoverScale(setlist, texts) {
  const layout = COVER_LAYOUTS.includes(setlist.cover_layout) ? setlist.cover_layout : 'detalhada';
  if (setlist.cover_scale > 0) return { layout, pct: setlist.cover_scale };
  for (const pct of COVER_STEPS) {
    const d = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    drawCover(d, setlist, texts, layout, pct / 100);
    if (d.getNumberOfPages() === 1) return { layout, pct, pages: 1 };
  }
  return { layout, pct: COVER_STEPS[COVER_STEPS.length - 1] };
}

/**
 * Gera o PDF. `songs` = [{ content, font_scale }] na ordem;
 * `cover` inclui a folha do setlist; `coverOnly` gera só ela;
 * `index` = posição da 1ª no show (para o rodapé).
 */
export function buildPdf({ setlist, songs, cols, cover, coverOnly, index = 0, total }) {
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  const tot = total || songs.length;
  const left = [setlist.name, fmtDate(setlist.event_date)].filter(Boolean).join(' · ');
  const texts = songs.map(s => s.content);
  if (cover || coverOnly) {
    const { layout, pct } = resolveCoverScale(setlist, texts);
    drawCover(doc, setlist, texts, layout, pct / 100);
    if (coverOnly) return doc;
  }
  songs.forEach((s, i) => {
    if (cover || i > 0) doc.addPage();
    const { pct } = resolveScale(s.content, cols, s.font_scale);
    drawSong(doc, s.content, cols, left, `${index + i + 1} / ${tot}`, pct / 100);
  });
  return doc;
}

export { fmtDate, COVER_LAYOUTS, COVER_STEPS };
