// Estado do app: SQLite no celular (funciona offline) + sincronização com o servidor.
// Todas as ações gravam primeiro no celular e ficam pendentes até a próxima sincronização.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { api, setSession, ApiError } from './api';
import { fixLocalhost, probeServers, suggestedServer } from './server';
import {
  getDb, loadAll, kvGet, kvSet, nowIso, saveSong, saveSetlist, deleteLocal, collectChanges, applySyncResult, wipeLocal,
} from './db';

const OLD_KEY = 'grade-cifras:dados:v1'; // versão anterior (AsyncStorage)
export const newId = () => Crypto.randomUUID();

// música nova começa sem estrutura: o músico adiciona as seções na ordem que quiser
export const NEW_SONG = `título: Nova música
artista:
tom: C
bpm: 90
compasso: 4/4
`;

// Traz os dados da versão anterior do app (antes do SQLite), uma única vez
async function migrateFromAsyncStorage(db) {
  if (await kvGet(db, 'migrated_v1')) return;
  try {
    const raw = await AsyncStorage.getItem(OLD_KEY);
    if (raw) {
      const old = JSON.parse(raw);
      await db.withTransactionAsync(async () => {
        for (const s of Object.values(old.songs || {})) {
          const p = old.pending?.[s.id];
          await db.runAsync(
            'INSERT OR IGNORE INTO songs (id, content, font_scale, updated_at, dirty) VALUES (?, ?, ?, ?, ?)',
            s.id, p?.content ?? s.content ?? '', p?.font_scale ?? s.font_scale ?? 100,
            p ? nowIso() : new Date(s.updated_at || Date.now()).toISOString(), p ? 1 : 0);
        }
        for (const s of old.setlists || []) {
          await db.runAsync(
            'INSERT OR IGNORE INTO setlists (id, name, event_date, venue, notes, cols, song_ids, updated_at, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
            s.id, s.name, s.event_date || null, s.venue || null, s.notes || null, s.cols || 4, JSON.stringify(s.song_ids || []),
            new Date(s.updated_at || Date.now()).toISOString());
        }
      });
      if (old.serverUrl && !(await kvGet(db, 'serverUrl'))) await kvSet(db, 'serverUrl', old.serverUrl);
    }
  } catch (e) { /* sem dados antigos */ }
  await kvSet(db, 'migrated_v1', '1');
}

const Ctx = createContext(null);

