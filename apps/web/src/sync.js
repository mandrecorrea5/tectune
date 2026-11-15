// Sincronização bidirecional com o app mobile (offline-first).
//
// POST /api/sync
//   { since: cursor | null,
//     changes: { songs: [...], setlists: [...], deletions: [{ entity, id, deleted_at }] } }
// → { cursor, songs: [...], setlists: [...], deletions: [...], applied: {...} }
//
// Regras:
//  - Cada aparelho cria registros com id próprio (UUID), então criar offline não gera conflito.
//  - Conflito na mesma música/setlist: vale a alteração mais recente (updated_at).
//  - Exclusão vence alterações mais antigas que ela; alteração feita depois da exclusão a desfaz.
//  - "since"/"cursor" usam o relógio do servidor (rev_at), não o do celular.
const { extractMeta } = require('./meta');

// o que aparece na folha do setlist; null = o aparelho não mandou (app antigo) → mantém o salvo
const COVER_KEYS = ['num', 'artist', 'key', 'bpm', 'info', 'notes'];
function coverOpts(v) {
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  for (const k of COVER_KEYS) if (typeof v[k] === 'boolean') out[k] = v[k];
  return JSON.stringify(out);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 2000;

class SyncError extends Error { constructor(msg) { super(msg); this.status = 400; } }

// data do aparelho: aceita ISO; se estiver no futuro (relógio adiantado), usa "agora"
function ts(v, now) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new SyncError('Data inválida: ' + v);
  return d > now ? now : d;
}
const str = (v, max) => (v == null || v === '' ? null : String(v).slice(0, max));

function validate(body) {
  const c = body?.changes || {};
  const songs = Array.isArray(c.songs) ? c.songs : [];
  const setlists = Array.isArray(c.setlists) ? c.setlists : [];
  const deletions = Array.isArray(c.deletions) ? c.deletions : [];
  if (songs.length + setlists.length + deletions.length > MAX_ITEMS) throw new SyncError('Alterações demais numa sincronização');
  for (const x of [...songs, ...setlists, ...deletions]) if (!UUID.test(String(x?.id))) throw new SyncError('id inválido: ' + x?.id);
  for (const d of deletions) if (!['song', 'setlist'].includes(d.entity)) throw new SyncError('Tipo de exclusão inválido');
  for (const s of songs) if (typeof s.content !== 'string' || s.content.length > 100000) throw new SyncError('Cifra inválida');
  for (const s of setlists) if (!String(s.name || '').trim()) throw new SyncError('Setlist sem nome');
  let since = null;
  if (body?.since) { since = new Date(body.since); if (Number.isNaN(since.getTime())) since = null; }
  return { songs, setlists, deletions, since };
}

