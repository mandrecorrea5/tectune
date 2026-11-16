// Link do show (sem cadastro): criar, abrir sem conta, ao vivo como convidado, trocar e desligar.
// Uso: BASE_URL=http://localhost:3000 node --test test/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const WebSocket = require('ws');

const ROOT = process.env.BASE_URL || 'http://localhost:3000';
const BASE = ROOT + '/api';
const call = async (method, path, body, a = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (a.token) headers.authorization = 'Bearer ' + a.token;
  if (a.band) headers['x-band'] = a.band;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
async function account(name) {
  const reg = await call('POST', '/auth/register', { name, email: `share-${randomUUID()}@teste.dev`, password: 'segredo123' });
  assert.equal(reg.status, 201);
  const v = await call('POST', '/auth/verify', { token: new URL(reg.body.devLink).searchParams.get('confirmar') });
  return { token: v.body.token };
}
const wsOpen = url => new Promise(resolve => {
  const ws = new WebSocket(url);
  ws.on('open', () => resolve({ ws, ok: true }));
  ws.on('unexpected-response', (req, res) => resolve({ ok: false, status: res.statusCode }));
  ws.on('error', () => resolve({ ok: false }));
});
const nextMsg = (ws, t, ok = () => true) => new Promise(resolve => { const h = raw => { const m = JSON.parse(raw); if (m.t === t && ok(m)) { ws.off('message', h); resolve(m); } }; ws.on('message', h); });

test('link do show', async t => {
  const admin = await account('Admin do link');
  const band = await call('POST', '/bands', { name: 'Banda do link' }, admin);
  admin.band = band.body.id;
  const song = await call('POST', '/songs', { content: 'título: Música do link\ntom: G\nbpm: 90\n[A]\n| G | D |' }, admin);
  const sl = await call('POST', '/setlists', { name: 'Show do link' }, admin);
  await call('PUT', `/setlists/${sl.body.id}/songs`, { songIds: [song.body.id] }, admin);
  let tok;

  await t.test('admin cria o link e recebe o mesmo de novo', async () => {
    const a = await call('POST', `/setlists/${sl.body.id}/share`, {}, admin);
    assert.equal(a.status, 200);
    tok = a.body.share_token;
    assert.match(tok, /^[A-Za-z0-9_-]{24}$/);
    const b = await call('POST', `/setlists/${sl.body.id}/share`, {}, admin);
    assert.equal(b.body.share_token, tok);
    const g = await call('GET', `/setlists/${sl.body.id}`, null, admin);
    assert.equal(g.body.share_token, tok);
  });

  await t.test('qualquer pessoa abre o show pelo link, sem conta', async () => {
    const r = await call('GET', `/public/shows/${tok}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'Show do link');
    assert.equal(r.body.band_name, 'Banda do link');
    assert.equal(r.body.songs.length, 1);
    assert.match(r.body.songs[0].content, /\| G \| D \|/);
    assert.equal(r.body.share_token, undefined);
    const page = await fetch(`${ROOT}/s/${tok}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<html/);
  });

  await t.test('link errado não abre e não dá para editar sem conta', async () => {
    assert.equal((await call('GET', '/public/shows/xxxxxxxxxxxxxxxxxxxxxxxx')).status, 404);
    assert.equal((await call('GET', '/public/shows/curto')).status, 404);
    assert.equal((await call('PUT', `/songs/${song.body.id}`, { content: 'x' })).status, 401);
  });

  await t.test('membro não admin não cria link', async () => {
    const other = await account('Outro');
    const r = await call('POST', `/setlists/${sl.body.id}/share`, {}, { ...other, band: admin.band });
    assert.ok([403, 404].includes(r.status));
  });

  await t.test('convidado entra no ao vivo, mas não comanda', async () => {
    const room = sl.body.id;
    const bad = await wsOpen(`${ROOT.replace('http', 'ws')}/api/live?room=${room}&share=yyyyyyyyyyyyyyyyyyyyyyyy`);
    assert.equal(bad.ok, false);
    const g = await wsOpen(`${ROOT.replace('http', 'ws')}/api/live?room=${room}&share=${tok}`);
    assert.equal(g.ok, true);
    const p1 = nextMsg(g.ws, 'peers', m => m.members[0]?.inst === 'baixo');
    g.ws.send(JSON.stringify({ t: 'hello', name: 'Rafa', view: 'musico', inst: 'baixo' }));
    const peers = await p1;
    assert.equal(peers.members[0].inst, 'baixo');
    assert.equal(peers.members[0].guest, true);
    g.ws.send(JSON.stringify({ t: 'lead' }));
    const p2 = nextMsg(g.ws, 'peers', m => m.members[0]?.name === 'Rafa 2');
    g.ws.send(JSON.stringify({ t: 'hello', name: 'Rafa 2', view: 'musico', inst: 'baixo' }));
    const after = await p2;
    assert.equal(after.director, null);

    // trocar o link derruba quem entrou pelo antigo
    const closed = new Promise(r => g.ws.on('close', code => r(code)));
    const n = await call('POST', `/setlists/${sl.body.id}/share`, { reset: true }, admin);
    assert.notEqual(n.body.share_token, tok);
    assert.equal(await closed, 4003);
    assert.equal((await call('GET', `/public/shows/${tok}`)).status, 404);
    tok = n.body.share_token;
  });

  await t.test('desligar o link', async () => {
    assert.equal((await call('DELETE', `/setlists/${sl.body.id}/share`, null, admin)).status, 204);
    assert.equal((await call('GET', `/public/shows/${tok}`)).status, 404);
  });
});
