// Show ao vivo: o diretor musical dá o play e todos os aparelhos da banda acompanham.
// WebSocket em /api/live?room=<id da setlist>. O servidor só repassa o estado do diretor
// (música, play/pausa, posição e andamento) e dá a hora certa para os relógios combinarem.
'use strict';
const { WebSocketServer } = require('ws');

const rooms = new Map(); // room → { clients:Set, director:ws|null, state }

function roomOf(id) {
  if (!rooms.has(id)) rooms.set(id, { clients: new Set(), director: null, state: null });
  return rooms.get(id);
}
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

function peers(room) {
  for (const ws of room.clients) {
    send(ws, {
      t: 'peers',
      count: room.clients.size,
      director: room.director ? room.director.info.name || 'Diretor' : null,
      you: room.director === ws,
      members: [...room.clients].map(c => ({ name: c.info.name || 'Sem nome', view: c.info.view || 'musico', inst: c.info.inst || '', guest: !!c.guest, director: room.director === c })),
    });
  }
}

// instrumentos de quem entra (o app ajusta a visão: voz vê a letra, bateria vê a estrutura…)
const INSTS = ['voz', 'harmonia', 'baixo', 'teclado', 'bateria', 'outro'];
const SHARE_RE = /^[A-Za-z0-9_-]{20,64}$/;

/** Tira do ao vivo quem entrou pelo link do show (o link foi desligado ou trocado). */
function dropGuests(roomId) {
  const room = rooms.get(String(roomId)); if (!room) return;
  for (const ws of room.clients) if (ws.guest) try { ws.close(4003, 'O link do show foi desligado'); } catch { /* ignora */ }
}

function attachLive(server, { pool, userFromToken } = {}) {
  // entra quem é membro da banda dona da setlist (sala) ou quem tem o link do show (só acompanha)
  const verifyClient = (info, done) => {
    if (!userFromToken) return done(true);
    const url = new URL(info.req.url, 'http://x');
    const room = url.searchParams.get('room') || '';
    const share = url.searchParams.get('share') || '';
    (async () => {
      if (share) {
        if (!SHARE_RE.test(share)) return done(false, 403, 'Link inválido');
        const { rows } = await pool.query('SELECT 1 FROM setlists WHERE id::text = $1 AND share_token = $2', [room, share]);
        if (!rows.length) return done(false, 403, 'Este link não existe ou foi desligado');
        info.req.guest = true; return done(true);
      }
      const user = await userFromToken(url.searchParams.get('token'));
      if (!user) return done(false, 401, 'Entre na sua conta');
      const { rows } = await pool.query(
        `SELECT 1 FROM setlists s JOIN band_members m ON m.band_id = s.band_id WHERE s.id::text = $1 AND m.user_id = $2`, [room, user.id]);
      if (!rows.length) return done(false, 403, 'Você não faz parte desta banda');
      info.req.user = user; done(true);
    })().catch(() => done(false, 500, 'Erro'));
  };
  const wss = new WebSocketServer({ server, path: '/api/live', maxPayload: 16 * 1024, verifyClient });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://x');
    const id = (url.searchParams.get('room') || '').slice(0, 80);
    if (!id) { ws.close(1008, 'room obrigatório'); return; }
    const room = roomOf(id);
    ws.guest = !!req.guest;
    ws.info = { name: req.user?.name || '', view: 'musico', inst: '' };
    ws.alive = true;
    room.clients.add(ws);
    send(ws, { t: 'hi', s: Date.now() });
    if (room.state) send(ws, { t: 'state', state: room.state });
    peers(room);

    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m !== 'object') return;
      switch (m.t) {
        case 'ping': send(ws, { t: 'pong', c: m.c, s: Date.now() }); break;
        case 'hello':
          ws.info = { name: String(m.name || req.user?.name || '').slice(0, 40), view: m.view === 'cantor' ? 'cantor' : 'musico', inst: INSTS.includes(m.inst) ? m.inst : '' };
          peers(room); break;
        case 'lead': // assumir a direção (quem pede por último fica); quem entrou pelo link só acompanha
          if (ws.guest) return;
          room.director = ws; peers(room); break;
        case 'unlead':
          if (room.director === ws) { room.director = null; peers(room); }
          break;
        case 'state':
          if (room.director !== ws || !m.state || typeof m.state !== 'object') return;
          room.state = { ...m.state, sentAt: Date.now() };
          for (const c of room.clients) if (c !== ws) send(c, { t: 'state', state: room.state });
          break;
        default:
      }
    });
    ws.on('close', () => {
      room.clients.delete(ws);
      if (room.director === ws) room.director = null;
      if (!room.clients.size) rooms.delete(id); else peers(room);
    });
  });

  // derruba conexões mortas (celular que perdeu o Wi-Fi sem avisar)
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false; try { ws.ping(); } catch { /* ignora */ }
    }
  }, 15000);
  wss.on('close', () => clearInterval(beat));
  return wss;
}

module.exports = { attachLive, dropGuests };
