// @tectune/core — núcleo compartilhado entre o web e o app mobile.
// Parser do texto da cifra, fórmula de compasso, distribuição dos tempos, validação,
// transposição e roteiro de reprodução (para o modo apresentação).
// JavaScript puro, sem dependências.

export const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------- parser ---------------- */
const META = { titulo: 'title', title: 'title', musica: 'title', artista: 'artist', banda: 'artist', autor: 'artist',
  tom: 'key', key: 'key', bpm: 'bpm', andamento: 'bpm', compasso: 'time', formula: 'time', capo: 'capo',
  obs: 'notes', observacao: 'notes', observacoes: 'notes', notas: 'notes',
  formato: 'view', visual: 'view', visualizacao: 'view', notacao: 'view' };
import { melodyInfo, assignVocals, transposeMelody } from './staff.js';
export * from './staff.js';
/** Visualização da música: 'pauta' (cifras dentro do pentagrama) ou 'caixas' (padrão). */
export const viewOf = song => (/^(pauta|partitura|pentagrama|staff)/.test(norm(song.meta.view || '')) ? 'pauta' : 'caixas');
export const CH = /^([A-G](?:#|b)?)([^\/]*)(?:\/([A-G](?:#|b)?))?$/;

function parseRow(line, lineNo) {
  const segs = line.split('|'); const bars = [];
  for (const seg of segs) {
    let t = seg.trim();
    if (!t) continue;
    if (/^:?\s*x\s*\d+$/i.test(t) && bars.length) { bars[bars.length - 1].times = +t.match(/\d+/)[0]; continue; }
    const bar = { start: false, end: false, ending: null, note: '', tokens: [], times: null, line: lineNo };
    if (t.startsWith(':')) { bar.start = true; t = t.slice(1).trim(); }
    if (t.endsWith(':')) { bar.end = true; t = t.slice(0, -1).trim(); }
    // frase com notas (ABC) entre chaves: | Am {A2 c2 e2 a2} |
    t = t.replace(/\{([^}]*)\}?/g, (m, n) => { if (n.trim()) bar.melody = (bar.melody ? bar.melody + ' ' : '') + n.trim(); return ' '; });
    t = t.replace(/"([^"]*)"?/g, (m, n) => { bar.note += (bar.note ? ' ' : '') + n.trim(); return ' '; }).trim();
    // casa: "1." / "2." / "1-3." (passadas 1 a 3) / "1,2." (passadas 1 e 2)
    const em = t.match(/^(\d{1,2}(?:\s*[-,]\s*\d{1,2})*)\.(?=\s|$)\s*/);
    if (em) {
      const passes = endingPasses(em[1]);
      if (passes.length) { bar.passes = passes; bar.ending = endingLabel(passes); t = t.slice(em[0].length); }
    }
    bar.tokens = t.split(/\s+/).filter(Boolean);
    if (!bar.tokens.length && !bar.start && !bar.end && !bar.note && !bar.ending && !bar.melody) continue;
    bars.push(bar);
  }
  return bars;
}

/* ---------------- fórmula de compasso ---------------- */
const UNIT = { 1: 'semibreves', 2: 'mínimas', 4: 'semínimas', 8: 'colcheias', 16: 'semicolcheias', 32: 'fusas' };
/** Lê "4/4", "3/4", "6/8", "12/8", "4x4", "C" (=4/4) ou "C|" (=2/2). Sem compasso → 4/4. */
export function meterOf(time) {
  const t = String(time || '').trim();
  const m = t.match(/^(\d{1,2})\s*[\/x]\s*(\d{1,2})$/i);
  if (m && +m[1] >= 1 && +m[1] <= 16 && UNIT[+m[2]]) return { beats: +m[1], unit: +m[2], label: `${+m[1]}/${+m[2]}`, unitName: UNIT[+m[2]] };
  if (/^c\s*\|$/i.test(t)) return { beats: 2, unit: 2, label: '2/2', unitName: 'mínimas' };
  if (/^c$/i.test(t)) return { beats: 4, unit: 4, label: '4/4', unitName: 'semínimas' };
  return { beats: 4, unit: 4, label: '4/4', unitName: 'semínimas', invalid: !!t, assumed: true };
}

const isCont = t => t === '/' || t === '.';
/**
 * Distribui os acordes do compasso nos tempos da fórmula.
 * Cada "span" = { tok, start, len } em tempos. `grid` = nº de colunas de tempo.
 */
