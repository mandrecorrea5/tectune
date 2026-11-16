// Recuperação de senha e convite por e-mail (modo desenvolvimento: e-mail simulado, link volta na resposta).
const test = require('node:test');
const assert = require('node:assert');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const tag = Math.random().toString(36).slice(2, 8);

async function call(method, path, body, token, band) {
  const r = await fetch(BASE + '/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(band ? { 'X-Band': band } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = r.status === 204 ? null : await r.json().catch(() => null);
  return { status: r.status, data };
}

async function registered(name, email, password) {
  const r = await call('POST', '/auth/register', { name, email, password });
  assert.equal(r.status, 201);
  const v = await call('POST', '/auth/verify', { token: new URL(r.data.devLink).searchParams.get('confirmar') });
  assert.equal(v.status, 200);
  return { status: 201, data: v.data };
}

test('confirmação de e-mail: reenviar link, link antigo continua valendo até usar', async () => {
  const email = `conf-${tag}@t.dev`;
  const r = await call('POST', '/auth/register', { name: 'Caio', email, password: 'segredo1' });
  assert.equal(r.status, 201);
  const again = await call('POST', '/auth/register', { name: 'Caio', email, password: 'segredo1' });
  assert.equal(again.status, 409); assert.equal(again.data.code, 'unverified');
  const re = await call('POST', '/auth/resend', { email });
  assert.equal(re.status, 200); assert.ok(re.data.devLink);
  const v = await call('POST', '/auth/verify', { token: new URL(re.data.devLink).searchParams.get('confirmar') });
  assert.equal(v.status, 200); assert.ok(v.data.token);
  // depois de confirmado, os outros links deixam de valer e o reenvio não manda nada
  assert.equal((await call('POST', '/auth/verify', { token: new URL(r.data.devLink).searchParams.get('confirmar') })).status, 400);
  assert.equal((await call('POST', '/auth/resend', { email })).data.devLink, undefined);
  assert.equal((await call('POST', '/auth/login', { email, password: 'segredo1' })).status, 200);
});

test('esqueci minha senha: link único, troca a senha e desconecta os aparelhos', async () => {
  const email = `reset-${tag}@t.dev`;
  const reg = await registered('Ana', email, 'antiga1');
  assert.equal((await call('GET', '/auth/options')).data.passwordReset, true);

  // e-mail inexistente: mesma resposta, sem link
  const ghost = await call('POST', '/auth/forgot', { email: `ninguem-${tag}@t.dev` });
  assert.equal(ghost.status, 200); assert.equal(ghost.data.devLink, undefined);

  const f = await call('POST', '/auth/forgot', { email: email.toUpperCase() });
  assert.equal(f.status, 200);
  const token = new URL(f.data.devLink).searchParams.get('redefinir');
  assert.ok(token);

  assert.equal((await call('POST', '/auth/reset', { token, password: '123' })).status, 400);
  const r = await call('POST', '/auth/reset', { token, password: 'nova123' });
  assert.equal(r.status, 200); assert.ok(r.data.token);

  assert.equal((await call('POST', '/auth/reset', { token, password: 'outra123' })).status, 400, 'link é de uso único');
  assert.equal((await call('GET', '/me', null, reg.data.token)).status, 401, 'sessão antiga caiu');
  assert.equal((await call('POST', '/auth/login', { email, password: 'antiga1' })).status, 401);
  assert.equal((await call('POST', '/auth/login', { email, password: 'nova123' })).status, 200);
});

test('convite por e-mail para quem ainda não tem conta vira convite ao se cadastrar', async () => {
  const admin = await registered('Diretor', `dir-${tag}@t.dev`, 'segredo1');
  const band = await call('POST', '/bands', { name: `Banda ${tag}` }, admin.data.token);
  assert.equal(band.status, 201);
  const guest = `novo-${tag}@t.dev`;
  const inv = await call('POST', `/bands/${band.data.id}/invites`, { email: guest }, admin.data.token);
  assert.equal(inv.status, 201);
  assert.match(inv.data.message, /ainda não tem conta/);
  assert.ok(inv.data.invites.some(i => i.email === guest));

  const u = await registered('Novo', guest, 'segredo1');
  const me = await call('GET', '/me', null, u.data.token);
  const pending = me.data.invites.find(i => i.band_id === band.data.id);
  assert.ok(pending, 'convite apareceu para a conta nova');
  const acc = await call('POST', `/invites/${pending.id}/accept`, {}, u.data.token);
  assert.ok(acc.data.bands.some(b => b.id === band.data.id));
});
