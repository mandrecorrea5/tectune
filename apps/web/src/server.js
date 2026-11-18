const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { attachLive, dropGuests } = require('./live');
const { pool, waitForDb, migrate, tx } = require('./db');
const { extractMeta } = require('./meta');
const { EXAMPLE_SONG } = require('./seed');
const { runSync } = require('./sync');
const auth = require('./auth');
const { PROD, securityHeaders, cors, rateLimit, accessLog } = require('./security');

const app = express();
app.disable('x-powered-by');
// atrás do Caddy (e da Cloudflare): o IP real do usuário vem em X-Forwarded-For
app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal');
app.use(securityHeaders);
app.use(accessLog);
app.use(express.json({ limit: '1mb' }));

// CORS: o app mobile (e a versão web dele) acessa a API de outra origem
app.use('/api', cors());
// freio contra abuso: geral na API e mais apertado em cadastro/login
app.use('/api', rateLimit({ windowMs: 60_000, max: Number(process.env.RATE_LIMIT_PER_MIN) || 600 }));
app.use(['/api/auth/register', '/api/auth/login', '/api/auth/forgot', '/api/auth/reset', '/api/auth/verify', '/api/auth/resend'], rateLimit({ windowMs: 15 * 60_000, max: Number(process.env.AUTH_RATE_LIMIT) || 30, message: 'Muitas tentativas. Espere alguns minutos e tente de novo.' }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CONTENT = 100_000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function checkId(id) { if (!UUID.test(id)) throw new HttpError(404, 'Não encontrado'); return id; }

function setlistInput(body, partial) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? '').trim();
    if (!name) throw new HttpError(400, 'O nome da setlist é obrigatório');
    out.name = name.slice(0, 200);
  }
  if (body.event_date !== undefined) {
    const d = body.event_date ? String(body.event_date) : null;
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, 'Data inválida (use AAAA-MM-DD)');
    out.event_date = d;
  }
  if (body.venue !== undefined) out.venue = body.venue ? String(body.venue).slice(0, 200) : null;
  if (body.notes !== undefined) out.notes = body.notes ? String(body.notes).slice(0, 5000) : null;
  if (body.cols !== undefined) {
    const c = Number(body.cols);
    if (![4, 6, 8].includes(c)) throw new HttpError(400, 'Compassos por linha deve ser 4, 6 ou 8');
    out.cols = c;
  }
  // folha do setlist (capa do PDF do show)
  if (body.cover_scale !== undefined) {
    const n = Number(body.cover_scale);
    if (!Number.isInteger(n) || !(n === 0 || (n >= 40 && n <= 160))) throw new HttpError(400, 'cover_scale deve ser 0 (automático) ou de 40 a 160');
    out.cover_scale = n;
  }
  if (body.cover_layout !== undefined) {
    if (!['detalhada', 'compacta', 'colunas'].includes(body.cover_layout)) throw new HttpError(400, 'cover_layout deve ser detalhada, compacta ou colunas');
    out.cover_layout = body.cover_layout;
  }
  if (body.cover_opts !== undefined) out.cover_opts = coverOptsInput(body.cover_opts);
  return out;
}
// o que aparece na folha do setlist: só chaves conhecidas, valores booleanos
const COVER_KEYS = ['num', 'artist', 'key', 'bpm', 'info', 'notes'];
function coverOptsInput(v) {
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'cover_opts deve ser um objeto');
  const out = {};
  for (const k of COVER_KEYS) if (typeof v[k] === 'boolean') out[k] = v[k];
  return out;
}
function scaleInput(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || !(n === 0 || (n >= 30 && n <= 100))) throw new HttpError(400, 'font_scale deve ser 0 (automático) ou de 30 a 100');
  return n;
}
const MAX_LYRICS = 50_000;
function lyricsInput(v) {
  if (typeof v !== 'string') throw new HttpError(400, '"lyrics" (letra) deve ser texto');
  if (v.length > MAX_LYRICS) throw new HttpError(413, 'Letra muito grande');
  return v.replace(/\r\n?/g, '\n');
}
function contentInput(body) {
  if (typeof body.content !== 'string') throw new HttpError(400, 'Campo "content" (texto da cifra) é obrigatório');
  if (body.content.length > MAX_CONTENT) throw new HttpError(413, 'Cifra muito grande');
  return body.content;
}