export function layoutBar(bar, meter) {
  const N = meter.beats, toks = bar.tokens, k = toks.length;
  const out = { grid: N, spans: [], error: null, warn: null };
  if (!k) return out;
  const oneEach = () => { out.grid = Math.max(k, 1); out.spans = toks.map((t, i) => ({ tok: t, start: i, len: 1 })); };
  if (toks.includes('%')) {
    if (k > 1) { out.error = 'O % (repetir compasso) deve ficar sozinho no compasso'; oneEach(); return out; }
    out.spans = [{ tok: '%', start: 0, len: N }]; return out;
  }
  if (k > N) {
    out.error = `${k} tempos neste compasso, mas ${meter.label} comporta ${N} ${meter.unitName}`;
    oneEach(); return out;
  }
  if (k === N || toks.some(isCont)) {
    toks.forEach((t, i) => {
      const last = out.spans[out.spans.length - 1];
      if (isCont(t) && last) last.len++;
      else out.spans.push({ tok: t, start: i, len: 1 });
    });
    if (k < N) {
      out.spans[out.spans.length - 1].len += N - k;
      out.warn = `${k} de ${N} tempos marcados; o último acorde foi estendido até o fim do compasso`;
    }
    return out;
  }
  // sem "/": divide o compasso igualmente entre os acordes
  const base = Math.floor(N / k), extra = N % k; let pos = 0;
  toks.forEach((t, i) => { const len = base + (i < extra ? 1 : 0); out.spans.push({ tok: t, start: pos, len }); pos += len; });
  if (extra) {
    const ex = out.spans.map(s => [s.tok, ...Array(s.len - 1).fill('/')].join(' ')).join(' ');
    out.warn = `${k} acordes não dividem ${meter.label} igualmente; marque os tempos com /, ex.: | ${ex} |`;
  }
  return out;
}

// "1-3" → [1,2,3]; "1,3" → [1,3]
function endingPasses(spec) {
  const out = new Set();
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map(x => parseInt(x, 10));
    if (!a) continue;
    for (let k = a; k <= (b && b >= a ? Math.min(b, a + 30) : a); k++) out.add(k);
  }
  return [...out].sort((x, y) => x - y);
}
// [1,2,3] → "1-3"; [1,3] → "1, 3"; [4] → "4"
function endingLabel(p) {
  const runs = [];
  for (const n of p) { const r = runs[runs.length - 1]; if (r && n === r[1] + 1) r[1] = n; else runs.push([n, n]); }
  return runs.map(([a, b]) => (a === b ? `${a}` : b === a + 1 ? `${a}, ${b}` : `${a}-${b}`)).join(', ');
}

// Uma casa que termina num ":|" mais à frente vale para todos os compassos até ele
// (ex.: "| 1-3. Ab | Bb :|" — os dois compassos são da casa 1-3).
function extendEndings(bars) {
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (!b.passes || b.end) continue;
    let j = i + 1;
    while (j < bars.length && !bars[j].passes && !bars[j].start && !bars[j].end) j++;
    if (j < bars.length && bars[j].end && !bars[j].passes && !bars[j].start) {
      for (let k = i + 1; k <= j; k++) { bars[k].passes = b.passes; bars[k].endingCont = true; }
      i = j;
    }
  }
}

