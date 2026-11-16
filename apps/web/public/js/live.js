// Show ao vivo (web): mesma conexão do app. O diretor manda o estado do play; quem segue recebe.
// Os relógios combinam pela hora do servidor (diferença medida com ping/pong).
export class Live {
  constructor({ onPeers, onState, onStatus, token }) {
    this.token = token || (() => '');
    this.onPeers = onPeers || (() => {}); this.onState = onState || (() => {}); this.onStatus = onStatus || (() => {});
    this.role = 'off'; this.room = null; this.name = ''; this.view = 'musico'; this.inst = ''; this.share = null;
    this.status = 'off'; this.peers = null; this.offset = 0; this.best = Infinity;
    this.ws = null; this._retry = null; this._ping = null; this._tries = 0;
  }
  get isDirector() { return !!this.peers?.you; }
  get director() { return this.peers?.director || null; }
  serverNow() { return Date.now() + this.offset; }

  /** Liga/desliga ou troca o papel ('off' | 'diretor' | 'seguir') na sala (= setlist). */
  set({ role = this.role, room = this.room, name = this.name, view = this.view }) {
    const reconnect = room !== this.room || (role !== 'off') !== (this.role !== 'off');
    Object.assign(this, { role, room, name, view });
    if (reconnect) { this._close(); if (role !== 'off' && room) this._open(); else this._setStatus('off'); }
    else if (this.status === 'on') { this._raw({ t: 'hello', name, view, inst: this.inst }); this._raw({ t: role === 'diretor' ? 'lead' : 'unlead' }); }
  }
  send(state) { if (this.role === 'diretor') this._raw({ t: 'state', state }); }

  _setStatus(s) { this.status = s; if (s !== 'on') this.peers = null; this.onStatus(s); }
  _raw(m) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); }
  _open() {
    this._setStatus('connecting');
    // quem entrou pelo link do show conecta com o link (sem conta); os demais, com o login
    const auth = this.share ? `share=${encodeURIComponent(this.share)}` : `token=${encodeURIComponent(this.token())}`;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live?room=${encodeURIComponent(this.room)}&${auth}`;
    const ws = new WebSocket(url); this.ws = ws;
    ws.onopen = () => {
      this._tries = 0; this.best = Infinity; this._setStatus('on');
      this._raw({ t: 'hello', name: this.name, view: this.view, inst: this.inst });
      if (this.role === 'diretor') this._raw({ t: 'lead' });
      const ping = () => this._raw({ t: 'ping', c: Date.now() });
      for (let k = 0; k < 4; k++) setTimeout(ping, k * 250);
      this._ping = setInterval(ping, 5000);
    };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'pong') {
        const rtt = Date.now() - m.c;
        if (rtt <= this.best * 1.5 || rtt < 60) { this.best = Math.min(this.best, rtt); this.offset = m.s - (m.c + rtt / 2); }
      } else if (m.t === 'hi' && this.best === Infinity) this.offset = m.s - Date.now();
      else if (m.t === 'peers') { this.peers = m; this.onPeers(m); }
      else if (m.t === 'state' && this.role === 'seguir') this.onState(m.state);
    };
    ws.onclose = () => {
      clearInterval(this._ping);
      if (this.ws !== ws) return; // fechada de propósito
      this._setStatus('error');
      this._retry = setTimeout(() => this._open(), Math.min(8000, 1000 * 2 ** this._tries++));
    };
  }
  _close() {
    clearTimeout(this._retry); clearInterval(this._ping);
    const ws = this.ws; this.ws = null;
    if (ws) try { ws.close(); } catch { /* ignora */ }
  }
}