const SETLIST_COLS = `s.id, s.name, to_char(s.event_date, 'YYYY-MM-DD') AS event_date, s.venue, s.notes, s.cols, s.cover_scale, s.cover_layout, s.cover_opts, s.share_token, s.created_at, s.updated_at`;
// link do show (só leitura, sem conta): 24 caracteres aleatórios, url-safe
const SHARE_RE = /^[A-Za-z0-9_-]{20,64}$/;
const newShareToken = () => crypto.randomBytes(18).toString('base64url');

/* ---------- health ---------- */
app.get('/api/health', wrap(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
}));

/* ---------- contas e bandas ---------- */
const { requireUser, requireBand, requireAdmin, userFromToken } = auth.mount(app, { pool, tx, wrap });
// todo o repertório é da banda ativa: precisa estar logado e ser membro; editar é só para admins
app.use(['/api/setlists', '/api/songs', '/api/sync'], requireUser, requireBand);
const canEdit = (req, res, next) => (req.method === 'GET' ? next() : requireAdmin(req, res, next));
app.use(['/api/setlists', '/api/songs'], canEdit);

/* ---------- setlists ---------- */
app.get('/api/setlists', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT ${SETLIST_COLS}, count(ss.id)::int AS song_count
    FROM setlists s LEFT JOIN setlist_songs ss ON ss.setlist_id = s.id
    WHERE s.band_id = $1
    GROUP BY s.id
    ORDER BY s.event_date DESC NULLS LAST, s.updated_at DESC`, [req.band]);
  res.json(rows);
}));

app.post('/api/setlists', wrap(async (req, res) => {
  const d = setlistInput(req.body, false);
  const { rows } = await pool.query(
    `INSERT INTO setlists (name, event_date, venue, notes, cols, cover_scale, cover_layout, cover_opts, band_id)
     VALUES ($1, $2, $3, $4, COALESCE($5, 4), COALESCE($6, 0), COALESCE($7, 'detalhada'), COALESCE($8::jsonb, '{}'::jsonb), $9)
     RETURNING id`,
    [d.name, d.event_date ?? null, d.venue ?? null, d.notes ?? null, d.cols ?? null, d.cover_scale ?? null, d.cover_layout ?? null, d.cover_opts ? JSON.stringify(d.cover_opts) : null, req.band]);
  res.status(201).json(await getSetlist(rows[0].id, req.band));
}));

async function getSetlist(id, band) {
  const { rows } = await pool.query(`SELECT ${SETLIST_COLS} FROM setlists s WHERE s.id = $1 AND s.band_id = $2`, [id, band]);
  if (!rows.length) throw new HttpError(404, 'Setlist não encontrada');
  const songs = await pool.query(`
    SELECT ss.id AS entry_id, ss.position, so.id, so.title, so.artist, so.song_key, so.bpm, so.font_scale, so.content, so.lyrics, so.updated_at
    FROM setlist_songs ss JOIN songs so ON so.id = ss.song_id
    WHERE ss.setlist_id = $1 ORDER BY ss.position, ss.id`, [id]);
  return { ...rows[0], songs: songs.rows };
}

app.get('/api/setlists/:id', wrap(async (req, res) => {
  res.json(await getSetlist(checkId(req.params.id), req.band));
}));

app.patch('/api/setlists/:id', wrap(async (req, res) => {
  const id = checkId(req.params.id);
  const d = setlistInput(req.body, true);
  const keys = Object.keys(d);
  if (keys.length) {
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const r = await pool.query(`UPDATE setlists SET ${sets}, updated_at = now() WHERE id = $1 AND band_id = $${keys.length + 2}`, [id, ...keys.map(k => d[k]), req.band]);
    if (!r.rowCount) throw new HttpError(404, 'Setlist não encontrada');
  }
  res.json(await getSetlist(id, req.band));
}));

app.delete('/api/setlists/:id', wrap(async (req, res) => {
  const r = await pool.query('DELETE FROM setlists WHERE id = $1 AND band_id = $2', [checkId(req.params.id), req.band]);
  if (!r.rowCount) throw new HttpError(404, 'Setlist não encontrada');
  res.status(204).end();
}));

// Substitui a ordem completa das músicas: { songIds: [uuid, ...] }
app.put('/api/setlists/:id/songs', wrap(async (req, res) => {
  const id = checkId(req.params.id);
  const ids = req.body.songIds;
  if (!Array.isArray(ids) || ids.length > 500 || !ids.every(x => typeof x === 'string' && UUID.test(x))) {
    throw new HttpError(400, '"songIds" deve ser uma lista de ids de músicas');
  }
  await tx(async c => {
    const s = await c.query('SELECT 1 FROM setlists WHERE id = $1 AND band_id = $2 FOR UPDATE', [id, req.band]);
    if (!s.rowCount) throw new HttpError(404, 'Setlist não encontrada');
    if (ids.length) {
      const found = await c.query('SELECT count(DISTINCT id)::int AS n FROM songs WHERE id = ANY($1::uuid[]) AND band_id = $2', [ids, req.band]);
      if (found.rows[0].n !== new Set(ids).size) throw new HttpError(400, 'Alguma música da lista não existe');
    }
    await c.query('DELETE FROM setlist_songs WHERE setlist_id = $1', [id]);
    if (ids.length) {
      await c.query(`INSERT INTO setlist_songs (setlist_id, song_id, position)
                     SELECT $1, sid, ord::int FROM unnest($2::uuid[]) WITH ORDINALITY AS t(sid, ord)`, [id, ids]);
    }
    await c.query('UPDATE setlists SET updated_at = now() WHERE id = $1', [id]);
  });
  res.json(await getSetlist(id, req.band));
}));

/* ---------- link do show (sem cadastro) ---------- */
// cria o link (ou devolve o que já existe); { reset: true } troca por um novo e o antigo deixa de abrir
app.post('/api/setlists/:id/share', wrap(async (req, res) => {
  const id = checkId(req.params.id);
  const reset = req.body?.reset === true;
  const { rows } = await pool.query(
    `UPDATE setlists SET share_token = CASE WHEN $3 OR share_token IS NULL THEN $4 ELSE share_token END,
       share_created_at = CASE WHEN $3 OR share_token IS NULL THEN now() ELSE share_created_at END
     WHERE id = $1 AND band_id = $2 RETURNING share_token`, [id, req.band, reset, newShareToken()]);
  if (!rows.length) throw new HttpError(404, 'Setlist não encontrada');
  if (reset) dropGuests(id);
  res.json({ share_token: rows[0].share_token });
}));
// desliga o link: quem estava vendo pelo link sai do ao vivo
app.delete('/api/setlists/:id/share', wrap(async (req, res) => {
  const id = checkId(req.params.id);
  const r = await pool.query('UPDATE setlists SET share_token = NULL, share_created_at = NULL WHERE id = $1 AND band_id = $2', [id, req.band]);
  if (!r.rowCount) throw new HttpError(404, 'Setlist não encontrada');
  dropGuests(id);
  res.status(204).end();
}));

/* ---------- músicas (biblioteca) ---------- */
app.get('/api/songs', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const params = [req.band];
  let where = 'WHERE so.band_id = $1';
  if (q) { params.push(`%${q.toLowerCase()}%`); where += ` AND (lower(so.title) LIKE $2 OR lower(coalesce(so.artist, '')) LIKE $2)`; }
  const { rows } = await pool.query(`
    SELECT so.id, so.title, so.artist, so.song_key, so.bpm, so.font_scale, so.updated_at,
           count(DISTINCT ss.setlist_id)::int AS setlist_count
    FROM songs so LEFT JOIN setlist_songs ss ON ss.song_id = so.id
    ${where}
    GROUP BY so.id ORDER BY lower(so.title) LIMIT 500`, params);
  res.json(rows);
}));

app.post('/api/songs', wrap(async (req, res) => {
  const content = contentInput(req.body);
  const scale = req.body.font_scale === undefined ? 100 : scaleInput(req.body.font_scale);
  const lyrics = req.body.lyrics === undefined ? '' : lyricsInput(req.body.lyrics);
  const m = extractMeta(content);
  const { rows } = await pool.query(
    `INSERT INTO songs (title, artist, song_key, bpm, content, font_scale, band_id, lyrics) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [m.title, m.artist, m.song_key, m.bpm, content, scale, req.band, lyrics]);
  res.status(201).json(rows[0]);
}));

