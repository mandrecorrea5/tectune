import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSong, validateSong, buildTimeline, barSeconds, pulseInfo, parseBpm, meterOf, transposeText } from '../src/index.js';

const order = song => buildTimeline(parseSong(song)).map(s => s.id);

test('fórmula de compasso', () => {
  assert.equal(meterOf('6/8').beats, 6);
  assert.equal(meterOf('4x4').label, '4/4');
  assert.equal(meterOf('C|').label, '2/2');
  assert.ok(meterOf('abc').invalid);
});

test('tempos: erro quando passa da fórmula', () => {
  const issues = validateSong('compasso: 3/4\n| C D E F |\n| C D E |');
  assert.equal(issues.filter(i => i.level === 'error').length, 1);
  assert.equal(issues[0].line, 2);
});

test('pausa conta como tempo', () => {
  const s = parseSong('compasso: 4/4\n| C - |\n| G / - - |');
  const [a, b] = s.sections[0].rows[0].concat(s.sections[0].rows[1]);
  assert.deepEqual(a.layout.spans.map(x => [x.tok, x.len]), [['C', 2], ['-', 2]]);
  assert.deepEqual(b.layout.spans.map(x => [x.tok, x.len]), [['G', 2], ['-', 1], ['-', 1]]);
});

test('roteiro: seção x2', () => {
  assert.deepEqual(order('[A] x2\n| C | G |\n[B]\n| F |'), ['0:0', '0:1', '0:0', '0:1', '1:0']);
});

test('roteiro: ritornelo e casas 1/2', () => {
  // | A |: B | 1. C :| 2. D | E |
  assert.deepEqual(order('[X]\n| A |: B | 1. C :| 2. D | E |'), ['0:0', '0:1', '0:2', '0:1', '0:3', '0:4']);
});

test('roteiro: ritornelo x3 sem |:', () => {
  assert.deepEqual(order('[X]\n| A | B :| x3\n| C |'), ['0:0', '0:1', '0:0', '0:1', '0:0', '0:1', '0:2']);
});

test('roteiro: dois ritornelos seguidos', () => {
  assert.deepEqual(order('[X]\n|: A :|: B :|'), ['0:0', '0:0', '0:1', '0:1']);
});

test('tempo do compasso', () => {
  assert.equal(barSeconds(meterOf('4/4'), 60), 4);
  assert.equal(barSeconds(meterOf('3/4'), 120), 1.5);
  assert.ok(pulseInfo(meterOf('6/8')).compound);
  assert.equal(barSeconds(meterOf('6/8'), 60), 2);   // ♩. = 60 → 2 pulsos
  assert.equal(barSeconds(meterOf('7/8'), 120), 3.5);
  assert.equal(parseBpm('76 bpm'), 76);
  assert.equal(parseBpm(''), null);
});

test('transposição', () => {
  assert.match(transposeText('tom: G\n| G | D/F# |', 1), /tom: Ab\n\| Ab \| Eb\/G \|/);
});

test('compasso em duas linhas', async () => {
  const { barLines } = await import('../src/index.js');
  const lay = t => parseSong('compasso: ' + t.split('|')[0] + '\n|' + t.split('|').slice(1).join('|')).sections[0].rows[0][0].layout;
  assert.equal(barLines(lay('4/4| C G |')).length, 1);                     // 2 acordes: 1 linha
  assert.deepEqual(barLines(lay('4/4| C D E F |')).map(l => l.spans.map(s => s.tok)), [['C', 'D'], ['E', 'F']]);
  assert.deepEqual(barLines(lay('4/4| C / G A |')).map(l => l.spans.map(s => [s.tok, s.start, s.len])), [[['C', 0, 2]], [['G', 0, 1], ['A', 1, 1]]]);
  assert.equal(barLines(lay('4/4| C D / E |')).length, 1);                 // D atravessa o meio
  assert.deepEqual(barLines(lay('6/8| C D E F G A |')).map(l => l.grid), [3, 3]);
  assert.equal(barLines(lay('3/4| C D E |')).length, 1);                   // 3 tempos: 1 linha
});

test('casas com várias passadas (1-3. / 4.)', async () => {
  const { sectionLengths } = await import('../src/index.js');
  // intro de 16 compassos: 4 vezes um bloco de 4, com o último compasso diferente na 4ª vez
  const intro = '[Intro]\n|: Bbm | Gb | Ab | 1-3. Bbm :| x4\n| 4. Gb |';
  const ids = order(intro);
  assert.equal(ids.length, 16);
  assert.deepEqual(ids.slice(0, 4), ['0:0', '0:1', '0:2', '0:3']);
  assert.deepEqual(ids.slice(12), ['0:0', '0:1', '0:2', '0:4']);
  assert.deepEqual(sectionLengths(parseSong(intro)), [16]);
  const s = parseSong(intro);
  assert.equal(s.sections[0].rows[0][3].ending, '1-3');
  assert.equal(validateSong(intro).length, 0);
});

test('casa que ocupa dois compassos até o :|', () => {
  // passadas 1 e 2: A B C D ; passada 3 (última): A B E
  const ids = order('[X]\n|: A | B | 1,2. C | D :| x3\n| 3. E |');
  assert.deepEqual(ids, ['0:0', '0:1', '0:2', '0:3', '0:0', '0:1', '0:2', '0:3', '0:0', '0:1', '0:4']);
});

test('aviso de casa que nunca toca', () => {
  const issues = validateSong('[X]\n|: A | 1. B :| 3. C |');
  assert.ok(issues.some(i => i.level === 'warn' && /nunca é tocada/.test(i.msg)));
});
