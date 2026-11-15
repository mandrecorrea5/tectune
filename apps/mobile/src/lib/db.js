// Banco local do app (SQLite no próprio celular).
// Tudo é gravado aqui primeiro; a sincronização envia/recebe as alterações quando há conexão.
import * as SQLite from 'expo-sqlite';
import { coverOpts } from '@tectune/core';

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS songs (
  id         TEXT PRIMARY KEY,
  content    TEXT NOT NULL DEFAULT '',
  font_scale INTEGER NOT NULL DEFAULT 100,
  updated_at TEXT NOT NULL,
  dirty      INTEGER NOT NULL DEFAULT 0          -- 1 = alterada no celular, ainda não enviada
);
CREATE TABLE IF NOT EXISTS setlists (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  event_date TEXT,
  venue      TEXT,
  notes      TEXT,
  cols       INTEGER NOT NULL DEFAULT 4,
  song_ids   TEXT NOT NULL DEFAULT '[]',         -- ordem das músicas (JSON)
  updated_at TEXT NOT NULL,
  dirty      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS deletions (         -- exclusões feitas no celular, ainda não enviadas
  entity     TEXT NOT NULL,
  id         TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (entity, id)
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
`;

let dbPromise = null;
export function getDb() {
  if (!dbPromise) dbPromise = open();
  return dbPromise;
}
async function open() {
  const db = await SQLite.openDatabaseAsync('grade-cifras.db');
  try { await db.execAsync('PRAGMA journal_mode = WAL;'); } catch (e) { /* web */ }
  const row = await db.getFirstAsync('PRAGMA user_version');
  const v = row ? Number(Object.values(row)[0]) : 0;
  if (v < 1) {
    await db.execAsync(SCHEMA_V1);
    await db.execAsync('PRAGMA user_version = 1');
  }
  if (v < 2) {
    // folha do setlist: tamanho (0 = automático, cabe em 1 folha) e visualização
    const cols = await db.getAllAsync('PRAGMA table_info(setlists)');
    if (!cols.some(c => c.name === 'cover_scale')) await db.execAsync('ALTER TABLE setlists ADD COLUMN cover_scale INTEGER NOT NULL DEFAULT 0');
    if (!cols.some(c => c.name === 'cover_layout')) await db.execAsync("ALTER TABLE setlists ADD COLUMN cover_layout TEXT NOT NULL DEFAULT 'detalhada'");
    await db.execAsync('PRAGMA user_version = 2');
  }
  if (v < 3) {
    // folha do setlist: o que mostrar (tom, BPM, artista…), em JSON
    const cols = await db.getAllAsync('PRAGMA table_info(setlists)');
    if (!cols.some(c => c.name === 'cover_opts')) await db.execAsync("ALTER TABLE setlists ADD COLUMN cover_opts TEXT NOT NULL DEFAULT '{}'");
    await db.execAsync('PRAGMA user_version = 3');
  }
  return db;
}

export const nowIso = () => new Date().toISOString();

export async function kvGet(db, key) {
  const r = await db.getFirstAsync('SELECT value FROM kv WHERE key = ?', key);
  return r ? r.value : null;
}
export async function kvSet(db, key, value) {
  await db.runAsync('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value == null ? null : String(value));
}

/** Tudo que a interface precisa, em memória (o volume de dados é pequeno). */
export async function loadAll(db) {
  const [songRows, setRows, del] = await Promise.all([
    db.getAllAsync('SELECT id, content, font_scale, updated_at, dirty FROM songs'),
    db.getAllAsync(`SELECT id, name, event_date, venue, notes, cols, song_ids, cover_scale, cover_layout, cover_opts, updated_at, dirty FROM setlists
                    ORDER BY event_date IS NULL, event_date DESC, updated_at DESC`),
    db.getFirstAsync('SELECT count(*) AS n FROM deletions'),
  ]);
  const songs = {};
  for (const s of songRows) songs[s.id] = s;
  const setlists = setRows.map(s => ({ ...s, cover_opts: coverOpts(s.cover_opts), song_ids: safeJson(s.song_ids).filter(id => songs[id]) }));
  const dirty = songRows.filter(s => s.dirty).length + setRows.filter(s => s.dirty).length + Number(del?.n || 0);
  return { songs, setlists, dirty };
}
const safeJson = v => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };

/* ---------- gravações locais (sempre marcam como "a enviar") ---------- */
export async function saveSong(db, { id, content, font_scale }) {
  const cur = await db.getFirstAsync('SELECT content, font_scale FROM songs WHERE id = ?', id);
  await db.runAsync(
    `INSERT INTO songs (id, content, font_scale, updated_at, dirty) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET content = excluded.content, font_scale = excluded.font_scale, updated_at = excluded.updated_at, dirty = 1`,
    id, content ?? cur?.content ?? '', font_scale ?? cur?.font_scale ?? 100, nowIso());
}
export async function saveSetlist(db, s) {
  await db.runAsync(
    `INSERT INTO setlists (id, name, event_date, venue, notes, cols, song_ids, cover_scale, cover_layout, cover_opts, updated_at, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, event_date = excluded.event_date, venue = excluded.venue,
       notes = excluded.notes, cols = excluded.cols, song_ids = excluded.song_ids,
       cover_scale = excluded.cover_scale, cover_layout = excluded.cover_layout, cover_opts = excluded.cover_opts, updated_at = excluded.updated_at, dirty = 1`,
    s.id, s.name, s.event_date || null, s.venue || null, s.notes || null, s.cols || 4, JSON.stringify(s.song_ids || []),
    Number(s.cover_scale) || 0, s.cover_layout || 'detalhada', JSON.stringify(coverOpts(s.cover_opts)), nowIso());
}
export async function deleteLocal(db, entity, id) {
  await db.withTransactionAsync(async () => {
    if (entity === 'song') {
      await db.runAsync('DELETE FROM songs WHERE id = ?', id);
      await removeSongFromSetlists(db, id, true);
    } else {
      await db.runAsync('DELETE FROM setlists WHERE id = ?', id);
    }
    await db.runAsync(
      `INSERT INTO deletions (entity, id, deleted_at) VALUES (?, ?, ?)
       ON CONFLICT(entity, id) DO UPDATE SET deleted_at = excluded.deleted_at`, entity, id, nowIso());
  });
}
async function removeSongFromSetlists(db, songId, markDirty) {
  const rows = await db.getAllAsync('SELECT id, song_ids FROM setlists WHERE song_ids LIKE ?', `%${songId}%`);
  for (const r of rows) {
    const ids = safeJson(r.song_ids).filter(x => x !== songId);
    if (markDirty) await db.runAsync('UPDATE setlists SET song_ids = ?, updated_at = ?, dirty = 1 WHERE id = ?', JSON.stringify(ids), nowIso(), r.id);
    else await db.runAsync('UPDATE setlists SET song_ids = ? WHERE id = ?', JSON.stringify(ids), r.id);
  }
}

/* ---------- sincronização ---------- */
/** O que precisa ser enviado ao servidor. */
export async function collectChanges(db) {
  const [songs, setlists, deletions] = await Promise.all([
    db.getAllAsync('SELECT id, content, font_scale, updated_at FROM songs WHERE dirty = 1'),
    db.getAllAsync('SELECT id, name, event_date, venue, notes, cols, song_ids, cover_scale, cover_layout, cover_opts, updated_at FROM setlists WHERE dirty = 1'),
    db.getAllAsync('SELECT entity, id, deleted_at FROM deletions'),
  ]);
  return { songs, setlists: setlists.map(s => ({ ...s, cover_opts: coverOpts(s.cover_opts), song_ids: safeJson(s.song_ids) })), deletions };
}

/**
 * Aplica a resposta do servidor:
 *  - o que foi enviado deixa de estar pendente (se não mudou de novo durante a sincronização);
 *  - recebe as alterações do servidor sem passar por cima de edições locais mais novas.
 */
export async function applySyncResult(db, sent, res) {
  await db.withTransactionAsync(async () => {
    for (const s of sent.songs) await db.runAsync('UPDATE songs SET dirty = 0 WHERE id = ? AND updated_at = ?', s.id, s.updated_at);
    for (const s of sent.setlists) await db.runAsync('UPDATE setlists SET dirty = 0 WHERE id = ? AND updated_at = ?', s.id, s.updated_at);
    for (const d of sent.deletions) await db.runAsync('DELETE FROM deletions WHERE entity = ? AND id = ? AND deleted_at = ?', d.entity, d.id, d.deleted_at);

    for (const d of res.deletions || []) {
      const at = new Date(d.deleted_at).toISOString();
      if (d.entity === 'song') {
        const r = await db.runAsync('DELETE FROM songs WHERE id = ? AND (dirty = 0 OR updated_at <= ?)', d.id, at);
        if (r.changes) await removeSongFromSetlists(db, d.id, false);
      } else {
        await db.runAsync('DELETE FROM setlists WHERE id = ? AND (dirty = 0 OR updated_at <= ?)', d.id, at);
      }
    }
    for (const s of res.songs || []) {
      await db.runAsync(
        `INSERT INTO songs (id, content, font_scale, updated_at, dirty) VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET content = excluded.content, font_scale = excluded.font_scale, updated_at = excluded.updated_at, dirty = 0
         WHERE songs.dirty = 0 OR songs.updated_at <= excluded.updated_at`,
        s.id, s.content, s.font_scale ?? 100, new Date(s.updated_at).toISOString());
    }
    for (const s of res.setlists || []) {
      await db.runAsync(
        `INSERT INTO setlists (id, name, event_date, venue, notes, cols, song_ids, cover_scale, cover_layout, cover_opts, updated_at, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, event_date = excluded.event_date, venue = excluded.venue, notes = excluded.notes,
           cols = excluded.cols, song_ids = excluded.song_ids, cover_scale = excluded.cover_scale, cover_layout = excluded.cover_layout,
           cover_opts = excluded.cover_opts, updated_at = excluded.updated_at, dirty = 0
         WHERE setlists.dirty = 0 OR setlists.updated_at <= excluded.updated_at`,
        s.id, s.name, s.event_date || null, s.venue || null, s.notes || null, s.cols || 4, JSON.stringify(s.song_ids || []),
        Number(s.cover_scale) || 0, s.cover_layout || 'detalhada', JSON.stringify(coverOpts(s.cover_opts)), new Date(s.updated_at).toISOString());
    }
    await kvSet(db, 'cursor', res.cursor);
    await kvSet(db, 'lastSync', new Date().toISOString());
  });
}

/** Esquece o que veio do servidor e baixa tudo de novo (mantém o que está pendente). */
export async function resetCursor(db) { await kvSet(db, 'cursor', null); }

/** Apaga o repertório guardado no celular (troca de banda ou saída da conta). */
export async function wipeLocal(db) {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM songs');
    await db.runAsync('DELETE FROM setlists');
    await db.runAsync('DELETE FROM deletions');
  });
  await kvSet(db, 'cursor', null);
  await kvSet(db, 'lastSync', null);
}
