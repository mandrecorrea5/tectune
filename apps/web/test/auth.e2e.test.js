// Teste de ponta a ponta de contas, bandas, convites e permissões (precisa da API rodando).
// Uso: BASE_URL=http://localhost:3000 node --test test/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const ROOT = process.env.BASE_URL || 'http://localhost:3000';
const call = async (method, path, body, { token, band } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (band) headers['x-band'] = band;
  const r = await fetch(ROOT + '/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};

test('contas, bandas e permissões', async t => {
  const tag = randomUUID().slice(0, 8);
  const ana = { email: `ana-${tag}@teste.dev`, password: 'senha-ana-1' };
  const beto = { email: `beto-${tag}@teste.dev`, password: 'senha-beto-1' };
  let A, B, band, song;

  await t.test('sem login não acessa o repertório', async () => {
    assert.equal((await call('GET', '/setlists')).status, 401);
  });

  await t.test('cadastro, e-mail repetido e senha curta', async () => {
    const r = await call('POST', '/auth/register', { name: 'Ana', ...ana });
    assert.equal(r.status, 201); A = r.body.token;
    assert.equal((await call('POST', '/auth/register', { name: 'Ana 2', ...ana })).status, 409);
    assert.equal((await call('POST', '/auth/register', { name: 'X', email: `x-${tag}@teste.dev`, password: '123' })).status, 400);
    B = (await call('POST', '/auth/register', { name: 'Beto', ...beto })).body.token;
  });

  await t.test('login certo e errado', async () => {
    assert.equal((await call('POST', '/auth/login', { email: ana.email, password: 'errada' })).status, 401);
    const r = await call('POST', '/auth/login', { email: ana.email.toUpperCase(), password: ana.password });
    assert.equal(r.status, 200); assert.equal(r.body.user.name, 'Ana');
  });

  await t.test('criar banda (quem cria é admin) e editar repertório', async () => {
    const r = await call('POST', '/bands', { name: 'Banda ' + tag }, { token: A });
    assert.equal(r.status, 201); assert.equal(r.body.role, 'admin'); band = r.body.id;
    const s = await call('POST', '/songs', { content: 'título: Da Ana\n[A]\n| G |' }, { token: A, band });
    assert.equal(s.status, 201); song = s.body.id;
  });

  await t.test('quem não é da banda não vê nada', async () => {
    assert.equal((await call('GET', '/songs', null, { token: B, band })).status, 403);
  });

  await t.test('convite por e-mail; aceitar entra como membro', async () => {
    // quem ainda não tem conta recebe e-mail (simulado em dev) e fica como convite pendente
    const ghost = await call('POST', `/bands/${band}/invites`, { email: `ninguem-${tag}@teste.dev` }, { token: A });
    assert.equal(ghost.status, 201); assert.equal(ghost.body.invites.length, 1);
    await call('DELETE', `/bands/${band}/invites/${ghost.body.invites[0].id}`, null, { token: A });
    assert.equal((await call('POST', `/bands/${band}/invites`, { email: beto.email }, { token: B })).status, 403);
    const inv = await call('POST', `/bands/${band}/invites`, { email: beto.email }, { token: A });
    assert.equal(inv.status, 201); assert.equal(inv.body.invites.length, 1);
    const me = await call('GET', '/me', null, { token: B });
    assert.equal(me.body.invites.length, 1); assert.equal(me.body.invites[0].band_name, 'Banda ' + tag);
    const ok = await call('POST', `/invites/${me.body.invites[0].id}/accept`, null, { token: B });
    assert.equal(ok.body.bands.find(b => b.id === band).role, 'membro');
  });

  await t.test('membro vê mas não edita (nem pela sincronização)', async () => {
    const list = await call('GET', '/songs', null, { token: B, band });
    assert.equal(list.status, 200); assert.ok(list.body.some(s => s.id === song));
    assert.equal((await call('PUT', '/songs/' + song, { content: 'título: Hack' }, { token: B, band })).status, 403);
    const sy = await call('POST', '/sync', { since: null, changes: { songs: [{ id: song, content: 'título: Hack\n', updated_at: new Date().toISOString() }] } }, { token: B, band });
    assert.equal(sy.status, 200); assert.equal(sy.body.readonly, true); assert.equal(sy.body.applied.songs, 0);
    assert.equal((await call('GET', '/songs/' + song, null, { token: A, band })).body.title, 'Da Ana');
  });

  await t.test('promover a admin libera a edição; banda nunca fica sem admin', async () => {
    const info = await call('GET', `/bands/${band}`, null, { token: A });
    const ana_id = info.body.members.find(m => m.name === 'Ana').id;
    const beto_id = info.body.members.find(m => m.name === 'Beto').id;
    assert.equal((await call('PATCH', `/bands/${band}/members/${ana_id}`, { role: 'membro' }, { token: A })).status, 400);
    assert.equal((await call('PATCH', `/bands/${band}/members/${beto_id}`, { role: 'admin' }, { token: A })).status, 200);
    assert.equal((await call('PUT', '/songs/' + song, { content: 'título: Do Beto\n[A]\n| C |' }, { token: B, band })).status, 200);
    // Beto sai; Ana continua admin
    assert.equal((await call('DELETE', `/bands/${band}/members/${beto_id}`, null, { token: B })).status, 200);
    assert.equal((await call('GET', '/songs', null, { token: B, band })).status, 403);
  });

  await t.test('sair da conta invalida o token', async () => {
    assert.equal((await call('POST', '/auth/logout', null, { token: A })).status, 204);
    assert.equal((await call('GET', '/me', null, { token: A })).status, 401);
  });
});