app.get('/api/songs/:id', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM songs WHERE id = $1 AND band_id = $2', [checkId(req.params.id), req.band]);
  if (!rows.length) throw new HttpError(404, 'Música não encontrada');
  res.json(rows[0]);
}));

app.put('/api/songs/:id', wrap(async (req, res) => {
  const id = checkId(req.params.id);
  // aceita { content }, { font_scale }, { lyrics } (letra inteira) ou combinações
  const sets = [], vals = [id, req.band];
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (req.body.content !== undefined) {
    const content = contentInput(req.body);
    const m = extractMeta(content);
    add('title', m.title); add('artist', m.artist); add('song_key', m.song_key); add('bpm', m.bpm); add('content', content);
  }
  if (req.body.font_scale !== undefined) add('font_scale', scaleInput(req.body.font_scale));
  const touch = sets.length > 0; // só a letra colada não conta como edição da cifra (a sincronização compara updated_at)
  if (req.body.lyrics !== undefined) add('lyrics', lyricsInput(req.body.lyrics));
  if (!sets.length) throw new HttpError(400, 'Envie "content", "font_scale" e/ou "lyrics"');
  const { rows } = await pool.query(
    `UPDATE songs SET ${sets.join(', ')}${touch ? ', updated_at = now()' : ''} WHERE id = $1 AND band_id = $2 RETURNING *`, vals);
  if (!rows.length) throw new HttpError(404, 'Música não encontrada');
  res.json(rows[0]);
}));

