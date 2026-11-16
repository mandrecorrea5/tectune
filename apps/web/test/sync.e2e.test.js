// Teste de ponta a ponta da sincronização (precisa da API rodando).
// Uso: BASE_URL=http://localhost:3000 node --test test/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const BASE = (process.env.BASE_URL || 'http://localhost:3000') + '/api';
// conta e banda próprias deste teste (o repertório agora é da banda)
const auth = { token: null, band: null };
const call = async (method, path, body) => {
  const headers = { 'content-type': 'application/json' };
  if (auth.token) headers.authorization = 'Bearer ' + auth.token;
  if (auth.band) headers['x-band'] = auth.band;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const sync = (since, changes = {}) => call('POST', '/sync', { since, changes });
const iso = ms => new Date(Date.now() + ms).toISOString();

test('sincronização offline-first', async t => {
  const reg = await call('POST', '/auth/register', { name: 'Teste Sync', email: `sync-${randomUUID()}@teste.dev`, password: 'segredo123' });
  assert.equal(reg.status, 201);
  const v = await call('POST', '/auth/verify', { token: new URL(reg.body.devLink).searchParams.get('confirmar') });
  auth.token = v.body.token;
  const band = await call('POST', '/bands', { name: 'Banda do teste de sync' });
  assert.equal(band.status, 201);
  auth.band = band.body.id;
  const full = await sync(null);
  assert.equal(full.status, 200);
  let cursor = full.body.cursor;

  const S1 = randomUUID(), L1 = randomUUID();
  const t0 = iso(-60000);

  await t.test('criar música e setlist offline', async () => {
    const r = await sync(cursor, {
      songs: [{ id: S1, content: 'título: Offline 1\ntom: G\nbpm: 80\n[A]\n| G | D |', font_scale: 0, updated_at: t0 }],
      setlists: [{ id: L1, name: 'Show do celular', event_date: '2026-12-20', venue: 'Bar', cols: 4, song_ids: [S1], updated_at: t0 }],
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.applied, { songs: 1, setlists: 1, deletions: 0 });
    const sl = (await call('GET', '/setlists/' + L1)).body;
    assert.equal(sl.name, 'Show do celular');
    assert.equal(sl.songs[0].title, 'Offline 1');
    assert.equal(sl.songs[0].font_scale, 0);
    cursor = r.body.cursor;
  });

  await t.test('edição no web aparece no próximo pull', async () => {
    await call('PUT', '/songs/' + S1, { content: 'título: Editada no web\n[A]\n| C |' });
    const r = await sync(cursor);
    const s = r.body.songs.find(x => x.id === S1);
    assert.equal(s.title, 'Editada no web');
    cursor = r.body.cursor;
  });

  await t.test('alteração antiga do celular não sobrescreve a mais nova do web', async () => {
    const r = await sync(cursor, { songs: [{ id: S1, content: 'título: Antiga\n', updated_at: iso(-30000) }] });
    assert.equal(r.body.applied.songs, 0);
    assert.equal((await call('GET', '/songs/' + S1)).body.title, 'Editada no web');
  });

  await t.test('alteração mais nova do celular vence', async () => {
    const r = await sync(cursor, { songs: [{ id: S1, content: 'título: Nova do celular\n', updated_at: iso(0) }] });
    assert.equal(r.body.applied.songs, 1);
    assert.equal((await call('GET', '/songs/' + S1)).body.title, 'Nova do celular');
    cursor = r.body.cursor;
  });

  await t.test('pull incremental não repete o que não mudou', async () => {
    const r = await sync(cursor);
    assert.ok(!r.body.songs.some(x => x.id === S1 && x.title !== 'Nova do celular'));
    assert.ok(r.body.songs.length <= 1); // no máximo o eco da última gravação
  });

  await t.test('exclusão no web chega ao celular e atualiza a setlist', async () => {
    await call('DELETE', '/songs/' + S1);
    const r = await sync(cursor);
    assert.ok(r.body.deletions.some(d => d.entity === 'song' && d.id === S1));
    const sl = r.body.setlists.find(x => x.id === L1);
    assert.ok(sl, 'setlist veio no pull');
    assert.deepEqual(sl.song_ids, []);
    cursor = r.body.cursor;
  });

  await t.test('edição anterior à exclusão não ressuscita a música', async () => {
    const r = await sync(cursor, { songs: [{ id: S1, content: 'título: Zumbi\n', updated_at: iso(-20000) }] });
    assert.equal(r.body.applied.songs, 0);
    assert.equal((await call('GET', '/songs/' + S1)).status, 404);
  });

  await t.test('setlist apagada no celular some do servidor', async () => {
    const r = await sync(cursor, { deletions: [{ entity: 'setlist', id: L1, deleted_at: iso(0) }] });
    assert.equal(r.body.applied.deletions, 1);
    assert.equal((await call('GET', '/setlists/' + L1)).status, 404);
  });

  await t.test('criado e apagado offline: registra a exclusão', async () => {
    const X = randomUUID();
    const r = await sync(cursor, { deletions: [{ entity: 'song', id: X, deleted_at: iso(0) }] });
    assert.equal(r.status, 200);
    assert.ok(r.body.deletions.some(d => d.id === X));
  });

  await t.test('dados inválidos são recusados', async () => {
    const r = await sync(cursor, { songs: [{ id: 'abc', content: 'x', updated_at: iso(0) }] });
    assert.equal(r.status, 400);
    const r2 = await sync(cursor, { setlists: [{ id: randomUUID(), name: '  ', updated_at: iso(0) }] });
    assert.equal(r2.status, 400);
  });
});
