// Acesso à API do sistema web (apps/web)
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function normalizeUrl(url) {
  let u = String(url || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u;
}

// sessão: token do login e banda ativa (o repertório é da banda)
const session = { token: null, band: null };
export function setSession(token, band) { session.token = token || null; session.band = band || null; }

async function request(base, method, path, body, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(normalizeUrl(base) + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(session.token ? { Authorization: 'Bearer ' + session.token } : {}),
        ...(session.band ? { 'X-Band': session.band } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (r.status === 204) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status, j.error || `Erro ${r.status}`);
    return j;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const detail = e?.message ? ` (${e.message})` : '';
    throw new ApiError(0, e.name === 'AbortError' ? 'O servidor não respondeu a tempo' : `Sem conexão com o servidor${detail}`);
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  health: base => request(base, 'GET', '/api/health', null, 5000),
  register: (base, data) => request(base, 'POST', '/api/auth/register', data),
  login: (base, data) => request(base, 'POST', '/api/auth/login', data),
  logout: base => request(base, 'POST', '/api/auth/logout'),
  me: base => request(base, 'GET', '/api/me'),
  createBand: (base, name) => request(base, 'POST', '/api/bands', { name }),
  band: (base, id) => request(base, 'GET', '/api/bands/' + id),
  renameBand: (base, id, name) => request(base, 'PATCH', '/api/bands/' + id, { name }),
  invite: (base, id, email) => request(base, 'POST', `/api/bands/${id}/invites`, { email }),
  cancelInvite: (base, id, inv) => request(base, 'DELETE', `/api/bands/${id}/invites/${inv}`),
  answerInvite: (base, inv, accept) => request(base, 'POST', `/api/invites/${inv}/${accept ? 'accept' : 'decline'}`),
  setRole: (base, id, uid, role) => request(base, 'PATCH', `/api/bands/${id}/members/${uid}`, { role }),
  removeMember: (base, id, uid) => request(base, 'DELETE', `/api/bands/${id}/members/${uid}`),
  sync: (base, payload) => request(base, 'POST', '/api/sync', payload, 30000),
  updateSong: (base, id, patch) => request(base, 'PUT', '/api/songs/' + id, patch),
};
