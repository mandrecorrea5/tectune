// Edição visual da cifra: cada ação (pôr um acorde no compasso, criar ou apagar compasso, repetição,
// casa, anotação, letra) muda só o trecho do texto daquele compasso. O texto continua sendo a fonte:
// quem prefere digitar vê exatamente o que o editor visual escreveu.
// Os compassos são identificados como no parser: "seção:compasso" (ex.: "1:3").

/* ---------- localizar o compasso no texto ---------- */
const TIMES = /^:?\s*x\s*\d+$/i;

/** Lê o trecho entre duas barras: repetição, casa, acordes, anotações e frase. */
export function splitBar(seg) {
  let s = String(seg).trim(); const p = { start: false, end: false, ending: '', tokens: [], notes: [], melody: [] };
  if (s.startsWith(':')) { p.start = true; s = s.slice(1).trim(); }
  if (s.endsWith(':')) { p.end = true; s = s.slice(0, -1).trim(); }
  s = s.replace(/\{[^}]*\}?/g, m => { p.melody.push(m.endsWith('}') ? m : m + '}'); return ' '; });
  s = s.replace(/"([^"]*)"?/g, (m, n) => { if (n.trim()) p.notes.push(n.trim()); return ' '; }).trim();
  const em = s.match(/^(\d{1,2}(?:\s*[-,]\s*\d{1,2})*)\.(?=\s|$)\s*/);
  if (em) { p.ending = em[1].replace(/\s+/g, ''); s = s.slice(em[0].length); }
  p.tokens = s.split(/\s+/).filter(Boolean);
  return p;
}
/** O inverso de splitBar. Compasso sem acordes vira "_" (compasso vazio). */
export function joinBar(p) {
  const parts = [];
  if (p.ending) parts.push(p.ending + '.');
  parts.push(...(p.tokens.length ? p.tokens : (p.melody.length ? [] : ['_'])));
  parts.push(...p.melody);
  for (const n of p.notes) parts.push(`"${n.replace(/"/g, "'")}"`);
  return (p.start ? ':' : '') + ' ' + parts.join(' ') + ' ' + (p.end ? ':' : '');
}
const isBar = seg => { const p = splitBar(seg); return p.tokens.length || p.start || p.end || p.notes.length || p.ending || p.melody.length; };

/** Trechos de compasso de uma linha, na ordem: [{ start, end }] (posições no texto da linha). */
export function barSegments(line) {
  const out = []; let pos = 0;
  for (const seg of String(line).split('|')) {
    const start = pos; pos += seg.length + 1;
    const t = seg.trim();
    if (!t) continue;
    if (TIMES.test(t) && out.length) continue; // "x4" depois de ":|"
    if (!isBar(seg)) continue;
    out.push({ start, end: start + seg.length });
  }
  return out;
}

/** Onde fica o compasso `id` no texto: { li (índice da linha), start, end, si, bi, bar }. */
export function locateBar(text, id, song) {
  const [si, bi] = String(id).split(':').map(Number);
  const sec = song.sections[si]; if (!sec) return null;
  const flat = sec.rows.flat(); const bar = flat[bi]; if (!bar) return null;
  const k = flat.filter(b => b.line === bar.line).indexOf(bar);
  const lines = text.split('\n');
  const seg = barSegments(lines[bar.line - 1] || '')[k]; if (!seg) return null;
  return { li: bar.line - 1, start: seg.start, end: seg.end, si, bi, bar };
}

