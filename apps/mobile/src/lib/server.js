// Descobre o endereço do servidor (sistema web) a partir de onde o app está rodando.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { api, normalizeUrl } from './api';

const LOCAL = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];

/** IP do computador que está rodando o `npx expo start` (só em desenvolvimento). */
export function devHost() {
  const uri = Constants.expoConfig?.hostUri || Constants.expoGoConfig?.debuggerHost || '';
  const host = uri.replace(/^[a-z]+:\/\//i, '').split('/')[0].split(':')[0];
  return host && !LOCAL.includes(host) ? host : null;
}

/** Servidor oficial (produção). Pode ser trocado com EXPO_PUBLIC_API_URL na hora do build. */
export const PROD_SERVER = (process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl || 'https://tectune.com.br').replace(/\/+$/, '');
const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;

/** Endereço sugerido: em produção o servidor oficial; em desenvolvimento, a porta 3000 do computador do Expo. */
export function suggestedServer() {
  if (!IS_DEV) return PROD_SERVER;
  if (Platform.OS === 'web') {
    return typeof window !== 'undefined' && window.location?.hostname ? `http://${window.location.hostname}:3000` : '';
  }
  const h = devHost();
  if (h) return `http://${h}:3000`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:3000' : '';
}

/**
 * No celular/emulador, "localhost" é o próprio aparelho, não o computador.
 * Troca pelo IP do computador (ou 10.0.2.2, o atalho do emulador Android para o computador).
 * Retorna { url, fixed }.
 */
export function fixLocalhost(url) {
  const u = normalizeUrl(url);
  if (Platform.OS === 'web' || !u) return { url: u, fixed: false };
  const m = u.match(/^(https?:\/\/)([^/:]+)(.*)$/i);
  if (!m || !LOCAL.includes(m[2].toLowerCase())) return { url: u, fixed: false };
  const host = devHost() || (Platform.OS === 'android' ? '10.0.2.2' : null);
  return host ? { url: `${m[1]}${host}${m[3]}`, fixed: true } : { url: u, fixed: false };
}

/** Endereços possíveis para o servidor, do mais provável ao menos provável. */
export function candidates(current) {
  const list = [];
  const add = u => { const n = normalizeUrl(u); if (n && !list.includes(n)) list.push(n); };
  if (current) add(fixLocalhost(current).url);
  const s = suggestedServer(); if (s) add(s);
  if (!IS_DEV) { add(PROD_SERVER); return list; }
  if (Platform.OS === 'android') add('http://10.0.2.2:3000');
  add('http://localhost:3000');
  add(PROD_SERVER);
  return list;
}

/**
 * Testa todos os endereços possíveis ao mesmo tempo.
 * Retorna [{ url, ok, ms, error }] na ordem dos candidatos.
 */
export async function probeServers(current) {
  const list = candidates(current);
  return Promise.all(list.map(async url => {
    const t = Date.now();
    try { await api.health(url); return { url, ok: true, ms: Date.now() - t }; }
    catch (e) { return { url, ok: false, error: e.message }; }
  }));
}