app.delete('/api/songs/:id', wrap(async (req, res) => {
  const r = await pool.query('DELETE FROM songs WHERE id = $1 AND band_id = $2', [checkId(req.params.id), req.band]);
  if (!r.rowCount) throw new HttpError(404, 'Música não encontrada');
  res.status(204).end();
}));

/* ---------- sincronização (app mobile) ---------- */
// Tudo de uma vez: setlists com a ordem das músicas + biblioteca completa.
app.get('/api/sync', wrap(async (req, res) => {
  const [sls, order, songs] = await Promise.all([
    pool.query(`SELECT ${SETLIST_COLS} FROM setlists s WHERE s.band_id = $1 ORDER BY s.event_date DESC NULLS LAST, s.updated_at DESC`, [req.band]),
    pool.query('SELECT ss.setlist_id, ss.song_id FROM setlist_songs ss JOIN setlists s ON s.id = ss.setlist_id WHERE s.band_id = $1 ORDER BY ss.setlist_id, ss.position, ss.id', [req.band]),
    pool.query('SELECT id, title, artist, song_key, bpm, font_scale, content, updated_at FROM songs WHERE band_id = $1 ORDER BY lower(title)', [req.band]),
  ]);
  const bySl = {};
  for (const r of order.rows) (bySl[r.setlist_id] ||= []).push(r.song_id);
  res.json({
    server_time: new Date().toISOString(),
    setlists: sls.rows.map(s => ({ ...s, song_ids: bySl[s.id] || [] })),
    songs: songs.rows,
  });
}));

// Sincronização bidirecional (app offline-first): envia alterações e recebe o que mudou.
app.post('/api/sync', wrap(async (req, res) => {
  // membros (não admins) só recebem: as alterações deles são ignoradas
  res.json(await runSync(pool, req.body, { band: req.band, canWrite: req.role === 'admin' }));
}));

