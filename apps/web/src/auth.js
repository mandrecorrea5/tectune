// Contas, login e bandas.
//  - Senha guardada com scrypt (sal aleatório); login devolve um token (guardamos só o hash).
//  - Toda chamada ao repertório vai com "Authorization: Bearer <token>" e "X-Band: <id da banda>".
//  - Admins da banda editam; membros só leem.
'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const mail = require('./email');

class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; if (code) this.code = code; } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 90;
const sha = t => crypto.createHash('sha256').update(t).digest('hex');

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}
async function checkPassword(pw, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const h = await scrypt(pw, Buffer.from(salt, 'hex'), 64);
  const want = Buffer.from(hash, 'hex');
  return want.length === h.length && crypto.timingSafeEqual(want, h);
}

// limite simples de tentativas de login erradas (por e-mail + IP)
const fails = new Map();
function tooMany(key) {
  const f = fails.get(key); if (!f) return false;
  if (Date.now() - f.at > 10 * 60 * 1000) { fails.delete(key); return false; }
  return f.n >= 8;
}
setInterval(() => { for (const k of fails.keys()) tooMany(k); }, 10 * 60 * 1000).unref();
const failed = key => { const f = fails.get(key) || { n: 0, at: Date.now() }; f.n++; f.at = Date.now(); fails.set(key, f); };

