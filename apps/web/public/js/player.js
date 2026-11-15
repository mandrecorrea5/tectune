// Play com rolagem automática (web): contagem, compasso atual destacado, progresso,
// compassos tocados apagados e rolagem no andamento. Usa o mesmo roteiro do app mobile.
import { parseSong, buildTimeline, barSeconds, pulseInfo, parseBpm } from '/core/index.js';

const now = () => performance.now() / 1000;
export const RATES = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25];

export class Player {
  /**
   * sheet: elemento da folha (contém .bar[data-id]); scroller: elemento que rola;
   * onChange(state): chamado quando muda o estado (para atualizar os controles).
   */
  constructor({ sheet, scroller, onChange }) {
    this.sheet = sheet; this.scroller = scroller; this.onChange = onChange || (() => {});
    this.mode = 'stopped';  // stopped | count | playing | paused | done
    this.pos = 0;           // posição no roteiro, em compassos (fracionário)
    this.cursor = 0;        // de onde o play começa
    this.rateIdx = RATES.indexOf(1);
    this.countIn = true;    // contagem de 1 compasso antes de começar (opcional)
    this.countBeat = 0;
    this.text = null;
    this.clock = { t0: 0, base: 0 };
    this._raf = null;
    this._lastStep = -1;
    this.locked = false;     // seguindo o diretor: os controles locais não mexem no play
    this.forceBarSec = null; // andamento vindo do diretor
  }

  /** Nova música (ou texto alterado). `keep` mantém a posição se o roteiro continuar válido. */
  load(text, { keep = false } = {}) {
    if (text === this.text) return;
    this.text = text;
    this.song = parseSong(text);
    this.timeline = buildTimeline(this.song);
    this.first = {}; this.last = {};
    this.timeline.forEach((s, k) => { if (!(s.id in this.first)) this.first[s.id] = k; this.last[s.id] = k; });
    this.pulse = pulseInfo(this.song.meter);
    this.songBpm = parseBpm(this.song.meta.bpm);
    if (!keep) { this.stop(true); this.cursor = 0; this.pos = 0; this.rateIdx = RATES.indexOf(1); }
    else if (this.pos >= this.timeline.length) this.stop();
    this._emit();
  }

  get bpm() { return (this.songBpm || 90) * RATES[this.rateIdx]; }
  get barSec() { return this.forceBarSec || barSeconds(this.song.meter, this.bpm); }
  get live() { return this.mode === 'playing' || this.mode === 'paused'; }
  get step() { return Math.max(0, Math.min(this.timeline.length - 1, Math.floor(this.pos))); }

  /** Posição atual calculada pelo relógio. */
  _now() { return this.clock.base + (now() - this.clock.t0) / this.barSec; }

  play() {
    if (!this.timeline?.length || this.locked) return;
    if (this.mode === 'paused') { this.clock = { t0: now(), base: this.pos }; this.mode = 'playing'; }
    else if (this.mode === 'playing' || this.mode === 'count') return;
    else {
      if (this.mode === 'done') this.cursor = 0;
      this.pos = this.cursor; this.countBeat = 1;
      this.clock = { t0: now(), base: this.cursor };
      this.mode = this.countIn ? 'count' : 'playing';   // sem contagem: começa direto
    }
    this._loop(); this._emit();
  }
  pause() {
    if (this.locked) return;
    if (this.mode === 'playing') { this.pos = this._now(); this.mode = 'paused'; }
    else if (this.mode === 'count') this.mode = 'stopped';
    else return;
    this._stopLoop(); this.paint(); this._emit();
  }
  toggle() { (this.mode === 'playing' || this.mode === 'count') ? this.pause() : this.play(); }
  stop(silent) {
    this._stopLoop();
    this.mode = 'stopped'; this.pos = this.cursor;
    if (!silent) { this.paint(); this._emit(); }
  }
  setRate(d) {
    if (this.locked) return;
    const i = Math.max(0, Math.min(RATES.length - 1, d === 0 ? RATES.indexOf(1) : this.rateIdx + d));
    if (this.mode === 'playing') { this.clock = { t0: now(), base: this._now() }; }
    this.rateIdx = i; this._emit();
  }
  /** Clique num compasso: começa (ou pula) dali. */
  seek(id) {
    if (!(id in this.first) || this.locked) return;
    const cur = Math.floor(this.pos);
    let k = this.timeline.findIndex((s, j) => j >= cur && s.id === id);
    if (k < 0) k = this.first[id];
    this.seekStep(k);
  }
  /** Vai para o passo k do roteiro (clique numa linha da letra, ou num compasso). */
  seekStep(k) {
    if (this.locked || !this.timeline?.length || k < 0 || k >= this.timeline.length) return;
    if (this.mode === 'playing') { this.clock = { t0: now(), base: k }; this.pos = k; }
    else { this.cursor = k; this.pos = k; if (this.mode === 'done') this.mode = 'stopped'; }
    this.paint(true); this._emit();
  }