export function DataProvider({ children }) {
  const [state, setState] = useState({ songs: {}, setlists: [], dirty: 0 });
  const [serverUrl, setUrl] = useState('');
  const [lastSync, setLastSync] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);
  // conta: token do login, bandas e convites, banda ativa
  const [account, setAccount] = useState({ token: null, user: null, bands: [], invites: [], bandId: null });
  const acct = useRef(account); acct.current = account;
  const syncingRef = useRef(false);
  const urlRef = useRef('');
  const stateRef = useRef(state);
  stateRef.current = state;

  const reload = useCallback(async () => {
    const db = await getDb();
    setState(await loadAll(db));
  }, []);

  // abre o banco, migra dados antigos e carrega
  useEffect(() => {
    (async () => {
      const db = await getDb();
      await migrateFromAsyncStorage(db);
      let url = await kvGet(db, 'serverUrl');
      url = url ? fixLocalhost(url).url : suggestedServer();
      urlRef.current = url; setUrl(url);
      setLastSync(await kvGet(db, 'lastSync'));
      const token = await kvGet(db, 'token'), bandId = await kvGet(db, 'bandId');
      let user = null;
      try { user = JSON.parse((await kvGet(db, 'user')) || 'null'); } catch (e) { /* sem usuário salvo */ }
      let bands = [];
      try { bands = JSON.parse((await kvGet(db, 'bands')) || '[]'); } catch (e) { /* idem */ }
      setSession(token, bandId);
      setAccount({ token, user, bands, invites: [], bandId });
      await reload();
      setLoaded(true);
    })().catch(e => { setSyncError('Erro ao abrir o banco do celular: ' + e.message); setLoaded(true); });
  }, [reload]);

  const setServerUrl = useCallback(async url => {
    const u = fixLocalhost(url).url;
    urlRef.current = u; setUrl(u);
    const db = await getDb();
    await kvSet(db, 'serverUrl', u);
    return u;
  }, []);

  /** Envia o que foi feito no celular e recebe o que mudou no servidor. */
  const sync = useCallback(async ({ discover = true } = {}) => {
    if (syncingRef.current) return false;
    syncingRef.current = true; setSyncing(true); setSyncError(null);
    try {
      const db = await getDb();
      let url = urlRef.current;
      // sem endereço, ou endereço que não responde → procura o servidor automaticamente
      if (discover) {
        let ok = false;
        if (url) { try { await api.health(url); ok = true; } catch (e) { /* procura abaixo */ } }
        if (!ok) {
          const found = (await probeServers(url)).find(r => r.ok);
          if (found) url = await setServerUrl(found.url);
          else throw new Error('Servidor não encontrado — seus dados continuam salvos no celular. Veja ⚙︎ Servidor.');
        }
      }
      if (!url) throw new Error('Configure o endereço do servidor em ⚙︎ Servidor.');
      if (!acct.current.token) throw new Error('Entre na sua conta para sincronizar.');
      if (!acct.current.bandId) throw new Error('Escolha uma banda.');
      const sent = await collectChanges(db);
      const res = await api.sync(url, { since: await kvGet(db, 'cursor'), changes: sent });
      await applySyncResult(db, sent, res);
      setLastSync(await kvGet(db, 'lastSync'));
      await reload();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await forgetLogin();
      setSyncError(e.message || 'Falha ao sincronizar');
      return false;
    } finally {
      syncingRef.current = false; setSyncing(false);
    }
  }, [reload, setServerUrl]);

  /* ----- conta e bandas ----- */
  const saveAccount = useCallback(async next => {
    const db = await getDb();
    await kvSet(db, 'token', next.token || null);
    await kvSet(db, 'bandId', next.bandId || null);
    await kvSet(db, 'user', next.user ? JSON.stringify(next.user) : null);
    await kvSet(db, 'bands', JSON.stringify(next.bands || []));
    setSession(next.token, next.bandId);
    setAccount(next);
  }, []);
  async function forgetLogin() {
    const db = await getDb(); await wipeLocal(db);
    await saveAccount({ token: null, user: null, bands: [], invites: [], bandId: null });
    await reload();
  }
  /** Atualiza bandas/convites; se a banda ativa sumiu, troca para outra (e recarrega o repertório). */
  const applyMe = useCallback(async (meRes, preferBand) => {
    const cur = acct.current;
    const want = preferBand || cur.bandId;
    const bandId = meRes.bands.some(b => b.id === want) ? want : (meRes.bands[0]?.id || null);
    const db = await getDb();
    if (bandId !== cur.bandId) {
      // 1º login neste aparelho como admin: mantém o que já estava no celular (vai para a banda);
      // trocar de banda (ou ser só membro): começa do zero e baixa o repertório da banda
      const role = meRes.bands.find(b => b.id === bandId)?.role;
      if (cur.bandId || role !== 'admin') await wipeLocal(db); else await kvSet(db, 'cursor', null);
    }
    await saveAccount({ ...cur, user: meRes.user, bands: meRes.bands, invites: meRes.invites, bandId });
    await reload();
    return bandId;
  }, [saveAccount, reload]);
  const refreshMe = useCallback(async preferBand => {
    const r = await api.me(urlRef.current);
    const b = await applyMe(r, preferBand);
    if (b) sync({ discover: false });
    return r;
  }, [applyMe]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Entrar ou criar conta. mode: 'login' | 'register' */
  const signIn = useCallback(async (mode, data) => {
    let url = urlRef.current;
    if (!url) { const found = (await probeServers(url)).find(r => r.ok); if (found) url = await setServerUrl(found.url); }
    if (!url) throw new Error('Servidor não encontrado. Configure o endereço em ⚙︎ Servidor.');
    const r = mode === 'register' ? await api.register(url, data) : await api.login(url, data);
    if (r.pending) return r; // conta criada: falta confirmar o e-mail
    setSession(r.token, null);
    await saveAccount({ ...acct.current, token: r.token, user: r.user });
    await refreshMe();
  }, [saveAccount, refreshMe, setServerUrl]);
  const signOut = useCallback(async () => {
    try { await api.logout(urlRef.current); } catch (e) { /* já saiu */ }
    await forgetLogin();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const selectBand = useCallback(async id => {
    if (id === acct.current.bandId) return;
    if (acct.current.bands.find(b => b.id === acct.current.bandId)?.role === 'admin') await sync({ discover: false }); // envia o que falta antes de trocar
    const db = await getDb(); await wipeLocal(db);
    await saveAccount({ ...acct.current, bandId: id });
    await reload();
    await sync({ discover: false });
  }, [saveAccount, reload]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Ações de banda no servidor (criar, convites, papéis); depois atualiza a conta. */
  const bandApi = useCallback(async (fn, preferBand) => {
    const out = await fn(api, urlRef.current, acct.current.bandId);
    await refreshMe(typeof preferBand === 'function' ? preferBand(out) : preferBand);
    return out;
  }, [refreshMe]);

  // depois de cada alteração, tenta sincronizar em segundo plano (se houver conexão)
  const autoTimer = useRef(null);
  const scheduleSync = useCallback(() => {
    clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => { if (urlRef.current) sync({ discover: false }); }, 4000);
  }, [sync]);

  const mutate = useCallback(async fn => {
    const db = await getDb();
    const out = await fn(db);
    await reload();
    scheduleSync();
    return out;
  }, [reload, scheduleSync]);

  /* ----- músicas ----- */
  const createSong = useCallback((content = NEW_SONG) => mutate(async db => {
    const id = newId(); await saveSong(db, { id, content, font_scale: 100 }); return id;
  }), [mutate]);
  const updateSong = useCallback((id, patch) => mutate(db => saveSong(db, { id, ...patch })), [mutate]);
  const deleteSong = useCallback(id => mutate(db => deleteLocal(db, 'song', id)), [mutate]);

  /* ----- setlists ----- */
  const createSetlist = useCallback(data => mutate(async db => {
    const id = newId(); await saveSetlist(db, { cols: 4, song_ids: [], ...data, id }); return id;
  }), [mutate]);
  const updateSetlist = useCallback((id, patch) => mutate(async db => {
    const cur = stateRef.current.setlists.find(s => s.id === id); if (!cur) return;
    await saveSetlist(db, { ...cur, ...patch, id });
  }), [mutate]);
  const deleteSetlist = useCallback(id => mutate(db => deleteLocal(db, 'setlist', id)), [mutate]);
  const setSetlistSongs = useCallback((id, songIds) => updateSetlist(id, { song_ids: songIds }), [updateSetlist]);

  const role = account.bands.find(b => b.id === account.bandId)?.role || null;
  const value = useMemo(() => ({
    ...state, serverUrl, lastSync, loaded, syncing, syncError, pendingCount: state.dirty,
    sync, setServerUrl, reload,
    account, role, readonly: role !== 'admin', band: account.bands.find(b => b.id === account.bandId) || null,
    signIn, signOut, refreshMe, selectBand, bandApi,
    createSong, updateSong, deleteSong, createSetlist, updateSetlist, deleteSetlist, setSetlistSongs,
  }), [state, serverUrl, lastSync, loaded, syncing, syncError, sync, setServerUrl, reload,
    account, role, signIn, signOut, refreshMe, selectBand, bandApi,
    createSong, updateSong, deleteSong, createSetlist, updateSetlist, deleteSetlist, setSetlistSongs]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useData = () => useContext(Ctx);
