import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSong, validateSong, buildTimeline, locateBar, setBarChords, addBarChord, insertBarAfter, appendBar, deleteBar,
  toggleRepeatStart, toggleRepeatEnd, setRepeatTimes, setBarEnding, setBarNote, setBarLyric, barLyric, appendSection,
  keyChords, usedChords,
} from '../src/index.js';

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