export function parseSong(text) {
  const song = { meta: {}, sections: [], metaLines: {} }; let cur = null;
  const ensure = () => { if (!cur) { cur = { name: '', times: null, notes: [], rows: [], vocals: [] }; song.sections.push(cur); } return cur; };
  String(text || '').split('\n').forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim(); if (!line) return;
    // entrada da voz / linha da letra: "voz: texto" ou "voz 5: texto" (compasso 5 da seção)
    // "voz 3 [2]: texto" = só na 2ª vez que o compasso 3 toca (repetição/ritornelo)
    const vm = line.match(/^(voz|letra|canta|vocal)(?:\s+(\d{1,3}))?(?:\s*\[\s*(\d{1,2})\s*\]|\s+(\d{1,2})\s*[ªa]\s*(?:vez)?)?\s*:\s*(.*)$/i);
    if (vm) {
      const pass = vm[3] || vm[4];
      ensure().vocals.push({ bar: vm[2] ? +vm[2] : null, pass: pass ? +pass : null, text: vm[5].trim(), line: lineNo });
      return;
    }
    const mm = line.match(/^([A-Za-zÀ-ÿçÇ]+)\s*:\s*(.*)$/);
    if (mm && META[norm(mm[1])]) {
      const k = META[norm(mm[1])], v = mm[2].trim();
      if (k === 'notes' && cur) { if (v) cur.notes.push(v); }
      else if (v) { song.meta[k] = v; song.metaLines[k] = lineNo; }
      return;
    }
    const sm = line.match(/^\[(.+?)\](.*)$/);
    if (sm) {
      let rest = sm[2]; let times = null;
      const tm = rest.match(/x\s*(\d+)/i);
      if (tm) { times = +tm[1]; rest = rest.replace(tm[0], ''); }
      rest = rest.replace(/^[\s\-–—:\/>]+/, '').trim();
      cur = { name: sm[1].trim(), times, notes: rest ? [rest] : [], rows: [], vocals: [] };
      song.sections.push(cur); return;
    }
    if (line.startsWith('>')) { const v = line.slice(1).trim(); if (v) ensure().notes.push(v); return; }
    if (line.includes('|')) { const r = parseRow(line, lineNo); if (r.length) ensure().rows.push(r); return; }
    ensure().notes.push(line);
  });
  song.meter = meterOf(song.meta.time);
  song.sections.forEach((s, si) => {
    let bi = 0;
    extendEndings(s.rows.flat());
    for (const r of s.rows) for (const b of r) {
      b.layout = layoutBar(b, song.meter); b.id = `${si}:${bi++}`;
      if (b.melody) b.mel = melodyInfo(b.melody, song.meter);
    }
    s.vocalsOut = assignVocals(s);
  });
  return song;
}

/** Erros (level "error") e avisos ("warn") de formatação, com a linha do texto. */
export function validateSong(text) {
  const song = typeof text === 'string' ? parseSong(text) : text;
  const issues = [];
  if (song.meter.invalid) issues.push({ line: song.metaLines.time || 1, level: 'error', where: 'Cabeçalho', msg: `Compasso "${song.meta.time}" não reconhecido (use 4/4, 3/4, 6/8…). Usando 4/4.` });
  for (const s of song.sections) {
    let n = 0;
    const flat = s.rows.flat();
    const played = new Set(expandRepeats(flat));
    for (const b of flat) {
      n++;
      const L = b.layout;
      const where = `${s.name || 'Sem seção'}, compasso ${n}`;
      // com frase escrita, o que vale é a soma das notas (os acordes só ficam em cima delas)
      if (b.mel?.error) issues.push({ line: b.line, level: 'error', where, msg: b.mel.error });
      else if ((L.error || L.warn) && !b.melody) issues.push({ line: b.line, level: L.error ? 'error' : 'warn', where, msg: L.error || L.warn });
      else if (L.error) issues.push({ line: b.line, level: 'error', where, msg: L.error });
      if (b.passes && !played.has(n - 1)) {
        issues.push({ line: b.line, level: 'warn', where, msg: `A casa ${b.ending}. nunca é tocada — confira o número de repetições do ritornelo (ex.: :| x${Math.max(...b.passes)})` });
      }
    }
    // letra de uma passada que nunca acontece (ex.: [5] num ritornelo x4)
    const plays = {};
    for (const bi of expandRepeats(flat)) plays[bi] = (plays[bi] || 0) + (s.times || 1);
    for (const v of s.vocals || []) {
      if (!v.pass) continue;
      if (!v.bar) { issues.push({ line: v.line, level: 'warn', where: s.name || 'Sem seção', msg: `voz [${v.pass}]: diga o compasso (ex.: voz 1 [${v.pass}]: …)` }); continue; }
      const n = plays[v.bar - 1] || 0;
      if (v.bar <= flat.length && v.pass > n) issues.push({ line: v.line, level: 'warn', where: s.name || 'Sem seção', msg: `voz ${v.bar} [${v.pass}]: o compasso ${v.bar} toca ${n === 1 ? 'só 1 vez' : `${n} vezes`}` });
    }
    for (const v of s.vocalsOut || []) {
      issues.push({ line: v.line, level: 'warn', where: s.name || 'Sem seção', msg: `voz ${v.bar}: a seção tem ${flat.length} ${flat.length === 1 ? 'compasso' : 'compassos'}` });
    }
  }
  return issues.sort((a, b) => a.line - b.line);
}

