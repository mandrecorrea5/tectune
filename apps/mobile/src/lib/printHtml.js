// Gera o HTML da folha (A4) para visualizar/imprimir/compartilhar como PDF no celular.
import { parseSong, wrapRows, rowHasTop, chordParts, isRest, REST_PTS, barLines, rowIsTall, sectionLengths, COVER_STEPS, coverOpts, viewOf, staffBarWidth, voiceLines } from '@tectune/core';

// igual ao web: fonte menor → folha em colunas (os compassos não achatam)
const pageColumns = s => (s < 0.45 ? 3 : s < 0.75 ? 2 : 1);
import { fmtDate } from './theme';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const REST_SVG = `<svg viewBox="0 0 12 28"><polyline points="${REST_PTS.map(p => p.map(v => +v.toFixed(2)).join(',')).join(' ')}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function tok(t) {
  if (t === '%') return '<span class="sim">%</span>';
  if (t === '/' || t === '.') return '<span class="beat">/</span>';
  if (t === '_') return '';
  if (isRest(t)) return `<span class="rest">${REST_SVG}</span>`;
  const p = chordParts(t);
  if (!p) return `<span class="txt">${esc(t)}</span>`;
  return '<span class="ch">' + p.map(x => x.k === 'root' ? esc(x.s) : `<span class="${x.k}">${esc(x.s)}</span>`).join('') + '</span>';
}
const rowTop = row => rowHasTop(row) || row.some(b => b.voice);
// quantos compassos a letra de cada compasso pode ocupar (até o próximo com letra, no máximo `cap`)
const lyrSpans = (bars, cap = Infinity) => bars.map((b, i) => {
  let n = 1; while (i + n < bars.length && n < cap && !voiceLines(bars[i + n].voice).length) n++;
  return n;
});
const rowLyr = row => Math.max(0, ...row.map(b => voiceLines(b.voice).length));
function bar(b, pauta, pos = {}) {
  const L = b.layout;
  const cls = ['bar', b.start && 'rs', b.end && 're', (L.error || b.mel?.error) && 'err', pos.first && 'first', pos.secEnd && (pos.fin ? 'fin' : 'secend')].filter(Boolean).join(' ');
  const multi = L.spans.length > 1 || L.error;
  let above = '';
  if (b.passes || b.note || b.voice) above = `<div class="above${b.passes ? ' e' : ''}${b.endingCont ? ' c' : ''}">${b.ending ? `<b>${b.ending}.</b>` : ''}${b.voice ? '<span class="vz">VOZ</span>' : ''}${b.note ? `<i>${esc(b.note)}</i>` : ''}</div>`;
  const rt = b.end && b.times ? `<span class="rt">${b.times}x</span>` : '';
  // na pauta fica tudo numa linha só
  const lines = L.spans.length ? (pauta ? [{ grid: L.grid, spans: L.spans }] : barLines(L)) : [];
  let beats = lines.map((ln, li) => {
    const starts = new Set(ln.spans.map(s => s.start));
    return `<div class="beats${li ? ' l2' : ''}" style="--g:${ln.grid}">${ln.spans.map((sp, i) => `<div class="slot${i ? ' sep' : ''}" style="grid-column:${sp.start + 1} / span ${sp.len}">${tok(sp.tok)}</div>`).join('')}${multi && !pauta ? `<div class="ticks">${Array.from({ length: ln.grid }, (_, i) => `<i${starts.has(i) ? ' class="on"' : ''}></i>`).join('')}</div>` : ''}</div>`;
  }).join('');
  if (lines.length > 1) beats = `<div class="stack">${beats}</div>`;
  const ll = voiceLines(b.voice);
  // letra: vai até o próximo compasso com letra (pos.span compassos) e quebra se não couber
  const span = pos.span || 1;
  const lyr = ll.length ? `<div class="lyr" style="width:calc(${span} * 100% + ${span - 1} * 6px - 8px)">${ll.map(esc).join('<br>')}</div>` : '';
  const mel = b.melody ? '<span class="mel">♪</span>' : '';
  // na pauta: largura natural (em "em" da cifra), esticando para justificar a linha
  const style = pos.em ? ` style="flex:${pos.em.toFixed(2)} 1 calc(${pos.em.toFixed(2)} * 23px * var(--s));max-width:calc(${(pos.em * 1.7).toFixed(2)} * 23px * var(--s))"` : '';
  return `<div class="${cls}"${style}>${above}${rt}${mel}${beats}${lyr}</div>`;
}

function songHTML(content, cols, scalePct, footer) {
  const song = parseSong(content); const m = song.meta;
  const s = (scalePct > 0 ? scalePct : 100) / 100;
  const metas = [['TOM', m.key], ['BPM', m.bpm], ['COMPASSO', m.time && song.meter.label], ['CAPO', m.capo]].filter(x => x[1]);
  const pc = pageColumns(s);
  let h = `<section class="page${pc > 1 ? ' pc' + pc : ''}${s < 0.45 ? ' tiny' : ''}" style="--s:${s}">
  <div class="ph"><div><h1>${esc(m.title || 'Sem título')}</h1>${m.artist ? `<div class="artist">${esc(m.artist)}</div>` : ''}</div>
  <div class="metas">${metas.map(x => `<div class="meta"><span>${x[0]}</span><b>${esc(x[1])}</b></div>`).join('')}</div></div>`;
  if (m.notes) h += `<div class="gnotes">${esc(m.notes)}</div>`;
  const lens = sectionLengths(song);
  const pauta = viewOf(song) === 'pauta';
  const lastSec = song.sections.reduce((k, x, i) => (x.rows.length ? i : k), -1);
  h += `<div class="body${pauta ? ' pauta' : ''}">`;
  song.sections.forEach((sec, si) => {
    h += '<div class="sec">';
    const len = lens[si];
    if (sec.name || sec.times || len) h += `<div class="sec-h">${sec.name ? `<span class="pill">${esc(sec.name)}</span>` : ''}${sec.times ? `<span class="sx">${sec.times}x</span>` : ''}${len ? `<span class="slen">${len} ${len === 1 ? 'compasso' : 'compassos'}</span>` : ''}</div>`;
    if (sec.notes.length) h += `<div class="sec-notes">${esc(sec.notes.join(' · '))}</div>`;
    if (pauta) {
      // pauta: compassos em sequência, cada um com a largura das suas cifras; quebram e esticam como partitura
      const bars = sec.rows.flat();
      const nl = rowLyr(bars);
      const spans = lyrSpans(bars, 2); // na pauta a quebra de linha não é conhecida: no máximo 2 compassos
      h += `<div class="srow${bars.some(b => b.passes || b.note || b.voice) ? ' withtop' : ''}${nl ? ' withlyr' : ''}" style="--lyn:${nl || 1}">`
        + bars.map((b, bi) => {
          const em = Math.max(staffBarWidth(b, undefined, { gap: 0.75, pad: 0.7, repeat: 0.6 }), 4.2);
          return bar(b, true, { secEnd: bi === bars.length - 1, fin: si === lastSec, em, span: spans[bi] });
        }).join('') + '<i class="sfill"></i></div>';
      h += '</div>';
      return;
    }
    const rows = wrapRows(sec.rows, cols);
    rows.forEach((row, ri) => {
      const lastRow = ri === rows.length - 1;
      const nl = rowLyr(row);
      const rs = lyrSpans(row);
      h += `<div class="row${rowTop(row) ? ' withtop' : ''}${!pauta && rowIsTall(row) ? ' tall' : ''}${nl ? ' withlyr' : ''}" style="--cols:${cols};--lyn:${nl || 1}">`
        + row.map((b, bi) => bar(b, pauta, { first: bi === 0, secEnd: lastRow && bi === row.length - 1, fin: si === lastSec, span: rs[bi] })).join('') + '</div>';
    });
    h += '</div>';
  });
  h += '</div>';
  if (footer) h += `<div class="foot">${esc(footer)}</div>`;
  return h + '</section>';
}

export const COVER_LAYOUTS = [['detalhada', 'Detalhada'], ['compacta', 'Compacta'], ['colunas', 'Duas colunas']];
export { COVER_STEPS };

// altura útil da A4 (271 mm) em px CSS, com folga para diferenças de renderização
const PAGE_H = 980;
function coverHeight(setlist, songs, layout, s) {
  const o = coverOpts(setlist.cover_opts);
  const hs = Math.min(Math.max(s, 0.7), 1.25);
  const notes = o.notes && setlist.notes;
  const head = 118 * hs + (notes ? (20 + 18 * Math.ceil(String(setlist.notes).length / 90)) * hs : 0);
  const n = songs.length;
  const rows = layout === 'colunas' ? Math.ceil(n / 2) : n;
  const withArtist = o.artist && songs.some(x => parseSong(x.content).meta.artist);
  const rowH = layout === 'detalhada' ? (withArtist ? 52 : 36) * s : 30 * s;
  return head + 22 + rows * rowH;
}
/** Tamanho da letra da folha do setlist em % (0 no cadastro = automático: o maior que cabe em 1 folha). */
export function resolveCoverScale(setlist, songs) {
  const fixed = Number(setlist?.cover_scale) || 0;
  if (fixed) return fixed;
  const layout = setlist?.cover_layout || 'detalhada';
  return COVER_STEPS.find(p => coverHeight(setlist, songs, layout, p / 100) <= PAGE_H) || COVER_STEPS[COVER_STEPS.length - 1];
}
/** Quantas folhas a lista deve ocupar (estimativa). */
export function coverPages(setlist, songs) {
  const s = resolveCoverScale(setlist, songs) / 100;
  return Math.max(1, Math.ceil(coverHeight(setlist, songs, setlist?.cover_layout || 'detalhada', s) / PAGE_H));
}

function coverItem(s, i, layout, o) {
  const m = parseSong(s.content).meta;
  const title = esc(m.title || 'Sem título'); const artist = o.artist && m.artist ? esc(m.artist) : '';
  const t = `<span class="t${layout === 'detalhada' ? '' : ' one'}"><b>${title}</b>${artist ? `<small>${artist}</small>` : ''}</span>`;
  return `<li>${o.num ? `<span class="n">${String(i + 1).padStart(2, '0')}</span>` : ''}${t}${o.key ? `<span class="k">${esc(m.key || '')}</span>` : ''}${o.bpm ? `<span class="b">${esc(String(m.bpm || '').replace(/\s*bpm\s*/i, ''))}</span>` : ''}</li>`;
}
const coverList = (items, start, layout, o) =>
  `<div class="clist"><div class="heads">${o.key ? '<span>TOM</span>' : ''}${o.bpm ? '<span>BPM</span>' : ''}</div><ol>${items.map((s, i) => coverItem(s, start + i, layout, o)).join('')}</ol></div>`;

function coverHTML(setlist, songs) {
  const layout = setlist.cover_layout || 'detalhada';
  const o = coverOpts(setlist.cover_opts);
  const s = resolveCoverScale(setlist, songs) / 100;
  const info = [o.info && fmtDate(setlist.event_date), o.info && setlist.venue, `${songs.length} ${songs.length === 1 ? 'música' : 'músicas'}`].filter(Boolean).join(' · ');
  let list;
  if (layout === 'colunas') {
    const per = Math.ceil(songs.length / 2);
    list = `<div class="ccols">${coverList(songs.slice(0, per), 0, layout, o)}${songs.length > per ? coverList(songs.slice(per), per, layout, o) : '<div class="clist"></div>'}</div>`;
  } else list = coverList(songs, 0, layout, o);
  return `<section class="page cover ${layout}" style="--cs:${s}; --chs:${Math.min(Math.max(s, 0.7), 1.25)}"><div class="kick">SETLIST</div><h1 class="big">${esc(setlist.name)}</h1><div class="info">${esc(info)}</div>
  ${o.notes && setlist.notes ? `<div class="gnotes">${esc(setlist.notes)}</div>` : ''}${list}</section>`;
}

const CSS = `
@page { size: A4; margin: 12mm 12mm 14mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1c1917; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { page-break-after: always; --hs: calc(0.55 + 0.45 * var(--s, 1)); }
.page:last-child { page-break-after: auto; }
.ph { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding-bottom: 8px; border-bottom: 2.5px solid #1c1917; }
h1 { margin: 0; font-size: calc(26px * var(--hs)); font-weight: 800; }
.artist { color: #78716c; font-size: calc(14px * var(--hs)); margin-top: 2px; }
.metas { display: flex; gap: 5px; }
.meta { border: 1.5px solid #1c1917; border-radius: 6px; min-width: 58px; padding: 3px 6px; text-align: center; }
.meta span { display: block; font-size: 8.5px; font-weight: 700; letter-spacing: .08em; color: #78716c; }
.meta b { font-size: calc(16px * var(--hs)); }
.gnotes { font-style: italic; color: #78716c; font-size: 12.5px; margin-top: 8px; }
.sec { margin-top: calc(16px * var(--s)); page-break-inside: avoid; }
.sec-h { display: flex; align-items: center; gap: 8px; margin-bottom: calc(6px * var(--s)); }
.pill { background: #1c1917; color: #fff; font-size: calc(10.5px * var(--s)); font-weight: 700; letter-spacing: .07em; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; }
.sx { color: #c2410c; font-weight: 800; font-size: calc(14px * var(--s)); }
.sec-notes { font-style: italic; color: #78716c; font-size: calc(12px * var(--s)); margin: 0 0 6px; }
.row { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 0 5px; margin-bottom: calc(6px * var(--s)); }
.row.withtop { margin-top: calc(16px * var(--s)); }
.bar { position: relative; height: calc(50px * var(--s)); background: #f7f5f1; border: 1px solid #d6cfc4; border-radius: 6px; display: flex; padding: 0 4px; }
.bar.rs { border-left: 4px solid #1c1917; padding-left: 11px; }
.bar.re { border-right: 4px solid #1c1917; padding-right: 11px; }
.bar.err { border: 2px solid #dc2626; background: #fef2f2; }
.above { position: absolute; left: 0; right: 0; bottom: calc(100% + 1px); display: flex; gap: 4px; font-size: calc(10px * var(--s)); white-space: nowrap; overflow: hidden; }
.above.e { border-left: 1.5px solid #1c1917; border-top: 1.5px solid #1c1917; padding-left: 3px; }
.above i { color: #78716c; }
.rt { position: absolute; right: 2px; bottom: calc(100% + 1px); font-size: calc(10.5px * var(--s)); font-weight: 800; color: #c2410c; }
.beats { position: relative; flex: 1; display: grid; grid-template-columns: repeat(var(--g), minmax(0, 1fr)); }
.slot { min-width: 0; display: flex; align-items: center; justify-content: center; white-space: nowrap; overflow: hidden; }
.slot.sep { border-left: 1.2px dashed #cfc6b9; }
.stack { flex: 1; display: flex; flex-direction: column; } .stack .beats { flex: 1; }
.beats.l2 { border-top: 1.2px dashed #cfc6b9; }
.row.tall .bar { height: calc(86px * var(--s)); }
.ticks { position: absolute; left: 0; right: 0; bottom: 4px; display: flex; }
.ticks i { flex: 1; height: 2.5px; margin: 0 3px; border-radius: 2px; background: #e4ddd3; }
.ticks i.on { background: #a39b92; }
.ch { font-weight: 700; font-size: calc(21px * var(--s)); line-height: 1; }
.ch .acc { font-size: .6em; position: relative; top: -.62em; }
.ch .mi { font-size: .8em; } .ch .q { font-size: .54em; position: relative; top: -.72em; font-weight: 600; } .ch .bs { font-size: .72em; font-weight: 600; }
.sim { font-size: calc(24px * var(--s)); font-weight: 700; color: #a8a29e; }
.beat { font-size: calc(20px * var(--s)); color: #b5aea5; }
.txt { font-weight: 700; font-size: calc(12px * var(--s)); }
.rest svg { height: calc(24px * var(--s)); width: auto; display: block; }
.foot { margin-top: 18px; font-size: 9px; color: #78716c; text-align: right; }
.cover .kick { color: #c2410c; font-weight: 800; font-size: calc(11px * var(--chs)); letter-spacing: .1em; margin-top: 8px; }
.cover .big { font-size: calc(30px * var(--chs)); margin-top: 4px; }
.cover .info { color: #78716c; font-size: calc(14px * var(--chs)); margin: 6px 0 12px; }
.cover .gnotes { font-size: calc(12.5px * var(--chs)); margin: -4px 0 12px; }
.cover .heads { font-size: calc(9px * min(max(var(--cs), 0.7), 1.3)) !important; }
.cover .ccols { display: flex; gap: 8mm; } .cover .ccols .clist { flex: 1; min-width: 0; }
.cover ol { list-style: none; padding: 0; margin: 0; border-top: 2.5px solid #1c1917; }
.cover li { display: flex; align-items: baseline; gap: calc(12px * var(--cs)); padding: calc(9px * var(--cs)) 0; border-bottom: 1px solid #e1dbd2; break-inside: avoid; }
.cover.compacta li, .cover.colunas li { padding: calc(4px * var(--cs)) 0; }
.cover .n { color: #c2410c; font-weight: 800; font-size: calc(16px * var(--cs)); width: calc(26px * var(--cs)); flex: none; }
.cover .t { flex: 1; min-width: 0; display: flex; flex-direction: column; } .cover .t b { font-size: calc(15px * var(--cs)); } .cover .t small { color: #78716c; font-size: calc(13px * var(--cs)); }
.cover .t.one { flex-direction: row; align-items: baseline; gap: calc(8px * var(--cs)); white-space: nowrap; overflow: hidden; }
.cover .t.one small { overflow: hidden; text-overflow: ellipsis; }
.cover .heads { display: flex; justify-content: flex-end; font-size: 9px; font-weight: 800; letter-spacing: .08em; color: #78716c; padding-bottom: 3px; min-height: 14px; }
.cover .heads span, .cover .k, .cover .b { width: calc(56px * max(var(--cs), 0.7)); text-align: center; flex: none; }
.cover.colunas .heads span, .cover.colunas .k, .cover.colunas .b { width: calc(38px * max(var(--cs), 0.7)); }
.cover .k, .cover .b { font-weight: 800; font-size: calc(14px * var(--cs)); }
.slen { font-size: calc(10.5px * var(--s)); color: #78716c; font-weight: 600; }
.above.e.c { border-left: 0; left: -6px; }
.bar.rs::before, .bar.re::after { content: ""; position: absolute; top: 50%; width: 5px; height: max(calc(15px * var(--s)), 12px); transform: translateY(-50%);
  background: radial-gradient(circle, #1c1917 42%, transparent 50%) center top / 5px 5px no-repeat, radial-gradient(circle, #1c1917 42%, transparent 50%) center bottom / 5px 5px no-repeat; }
.bar.rs::before { left: 3px; } .bar.re::after { right: 3px; }
.page.pc2 .body { column-count: 2; column-gap: 7mm; column-rule: 1px solid #eee8df; }
.page.pc3 .body { column-count: 3; column-gap: 6mm; column-rule: 1px solid #eee8df; }
.page.pc2 .sec, .page.pc3 .sec { break-inside: avoid; }
.page.tiny .ticks { display: none; }

/* entrada da voz, letra e frase com notas */
.above .vz { background: #c2410c; color: #fff; font-weight: 800; font-size: .85em; letter-spacing: .05em; padding: 0 3px; border-radius: 3px; font-style: normal; }
.lyr { position: absolute; left: 2px; top: calc(100% + 2px); font-style: italic; font-size: max(8px, calc(11.5px * var(--s))); line-height: 1.3; white-space: normal; overflow-wrap: anywhere; }
.row.withlyr { margin-bottom: calc((5px + 15px * (var(--lyn, 1) + 1)) * var(--s)); }
.mel { position: absolute; left: 3px; top: 0; font-size: calc(10px * var(--s)); color: #c2410c; font-weight: 800; }
/* pauta: cifras dentro do pentagrama */
.pauta { --sp: calc(10px * var(--s)); --staffH: calc(4 * var(--sp) + 1.2px);
  --staff: repeating-linear-gradient(to bottom, #78716c 0 0.8px, transparent 0.8px var(--sp)) left center / 100% var(--staffH) no-repeat; }
.pauta .row { gap: 0; margin-bottom: calc(13px * var(--s)); }
.pauta .row.withtop { margin-top: calc(19px * var(--s)); }
.pauta .row.withlyr { margin-bottom: calc((9px + 15px * var(--lyn, 1)) * var(--s)); }
.pauta .bar { height: var(--staffH); background: var(--staff), transparent; border: 0; border-right: 1.2px solid #1c1917; border-radius: 0; padding: 0 4px; }
.pauta .bar.first { border-left: 1.2px solid #1c1917; }
.pauta .bar.secend { border-right: 4px double #1c1917; }
.pauta .bar.fin { border-right: 4px solid #1c1917; box-shadow: inset -6px 0 0 -4.8px #1c1917; }
.pauta .bar.rs { border-left: 4px solid #1c1917; padding-left: 11px; box-shadow: inset 2.5px 0 0 -1.3px #1c1917; }
.pauta .bar.re { border-right: 4px solid #1c1917; padding-right: 11px; box-shadow: inset -2.5px 0 0 -1.3px #1c1917; }
.pauta .bar.rs::before, .pauta .bar.re::after { height: calc(var(--sp) + 5px); }
.pauta .bar.err { background: var(--staff), #fef2f2; border-top: 0; border-bottom: 0; }
.pauta .slot { overflow: visible; }
.pauta .slot > * { background: #fff; padding: 1px 3px; border-radius: 3px; position: relative; z-index: 1; }
.pauta .slot > .beat { background: transparent; }
.pauta .slot.sep { border-left: 0; }
.pauta .ch { font-size: calc(23px * var(--s)); }
.pauta .sim { color: #1c1917; }
.pauta .mel { top: calc(-13px * var(--s)); left: auto; right: 2px; }

/* pauta contínua */
.pauta .srow { display: flex; flex-wrap: wrap; row-gap: calc(15px * var(--s)); margin: 2px 0 calc(10px * var(--s)); padding-left: 1.2px; }
.pauta .srow.withtop { row-gap: calc(25px * var(--s)); margin-top: calc(20px * var(--s)); }
.pauta .srow.withlyr { row-gap: calc((21px + 15px * (var(--lyn, 1) + 1)) * var(--s)); margin-bottom: calc((11px + 15px * var(--lyn, 1)) * var(--s)); }
.pauta .srow .bar { min-width: 12.5%; border-left: 1.2px solid #1c1917; margin-left: -1.2px; }
.pauta .srow .bar.rs { border-left-width: 4px; }
.pauta .srow .sfill { flex: 6 1 0; height: 0; }
`;

/** HTML completo. `songs` = [{ content, font_scale }]. */
export function buildPrintHtml({ setlist, songs, cols, cover, coverOnly }) {
  const n = songs.length;
  const pages = coverOnly ? [] : songs.map((s, i) => songHTML(s.content, cols, s.font_scale, cover || n > 1 ? `${setlist?.name || ''} · ${i + 1} / ${n}` : setlist?.name));
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head><body>${cover || coverOnly ? coverHTML(setlist, songs) : ''}${pages.join('')}</body></html>`;
}
