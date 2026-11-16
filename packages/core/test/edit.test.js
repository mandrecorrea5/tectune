import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSong, validateSong, buildTimeline, locateBar, setBarChords, addBarChord, insertBarAfter, appendBar, deleteBar,
  toggleRepeatStart, toggleRepeatEnd, setRepeatTimes, setBarEnding, setBarNote, setBarLyric, barLyric, appendSection,
  keyChords, usedChords,
} from '../src/index.js';
import * as E from '../src/index.js';
import { barPlays } from '../src/index.js';

const SONG = `título: Teste
tom: G
bpm: 90

[Intro]
|: G | D/F# | 1. Em "breque" | C :| x2 | 2. Am |

[Verso]
| G | C |
| D | G |
voz 1: primeira frase
`;
const run = (fn, text, ...a) => fn(text, a[0], parseSong(text), ...a.slice(1));
const toks = (text, id) => { const s = parseSong(text); const [si, bi] = id.split(':').map(Number); return s.sections[si].rows.flat()[bi].tokens; };

test('localiza o compasso no texto', () => {
  const s = parseSong(SONG);
  const loc = locateBar(SONG, '0:2', s);
  const line = SONG.split('\n')[loc.li];
  assert.equal(line.slice(loc.start, loc.end).trim(), '1. Em "breque"');
  assert.equal(locateBar(SONG, '0:4', s) && SONG.split('\n')[locateBar(SONG, '0:4', s).li].slice(locateBar(SONG, '0:4', s).start, locateBar(SONG, '0:4', s).end).trim(), '2. Am');
});

test('troca acordes e mantém repetição, casa e anotação', () => {
  const r = run(setBarChords, SONG, '0:2', ['Bm', 'B7'], { advance: true });
  assert.equal(r.id, '0:3');
  const b = parseSong(r.text).sections[0].rows.flat()[2];
  assert.deepEqual(b.tokens, ['Bm', 'B7']);
  assert.equal(b.note, 'breque'); assert.equal(b.ending, '1');
  assert.equal(parseSong(r.text).sections[0].rows.flat()[3].times, 2);
  // o último compasso da seção avança para a próxima seção
  assert.equal(run(setBarChords, SONG, '0:4', ['A'], { advance: true }).id, '1:0');
});

test('mais um acorde no compasso', () => {
  const r = run(addBarChord, SONG, '1:0', 'D');
  assert.deepEqual(toks(r.text, '1:0'), ['G', 'D']);
  const e = run(insertBarAfter, SONG, '1:1');
  assert.deepEqual(toks(run(addBarChord, e.text, e.id, 'F').text, e.id), ['F']);
});

test('cria compasso depois de um ritornelo com x2', () => {
  const r = run(insertBarAfter, SONG, '0:3', ['E']);
  assert.equal(r.id, '0:4');
  const flat = parseSong(r.text).sections[0].rows.flat();
  assert.deepEqual(flat.map(b => b.tokens.join(' ')), ['G', 'D/F#', 'Em', 'C', 'E', 'Am']);
  assert.equal(flat[3].times, 2);
});

test('compasso no fim da seção: mesma linha até 4, depois linha nova', () => {
  const a = run(appendBar, SONG, 1, ['A']);
  assert.equal(a.id, '1:4');
  assert.deepEqual(parseSong(a.text).sections[1].rows.map(r => r.length), [2, 3]);
  const full = `[A]\n| C | D | E | F |`;
  const n = run(appendBar, full, 0, ['G']);
  assert.equal(n.text, '[A]\n| C | D | E | F |\n| G |');
  const s2 = `[A]\n| C | D |`;
  const b = run(appendBar, s2, 0, ['E']);
  assert.equal(b.text, '[A]\n| C | D | E |');
});

test('apaga compasso e linha vazia', () => {
  const r = run(deleteBar, SONG, '1:1');
  assert.deepEqual(parseSong(r.text).sections[1].rows.flat().map(b => b.tokens[0]), ['G', 'D', 'G']);
  const s = `[A]\n| C | D |\n| E |\n[B]\n| F |`;
  const d = run(deleteBar, s, '0:2');
  assert.equal(d.text, '[A]\n| C | D |\n[B]\n| F |');
  assert.equal(d.id, '0:1');
});