export function wrapRows(rows, cols) { const out = []; rows.forEach(r => { for (let i = 0; i < r.length; i += cols) out.push(r.slice(i, i + cols)); }); return out; }
export const rowHasTop = row => row.some(b => b.note || b.passes || (b.end && b.times));

export function chordParts(tok) {
  const m = tok.match(CH); if (!m) return null;
  const parts = [{ k: 'root', s: m[1][0] }];
  if (m[1].length > 1) parts.push({ k: 'acc', s: m[1].slice(1) });
  let q = m[2] || '';
  if (/^m(?!aj)/.test(q)) { parts.push({ k: 'mi', s: 'm' }); q = q.slice(1); }
  if (q) parts.push({ k: 'q', s: q });
  if (m[3]) parts.push({ k: 'bs', s: '/' + m[3] });
  return parts;
}

/* ---------------- transposição ---------------- */
const SH = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FL = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const EXTRA = { Cb: 11, Fb: 4, 'E#': 5, 'B#': 0 };
const noteIdx = n => { let i = SH.indexOf(n); if (i < 0) i = FL.indexOf(n); if (i < 0 && n in EXTRA) i = EXTRA[n]; return i; };

export function transposeText(text, st) {
  let useFlat = st < 0;
  const km = text.match(/^\s*tom\s*:\s*([A-G][#b]?)(m(?!aj))?/im);
  if (km && noteIdx(km[1]) >= 0) {
    const ni = (noteIdx(km[1]) + st + 120) % 12;
    useFlat = km[2] ? [2, 7, 0, 5, 10, 3].includes(ni) : [5, 10, 3, 8, 1].includes(ni);
  }
  const tn = n => { const i = noteIdx(n); return i < 0 ? n : (useFlat ? FL : SH)[(i + st + 120) % 12]; };
  const tc = t => { const m = t.match(CH); return m ? tn(m[1]) + m[2] + (m[3] ? '/' + tn(m[3]) : '') : t; };
  // tom antigo e novo (para as frases com notas, que seguem a armadura)
  const oldKey = km ? km[1] + (km[2] || '') : '', newKey = km ? tn(km[1]) + (km[2] || '') : '';
  const chords = p => p.split('"').map((q, i) => i % 2 ? q : q.replace(/[^\s|:"]+/g, tc)).join('"');
  return text.split('\n').map(line => {
    const k = line.match(/^(\s*tom\s*:\s*)(.*)$/i);
    if (k) return k[1] + k[2].replace(/[A-G][#b]?/, tn);
    if (!line.includes('|')) return line;
    // {frase em notas} é transposta nota a nota; o resto da linha, acorde a acorde
    return line.split(/(\{[^}]*\}?)/).map(p => p.startsWith('{') ? '{' + transposeMelody(p.replace(/^\{|\}$/g, ''), st, oldKey, newKey, useFlat) + (p.endsWith('}') ? '}' : '') : chords(p)).join('');
  }).join('\n');
}

/* ---------------- pausa ---------------- */
// "-" ou "pausa" = pausa (silêncio) naquele tempo. Desenhada como pausa de semínima.
export const isRest = t => t === '-' || norm(t) === 'pausa';
// contorno da pausa num quadro de 12 x 28 (mesmo desenho na prévia e no PDF)
export const REST_PTS = (() => {
  const pts = [[3, 1], [9, 8], [4, 14], [9, 20]];
  const q = (p0, c, p1) => { for (let i = 1; i <= 6; i++) { const t = i / 6, u = 1 - t; pts.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]); } };
  q([9, 20], [3, 17.5], [3.5, 22.5]); q([3.5, 22.5], [3.5, 25.5], [7, 27]);
  return pts;
})();

/* ---------------- reprodução (modo apresentação) ---------------- */
const UNIT_SYMBOL = { 2: '𝅗𝅥', 4: '♩', 8: '♪', 16: '𝅘𝅥𝅯' };

/**
 * Em que figura o BPM é contado. Compassos compostos (6/8, 9/8, 12/8) contam a
 * semínima pontuada (♩. = bpm); os demais, a figura do denominador (♩ em x/4, ♪ em x/8).
 */
export function pulseInfo(meter) {
  const compound = meter.unit === 8 && meter.beats >= 6 && meter.beats % 3 === 0;
  return compound
    ? { pulses: meter.beats / 3, symbol: '♩.', compound: true }
    : { pulses: meter.beats, symbol: UNIT_SYMBOL[meter.unit] || '♩', compound: false };
}
/** Lê o BPM do cabeçalho ("76", "76 bpm", "92,5"). */
export function parseBpm(v) {
  const m = String(v ?? '').replace(',', '.').match(/\d+(\.\d+)?/);
  const n = m ? parseFloat(m[0]) : NaN;
  return n >= 20 && n <= 400 ? n : null;
}
/** Duração de um compasso, em segundos. */
export function barSeconds(meter, bpm) { return pulseInfo(meter).pulses * 60 / bpm; }

// Ordem de execução dos compassos de uma seção: ritornelos |: :| (xN) e casas 1./2.
function expandRepeats(bars) {
  const seq = []; let i = 0, start = 0, pass = 1, guard = 0;
  while (i < bars.length && guard++ < 5000) {
    const b = bars[i];
    if (b.start && i !== start) { start = i; pass = 1; }
    if (b.passes && !b.passes.includes(pass)) { i++; continue; }   // casa de outra passada
    seq.push(i);
    if (b.end) {
      const times = b.times || 2;
      if (pass < times) { pass++; i = start; continue; }
      pass = 1; start = i + 1;
    }
    i++;
  }
  return seq;
}

/**
 * Roteiro da música: compassos na ordem em que são tocados, já com as repetições
 * de seção ([Refrão] x2), ritornelos e casas. Cada passo: { id, sec, bar, beats }.
 */
/** Quantos compassos cada seção soma ao ser tocada (com repetições). */
export function sectionLengths(song) {
  return song.sections.map(sec => {
    const flat = sec.rows.flat();
    return flat.length ? expandRepeats(flat).length * (sec.times || 1) : 0;
  });
}

export function buildTimeline(song) {
  const steps = [];
  song.sections.forEach((sec, si) => {
    const flat = sec.rows.flat();
    if (!flat.length) return;
    const seq = expandRepeats(flat);
    const count = {}; // n = quantas vezes este compasso já tocou nesta seção (1ª, 2ª…) — letra por passada
    for (let r = 0; r < (sec.times || 1); r++) {
      for (const bi of seq) { count[bi] = (count[bi] || 0) + 1; steps.push({ id: flat[bi].id, sec: si, bar: bi, beats: song.meter.beats, pass: r, n: count[bi] }); }
    }
  });
  return steps;
}

/* ---------------- compasso em duas linhas ---------------- */
/**
 * Quando o compasso tem mais de 2 acordes, divide em duas linhas (1ª metade dos tempos em cima,
 * 2ª embaixo) para os acordes ficarem maiores. Só divide se nenhum acorde atravessa o meio.
 * Retorna [{ grid, spans: [{ tok, start, len }] }] — 1 ou 2 linhas.
 */
export function barLines(layout) {
  const { grid, spans } = layout;
  if (spans.length <= 2 || grid < 4) return [{ grid, spans }];
  const half = Math.ceil(grid / 2);
  if (spans.some(s => s.start < half && s.start + s.len > half)) return [{ grid, spans }];
  return [
    { grid: half, spans: spans.filter(s => s.start < half) },
    { grid: grid - half, spans: spans.filter(s => s.start >= half).map(s => ({ ...s, start: s.start - half })) },
  ];
}
/** A linha da grade tem algum compasso em duas linhas? */
export const rowIsTall = row => row.some(b => b.layout && barLines(b.layout).length > 1);

/* ---------- folha do setlist (lista de músicas que abre o PDF do show) ---------- */
export const COVER_LAYOUTS = ['detalhada', 'compacta', 'colunas'];
/** Tamanhos da letra da folha do setlist, em %. 0 = automático (o maior que cabe em 1 folha). */
export const COVER_STEPS = [160, 150, 140, 130, 120, 110, 100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40];
export const COVER_SCALE_MIN = 40, COVER_SCALE_MAX = 160;
/** O que aparece na folha (tudo ligado por padrão). */
export const COVER_OPTS = [
  ['num', 'Numeração'], ['artist', 'Artista'], ['key', 'Tom'], ['bpm', 'BPM'],
  ['info', 'Data e local'], ['notes', 'Observações do show'],
];
export function coverOpts(o) {
  let v = o;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  const out = {};
  for (const [k] of COVER_OPTS) out[k] = !(v && typeof v === 'object' && v[k] === false);
  return out;
}
export const validCoverScale = n => Number.isInteger(n) && (n === 0 || (n >= COVER_SCALE_MIN && n <= COVER_SCALE_MAX));

/* ---------- pauta: largura de cada compasso e quebra em linhas ---------- */
// Na pauta não há "compassos por linha": cada compasso tem a largura que suas cifras pedem
// (todas no mesmo tamanho) e as linhas se formam como numa partitura.
const REL_W = { root: 1, acc: 0.58, mi: 0.8, q: 0.55, bs: 0.72 };
const CHAR_EM = 0.62; // largura média de um caractere em negrito (fração do tamanho da fonte)
/** Largura estimada do acorde, em "em" (tamanho da fonte da cifra = 1). */
export function tokenEm(tok) {
  if (tok === '%' || tok === '/' || tok === '.' || tok === '_') return 0;
  if (isRest(tok)) return 0.5;
  const parts = chordParts(tok);
  if (!parts) return tok.length * 0.55 * CHAR_EM;
  return parts.reduce((w, p) => w + p.s.length * REL_W[p.k] * CHAR_EM, 0);
}
/**
 * Largura natural do compasso na pauta (na unidade de `measure`): cada cifra cabe inteira no espaço dos
 * seus tempos. `gap` = folga em volta de cada cifra, `pad` = margens do compasso.
 */
export function staffBarWidth(b, measure = tokenEm, { gap = 0.6, pad = 0.6, repeat = 0.7 } = {}) {
  const L = b.layout; let inner = 0;
  for (const sp of L.spans) { const w = measure(sp.tok); if (w > 0) inner = Math.max(inner, (w + gap) * L.grid / sp.len); }
  return inner + pad + (b.start ? repeat : 0) + (b.end ? repeat : 0);
}
/**
 * Quebra os compassos em linhas de largura W e estica cada linha até W (como numa partitura).
 * A última linha só estica se já estiver quase cheia. Retorna [[{ i, w }]] (i = índice em `widths`).
 */
export function flowStaff(widths, W, { lastFill = 0.72 } = {}) {
  const lines = []; let cur = [], sum = 0;
  widths.forEach((w0, i) => {
    const w = Math.min(w0, W);
    if (cur.length && sum + w > W + 0.01) { lines.push(cur); cur = []; sum = 0; }
    cur.push(i); sum += w;
  });
  if (cur.length) lines.push(cur);
  return lines.map((idx, li) => {
    const nat = idx.reduce((a, i) => a + Math.min(widths[i], W), 0);
    let f = nat > 0 ? W / nat : 1;
    if (li === lines.length - 1 && nat / W < lastFill) f = Math.min(f, 1.15);
    return idx.map(i => ({ i, w: Math.min(widths[i], W) * f }));
  });
}

/* ---------- letra no roteiro (visão do cantor) ---------- */
/**
 * Percorre o roteiro tocado e devolve o que o cantor lê, na ordem: cabeçalho de cada seção
 * ({ kind:'sec', k, name, bars, lines }) e cada linha da letra ({ kind:'line', k, text }),
 * onde k = passo do roteiro em que a seção/linha começa. Refrão repetido aparece de novo.
 */
export function lyricEvents(song, timeline) {
  const out = []; let prev = null, head = null;
  timeline.forEach((st, k) => {
    const sec = song.sections[st.sec];
    if (!prev || prev.sec !== st.sec || prev.pass !== st.pass) {
      head = { kind: 'sec', k, name: sec.name || '', bars: 0, lines: 0 };
      out.push(head);
    }
    head.bars++;
    const b = sec.rows.flat()[st.bar];
    if (b && b.voice) {
      // letra da passada (voz 3 [2]: …) ou a geral do compasso
      const text = (b.voice.passes && b.voice.passes[st.n]) ?? b.voice.text ?? '';
      const only = b.voice.passes && Object.keys(b.voice.passes).length && !b.voice.text && !(st.n in b.voice.passes);
      if (!only) { out.push({ kind: 'line', k, text }); head.lines++; }
    }
    prev = st;
  });
  return out;
}
