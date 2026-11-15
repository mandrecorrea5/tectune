// Visão em pauta: frases com notas escritas em ABC dentro do compasso ({A2 c2 e2 a2}),
// entradas da voz ("voz 5: texto") e transposição das notas junto com a cifra.
// JavaScript puro, sem dependências.

/* ---------------- frase em ABC: leitura e duração ---------------- */
// Durações em colcheias (L:1/8): "A" = 1 colcheia, "A2" = semínima, "A/" = semicolcheia, "A3/2" = colcheia pontuada.
function readDur(s, i) {
  const m = s.slice(i).match(/^(\d*)(\/*)(\d*)/);
  const num = m[1] ? +m[1] : 1;
  let den = 1;
  if (m[2]) den = m[3] ? +m[3] * 2 ** (m[2].length - 1) : 2 ** m[2].length;
  return { d: num / den, len: m[0].length };
}

/**
 * Lê a frase em ABC. Retorna { tokens, total, error }: cada token { kind: note|rest|chord, start, len, idx, pitches },
 * com início e duração em colcheias, e `idx` = onde o token começa no texto (para encaixar a cifra em cima).
 */
export function scanMelody(src) {
  const s = String(src || '');
  const tokens = []; let i = 0, t = 0, tup = null, broken = 0, pending = null, error = null;
  const push = (kind, d, idx, pitches) => {
    let len = d;
    if (tup) { len *= tup.q / tup.p; if (--tup.n <= 0) tup = null; }
    if (broken) { len *= broken; broken = 0; }
    tokens.push({ kind, start: t, len, idx: pending ?? idx, pitches }); t += len; pending = null;
  };
  const NOTE = /^(\^{1,2}|_{1,2}|=)?([A-Ga-g])([',]*)/;
  while (i < s.length && !error) {
    const c = s[i];
    if (/\s|`|\|/.test(c)) { i++; continue; }
    if (c === '"' || c === '!' || c === '+') {           // cifra/texto ou ornamento: pertence à próxima nota
      const j = s.indexOf(c, i + 1); if (pending == null) pending = i; i = j < 0 ? s.length : j + 1; continue;
    }
    if (c === '(') {
      const m = s.slice(i).match(/^\((\d)(?::(\d)?)?(?::(\d))?/);
      if (m) {
        const p = +m[1], q = m[2] ? +m[2] : ({ 2: 3, 3: 2, 4: 3, 6: 2, 8: 3 }[p] || 2);
        tup = { p, q, n: m[3] ? +m[3] : p }; if (pending == null) pending = i; i += m[0].length;
      } else i++;                                         // ligadura de expressão
      continue;
    }
    if (c === ')' || c === '-' || c === '.' || c === '~') { i++; continue; }
    if (c === '>' || c === '<') {                         // ritmo pontuado: a>b = a pontuada, b curta
      const run = s.slice(i).match(/^[<>]+/)[0]; const f = 1 - 0.5 ** run.length;
      const last = tokens[tokens.length - 1];
      if (!last) { error = `"${c}" sem nota antes`; break; }
      const old = last.len; last.len = old * (c === '>' ? 1 + f : 1 - f); t += last.len - old;
      broken = c === '>' ? 1 - f : 1 + f; i += run.length; continue;
    }
    if (c === '[') {
      if (/^\[[A-Za-z]:[^\]]*\]/.test(s.slice(i))) { i = s.indexOf(']', i) + 1; continue; } // campo [K:...]
      const close = s.indexOf(']', i);
      if (close < 0) { error = 'acorde "[" sem "]"'; break; }
      const inner = s.slice(i + 1, close); const pitches = []; let j = 0, d0 = null;
      while (j < inner.length) {
        const m = inner.slice(j).match(NOTE);
        if (!m) { if (/\s|-/.test(inner[j])) { j++; continue; } error = `"${inner[j]}" não reconhecido no acorde`; break; }
        pitches.push({ from: i + 1 + j, to: i + 1 + j + m[0].length, acc: m[1] || '', letter: m[2], oct: m[3] });
        j += m[0].length; const d = readDur(inner, j); if (d0 == null) d0 = d.d; j += d.len;
      }
      if (error) break;
      const idx = i; i = close + 1; const d = readDur(s, i); i += d.len;
      push('chord', (d0 ?? 1) * d.d, idx, pitches); continue;
    }
    const nm = s.slice(i).match(NOTE);
    if (nm) {
      const pit = { from: i, to: i + nm[0].length, acc: nm[1] || '', letter: nm[2], oct: nm[3] };
      const idx = i; i += nm[0].length; const d = readDur(s, i); i += d.len;
      push('note', d.d, idx, [pit]); continue;
    }
    if (c === 'z' || c === 'x') { const idx = i; i++; const d = readDur(s, i); i += d.len; push('rest', d.d, idx, []); continue; }
    error = `"${c}" não reconhecido na frase`;
  }
  return { tokens, total: t, error };
}

const fmtNum = n => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace('.', ','));
/** Confere se a frase preenche o compasso. Retorna { units, expected, error } (em colcheias). */
export function melodyInfo(melody, meter) {
  const r = scanMelody(melody);
  const expected = meter.beats * 8 / meter.unit;
  if (r.error) return { units: r.total, expected, error: `Frase com notas: ${r.error}` };
  if (!r.tokens.length) return { units: 0, expected, error: null };
  if (Math.abs(r.total - expected) > 1e-6) {
    const have = r.total * meter.unit / 8;
    return { units: r.total, expected, error: `A frase soma ${fmtNum(have)} ${meter.unitName}, mas ${meter.label} comporta ${meter.beats}` };
  }
  return { units: r.total, expected, error: null };
}

/* ---------------- entradas da voz ---------------- */
/**
 * Coloca as linhas "voz:" da seção nos compassos. "voz 5: texto" fixa no compasso 5;
 * "voz: texto" sem número reparte as linhas pelos compassos livres entre as fixas.
 * Marca b.voice = { text, line } no compasso e devolve as que caem fora da seção.
 */
export function assignVocals(sec) {
  const flat = sec.rows.flat(); const n = flat.length; const out = [];
  const all = sec.vocals || [];
  if (!all.length) return out;
  const place = (e, at) => {
    if (at >= n || at < 0) { out.push(e); return; }
    const b = flat[at];
    if (!b.voice) b.voice = { text: '', line: e.line, passes: {} };
    if (e.pass) { const t = b.voice.passes[e.pass]; b.voice.passes[e.pass] = t ? `${t} / ${e.text}` : e.text; }
    else if (e.text) b.voice.text = b.voice.text ? `${b.voice.text} / ${e.text}` : e.text;
  };
  // letra por passada ("voz 3 [2]: …") vai direto no compasso indicado
  for (const e of all) if (e.pass && e.bar) place(e, e.bar - 1);
  const v = all.filter(e => !e.pass);
  let i = 0, prevAt = -1;
  while (i < v.length) {
    if (v[i].bar) { prevAt = v[i].bar - 1; place(v[i], prevAt); i++; continue; }
    let j = i; while (j < v.length && !v[j].bar) j++;
    const a = prevAt + 1, b = j < v.length ? v[j].bar - 1 : n, k = j - i;
    for (let q = 0; q < k; q++) {
      const at = b > a ? a + Math.floor(q * (b - a) / k) : Math.min(a, n - 1);
      place(v[i + q], at); prevAt = at;
    }
    i = j;
  }
  return out;
}

/**
 * Linhas da letra para mostrar embaixo do compasso: a geral e, se houver, uma por passada
 * ("1. …", "2. …" — como as estrofes numeradas de um songbook).
 */
export function voiceLines(v) {
  if (!v) return [];
  const ps = Object.keys(v.passes || {}).map(Number).sort((a, b) => a - b);
  const out = v.text ? [v.text] : [];
  for (const p of ps) out.push(`${p}. ${v.passes[p]}`);
  return out;
}

/* ---------------- armadura / transposição das notas ---------------- */
const SHARP_ORDER = 'FCGDAEB', FLAT_ORDER = 'BEADGCF';
const MAJ = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const MIN = { A: 0, E: 1, B: 2, 'F#': 3, 'C#': 4, 'G#': 5, 'D#': 6, 'A#': 7, D: -1, G: -2, C: -3, F: -4, Bb: -5, Eb: -6, Ab: -7 };
/** "Bbm" → { abc: 'Bbm', acc: { B: -1, E: -1, ... } } */
export function keyInfo(key) {
  const m = String(key || '').trim().match(/^([A-G])([#b]?)(m(?!aj))?/);
  if (!m) return { abc: 'C', acc: {} };
  const root = m[1] + m[2]; const minor = !!m[3];
  const n = (minor ? MIN : MAJ)[root] ?? 0;
  const acc = {};
  if (n > 0) for (const L of SHARP_ORDER.slice(0, n)) acc[L] = 1;
  if (n < 0) for (const L of FLAT_ORDER.slice(0, -n)) acc[L] = -1;
  return { abc: root + (minor ? 'm' : ''), acc };
}
const LET = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACC_VAL = { '^^': 2, '^': 1, '': 0, '=': 0, _: -1, __: -2 };
const SPELL_S = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const SPELL_F = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

/** Transpõe uma frase ABC em `st` semitons, da armadura do tom antigo para a do novo. */
export function transposeMelody(src, st, oldKey, newKey, useFlat) {
  const r = scanMelody(src); if (r.error) return src;
  const ko = keyInfo(oldKey).acc, kn = keyInfo(newKey).acc;
  const oldBar = {}, newBar = {}; // acidentes que valem até o fim do compasso
  const reps = [];
  for (const tk of r.tokens) for (const p of tk.pitches) {
    const L = p.letter.toUpperCase();
    const octave = (p.letter === L ? 4 : 5) + (p.oct.match(/'/g) || []).length - (p.oct.match(/,/g) || []).length;
    const keyA = p.letter.toUpperCase() + octave;
    let a;
    if (p.acc) { a = ACC_VAL[p.acc]; oldBar[keyA] = a; } else a = keyA in oldBar ? oldBar[keyA] : (ko[L] || 0);
    const midi = 12 * (octave + 1) + LET[L] + a + st;
    const [nl, na] = (useFlat ? SPELL_F : SPELL_S)[((midi % 12) + 12) % 12];
    const oct2 = Math.floor((midi - (LET[nl] + na)) / 12) - 1;
    const k2 = nl + oct2;
    const implied = k2 in newBar ? newBar[k2] : (kn[nl] || 0);
    let accStr = '';
    if (na !== implied) { accStr = na === 1 ? '^' : na === -1 ? '_' : na === 2 ? '^^' : na === -2 ? '__' : '='; newBar[k2] = na; }
    const letter = oct2 >= 5 ? nl.toLowerCase() : nl;
    const marks = oct2 >= 5 ? "'".repeat(oct2 - 5) : ','.repeat(4 - oct2);
    reps.push({ from: p.from, to: p.to, s: accStr + letter + marks });
  }
  let out = src;
  for (const rp of reps.sort((a, b) => b.from - a.from)) out = out.slice(0, rp.from) + rp.s + out.slice(rp.to);
  return out;
}