test('repetição: liga, muda vezes e desliga', () => {
  const s = `[A]\n| C | D | E | F |`;
  let r = run(toggleRepeatStart, s, '0:1');
  r = run(toggleRepeatEnd, r.text, '0:2');
  let flat = parseSong(r.text).sections[0].rows.flat();
  assert.ok(flat[1].start); assert.ok(flat[2].end); assert.equal(flat[2].times, 2);
  assert.deepEqual(buildTimeline(parseSong(r.text)).map(x => x.bar), [0, 1, 2, 1, 2, 3]);
  r = run(setRepeatTimes, r.text, '0:2', 3);
  assert.equal(parseSong(r.text).sections[0].rows.flat()[2].times, 3);
  r = run(toggleRepeatEnd, r.text, '0:2');
  r = run(toggleRepeatStart, r.text, '0:1');
  flat = parseSong(r.text).sections[0].rows.flat();
  assert.deepEqual(flat.map(b => b.tokens[0]), ['C', 'D', 'E', 'F']);
  assert.ok(!flat.some(b => b.start || b.end || b.times));
  // fim de linha sem barra final
  const t = run(toggleRepeatEnd, `[A]\n| C | D`, '0:1');
  assert.equal(parseSong(t.text).sections[0].rows.flat()[1].times, 2);
});

test('casa e anotação', () => {
  let r = run(setBarEnding, SONG, '1:1', '1-3');
  assert.deepEqual(parseSong(r.text).sections[1].rows.flat()[1].passes, [1, 2, 3]);
  r = run(setBarEnding, r.text, '1:1', '');
  assert.equal(parseSong(r.text).sections[1].rows.flat()[1].passes, undefined);
  r = run(setBarNote, SONG, '1:1', 'só "bateria"');
  assert.equal(parseSong(r.text).sections[1].rows.flat()[1].note, "só 'bateria'");
  r = run(setBarNote, r.text, '1:1', '');
  assert.equal(parseSong(r.text).sections[1].rows.flat()[1].note, '');
});

test('letra do compasso', () => {
  assert.equal(barLyric(parseSong(SONG), '1:0'), 'primeira frase');
  let r = run(setBarLyric, SONG, '1:0', 'frase nova');
  assert.equal(barLyric(parseSong(r.text), '1:0'), 'frase nova');
  r = run(setBarLyric, r.text, '1:2', 'segunda');
  assert.equal(barLyric(parseSong(r.text), '1:2'), 'segunda');
  assert.match(r.text, /voz 3: segunda/);
  r = run(setBarLyric, r.text, '1:0', '');
  assert.equal(barLyric(parseSong(r.text), '1:0'), '');
  assert.equal(validateSong(r.text).length, 0);
  // linhas "voz:" sem número: a que cai no compasso vira a fixa
  const s = `[A]\n| C | D | E | F |\nvoz: um\nvoz: dois`;
  const q = run(setBarLyric, s, '0:2', 'DOIS');
  assert.equal(barLyric(parseSong(q.text), '0:2'), 'DOIS');
  assert.equal(barLyric(parseSong(q.text), '0:0'), 'um');
});

test('nova seção', () => {
  const t = appendSection(SONG, 'Refrão');
  const s = parseSong(t);
  assert.equal(s.sections[2].name, 'Refrão');
  assert.deepEqual(s.sections[2].rows.flat()[0].tokens, ['_']);
  assert.equal(appendBar(t, 2, s, ['G']).id, '2:1');
});

test('acordes do tom', () => {
  assert.deepEqual(keyChords('G').map(x => x.chord), ['G', 'Am', 'Bm', 'C', 'D', 'D7', 'Em']);
  assert.deepEqual(keyChords('Bbm').map(x => x.chord), ['Bbm', 'Db', 'Ebm', 'Fm', 'F', 'Gb', 'Ab']);
  assert.deepEqual(keyChords('F#').map(x => x.chord).slice(0, 3), ['F#', 'G#m', 'A#m']);
  assert.deepEqual(keyChords(''), []);
  assert.deepEqual(usedChords(parseSong(SONG), ['G', 'C']).sort(), ['Am', 'D', 'D/F#', 'Em']);
});

/* ---------- cabeçalho, seções e letra por passada ---------- */
const BASE = 'título: X\nartista:\ntom: C\nbpm: 90\ncompasso: 4/4\n\n[Intro]\n| C | G |\n\n[Verso] x2\n| Am | F |\nvoz 1: oi\nvoz 1 [2]: tchau\n\n[Refrão]\n|: C | G :| x3\n';

