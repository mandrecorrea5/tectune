// Show ao vivo: conexão com o servidor para o diretor musical comandar o play de todos.
// O diretor manda o estado (música, play/pausa, posição, andamento); quem segue recebe e rola junto.
// Os relógios combinam pela hora do servidor (diferença medida com ping/pong, como no NTP).
import { useCallback, useEffect, useRef, useState } from 'react';

const wsUrl = (server, room, token) => server.replace(/^http/i, 'ws').replace(/\/+$/, '') + '/api/live?room=' + encodeURIComponent(room) + '&token=' + encodeURIComponent(token || '');

/**
 * role: 'off' (sozinho) | 'diretor' | 'seguir'.
 * Retorna { status, peers, isDirector, remote, serverNow, send }.
 * `remote` = último estado recebido do diretor (só para quem segue).
 */
export function useLive({ server, room, role, name, view, token }) {
  const [status, setStatus] = useState('off'); // off | connecting | on | error
  const [peers, setPeers] = useState(null);
  const [remote, setRemote] = useState(null);
  const ws = useRef(null);
  const offset = useRef(0);      // hora do servidor − Date.now()
  const best = useRef(Infinity); // menor tempo de ida e volta medido (amostra mais confiável)
  const info = useRef({ role, name, view });
  info.current = { role, name, view };

  const raw = useCallback(m => { const s = ws.current; if (s && s.readyState === 1) s.send(JSON.stringify(m)); }, []);

  useEffect(() => {
    if (role === 'off' || !server || !room) { setStatus('off'); setPeers(null); setRemote(null); return undefined; }
    let closed = false, retry = null, pinger = null, tries = 0;
    const open = () => {
      setStatus('connecting');
      let s;
      try { s = new WebSocket(wsUrl(server, room, token)); } catch { setStatus('error'); return; }
      ws.current = s;
      s.onopen = () => {
        tries = 0; setStatus('on'); best.current = Infinity;
        const { name: n, view: v, role: r } = info.current;
        raw({ t: 'hello', name: n, view: v });
        if (r === 'diretor') raw({ t: 'lead' });
        const ping = () => raw({ t: 'ping', c: Date.now() });
        for (let k = 0; k < 4; k++) setTimeout(ping, k * 250); // várias amostras logo no começo
        pinger = setInterval(ping, 5000);
      };
      s.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'pong') {
          const t = Date.now(), rtt = t - m.c;
          // fica com a amostra de menor atraso (mais precisa); aceita uma nova se piorou muito com o tempo
          if (rtt <= best.current * 1.5 || rtt < 60) { best.current = Math.min(best.current, rtt); offset.current = m.s - (m.c + rtt / 2); }
        } else if (m.t === 'hi' && best.current === Infinity) offset.current = m.s - Date.now();
        else if (m.t === 'peers') setPeers(m);
        else if (m.t === 'state' && info.current.role === 'seguir') setRemote(m.state);
      };
      s.onclose = () => {
        clearInterval(pinger);
        if (closed) return;
        setStatus('error');
        retry = setTimeout(open, Math.min(8000, 1000 * 2 ** tries++)); // tenta de novo (1s, 2s, 4s…)
      };
      s.onerror = () => {};
    };
    open();
    return () => { closed = true; clearTimeout(retry); clearInterval(pinger); try { ws.current?.close(); } catch { /* ignora */ } ws.current = null; };
  }, [server, room, token, role === 'off']); // eslint-disable-line react-hooks/exhaustive-deps

  // troca de papel/nome/visão sem reconectar
  useEffect(() => {
    if (status !== 'on') return;
    raw({ t: 'hello', name, view });
    raw({ t: role === 'diretor' ? 'lead' : 'unlead' });
    if (role !== 'seguir') setRemote(null);
  }, [role, name, view, status, raw]);

  const serverNow = useCallback(() => Date.now() + offset.current, []);
  const send = useCallback(state => { if (info.current.role === 'diretor') raw({ t: 'state', state }); }, [raw]);
  return { status, peers, isDirector: !!peers?.you, remote, serverNow, send };
}