/* ---------- show pelo link (público, só leitura) ---------- */
app.get('/api/public/shows/:token', wrap(async (req, res) => {
  const tok = String(req.params.token);
  if (!SHARE_RE.test(tok)) throw new HttpError(404, 'Este link não existe ou foi desligado');
  const { rows } = await pool.query(
    `SELECT s.id, s.name, to_char(s.event_date, 'YYYY-MM-DD') AS event_date, s.venue, s.notes, s.cols, b.name AS band_name
     FROM setlists s JOIN bands b ON b.id = s.band_id WHERE s.share_token = $1`, [tok]);
  if (!rows.length) throw new HttpError(404, 'Este link não existe ou foi desligado');
  const songs = await pool.query(`
    SELECT so.id, so.title, so.artist, so.song_key, so.bpm, so.font_scale, so.content
    FROM setlist_songs ss JOIN songs so ON so.id = ss.song_id
    WHERE ss.setlist_id = $1 ORDER BY ss.position, ss.id`, [rows[0].id]);
  res.set('Cache-Control', 'no-store');
  res.json({ ...rows[0], songs: songs.rows });
}));

/* ---------- front-end ---------- */
// link do show instalado como app (PWA): abre direto no show, não no login
app.get('/s/:token/manifest.webmanifest', (req, res) => {
  const tok = String(req.params.token);
  if (!SHARE_RE.test(tok)) return res.status(404).end();
  res.set('Cache-Control', 'no-cache');
  res.type('application/manifest+json').json({
    name: 'Tectune — show', short_name: 'Tectune', lang: 'pt-BR',
    id: `/s/${tok}`, start_url: `/s/${tok}`, scope: '/', display: 'standalone', orientation: 'any',
    background_color: '#0E0D0C', theme_color: '#0E0D0C',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
});
// link do show: a mesma página, que abre no modo convidado
app.get('/s/:token', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.set('Referrer-Policy', 'no-referrer'); // o link não vaza para outros sites
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
// núcleo compartilhado (packages/core) servido em /core
const CORE_DIR = process.env.CORE_DIR || path.join(__dirname, '..', '..', '..', 'packages', 'core', 'src');
// html/js/css revalidam sempre (ETag): cada deploy chega na hora, sem versões misturadas.
// vendor (jsPDF, fontes) quase nunca muda: 30 dias de cache.
const staticOpts = { setHeaders(res) { res.set('Cache-Control', 'no-cache'); } };
app.use('/core', express.static(CORE_DIR, staticOpts));
app.use('/vendor', express.static(path.join(__dirname, '..', 'public', 'vendor'), { maxAge: PROD ? '30d' : 0 }));
app.use(express.static(path.join(__dirname, '..', 'public'), staticOpts));
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Requisição muito grande' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Erro interno' : err.message, ...(err.code && status < 500 ? { code: err.code } : {}) });
});

/* ---------- boot ---------- */
async function seed() {
  // dados de exemplo só no desenvolvimento (em produção cada banda começa vazia)
  if (PROD || process.env.SEED_EXAMPLE === '0') return;
  const { rows } = await pool.query('SELECT (SELECT count(*) FROM setlists)::int AS s, (SELECT count(*) FROM songs)::int AS m');
  if (rows[0].s || rows[0].m) return;
  await tx(async c => {
    const m = extractMeta(EXAMPLE_SONG);
    const song = await c.query(
      `INSERT INTO songs (title, artist, song_key, bpm, content) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [m.title, m.artist, m.song_key, m.bpm, EXAMPLE_SONG]);
    const sl = await c.query(`INSERT INTO setlists (name, venue) VALUES ('Meu primeiro show', 'Local do show') RETURNING id`);
    await c.query('INSERT INTO setlist_songs (setlist_id, song_id, position) VALUES ($1, $2, 1)', [sl.rows[0].id, song.rows[0].id]);
  });
  console.log('[db] dados de exemplo criados');
}

const PORT = Number(process.env.PORT) || 3000;
(async () => {
  await waitForDb();
  await migrate();
  await seed();
  const server = app.listen(PORT, () => console.log(`[app] Tectune rodando em http://localhost:${PORT}`));
  const live = attachLive(server, { pool, userFromToken }); // show ao vivo (diretor dá o play, a banda acompanha)
  auth.startCleanup(pool);
  const stop = () => {
    console.log('[app] encerrando...');
    live.close(); for (const c of live.clients) c.terminate();
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10_000).unref(); // não fica preso em conexão aberta
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
})().catch(err => { console.error('[app] falha ao iniciar:', err); process.exit(1); });