test('setMeta troca, cria e apaga linhas do cabeçalho', () => {
  let t = E.setMeta(BASE, 'title', 'Garota de Ipanema');
  assert.equal(parseSong(t).meta.title, 'Garota de Ipanema');
  t = E.setMeta(t, 'artist', 'Tom Jobim');
  assert.equal(parseSong(t).meta.artist, 'Tom Jobim');
  assert.equal(t.split('\n').filter(l => /^artista/.test(l)).length, 1, 'reaproveita a linha vazia');
  t = E.setMeta(t, 'bpm', '130'); t = E.setMeta(t, 'time', '3/4'); t = E.setMeta(t, 'notes', 'capo na 2');
  const s = parseSong(t);
  assert.equal(s.meta.bpm, '130'); assert.equal(s.meter.label, '3/4'); assert.equal(s.meta.notes, 'capo na 2');
  assert.equal(s.sections.length, 3, 'não mexe nas seções');
  t = E.setMeta(t, 'notes', '');
  assert.equal(parseSong(t).meta.notes, undefined);
  // música sem cabeçalho: a linha entra no topo
  assert.match(E.setMeta('[A]\n| C |\n', 'title', 'Nova'), /^título: Nova\n\[A\]/);
});

test('seções: renomear, repetir, duplicar, mover e apagar', () => {
  const s = parseSong(BASE);
  const names = t => parseSong(t).sections.map(x => x.name + (x.times ? ' x' + x.times : ''));
  assert.deepEqual(names(E.renameSection(BASE, s, 0, 'Abertura')), ['Abertura', 'Verso x2', 'Refrão']);
  assert.deepEqual(names(E.setSectionTimes(BASE, s, 1, 1)), ['Intro', 'Verso', 'Refrão']);
  assert.deepEqual(names(E.setSectionTimes(BASE, s, 2, 4)), ['Intro', 'Verso x2', 'Refrão x4']);
  assert.deepEqual(names(E.duplicateSection(BASE, s, 0)), ['Intro', 'Intro', 'Verso x2', 'Refrão']);
  assert.deepEqual(names(E.moveSection(BASE, s, 2, -1)), ['Intro', 'Refrão', 'Verso x2']);
  assert.deepEqual(names(E.moveSection(BASE, s, 0, -1)), ['Intro', 'Verso x2', 'Refrão'], 'primeira não sobe');
  const d = E.deleteSection(BASE, s, 1);
  assert.deepEqual(names(d), ['Intro', 'Refrão']);
  assert.doesNotMatch(d, /voz/, 'a letra vai junto');
  assert.equal(parseSong(E.moveSection(BASE, s, 1, 1)).sections[2].vocals.length, 2, 'letra acompanha a seção');
  // seção sem cabeçalho ganha um ao ser renomeada
  const t2 = 'título: Y\n| C | G |\n';
  assert.deepEqual(names(E.renameSection(t2, parseSong(t2), 0, 'Intro')), ['Intro']);
});

test('letra por passada: lê, escreve e não mexe na letra geral', () => {
  const s = parseSong(BASE);
  assert.equal(barPlays(s, '1:0'), 2); assert.equal(barPlays(s, '2:1'), 3); assert.equal(barPlays(s, '0:0'), 1);
  assert.deepEqual(E.barLyricPasses(s, '1:0'), { 2: 'tchau' });
  let t = E.setBarLyricPass(BASE, '1:0', s, 'olá', 1).text;
  let p = parseSong(t);
  assert.deepEqual(E.barLyricPasses(p, '1:0'), { 1: 'olá', 2: 'tchau' });
  assert.equal(E.barLyric(p, '1:0'), 'oi');
  t = E.setBarLyricPass(t, '1:0', p, '', 2).text; p = parseSong(t);
  assert.deepEqual(E.barLyricPasses(p, '1:0'), { 1: 'olá' });
  // mexer na letra geral não apaga as passadas
  t = E.setBarLyric(t, '1:0', p, 'mudou').text; p = parseSong(t);
  assert.equal(E.barLyric(p, '1:0'), 'mudou'); assert.deepEqual(E.barLyricPasses(p, '1:0'), { 1: 'olá' });
});