function mount(app, { pool, tx, wrap }) {
  async function newSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query('INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)', [sha(token), userId]);
    return token;
  }
  const publicUser = u => ({ id: u.id, name: u.name, email: u.email });

  /** Lê o token e põe req.user (ou 401). */
  async function userFromToken(token) {
    if (!token || token.length > 200) return null;
    // sessão parada há mais de SESSION_DAYS dias expira
    const { rows } = await pool.query(
      `UPDATE sessions s SET last_used_at = now() FROM users u
        WHERE s.token_hash = $1 AND u.id = s.user_id AND s.last_used_at > now() - make_interval(days => $2)
        RETURNING u.id, u.name, u.email`, [sha(token), SESSION_DAYS]);
    return rows[0] || null;
  }
  const tokenOf = req => (String(req.get('authorization') || '').match(/^Bearer\s+(\S+)$/i) || [])[1] || req.query.token;
  const requireUser = wrap(async (req, res, next) => {
    const u = await userFromToken(tokenOf(req));
    if (!u) throw new HttpError(401, 'Entre na sua conta para continuar');
    req.user = u; next();
  });
  /** Banda ativa (header X-Band): confere se o usuário é membro; req.band, req.role. */
  const requireBand = wrap(async (req, res, next) => {
    const id = String(req.get('x-band') || req.query.band || '');
    if (!UUID.test(id)) throw new HttpError(400, 'Escolha uma banda');
    const { rows } = await pool.query('SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2', [id, req.user.id]);
    if (!rows.length) throw new HttpError(403, 'Você não faz parte desta banda');
    req.band = id; req.role = rows[0].role; next();
  });
  const requireAdmin = (req, res, next) => {
    if (req.role !== 'admin') return next(new HttpError(403, 'Só admins da banda podem editar o repertório'));
    next();
  };

  /* ---------- cadastro e login ---------- */
  // envia (ou reenvia) o link de confirmação; em dev sem Resend devolve o link (testes)
  async function sendVerification(user) {
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.query(`INSERT INTO email_verifications (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '24 hours')`, [sha(token), user.id]);
    const link = `${mail.appUrl()}/?confirmar=${token}`;
    const r = await mail.confirmEmail({ to: user.email, name: user.name, link });
    return r?.simulated ? link : undefined;
  }

  app.post('/api/auth/register', wrap(async (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 80);
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 200);
    const pw = String(req.body.password || '');
    if (!name) throw new HttpError(400, 'Informe seu nome');
    if (!EMAIL.test(email)) throw new HttpError(400, 'E-mail inválido');
    if (pw.length < 6) throw new HttpError(400, 'A senha precisa ter pelo menos 6 caracteres');
    // sem e-mail não há como confirmar a conta: melhor não criar
    if (!mail.available()) throw new HttpError(503, 'Os cadastros estão temporariamente fechados. Tente de novo mais tarde.');
    const exists = await pool.query('SELECT email_verified_at FROM users WHERE lower(email) = $1', [email]);
    if (exists.rowCount) {
      if (exists.rows[0].email_verified_at) throw new HttpError(409, 'Já existe uma conta com esse e-mail');
      throw new HttpError(409, 'Esse e-mail já foi cadastrado mas ainda não foi confirmado. Confira sua caixa de entrada ou peça um novo link.', 'unverified');
    }
    const { rows } = await pool.query('INSERT INTO users (email, name, pass_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [email, name, await hashPassword(pw)]);
    // convites feitos por e-mail antes de a pessoa ter conta viram convites normais
    await pool.query(`WITH moved AS (DELETE FROM band_email_invites WHERE lower(email) = $1 RETURNING band_id, invited_by)
      INSERT INTO band_invites (band_id, user_id, invited_by) SELECT band_id, $2, invited_by FROM moved
      ON CONFLICT (band_id, user_id) DO NOTHING`, [email, rows[0].id]);
    let devLink;
    try { devLink = await sendVerification(rows[0]); }
    catch (err) {
      console.error('[email] confirmação de cadastro falhou:', err.message);
      await pool.query('DELETE FROM users WHERE id = $1', [rows[0].id]);
      throw new HttpError(502, 'Não conseguimos enviar o e-mail de confirmação agora. Tente de novo em alguns minutos.');
    }
    // sem sessão: a conta só entra depois de confirmar o e-mail
    res.status(201).json({ pending: true, email: rows[0].email, ...(devLink ? { devLink } : {}) });
  }));

  // o link do e-mail: confirma e já entra
  app.post('/api/auth/verify', wrap(async (req, res) => {
    const token = String(req.body.token || '');
    if (!token || token.length > 100) throw new HttpError(400, 'Link inválido');
    const user = await tx(async c => {
      const { rows } = await c.query(`DELETE FROM email_verifications WHERE token_hash = $1 AND expires_at > now() RETURNING user_id`, [sha(token)]);
      if (!rows.length) throw new HttpError(400, 'Este link de confirmação expirou ou já foi usado. Entre com seu e-mail e senha para receber um novo.', 'link_expired');
      const u = await c.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1 RETURNING id, name, email`, [rows[0].user_id]);
      await c.query('DELETE FROM email_verifications WHERE user_id = $1', [rows[0].user_id]);
      return u.rows[0];
    });
    await ensureBand(user); // a conta já entra com a banda padrão
    res.json({ token: await newSession(user.id), user: publicUser(user) });
  }));

  // novo link de confirmação (mesma resposta exista ou não a conta)
  app.post('/api/auth/resend', wrap(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) throw new HttpError(400, 'E-mail inválido');
    const { rows } = await pool.query('SELECT id, name, email, email_verified_at FROM users WHERE lower(email) = $1', [email]);
    const out = { ok: true };
    if (rows.length && !rows[0].email_verified_at) {
      const recent = await pool.query(`SELECT count(*)::int AS n FROM email_verifications WHERE user_id = $1 AND created_at > now() - interval '15 minutes'`, [rows[0].id]);
      if (recent.rows[0].n < 3) {
        try { const devLink = await sendVerification(rows[0]); if (devLink) out.devLink = devLink; }
        catch (err) {
          console.error('[email] reenvio de confirmação falhou:', err.message);
          throw new HttpError(502, 'Não conseguimos enviar o e-mail agora. Tente de novo em alguns minutos.');
        }
      }
    }
    res.json(out);
  }));

  app.post('/api/auth/login', wrap(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const key = email + '|' + req.ip;
    if (tooMany(key)) throw new HttpError(429, 'Muitas tentativas. Espere alguns minutos e tente de novo.');
    const { rows } = await pool.query('SELECT * FROM users WHERE lower(email) = $1', [email]);
    if (!rows.length || !(await checkPassword(String(req.body.password || ''), rows[0].pass_hash))) {
      failed(key); throw new HttpError(401, 'E-mail ou senha incorretos');
    }
    fails.delete(key);
    if (!rows[0].email_verified_at) {
      throw new HttpError(403, 'Confirme seu e-mail para entrar. Enviamos um link para ' + rows[0].email + ' quando você criou a conta.', 'unverified');
    }
    res.json({ token: await newSession(rows[0].id), user: publicUser(rows[0]) });
  }));

  /* ---------- esqueci minha senha (por e-mail) ---------- */
  // o que a tela de login pode oferecer
  app.get('/api/auth/options', (req, res) => res.json({ passwordReset: mail.available(), signup: mail.available() }));

  app.post('/api/auth/forgot', wrap(async (req, res) => {
    if (!mail.available()) throw new HttpError(503, 'A recuperação de senha por e-mail não está disponível. Fale com o admin da sua banda.');
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) throw new HttpError(400, 'E-mail inválido');
    const { rows } = await pool.query('SELECT id, name, email FROM users WHERE lower(email) = $1', [email]);
    const out = { ok: true };
    // mesma resposta exista ou não a conta (não revela quem tem cadastro)
    if (rows.length) {
      const recent = await pool.query(`SELECT count(*)::int AS n FROM password_resets WHERE user_id = $1 AND created_at > now() - interval '15 minutes'`, [rows[0].id]);
      if (recent.rows[0].n < 3) {
        const token = crypto.randomBytes(32).toString('base64url');
        await pool.query(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, [sha(token), rows[0].id]);
        const link = `${mail.appUrl()}/?redefinir=${token}`;
        try {
          const r = await mail.passwordReset({ to: rows[0].email, name: rows[0].name, link });
          if (r?.simulated) out.devLink = link; // só em desenvolvimento sem Resend (testes)
        } catch (err) {
          console.error('[email] recuperação de senha falhou:', err.message);
          throw new HttpError(502, 'Não conseguimos enviar o e-mail agora. Tente de novo em alguns minutos.');
        }
      }
    }
    res.json(out);
  }));

  app.post('/api/auth/reset', wrap(async (req, res) => {
    const token = String(req.body.token || '');
    const pw = String(req.body.password || '');
    if (pw.length < 6) throw new HttpError(400, 'A senha precisa ter pelo menos 6 caracteres');
    if (!token || token.length > 100) throw new HttpError(400, 'Link inválido');
    const user = await tx(async c => {
      const { rows } = await c.query(`UPDATE password_resets SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`, [sha(token)]);
      if (!rows.length) throw new HttpError(400, 'Este link expirou ou já foi usado. Peça um novo em "Esqueci minha senha".');
      // o link chegou por e-mail: também confirma o endereço
      const u = await c.query('UPDATE users SET pass_hash = $2, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1 RETURNING id, name, email', [rows[0].user_id, await hashPassword(pw)]);
      // troca de senha desconecta todos os aparelhos e invalida outros links pendentes
      await c.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].user_id]);
      await c.query('DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [rows[0].user_id]);
      return u.rows[0];
    });
    await ensureBand(user); // a conta já entra com a banda padrão
    res.json({ token: await newSession(user.id), user: publicUser(user) });
  }));

  app.post('/api/auth/logout', requireUser, wrap(async (req, res) => {
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha(tokenOf(req))]);
    res.status(204).end();
  }));

  /* ---------- banda padrão ---------- */
  // ninguém fica sem banda: a conta já nasce com "<Nome>'s band" (dá para estudar sozinho,
  // renomear depois ou entrar na banda de alguém). Quem sai de todas as bandas ganha uma de novo.
  const defaultBandName = name => `${String(name || '').trim().split(/\s+/)[0] || 'Minha'}'s band`.slice(0, 120);
  async function createBand(c, name, userId) {
    const { rows } = await c.query('INSERT INTO bands (name) VALUES ($1) RETURNING id, name', [name]);
    await c.query(`INSERT INTO band_members (band_id, user_id, role) VALUES ($1, $2, 'admin')`, [rows[0].id, userId]);
    // a 1ª banda criada recebe o repertório que já existia antes das contas
    const first = await c.query('SELECT count(*)::int AS n FROM bands');
    if (first.rows[0].n === 1) {
      await c.query('UPDATE songs SET band_id = $1 WHERE band_id IS NULL', [rows[0].id]);
      await c.query('UPDATE setlists SET band_id = $1 WHERE band_id IS NULL', [rows[0].id]);
      await c.query('UPDATE tombstones SET band_id = $1 WHERE band_id IS NULL', [rows[0].id]);
    }
    return rows[0];
  }
  async function ensureBand(user) {
    await tx(async c => {
      await c.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [user.id]); // evita criar duas em chamadas simultâneas
      const n = await c.query('SELECT count(*)::int AS n FROM band_members WHERE user_id = $1', [user.id]);
      if (!n.rows[0].n) await createBand(c, defaultBandName(user.name), user.id);
    });
  }

  /* ---------- eu: bandas e convites ---------- */
  async function me(user) {
    await ensureBand(user);
    const [bands, invites] = await Promise.all([
      pool.query(`SELECT b.id, b.name, m.role, (SELECT count(*)::int FROM band_members x WHERE x.band_id = b.id) AS members
                    FROM band_members m JOIN bands b ON b.id = m.band_id WHERE m.user_id = $1 ORDER BY lower(b.name)`, [user.id]),
      pool.query(`SELECT i.id, b.id AS band_id, b.name AS band_name, u.name AS invited_by
                    FROM band_invites i JOIN bands b ON b.id = i.band_id LEFT JOIN users u ON u.id = i.invited_by
                   WHERE i.user_id = $1 ORDER BY i.created_at`, [user.id]),
    ]);
    return { user: publicUser(user), bands: bands.rows, invites: invites.rows };
  }
  app.get('/api/me', requireUser, wrap(async (req, res) => res.json(await me(req.user))));

  /* ---------- bandas ---------- */
  app.post('/api/bands', requireUser, wrap(async (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 120);
    if (!name) throw new HttpError(400, 'Informe o nome da banda');
    const band = await tx(c => createBand(c, name, req.user.id));
    res.status(201).json({ ...band, role: 'admin', ...(await me(req.user)) });
  }));

  // banda pela URL (/api/bands/:id/...): confere que é membro
  const bandParam = wrap(async (req, res, next) => {
    const id = req.params.id;
    if (!UUID.test(id)) throw new HttpError(404, 'Banda não encontrada');
    const { rows } = await pool.query('SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2', [id, req.user.id]);
    if (!rows.length) throw new HttpError(403, 'Você não faz parte desta banda');
    req.band = id; req.role = rows[0].role; next();
  });
  const adminOnly = (req, res, next) => (req.role === 'admin' ? next() : next(new HttpError(403, 'Só admins da banda podem fazer isso')));

  async function bandInfo(id) {
    const [b, members, invites] = await Promise.all([
      pool.query('SELECT id, name FROM bands WHERE id = $1', [id]),
      pool.query(`SELECT u.id, u.name, u.email, m.role FROM band_members m JOIN users u ON u.id = m.user_id
                   WHERE m.band_id = $1 ORDER BY m.role, lower(u.name)`, [id]),
      pool.query(`SELECT id, name, email FROM (
                     SELECT i.id, u.name, u.email, i.created_at FROM band_invites i JOIN users u ON u.id = i.user_id WHERE i.band_id = $1
                     UNION ALL
                     SELECT e.id, 'Ainda sem conta' AS name, e.email, e.created_at FROM band_email_invites e WHERE e.band_id = $1
                   ) x ORDER BY created_at`, [id]),
    ]);
    return { ...b.rows[0], members: members.rows, invites: invites.rows };
  }
  app.get('/api/bands/:id', requireUser, bandParam, wrap(async (req, res) => res.json({ ...(await bandInfo(req.band)), role: req.role })));

  app.patch('/api/bands/:id', requireUser, bandParam, adminOnly, wrap(async (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 120);
    if (!name) throw new HttpError(400, 'Informe o nome da banda');
    await pool.query('UPDATE bands SET name = $2 WHERE id = $1', [req.band, name]);
    res.json({ ...(await bandInfo(req.band)), role: req.role });
  }));

  // convidar pelo e-mail: quem já tem conta recebe o convite no app (e por e-mail);
  // quem ainda não tem recebe um e-mail para se cadastrar, e o convite espera por ela
  app.post('/api/bands/:id/invites', requireUser, bandParam, adminOnly, wrap(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 200);
    if (!EMAIL.test(email)) throw new HttpError(400, 'E-mail inválido');
    const band = (await pool.query('SELECT name FROM bands WHERE id = $1', [req.band])).rows[0];
    const u = await pool.query('SELECT id, name FROM users WHERE lower(email) = $1', [email]);
    let message;
    if (u.rowCount) {
      const uid = u.rows[0].id;
      const member = await pool.query('SELECT 1 FROM band_members WHERE band_id = $1 AND user_id = $2', [req.band, uid]);
      if (member.rowCount) throw new HttpError(409, `${u.rows[0].name} já faz parte da banda`);
      const ins = await pool.query(`INSERT INTO band_invites (band_id, user_id, invited_by) VALUES ($1, $2, $3)
                        ON CONFLICT (band_id, user_id) DO NOTHING`, [req.band, uid, req.user.id]);
      message = 'Convite enviado: a pessoa vê ao entrar no Tectune';
      if (ins.rowCount && mail.configured()) {
        mail.bandInvite({ to: email, band: band.name, by: req.user.name, hasAccount: true })
          .catch(err => console.error('[email] convite falhou:', err.message));
        message = 'Convite enviado: a pessoa recebeu um e-mail e vê o convite ao entrar';
      }
    } else {
      if (!mail.available()) throw new HttpError(404, 'Não há conta com esse e-mail. Peça para a pessoa se cadastrar primeiro.');
      const ins = await pool.query(`INSERT INTO band_email_invites (band_id, email, invited_by) VALUES ($1, $2, $3)
                        ON CONFLICT (band_id, lower(email)) DO NOTHING`, [req.band, email, req.user.id]);
      if (ins.rowCount) {
        try { await mail.bandInvite({ to: email, band: band.name, by: req.user.name, hasAccount: false }); }
        catch (err) {
          await pool.query('DELETE FROM band_email_invites WHERE band_id = $1 AND lower(email) = $2', [req.band, email]);
          console.error('[email] convite falhou:', err.message);
          throw new HttpError(502, 'Não conseguimos enviar o e-mail de convite agora. Tente de novo em alguns minutos.');
        }
      }
      message = 'Essa pessoa ainda não tem conta: mandamos um e-mail para ela se cadastrar';
    }
    res.status(201).json({ ...(await bandInfo(req.band)), role: req.role, message });
  }));
  app.delete('/api/bands/:id/invites/:inv', requireUser, bandParam, adminOnly, wrap(async (req, res) => {
    if (!UUID.test(req.params.inv)) throw new HttpError(404, 'Convite não encontrado');
    await pool.query('DELETE FROM band_invites WHERE id = $1 AND band_id = $2', [req.params.inv, req.band]);
    await pool.query('DELETE FROM band_email_invites WHERE id = $1 AND band_id = $2', [req.params.inv, req.band]);
    res.json({ ...(await bandInfo(req.band)), role: req.role });
  }));

  // aceitar / recusar convite (quem foi convidado)
  app.post('/api/invites/:inv/:action', requireUser, wrap(async (req, res) => {
    const { inv, action } = req.params;
    if (!UUID.test(inv) || !['accept', 'decline'].includes(action)) throw new HttpError(404, 'Convite não encontrado');
    await tx(async c => {
      const { rows } = await c.query('DELETE FROM band_invites WHERE id = $1 AND user_id = $2 RETURNING band_id', [inv, req.user.id]);
      if (!rows.length) throw new HttpError(404, 'Convite não encontrado');
      if (action === 'accept') {
        await c.query(`INSERT INTO band_members (band_id, user_id, role) VALUES ($1, $2, 'membro') ON CONFLICT DO NOTHING`, [rows[0].band_id, req.user.id]);
      }
    });
    res.json(await me(req.user));
  }));

  // mudar papel (admin ↔ membro) e tirar da banda; sempre sobra pelo menos 1 admin
  async function adminsLeft(c, band, exceptUser) {
    const r = await c.query(`SELECT count(*)::int AS n FROM band_members WHERE band_id = $1 AND role = 'admin' AND user_id <> $2`, [band, exceptUser]);
    return r.rows[0].n;
  }
  app.patch('/api/bands/:id/members/:uid', requireUser, bandParam, adminOnly, wrap(async (req, res) => {
    const { uid } = req.params; const role = req.body.role;
    if (!UUID.test(uid) || !['admin', 'membro'].includes(role)) throw new HttpError(400, 'Papel inválido');
    await tx(async c => {
      if (role === 'membro' && !(await adminsLeft(c, req.band, uid))) throw new HttpError(400, 'A banda precisa ter pelo menos um admin');
      const r = await c.query('UPDATE band_members SET role = $3 WHERE band_id = $1 AND user_id = $2', [req.band, uid, role]);
      if (!r.rowCount) throw new HttpError(404, 'Membro não encontrado');
    });
    res.json({ ...(await bandInfo(req.band)), role: uid === req.user.id ? role : req.role });
  }));
  app.delete('/api/bands/:id/members/:uid', requireUser, bandParam, wrap(async (req, res) => {
    const { uid } = req.params;
    if (!UUID.test(uid)) throw new HttpError(404, 'Membro não encontrado');
    const self = uid === req.user.id;
    if (!self && req.role !== 'admin') throw new HttpError(403, 'Só admins podem tirar alguém da banda');
    await tx(async c => {
      const m = await c.query('SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2', [req.band, uid]);
      if (!m.rowCount) throw new HttpError(404, 'Membro não encontrado');
      const others = await c.query('SELECT count(*)::int AS n FROM band_members WHERE band_id = $1 AND user_id <> $2', [req.band, uid]);
      if (!others.rows[0].n) throw new HttpError(400, 'Você é o único membro da banda — ela não pode ficar sem ninguém');
      if (m.rows[0].role === 'admin' && !(await adminsLeft(c, req.band, uid))) {
        throw new HttpError(400, 'Torne outra pessoa admin antes de sair — a banda precisa de pelo menos um admin');
      }
      await c.query('DELETE FROM band_members WHERE band_id = $1 AND user_id = $2', [req.band, uid]);
    });
    res.json(self ? await me(req.user) : { ...(await bandInfo(req.band)), role: req.role });
  }));

  return { requireUser, requireBand, requireAdmin, userFromToken, HttpError };
}

/** Apaga sessões expiradas uma vez por dia. */
function startCleanup(pool) {
  const run = () => pool.query('DELETE FROM sessions WHERE last_used_at < now() - make_interval(days => $1)', [SESSION_DAYS])
    .then(r => { if (r.rowCount) console.log(`[auth] ${r.rowCount} sessões expiradas removidas`); })
    .catch(err => console.error('[auth] limpeza de sessões falhou:', err.message));
  const resets = () => Promise.all([
    pool.query(`DELETE FROM password_resets WHERE expires_at < now() - interval '1 day'`),
    pool.query(`DELETE FROM email_verifications WHERE expires_at < now() - interval '1 day'`),
    // cadastro nunca confirmado some depois de 7 dias (libera o e-mail)
    pool.query(`DELETE FROM users WHERE email_verified_at IS NULL AND created_at < now() - interval '7 days'`),
  ]).catch(() => {});
  run(); resets();
  setInterval(() => { run(); resets(); }, 24 * 3600 * 1000).unref();
}

module.exports = { mount, hashPassword, checkPassword, startCleanup };