/* ---------- ações ---------- */
// cada ação recebe (texto, id do compasso, song já lido) e devolve { text, id } (id = compasso selecionado depois)
function editSeg(text, id, song, fn) {
  const loc = locateBar(text, id, song); if (!loc) return { text, id };
  const lines = text.split('\n'); const line = lines[loc.li];
  const p = splitBar(line.slice(loc.start, loc.end));
  const extra = fn(p, loc, lines) || {};
  const seg = joinBar(p);
  lines[loc.li] = line.slice(0, loc.start) + seg + line.slice(loc.end);
  let out = lines.join('\n');
  if (extra.after) out = extra.after(out, { ...loc, end: loc.start + seg.length });
  return { text: out, id: extra.id || id };
}
const nextId = (song, id) => {
  const [si, bi] = id.split(':').map(Number);
  const n = song.sections[si]?.rows.flat().length || 0;
  if (bi + 1 < n) return `${si}:${bi + 1}`;
  for (let s = si + 1; s < song.sections.length; s++) if (song.sections[s].rows.flat().length) return `${s}:0`;
  return id;
};

/** Troca os acordes do compasso. `advance`: seleciona o próximo compasso depois. */
export function setBarChords(text, id, song, tokens, { advance = false } = {}) {
  const r = editSeg(text, id, song, p => { p.tokens = tokens.filter(Boolean); });
  return advance ? { text: r.text, id: nextId(song, id) } : r;
}
/** Mais um acorde no compasso (divide o compasso). Tira o "_" e o "%" se estiverem sozinhos. */
export function addBarChord(text, id, song, tok) {
  return editSeg(text, id, song, p => {
    p.tokens = p.tokens.filter(t => t !== '_' && t !== '%' && t.toUpperCase() !== 'N.C.');
    p.tokens.push(tok);
  });
}
/** Compasso novo logo depois deste (na mesma linha), já selecionado. */
export function insertBarAfter(text, id, song, tokens = ['_']) {
  const loc = locateBar(text, id, song); if (!loc) return { text, id };
  const lines = text.split('\n'); const line = lines[loc.li];
  const seg = joinBar({ start: false, end: false, ending: '', tokens, notes: [], melody: [] });
  let at = loc.end; // logo depois do "|" que fecha o compasso (e do "x4" do ritornelo, se houver)
  if (line[at] === '|') {
    at++;
    const m = line.slice(at).match(/^\s*x\s*\d+\s*(?=\||$)/i);
    if (m) { at += m[0].length; if (line[at] === '|') at++; else { lines[loc.li] = line.slice(0, at) + ' |' + seg + '|' + line.slice(at); return { text: lines.join('\n'), id: `${loc.si}:${loc.bi + 1}` }; } }
    lines[loc.li] = line.slice(0, at) + seg + '|' + line.slice(at);
  } else lines[loc.li] = line.slice(0, at) + '|' + seg + '|' + line.slice(at);
  return { text: lines.join('\n'), id: `${loc.si}:${loc.bi + 1}` };
}
/** Compasso novo no fim da seção (numa linha nova se a última já tiver 4 ou mais). */
export function appendBar(text, si, song, tokens = ['_']) {
  const sec = song.sections[si]; if (!sec) return { text, id: null };
  const flat = sec.rows.flat();
  if (flat.length) {
    const last = flat[flat.length - 1];
    if (flat.filter(b => b.line === last.line).length < 4) return insertBarAfter(text, `${si}:${flat.length - 1}`, song, tokens);
    const lines = text.split('\n');
    lines.splice(last.line, 0, '|' + joinBar({ start: false, end: false, ending: '', tokens, notes: [], melody: [] }) + '|');
    return { text: lines.join('\n'), id: `${si}:${flat.length}` };
  }
  // seção ainda sem compassos: a linha entra logo depois do título da seção
  const lines = text.split('\n');
  const headLine = sectionHeadLine(lines, song, si);
  lines.splice(headLine + 1, 0, '|' + joinBar({ start: false, end: false, ending: '', tokens, notes: [], melody: [] }) + '|');
  return { text: lines.join('\n'), id: `${si}:0` };
}
function sectionHeadLine(lines, song, si) {
  // n-ésimo "[Seção]" do texto (o parser cria seção sem nome se a cifra começa sem título de seção)
  const named = song.sections.slice(0, si + 1).filter(s => s.name).length;
  let seen = 0;
  for (let i = 0; i < lines.length; i++) if (/^\s*\[.+?\]/.test(lines[i]) && ++seen === named) return i;
  return lines.length - 1;
}
/** Apaga o compasso (e a linha, se ficar vazia). */
export function deleteBar(text, id, song) {
  const loc = locateBar(text, id, song); if (!loc) return { text, id };
  const lines = text.split('\n'); const line = lines[loc.li];
  let next = line.slice(0, loc.start) + line.slice(line[loc.end] === '|' ? loc.end + 1 : loc.end);
  if (!barSegments(next).length) lines.splice(loc.li, 1); else lines[loc.li] = next;
  const n = song.sections[loc.si].rows.flat().length;
  const sel = n <= 1 ? null : `${loc.si}:${Math.min(loc.bi, n - 2)}`;
  return { text: lines.join('\n'), id: sel };
}
/** Liga/desliga o início da repetição "|:" neste compasso. */
export function toggleRepeatStart(text, id, song) {
  return editSeg(text, id, song, p => { p.start = !p.start; });
}
/** Liga/desliga o fim da repetição ":|" neste compasso (ligando, toca 2 vezes). */
export function toggleRepeatEnd(text, id, song, times = 2) {
  let on;
  return editSeg(text, id, song, p => {
    p.end = !p.end; on = p.end;
    return { after: (t, loc) => setTimesAt(t, loc, on ? times : null) };
  });
}
/** Quantas vezes o ritornelo que termina neste compasso toca. */
export function setRepeatTimes(text, id, song, times) {
  const loc = locateBar(text, id, song); if (!loc || !loc.bar.end) return { text, id };
  return { text: setTimesAt(text, loc, Math.max(2, Math.min(99, times | 0))), id };
}
function setTimesAt(text, loc, times) {
  const lines = text.split('\n'); const line = lines[loc.li];
  let at = loc.end;
  if (line[at] !== '|') { if (times != null) lines[loc.li] = line.replace(/\s*$/, '') + ` | x${times}`; return lines.join('\n'); }
  at++;
  const m = line.slice(at).match(/^\s*x\s*\d+\s*/i);
  if (times == null) {
    if (!m) return text;
    let cut = at + m[0].length; if (line[cut] === '|') cut++;
    const rest = line.slice(cut).replace(/^\s*/, '');
    lines[loc.li] = (line.slice(0, at) + (rest ? ' ' + rest : '')).replace(/\s+$/, '');
  } else if (m) lines[loc.li] = line.slice(0, at) + ` x${times} ` + line.slice(at + m[0].length);
  else lines[loc.li] = line.slice(0, at) + ` x${times} |` + line.slice(at);
  return lines.join('\n');
}
/** Casa (ex.: "1", "2", "1-3"); vazio tira. */
export function setBarEnding(text, id, song, spec) {
  const v = String(spec || '').replace(/[^\d,\-]/g, '').replace(/^[-,]+|[-,]+$/g, '');
  return editSeg(text, id, song, p => { p.ending = v; });
}
/** Anotação em cima do compasso (breque, só bateria…); vazio tira. */
export function setBarNote(text, id, song, note) {
  const v = String(note || '').replace(/"/g, "'").trim();
  return editSeg(text, id, song, p => { p.notes = v ? [v] : []; });
}

/* ---------- letra embaixo do compasso ---------- */
// mesmo critério do assignVocals: em que compasso cai cada linha "voz:" sem passada
function vocalPlacement(sec) {
  const n = sec.rows.flat().length; const v = (sec.vocals || []).filter(e => !e.pass); const at = new Map();
  let i = 0, prevAt = -1;
  while (i < v.length) {
    if (v[i].bar) { prevAt = v[i].bar - 1; at.set(v[i], prevAt); i++; continue; }
    let j = i; while (j < v.length && !v[j].bar) j++;
    const a = prevAt + 1, b = j < v.length ? v[j].bar - 1 : n, k = j - i;
    for (let q = 0; q < k; q++) { const x = b > a ? a + Math.floor(q * (b - a) / k) : Math.min(a, n - 1); at.set(v[i + q], x); prevAt = x; }
    i = j;
  }
  return at;
}
/** Letra geral do compasso (sem as passadas). */
export function barLyric(song, id) {
  const [si, bi] = String(id).split(':').map(Number);
  return song.sections[si]?.rows.flat()[bi]?.voice?.text || '';
}
/** Escreve a letra do compasso como "voz N: texto" (fixa no compasso). Vazio apaga. */
export function setBarLyric(text, id, song, lyric) {
  const [si, bi] = String(id).split(':').map(Number);
  const sec = song.sections[si]; if (!sec || !sec.rows.flat()[bi]) return { text, id };
  const v = String(lyric || '').replace(/\s+/g, ' ').trim();
  const lines = text.split('\n');
  const mine = [...vocalPlacement(sec)].filter(([, at]) => at === bi).map(([e]) => e.line - 1).sort((a, b) => a - b);
  const entry = `voz ${bi + 1}: ${v}`;
  if (mine.length) {
    const [first, ...others] = mine;
    if (v) lines[first] = entry; else others.unshift(first);
    for (const li of others.sort((a, b) => b - a)) lines.splice(li, 1);
  } else if (v) {
    const last = Math.max(...sec.rows.flat().map(b => b.line), ...(sec.vocals || []).map(e => e.line));
    lines.splice(last, 0, entry);
  }
  return { text: lines.join('\n'), id };
}

/** Nova seção no fim da música, com um compasso vazio. */
export function appendSection(text, name = 'Seção') {
  const clean = String(name).replace(/[\[\]]/g, '').trim() || 'Seção';
  const body = text.replace(/\s*$/, '');
  return body + `\n\n[${clean}]\n| _ |\n`;
}

/* ---------- acordes do tom (barra de acordes) ---------- */
const SH = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FL = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
/**
 * Acordes do campo harmônico do tom, com o grau: "G" → I G, ii Am, iii Bm, IV C, V D, V7 D7, vi Em.
 * Menor: "Bbm" → i Bbm, III Db, iv Ebm, v Fm, V F, VI Gb, VII Ab.
 */
export function keyChords(key) {
  const m = String(key || '').trim().match(/^([A-G])([#b]?)(m(?!aj))?/);
  if (!m) return [];
  const root = m[1] + m[2]; const minor = !!m[3];
  let ri = SH.indexOf(root); if (ri < 0) ri = FL.indexOf(root); if (ri < 0) return [];
  const flat = m[2] === 'b' || (m[2] !== '#' && (minor ? [2, 7, 0, 5, 10, 3].includes(ri) : [5, 10, 3, 8, 1].includes(ri)));
  const N = i => (flat ? FL : SH)[(ri + i) % 12];
  const deg = minor
    ? [['i', 0, 'm'], ['III', 3, ''], ['iv', 5, 'm'], ['v', 7, 'm'], ['V', 7, ''], ['VI', 8, ''], ['VII', 10, '']]
    : [['I', 0, ''], ['ii', 2, 'm'], ['iii', 4, 'm'], ['IV', 5, ''], ['V', 7, ''], ['V7', 7, '7'], ['vi', 9, 'm']];
  return deg.map(([d, i, q]) => ({ deg: d, chord: N(i) + q }));
}
/** Acordes mais usados na música (para a barra de acordes), sem repetir os do tom. */
export function usedChords(song, exclude = [], max = 6) {
  const count = new Map();
  for (const s of song.sections) for (const b of s.rows.flat()) for (const t of b.tokens) {
    if (!/^[A-G]/.test(t)) continue;
    count.set(t, (count.get(t) || 0) + 1);
  }
  const ex = new Set(exclude);
  return [...count].filter(([c]) => !ex.has(c)).sort((a, b) => b[1] - a[1]).slice(0, max).map(([c]) => c);
}