  /** Estado para mandar à banda (t0 na hora do servidor). */
  stateFor(serverNow) {
    return {
      mode: this.mode, base: this.clock.base, t0: serverNow - (now() - this.clock.t0) * 1000,
      barSec: this.barSec, bpm: Math.round(this.bpm), cursor: this.cursor, pos: this.pos,
    };
  }
  /** Segue o estado do diretor. `serverNow` = hora do servidor agora (ms). */
  applyRemote(r, serverNow) {
    const lag = Math.max(0, (serverNow - r.t0) / 1000);
    this.forceBarSec = r.barSec || null;
    this.remoteBpm = r.bpm;
    this.clock = { t0: now() - lag, base: r.base };
    this.cursor = r.mode === 'count' ? r.base : (r.cursor || 0);
    this.mode = r.mode;
    if (r.mode === 'playing') { this.pos = r.base + lag / this.barSec; this._loop(); }
    else if (r.mode === 'count') { this.pos = r.base; this.countBeat = 1; this._loop(); }
    else { this.pos = r.pos ?? r.base; this._stopLoop(); }
    this.paint(true); this._emit();
  }

  _loop() {
    this._stopLoop();
    const tick = () => {
      const bs = this.barSec;
      if (this.mode === 'count') {
        const el = now() - this.clock.t0;
        if (el >= bs) { this.clock = { t0: this.clock.t0 + bs, base: this.cursor }; this.mode = 'playing'; this._emit(); }
        else {
          const b = Math.floor(el / (bs / this.pulse.pulses)) + 1;
          if (b !== this.countBeat) { this.countBeat = b; this._emit(); }
        }
      }
      if (this.mode === 'playing') {
        this.pos = this._now();
        if (this.pos >= this.timeline.length) {
          this.pos = this.timeline.length; this.mode = 'done';
          this._stopLoop(); this.paint(); this._emit(); return;
        }
        if (this.step !== this._emitStep) { this._emitStep = this.step; this._emit(); } // atualiza "compasso X de Y"
      }
      this.paint();
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }
  _stopLoop() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }
  _emit() { this.onChange(this); }

  /** Aplica destaque/progresso/apagados na folha (chamar também depois de re-renderizar). */
  paint(forceScroll) {
    if (!this.timeline) return;
    const lines = this.sheet.querySelectorAll('.ly[data-k]');
    if (lines.length) return this._paintLyrics(lines, forceScroll);
    const bars = this.sheet.querySelectorAll('.bar[data-id]');
    const step = this.step;
    const activeId = this.live ? this.timeline[step]?.id : this.mode === 'count' ? this.timeline[this.cursor]?.id : null;
    const cursorId = (this.mode === 'stopped' || this.mode === 'done') && (this.cursor > 0 || forceScroll) ? this.timeline[this.cursor]?.id : null;
    const showPlayed = this.live || this.mode === 'done';
    let activeEl = null;
    bars.forEach(el => {
      const id = el.dataset.id;
      const isActive = id === activeId;
      el.classList.toggle('now', isActive);
      el.classList.toggle('cue', id === cursorId);
      el.classList.toggle('played', showPlayed && !isActive && (this.mode === 'done' || (id in this.last && this.last[id] < step)));
      let pp = el.querySelector(':scope > .pp');
      if (isActive) {
        activeEl = el;
        if (!pp) { pp = document.createElement('div'); pp.className = 'pp'; pp.innerHTML = '<i></i>'; el.appendChild(pp); }
        pp.firstChild.style.width = (this.live ? (this.pos - Math.floor(this.pos)) * 100 : 0) + '%';
      } else if (pp) pp.remove();
    });
    // rolagem: mantém a linha atual a ~28% do topo
    const focus = activeEl || (cursorId && this.sheet.querySelector(`.bar[data-id="${cursorId}"]`));
    const key = focus ? focus.dataset.id + ':' + step : null;
    if (focus && (this.mode === 'playing' || this.mode === 'count' || forceScroll) && key !== this._lastStep) {
      this._lastStep = key;
      const row = focus.closest('.row') || focus;
      const top = row.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top + this.scroller.scrollTop;
      this.scroller.scrollTo({ top: Math.max(0, top - this.scroller.clientHeight * 0.28), behavior: 'smooth' });
    }
  }

  // visão do cantor: linha da vez destacada, as que passaram apagadas, rolagem na altura dos olhos
  _paintLyrics(lines, forceScroll) {
    const on = this.live || this.mode === 'count' || this.mode === 'done';
    const step = this.mode === 'count' ? this.cursor : this.step;
    let cur = -1;
    if (on) lines.forEach((el, i) => { if (+el.dataset.k <= step) cur = i; });
    lines.forEach((el, i) => { el.classList.toggle('now', i === cur && el.classList.contains('lyline')); el.classList.toggle('cur', i === cur); el.classList.toggle('past', on && i < cur); });
    const focus = cur >= 0 ? lines[cur] : null;
    const key = focus ? 'ly' + cur : null;
    if (focus && (this.mode === 'playing' || this.mode === 'count' || forceScroll) && key !== this._lastStep) {
      this._lastStep = key;
      const top = focus.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top + this.scroller.scrollTop;
      this.scroller.scrollTo({ top: Math.max(0, top - this.scroller.clientHeight * 0.3), behavior: 'smooth' });
    }
  }

  /** Texto do andamento para os controles. */
  tempoLabel() { return `${this.pulse.symbol} = ${Math.round(this.locked && this.remoteBpm ? this.remoteBpm : this.bpm)}`; }
  info() {
    if (!this.timeline?.length) return 'sem compassos';
    if (this.live || this.mode === 'count') {
      const st = this.timeline[this.step];
      const sec = this.song.sections[st.sec]?.name || '—';
      return `${sec} · compasso ${this.step + 1} de ${this.timeline.length}`;
    }
    if (this.mode === 'done') return 'fim da música';
    return `${this.timeline.length} compassos no roteiro`;
  }
}