async function runSync(pool, body, { band, canWrite = true } = {}) {
  const v = validate(body);
  const { since } = v;
  // membro sem permissão de edição: só recebe (o que ele mandou é ignorado)
  const { songs, setlists, deletions } = canWrite ? v : { songs: [], setlists: [], deletions: [] };
  const client = await pool.connect();
  const applied = { songs: 0, setlists: 0, deletions: 0 };
  try {
    await client.query('BEGIN');
    const now = new Date();

    // 1) exclusões vindas do aparelho (só apagam se ninguém alterou depois)
    for (const d of deletions) {
      const table = d.entity === 'song' ? 'songs' : 'setlists';
      const at = ts(d.deleted_at, now);
      const r = await client.query(`DELETE FROM ${table} WHERE id = $1 AND band_id = $3 AND updated_at <= $2`, [d.id, at, band]);
      if (r.rowCount) applied.deletions++;
      else {
        // não existia (criado e apagado offline) → registra a exclusão mesmo assim
        const exists = await client.query(`SELECT 1 FROM ${table} WHERE id = $1`, [d.id]);
        if (!exists.rowCount) {
          await client.query(`INSERT INTO tombstones (entity, id, band_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [d.entity, d.id, band]);
        }
      }
    }

    // exclusões já registradas no servidor que são mais novas que a alteração do aparelho
    const tomb = async (entity, id, at) => {
      const r = await client.query('SELECT deleted_at FROM tombstones WHERE entity = $1 AND id = $2', [entity, id]);
      return r.rowCount && r.rows[0].deleted_at >= at;
    };

    // 2) músicas (vale a mais recente)
    for (const s of songs) {
      const at = ts(s.updated_at, now);
      if (await tomb('song', s.id, at)) continue;
      const m = extractMeta(s.content);
      const fs = Number.isInteger(s.font_scale) && (s.font_scale === 0 || (s.font_scale >= 30 && s.font_scale <= 100)) ? s.font_scale : 100;
      const r = await client.query(
        `INSERT INTO songs (id, title, artist, song_key, bpm, content, font_scale, created_at, updated_at, band_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, artist = EXCLUDED.artist, song_key = EXCLUDED.song_key,
           bpm = EXCLUDED.bpm, content = EXCLUDED.content, font_scale = EXCLUDED.font_scale, updated_at = EXCLUDED.updated_at
         WHERE songs.updated_at < EXCLUDED.updated_at AND songs.band_id = EXCLUDED.band_id
         RETURNING id`,
        [s.id, m.title, m.artist, m.song_key, m.bpm, s.content, fs, at, band]);
      applied.songs += r.rowCount;
    }

    // 3) setlists (+ ordem das músicas), vale a mais recente
    for (const s of setlists) {
      const at = ts(s.updated_at, now);
      if (await tomb('setlist', s.id, at)) continue;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(s.event_date || '')) ? s.event_date : null;
      const cols = [4, 6, 8].includes(Number(s.cols)) ? Number(s.cols) : 4;
      // folha do setlist: se o aparelho não mandar (versão antiga do app), mantém o que já está salvo
      const cs = Number.isInteger(s.cover_scale) && (s.cover_scale === 0 || (s.cover_scale >= 40 && s.cover_scale <= 160)) ? s.cover_scale : null;
      const cl = ['detalhada', 'compacta', 'colunas'].includes(s.cover_layout) ? s.cover_layout : null;
      const co = coverOpts(s.cover_opts);
      const r = await client.query(
        `INSERT INTO setlists (id, name, event_date, venue, notes, cols, cover_scale, cover_layout, cover_opts, created_at, updated_at, band_id)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($8::smallint, 0), COALESCE($9::text, 'detalhada'), COALESCE($10::jsonb, '{}'::jsonb), $7, $7, $11)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, event_date = EXCLUDED.event_date, venue = EXCLUDED.venue,
           notes = EXCLUDED.notes, cols = EXCLUDED.cols, updated_at = EXCLUDED.updated_at,
           cover_scale = COALESCE($8::smallint, setlists.cover_scale), cover_layout = COALESCE($9::text, setlists.cover_layout),
           cover_opts = COALESCE($10::jsonb, setlists.cover_opts)
         WHERE setlists.updated_at < EXCLUDED.updated_at AND setlists.band_id = EXCLUDED.band_id
         RETURNING id`,
        [s.id, str(s.name, 200).trim(), date, str(s.venue, 200), str(s.notes, 5000), cols, at, cs, cl, co, band]);
      if (!r.rowCount) continue;
      applied.setlists++;
      const ids = (Array.isArray(s.song_ids) ? s.song_ids : []).filter(x => UUID.test(String(x))).slice(0, 500);
      await client.query('DELETE FROM setlist_songs WHERE setlist_id = $1', [s.id]);
      if (ids.length) {
        await client.query(
          `INSERT INTO setlist_songs (setlist_id, song_id, position)
           SELECT $1, t.sid, t.ord::int FROM unnest($2::uuid[]) WITH ORDINALITY AS t(sid, ord)
           WHERE EXISTS (SELECT 1 FROM songs WHERE songs.id = t.sid AND songs.band_id = $3)`,
          [s.id, ids, band]);
      }
    }

    // 4) o que mudou no servidor desde a última sincronização do aparelho
    // só o repertório da banda ativa
    const p = since ? [band, since] : [band];
    const cond = since ? 'WHERE band_id = $1 AND rev_at > $2' : 'WHERE band_id = $1';
    // uma consulta por vez: o mesmo client (transação) não aceita consultas em paralelo
    const sg = await client.query(`SELECT id, title, artist, song_key, bpm, font_scale, content, updated_at, rev_at FROM songs ${cond}`, p);
    const sl = await client.query(`SELECT id, name, to_char(event_date, 'YYYY-MM-DD') AS event_date, venue, notes, cols, cover_scale, cover_layout, cover_opts, updated_at, rev_at FROM setlists ${cond}`, p);
    const ord = await client.query(`SELECT ss.setlist_id, ss.song_id FROM setlist_songs ss JOIN setlists s ON s.id = ss.setlist_id WHERE s.band_id = $1 ${since ? 'AND s.rev_at > $2' : ''} ORDER BY ss.setlist_id, ss.position, ss.id`, p);
    const tb = await client.query(`SELECT entity, id, deleted_at FROM tombstones WHERE band_id = $1 ${since ? 'AND deleted_at > $2' : ''}`, p);
    await client.query('COMMIT');

    const bySl = {};
    for (const r of ord.rows) (bySl[r.setlist_id] ||= []).push(r.song_id);
    // cursor = maior rev visto (relógio do servidor); sem mudanças, mantém o anterior
    let cursor = since || new Date(0);
    for (const r of [...sg.rows, ...sl.rows]) if (r.rev_at > cursor) cursor = r.rev_at;
    for (const r of tb.rows) if (r.deleted_at > cursor) cursor = r.deleted_at;
    const clean = ({ rev_at, ...rest }) => rest;
    return {
      cursor: cursor.toISOString(),
      server_time: now.toISOString(),
      songs: sg.rows.map(clean),
      setlists: sl.rows.map(r => ({ ...clean(r), song_ids: bySl[r.id] || [] })),
      deletions: tb.rows,
      applied,
      readonly: !canWrite,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { runSync };
