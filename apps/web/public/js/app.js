import { parseSong, transposeText, sheetHTML, lyricsHTML, buildPdf, resolveScale, validateSong, pageColumns, esc, fmtDate, norm, viewOf } from './cifra.js';
import { Player } from './player.js';
import { Live } from './live.js';
import { COVER_STEPS, COVER_OPTS, coverOpts, flowStaff } from '/core/index.js';
import { resolveCoverScale } from './cifra.js';

const $ = id => document.getElementById(id);
const LAST_KEY = 'grade-cifras-ultima-setlist';
const NEW_SONG = `título: Nova música
artista:
tom: C
bpm:
compasso: 4/4

[Intro]
| C | % | G | % |

[Verso]
| C | Am | F | G |
`;

/* ---------------- API ---------------- */
// sessão: token do login e banda ativa (o repertório é da banda)
const TOKEN_KEY = 'grade-cifras-token', BAND_KEY = 'grade-cifras-banda';
let token = null, bandId = null, me = null;
try { token = localStorage.getItem(TOKEN_KEY); bandId = localStorage.getItem(BAND_KEY); } catch (e) {}
const authHeaders = () => ({ ...(token ? { authorization: 'Bearer ' + token } : {}), ...(bandId ? { 'x-band': bandId } : {}) });
async function api(method, url, body) {
  const r = await fetch('/api' + url, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.startsWith('/auth/')) { setToken(null); showAuth(); }
  if (!r.ok) throw new Error(j.error || `Erro ${r.status}`);
  return j;
}
function setToken(t) { token = t; try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

/* ---------------- estado ---------------- */
let setlists = [];   // resumo de todas as setlists
let sl = null;       // setlist aberta (com músicas)
let cur = -1;        // índice da música aberta em sl.songs

function toast(msg, ms = 2800) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
const slug = s => norm(s || 'cifra').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cifra';
const curSong = () => (sl && cur >= 0 ? sl.songs[cur] : null);

/* ---------------- salvamento automático ---------------- */
const pending = new Map(); // songId -> conteúdo ainda não salvo
let saveTimer = null, savingP = null, saveErr = false;

function updateStatus() {
  const el = $('status'); let cls = 'ok', msg = 'Salvo no banco';
  if (savingP) { cls = ''; msg = 'Salvando…'; }
  else if (saveErr) { cls = 'err'; msg = 'Erro ao salvar — tentando de novo'; }
  else if (pending.size) { cls = 'dirty'; msg = 'Alterações não salvas'; }
  el.className = 'status ' + cls; el.lastChild.textContent = msg;
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 700); updateStatus(); }

async function flush() {
  clearTimeout(saveTimer);
  if (savingP) await savingP;
  if (!pending.size) { updateStatus(); return; }
  const items = [...pending]; pending.clear();
  savingP = (async () => {
    let failed = false;
    for (const [id, content] of items) {
      try { await api('PUT', '/songs/' + id, { content }); }
      catch (e) { if (!pending.has(id)) pending.set(id, content); failed = true; }
    }
    saveErr = failed;
  })();
  updateStatus();
  await savingP; savingP = null; updateStatus();
  if (saveErr) saveTimer = setTimeout(flush, 4000);
}
window.addEventListener('beforeunload', e => {
  if (!pending.size) return;
  for (const [id, content] of pending) {
    fetch('/api/songs/' + id, { method: 'PUT', keepalive: true, headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ content }) });
  }
  e.preventDefault();
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); flush().then(() => toast('Salvo')); }
});

/* ---------------- setlists ---------------- */
function slLabel(s) { return s.name + (s.event_date ? ` — ${fmtDate(s.event_date)}` : ''); }

function renderSelect() {
  const sel = $('slSelect');
  sel.innerHTML = setlists.length
    ? setlists.map(s => `<option value="${s.id}">${esc(slLabel(s))}</option>`).join('')
    : '<option value="">Nenhuma setlist</option>';
  if (sl) sel.value = sl.id;
}

async function loadSetlists(selectId) {
  setlists = await api('GET', '/setlists');
  renderSelect();
  let id = selectId;
  if (!id) { try { id = localStorage.getItem(LAST_KEY); } catch (e) {} }
  if (!setlists.some(s => s.id === id)) id = setlists[0]?.id;
  if (id) await openSetlist(id);
  else { sl = null; cur = -1; renderAll(); }
}

async function openSetlist(id) {
  await flush();
  sl = await api('GET', '/setlists/' + id);
  cur = sl.songs.length ? 0 : -1;
  try { localStorage.setItem(LAST_KEY, id); } catch (e) {}
  renderSelect(); renderAll();
}

function syncSummary() {
  const s = setlists.find(x => x.id === sl?.id);
  if (s) Object.assign(s, { name: sl.name, event_date: sl.event_date, venue: sl.venue, cols: sl.cols, song_count: sl.songs.length });
  renderSelect();
}

$('slSelect').addEventListener('change', e => { if (e.target.value) openSetlist(e.target.value).catch(err => toast(err.message)); });

/* diálogo de setlist */
let dlgMode = 'new';
function openSetlistDialog(mode) {
  dlgMode = mode;
  const f = $('formSetlist');
  $('dlgSetlistTitle').textContent = mode === 'new' ? 'Nova setlist' : 'Editar setlist';
  const d = mode === 'edit' && sl ? sl : { name: '', event_date: '', venue: '', notes: '', cols: 4 };
  f.name.value = d.name || ''; f.event_date.value = d.event_date || '';
  f.venue.value = d.venue || ''; f.notes.value = d.notes || ''; f.cols.value = String(d.cols || 4);
  const del = $('slDelete'); del.style.display = mode === 'edit' ? '' : 'none';
  del.classList.remove('armed'); del.textContent = 'Excluir setlist';
  $('dlgSetlist').showModal(); f.name.focus();
}
$('slNew').onclick = () => openSetlistDialog('new');
$('slEdit').onclick = () => sl && openSetlistDialog('edit');
$('formSetlist').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const body = { name: f.name.value.trim(), event_date: f.event_date.value || null, venue: f.venue.value.trim() || null, notes: f.notes.value.trim() || null, cols: +f.cols.value };
  if (!body.name) { f.name.focus(); return; }
  try {
    if (dlgMode === 'new') {
      const created = await api('POST', '/setlists', body);
      $('dlgSetlist').close();
      await loadSetlists(created.id);
      toast('Setlist criada');
    } else {
      const upd = await api('PATCH', '/setlists/' + sl.id, body);
      await flush();
      sl = upd; if (cur >= sl.songs.length) cur = sl.songs.length - 1;
      $('dlgSetlist').close();
      setlists = await api('GET', '/setlists'); renderSelect(); renderAll();
      toast('Setlist atualizada');
    }
  } catch (err) { toast(err.message); }
});
$('slDelete').onclick = async () => {
  const b = $('slDelete');
  if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Confirmar exclusão'; return; }
  try {
    await api('DELETE', '/setlists/' + sl.id);
    $('dlgSetlist').close();
    try { localStorage.removeItem(LAST_KEY); } catch (e) {}
    sl = null;
    await loadSetlists();
    toast('Setlist excluída (as músicas continuam na biblioteca)');
  } catch (err) { toast(err.message); }
};
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

/* ---------------- músicas da setlist ---------------- */
async function setOrder(ids, newCur) {
  await flush();
  sl = await api('PUT', `/setlists/${sl.id}/songs`, { songIds: ids });
  cur = sl.songs.length ? Math.max(0, Math.min(newCur, sl.songs.length - 1)) : -1;
  syncSummary(); renderAll();
}
const ids = () => sl.songs.map(s => s.id);

const hasErrors = text => validateSong(text).some(i => i.level === 'error');

function gotoLine(n) {
  const ta = $('text'); if (ta.disabled) return;
  const lines = ta.value.split('\n'); if (n < 1 || n > lines.length) return;
  let start = 0; for (let i = 0; i < n - 1; i++) start += lines[i].length + 1;
  ta.focus(); ta.setSelectionRange(start, start + lines[n - 1].length);
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 22;
  ta.scrollTop = Math.max(0, (n - 4) * lh);
}
function renderIssues() {
  const box = $('issues'); const s = curSong();
  const issues = s ? validateSong(s.content) : [];
  if (!issues.length) { box.hidden = true; box.innerHTML = ''; return; }
  const ne = issues.filter(i => i.level === 'error').length, nw = issues.length - ne;
  box.hidden = false;
  box.innerHTML = `<div class="ih">${ne ? `<span class="e">${ne} ${ne === 1 ? 'erro' : 'erros'} de formatação</span>` : ''}${ne && nw ? ' · ' : ''}${nw ? `<span class="w">${nw} ${nw === 1 ? 'aviso' : 'avisos'}</span>` : ''}</div>
    <ul>${issues.map(i => `<li class="${i.level}" data-line="${i.line}"><span class="dot"></span><span class="ln">linha ${i.line}</span><span><span class="wh">${esc(i.where)}:</span> ${esc(i.msg)}</span></li>`).join('')}</ul>`;
}
$('issues').addEventListener('click', e => { const li = e.target.closest('li[data-line]'); if (li) gotoLine(+li.dataset.line); });
$('sheet').addEventListener('click', e => {
  const ly = e.target.closest('.ly[data-k]'); if (ly) { player.seekStep(+ly.dataset.k); return; } // linha da letra: começa dali
  const b = e.target.closest('.bar[data-line]'); if (!b) return;
  player.seek(b.dataset.id);                       // começa (ou pula) dali
  if (!player.live && !document.body.classList.contains('palco')) gotoLine(+b.dataset.line);
});

function renderList() {
  const ol = $('songList');
  if (!sl) { ol.innerHTML = `<div class="listempty">Crie uma setlist para começar: clique em <b>+ Nova setlist</b>.</div>`; return; }
  if (!sl.songs.length) { ol.innerHTML = `<div class="listempty">Este show ainda não tem músicas.<br>Use <b>+ Nova música</b> ou traga uma da <b>biblioteca</b>.</div>`; return; }
  ol.innerHTML = sl.songs.map((s, i) => {
    const m = parseSong(s.content).meta;
    const sub = [m.key && 'Tom ' + m.key, m.bpm && m.bpm + ' bpm'].filter(Boolean).join(' · ');
    return `<li class="${i === cur ? 'on' : ''}" data-i="${i}">
      <span class="n">${i + 1}</span>
      <div style="min-width:0"><div class="t">${esc(m.title || 'Sem título')}${hasErrors(s.content) ? '<span class="bad" title="Erro de formatação"></span>' : ''}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div>
      <span class="acts">
        <button data-a="up" title="Subir">↑</button><button data-a="down" title="Descer">↓</button>
        <button data-a="dup" title="Duplicar como nova música">⧉</button>
        <button data-a="rm" title="Tirar do show (continua na biblioteca)">✕</button>
      </span></li>`;
  }).join('');
}

$('songList').addEventListener('click', async e => {
  const li = e.target.closest('li'); if (!li) return;
  const i = +li.dataset.i; const a = e.target.closest('button')?.dataset.a;
  if (!a) { cur = i; renderAll(); return; }
  try {
    const list = ids();
    if (a === 'up' && i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; await setOrder(list, cur === i ? i - 1 : cur === i - 1 ? i : cur); }
    else if (a === 'down' && i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; await setOrder(list, cur === i ? i + 1 : cur === i + 1 ? i : cur); }
    else if (a === 'dup') {
      await flush();
      const src = sl.songs[i].content;
      const content = /^\s*t[ií]tulo\s*:/im.test(src) ? src.replace(/^(\s*t[ií]tulo\s*:\s*)(.*)$/im, (m, p, t) => `${p}${t.trim()} (cópia)`) : `título: Cópia\n${src}`;
      const song = await api('POST', '/songs', { content, font_scale: sl.songs[i].font_scale ?? 100 });
      list.splice(i + 1, 0, song.id); await setOrder(list, i + 1);
    } else if (a === 'rm') {
      list.splice(i, 1); await setOrder(list, cur > i ? cur - 1 : cur);
      toast('Tirada do show — continua na biblioteca');
    }
  } catch (err) { toast(err.message); }
});

$('songNew').onclick = async () => {
  if (!sl) return;
  try {
    const song = await api('POST', '/songs', { content: NEW_SONG });
    await setOrder([...ids(), song.id], sl.songs.length);
    const ta = $('text'); ta.focus(); ta.setSelectionRange(9, 21);
  } catch (err) { toast(err.message); }
};

/* ---------------- biblioteca ---------------- */
let libTimer;
async function renderLib() {
  const q = $('libSearch').value.trim();
  const list = await api('GET', '/songs' + (q ? '?q=' + encodeURIComponent(q) : ''));
  const inShow = new Set(sl ? ids() : []);
  $('libList').innerHTML = list.length ? list.map(s => {
    const sub = [s.artist, s.song_key && 'Tom ' + s.song_key, s.bpm && s.bpm + ' bpm', `em ${s.setlist_count} ${s.setlist_count === 1 ? 'setlist' : 'setlists'}`].filter(Boolean).join(' · ');
    return `<li data-id="${s.id}"><div class="info"><div class="t">${esc(s.title)}${inShow.has(s.id) ? '<span class="tag">neste show</span>' : ''}</div><div class="s">${esc(sub)}</div></div>
      <button data-a="add" ${sl ? '' : 'disabled'}>Adicionar</button>
      <button data-a="del" class="danger" title="Apagar da biblioteca e de todas as setlists">Apagar</button></li>`;
  }).join('') : `<li class="listempty">${q ? 'Nenhuma música encontrada.' : 'A biblioteca está vazia.'}</li>`;
}
$('songLib').onclick = async () => {
  $('libSearch').value = '';
  try { await flush(); await renderLib(); $('dlgLib').showModal(); $('libSearch').focus(); } catch (err) { toast(err.message); }
};
$('libSearch').addEventListener('input', () => { clearTimeout(libTimer); libTimer = setTimeout(() => renderLib().catch(err => toast(err.message)), 200); });
$('libList').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const id = b.closest('li').dataset.id;
  try {
    if (b.dataset.a === 'add') {
      await setOrder([...ids(), id], sl.songs.length);
      toast('Adicionada ao show'); await renderLib();
    } else if (b.dataset.a === 'del') {
      if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Confirmar'; return; }
      pending.delete(id);
      await api('DELETE', '/songs/' + id);
      if (sl && ids().includes(id)) { const c = cur; await openSetlist(sl.id); cur = Math.min(c, sl.songs.length - 1); renderAll(); }
      setlists = await api('GET', '/setlists'); renderSelect();
      toast('Música apagada'); await renderLib();
    }
  } catch (err) { toast(err.message); }
});

/* ---------------- editor e prévia ---------------- */
let pvTimer;
function renderPreview() {
  const s = curSong();
  renderIssues();
  const sheet = $('sheet'), badge = $('pages');
  badge.hidden = true; sheet.style.removeProperty('--s'); sheet.style.removeProperty('--hs');
  if (!sl) { $('sheet').innerHTML = `<div class="empty">Nenhuma setlist ainda.<br>Clique em <b>+ Nova setlist</b> para cadastrar o primeiro show.</div>`; return; }
  if (!s) { $('sheet').innerHTML = `<div class="empty">Adicione uma música ao show para ver a grade aqui.</div>`; return; }
  const fs = s.font_scale ?? 100;
  const { pct, pages } = resolveScale(s.content, sl.cols, fs);
  // no palco a leitura é de longe: ignora o tamanho de impressão e usa uma coluna só (A−/A+ ajustam)
  const palco = document.body.classList.contains('palco');
  const k = palco ? palcoZoom : pct / 100;
  const pc = palco ? 1 : pageColumns(k); // fonte menor → folha em colunas, igual ao PDF
  sheet.style.setProperty('--s', k); sheet.style.setProperty('--hs', 0.55 + 0.45 * k);
  sheet.classList.toggle('tiny', k < 0.45); // tamanhos bem pequenos: esconde detalhes que embolam
  sheet.classList.toggle('pc2', pc === 2); sheet.classList.toggle('pc3', pc === 3);
  const cantor = palco && showView === 'cantor';
  if (cantor) sheet.classList.remove('pc2', 'pc3', 'tiny');
  sheet.innerHTML = cantor ? lyricsHTML(s.content) : sheetHTML(s.content, sl.cols);
  if (!cantor) fitSlots();
  renderShowBar();
  // play: mesma música → mantém a posição; outra música → recomeça
  if (playerSongId !== s.id) { playerSongId = s.id; player.text = null; player.load(s.content); }
  else player.load(s.content, { keep: true });
  player.paint();
  badge.hidden = false;
  badge.className = 'pages' + (pages > 1 ? ' over' : '');
  badge.textContent = `${fs === 0 ? 'Auto · ' : ''}${pct}% · ${pages} ${pages === 1 ? 'folha' : 'folhas'}`;
  badge.title = pages > 1 && fs === 0 ? 'Mesmo no tamanho mínimo (50%) não coube em uma folha' : '';
}
/* ---------------- play / rolagem automática ---------------- */
let playerSongId = null, palcoZoom = 1;
const player = new Player({ sheet: $('sheet'), scroller: $('pScroll'), onChange: updatePlayerUI });
function updatePlayerUI(p) {
  if (typeof broadcast === 'function') try { broadcast(); } catch (e) { /* ao vivo ainda não iniciado */ }
  const playing = p.mode === 'playing' || p.mode === 'count';
  $('pPlay').textContent = playing ? '❚❚' : '▶';
  $('pPlay').title = playing ? 'Pausar (espaço)' : 'Tocar (espaço)';
  $('pStop').disabled = p.mode === 'stopped' && !p.cursor;
  if (p.song) {
    $('pTempo').textContent = p.tempoLabel() + (p.songBpm ? (p.rateIdx !== 8 ? ` · ${Math.round(p.bpm / p.songBpm * 100)}%` : '') : ' (sem BPM)');
    $('pInfo').textContent = (p.locked ? `Seguindo o play de ${live.director} · ` : '') + p.info();
    $('pKey').textContent = p.song.meta.key || '—';
  }
  $('pCount').hidden = p.mode !== 'count';
  if (p.mode === 'count') $('pCount').firstElementChild.textContent = p.countBeat;
  const hasNext = sl && cur < sl.songs.length - 1;
  $('pDone').hidden = p.mode !== 'done';
  $('pDoneNext').hidden = !hasNext;
  $('pDone').firstElementChild.textContent = hasNext ? `Fim da música · Próxima: ${parseSong(sl.songs[cur + 1].content).meta.title || 'Sem título'}` : 'Fim da música';
}
function gotoSong(d) {
  if (!sl || player.locked) return;
  const n = cur + d; if (n < 0 || n >= sl.songs.length) return;
  player.stop(); cur = n; renderAll();
  $('pScroll').scrollTo({ top: 0 });
}
function setPalco(on) {
  document.body.classList.toggle('palco', on);
  renderPreview();
}
// tocar já abre o modo palco
function playToggle() {
  const starting = !(player.mode === 'playing' || player.mode === 'count');
  if (starting && !document.body.classList.contains('palco')) setPalco(true);
  player.toggle();
}
$('pPlay').onclick = playToggle;
// mudar o tom no palco, sem parar a música (altera e salva a cifra, como no editor)
$('pKeyUp').onclick = () => transpose(1);
$('pKeyDown').onclick = () => transpose(-1);
$('pStop').onclick = () => { if (player.locked) return; player.cursor = 0; player.stop(); $('pScroll').scrollTo({ top: 0, behavior: 'smooth' }); };
$('pSlower').onclick = () => player.setRate(-1);
$('pFaster').onclick = () => player.setRate(1);
$('pTempo').onclick = () => player.setRate(0);
$('pPrev').onclick = () => gotoSong(-1);
$('pNext').onclick = () => gotoSong(1);
$('pDoneNext').onclick = () => gotoSong(1);
$('pZoomIn').onclick = () => { palcoZoom = Math.min(2, +(palcoZoom + 0.1).toFixed(2)); renderPreview(); };
$('pZoomOut').onclick = () => { palcoZoom = Math.max(0.6, +(palcoZoom - 0.1).toFixed(2)); renderPreview(); };
$('pPalco').onclick = () => setPalco(true);

/* ---------------- modo Show: visão, sair, ao vivo ---------------- */
const VIEW_KEY = 'grade-cifras-visao', NAME_KEY = 'grade-cifras-nome';
let showView = 'musico';
try { showView = localStorage.getItem(VIEW_KEY) === 'cantor' ? 'cantor' : 'musico'; } catch (e) {}
function setShowView(v) {
  showView = v; try { localStorage.setItem(VIEW_KEY, v); } catch (e) {}
  live.set({ view: v }); renderPreview(); player.paint(true);
}
$('svMusico').onclick = () => setShowView('musico');
$('svCantor').onclick = () => setShowView('cantor');
function renderShowBar() {
  const s = curSong();
  $('showTitle').textContent = sl && s ? `Música ${cur + 1} de ${sl.songs.length} · ${parseSong(s.content).meta.title || 'Sem título'}` : '';
  $('svMusico').classList.toggle('on', showView === 'musico'); $('svCantor').classList.toggle('on', showView === 'cantor');
}
function askExit() { $('exitText').textContent = (live.role !== 'off' ? 'Você também sai do show ao vivo. ' : '') + 'O play é interrompido.'; $('dlgExit').showModal(); }
$('showExit').onclick = askExit;
$('exitConfirm').onclick = () => {
  $('dlgExit').close(); live.set({ role: 'off' }); renderLive();
  player.locked = false; player.forceBarSec = null; player.stop(); setPalco(false);
};

const live = new Live({ onPeers: () => renderLive(), onStatus: () => renderLive(), onState: r => applyRemote(r), token: () => token });
try { live.name = localStorage.getItem(NAME_KEY) || ''; } catch (e) {}
const following = () => live.role === 'seguir' && live.status === 'on' && !!live.director && !live.isDirector;
function applyRemote(r) {
  if (!following() || !sl) return;
  let k = sl.songs.findIndex(x => x.id === r.songId); if (k < 0) k = r.songIdx;
  if (k >= 0 && k < sl.songs.length && k !== cur) { player.locked = false; player.stop(); cur = k; renderAll(); player.locked = true; }
  player.applyRemote(r, live.serverNow());
}
let lastSig = '', wasDirector = false;
// diretor: manda o estado a cada mudança de verdade (play, pausa, salto, andamento, música)
function broadcast(force) {
  if (live.role !== 'diretor' || live.status !== 'on' || !sl || !player.timeline) return;
  const s = curSong(); const st = player.stateFor(live.serverNow());
  const sig = [s?.id, st.mode, player.clock.t0.toFixed(3), player.clock.base, st.cursor, player.rateIdx, st.mode === 'playing' ? '' : st.pos.toFixed(2)].join('|');
  if (!force && sig === lastSig) return;
  lastSig = sig;
  live.send({ ...st, songIdx: cur, songId: s?.id });
}
function renderLive() {
  const f = following();
  if (player.locked !== f) { player.locked = f; if (!f) { player.forceBarSec = null; player.remoteBpm = null; } updatePlayerUI(player); }
  document.body.classList.toggle('following', f);
  const b = $('liveBtn'), lab = b.querySelector('span');
  b.classList.remove('ok', 'wait', 'bad');
  if (live.role === 'off') lab.textContent = 'Ao vivo';
  else if (live.status !== 'on') { lab.textContent = live.status === 'connecting' ? 'Conectando…' : 'Sem conexão'; b.classList.add('bad'); }
  else if (live.isDirector) { lab.textContent = `Diretor · ${live.peers?.count || 1}`; b.classList.add('ok'); }
  else if (live.director) { lab.textContent = `Seguindo ${live.director}`; b.classList.add('ok'); }
  else { lab.textContent = 'Aguardando diretor'; b.classList.add('wait'); }
  $('liveOpts').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.role === live.role));
  const p = live.peers;
  $('liveMembers').innerHTML = live.role !== 'off' && p ? `<b>Conectados (${p.count})</b>` + p.members.map(m => `<span>${m.director ? '★' : '•'} ${esc(m.name)} · ${m.view === 'cantor' ? 'cantor' : 'músico'}</span>`).join('') : '';
  if (live.isDirector && !wasDirector) broadcast(true); // acabou de assumir: manda o estado atual
  wasDirector = live.isDirector;
  if (f && live.status === 'on' && player.mode === 'stopped') $('pInfo').textContent = `Seguindo o play de ${live.director} · aguardando o play`;
}
$('liveBtn').onclick = () => { $('liveName').value = live.name; renderLive(); $('dlgLive').showModal(); };
$('liveName').addEventListener('input', () => { const n = $('liveName').value.trim(); try { localStorage.setItem(NAME_KEY, n); } catch (e) {} live.set({ name: n }); });
$('liveOpts').addEventListener('click', e => {
  const b = e.target.closest('button[data-role]'); if (!b || !sl) return;
  live.set({ role: b.dataset.role, room: sl.id, name: $('liveName').value.trim(), view: showView });
  renderLive();
});
// contagem antes de começar: opcional, lembrada neste navegador
const COUNT_KEY = 'grade-cifras-contagem';
try { player.countIn = localStorage.getItem(COUNT_KEY) !== 'off'; } catch (e) {}
function renderCountToggle() {
  $('pCount1').classList.toggle('on', player.countIn);
  $('pCount1').textContent = player.countIn ? 'Contagem: sim' : 'Contagem: não';
}
$('pCount1').onclick = () => {
  player.countIn = !player.countIn;
  try { localStorage.setItem(COUNT_KEY, player.countIn ? 'on' : 'off'); } catch (e) {}
  renderCountToggle();
};
renderCountToggle();
// botões do player não guardam o foco (senão o espaço "clicaria" neles além de tocar/pausar)
document.querySelectorAll('#pctl button').forEach(b => b.addEventListener('click', () => b.blur()));
document.addEventListener('keyup', e => { if (e.key === ' ' && e.target?.tagName === 'BUTTON') e.preventDefault(); });
window.__player = player; // útil para depurar no console
// atalhos (também funcionam com pedais Bluetooth, que enviam teclas)
document.addEventListener('keydown', e => {
  const t = e.target;
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (document.querySelector('dialog[open]')) return;
  if (e.key === ' ') { e.preventDefault(); if (t && t.tagName === 'BUTTON') t.blur(); playToggle(); }
  else if (e.key === 'Escape') {
    // no Show, Esc pergunta antes de sair (abre depois do evento, senão o próprio Esc fecha a pergunta)
    if (document.body.classList.contains('palco')) { e.preventDefault(); setTimeout(askExit, 0); }
    else if (!player.locked) player.stop();
  }
  else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); gotoSong(1); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); gotoSong(-1); }
});

// Encolhe cada acorde que não cabe na sua parte do compasso (a prévia acompanha o PDF)
// (todos os acordes de um mesmo compasso ficam do mesmo tamanho)
// Pauta: cada compasso com a largura que suas cifras pedem (todas no tamanho cheio) e as linhas
// quebrando como numa partitura, esticadas até a largura da folha.
function layoutStaff() {
  for (const row of $('sheet').querySelectorAll('.pauta .srow')) {
    const bars = [...row.children].filter(el => el.classList.contains('bar'));
    const W = row.clientWidth; if (!bars.length || !W) continue;
    const ch = row.querySelector('.ch'); const em = ch ? parseFloat(getComputedStyle(ch).fontSize) : 27;
    const widths = bars.map(bar => {
      const g = +bar.dataset.g || 1; let inner = 0;
      bar.querySelectorAll('.slot').forEach(sl => {
        const c = sl.firstElementChild; if (!c) return;
        c.style.fontSize = '';
        const w = c.getBoundingClientRect().width;
        if (w > 0) inner = Math.max(inner, (w + 0.6 * em) * g / (+sl.dataset.len || 1));
      });
      const cs = getComputedStyle(bar);
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 3;
      return Math.max(inner + pad, 3.4 * em, W / 8);
    });
    flowStaff(widths, W - 1).forEach(line => line.forEach(({ i, w }, k) => {
      bars[i].style.flex = `0 0 ${Math.floor(w * 100) / 100 - 0.02}px`;
      bars[i].classList.toggle('first', k === 0);
    }));
  }
}
// Letra embaixo dos compassos: cada trecho vai só até o próximo compasso com letra (ou o fim da
// linha) e quebra em mais linhas se não couber — nunca vaza da folha nem passa por cima da outra.
// A linha da grade ganha embaixo exatamente a altura que a letra ocupa.
function layoutLyrics() {
  for (const cont of $('sheet').querySelectorAll('.srow, .row')) {
    const bars = [...cont.children].filter(el => el.classList.contains('bar'));
    const lyrs = bars.map(b => b.querySelector(':scope > .lyr'));
    if (!lyrs.some(Boolean)) continue;
    bars.forEach((b, i) => { b.style.marginBottom = ''; if (lyrs[i]) lyrs[i].style.width = ''; });
    const right = cont.getBoundingClientRect().right;
    const rects = bars.map(b => b.getBoundingClientRect());
    const lines = [];
    rects.forEach((r, i) => {
      let L = lines.find(l => Math.abs(l.top - r.top) < 4);
      if (!L) { L = { top: r.top, idx: [] }; lines.push(L); }
      L.idx.push(i);
    });
    for (const L of lines) {
      let maxH = 0;
      L.idx.forEach((i, k) => {
        if (!lyrs[i]) return;
        let end = right;
        for (let q = k + 1; q < L.idx.length; q++) if (lyrs[L.idx[q]]) { end = rects[L.idx[q]].left; break; }
        lyrs[i].style.width = Math.max(40, end - rects[i].left - 10) + 'px';
        maxH = Math.max(maxH, lyrs[i].getBoundingClientRect().height);
      });
      if (maxH) L.idx.forEach(i => { bars[i].style.marginBottom = `${Math.ceil(maxH) + 6}px`; });
    }
  }
}
function fitSlots() {
  layoutStaff();
  layoutLyrics();
  const bars = [...$('sheet').querySelectorAll('.bar')].map(bar => [...bar.querySelectorAll('.slot')].map(el => ({ el, c: el.firstElementChild })).filter(x => x.c));
  bars.flat().forEach(x => { x.c.style.fontSize = ''; });
  const plan = bars.map(items => {
    const m = items.map(x => ({ ...x, avail: x.el.clientWidth - 4, w: x.c.getBoundingClientRect().width, fs: parseFloat(getComputedStyle(x.c).fontSize) }));
    const r = Math.min(1, ...m.filter(x => x.avail > 0 && x.w > 0).map(x => x.avail / x.w));
    return { m, r };
  });
  plan.forEach(({ m, r }) => { if (r < 1) m.forEach(x => { x.c.style.fontSize = Math.max(7, x.fs * r) + 'px'; }); });
}
let fitRaf;
new ResizeObserver(() => { cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(fitSlots); }).observe($('sheet'));
if (document.fonts) document.fonts.ready.then(fitSlots);

function renderEditor() {
  const s = curSong(); const ta = $('text');
  ta.disabled = !s; ta.value = s ? s.content : '';
  ['tUp', 'tDown', 'btnPdfSong', 'scale'].forEach(id => $(id).disabled = !s);
  $('scale').value = String(s?.font_scale ?? 100);
  $('btnPdfAll').disabled = $('btnPdfSetlist').disabled = !sl || !sl.songs.length;
  ['songNew', 'songLib', 'slEdit'].forEach(id => $(id).disabled = !sl);
  $('cols').disabled = !sl; $('cols').value = String(sl?.cols || 4);
}
function renderInfo() {
  $('slTitle').textContent = sl ? sl.name : 'Sem setlist';
  $('slMeta').textContent = sl ? [fmtDate(sl.event_date), sl.venue, `${sl.songs.length} ${sl.songs.length === 1 ? 'música' : 'músicas'}`].filter(Boolean).join(' · ') : '';
}
function renderAll() { renderInfo(); renderList(); renderEditor(); renderPreview(); renderViewToggle(); }

function setContent(v) {
  const s = curSong(); if (!s) return;
  sl.songs.forEach(x => { if (x.id === s.id) x.content = v; });
  pending.set(s.id, v); scheduleSave();
}
$('text').addEventListener('input', () => {
  setContent($('text').value);
  clearTimeout(pvTimer); pvTimer = setTimeout(() => { renderPreview(); renderList(); renderViewToggle(); }, 120);
});
$('text').addEventListener('keydown', e => {
  if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, ' | '); }
});
function transpose(st) {
  const s = curSong(); if (!s) return;
  const v = transposeText(s.content, st);
  setContent(v); $('text').value = v; renderPreview(); renderList();
}
// Caixas | Pauta: grava "formato: pauta" no cabeçalho da cifra (vale na prévia, no palco e no PDF)
function setView(view) {
  const s = curSong(); if (!s) return;
  let lines = s.content.split('\n').filter(l => !/^\s*(formato|visual|visualiza[cç][aã]o|nota[cç][aã]o)\s*:/i.test(l));
  if (view === 'pauta') {
    // logo depois do último campo do cabeçalho (título, tom, bpm, compasso...)
    let at = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (/^\[/.test(l) || l.includes('|')) break;
      if (/^[A-Za-zÀ-ÿçÇ]+\s*:/.test(l)) at = i + 1;
    }
    lines.splice(at, 0, 'formato: pauta');
  }
  const v = lines.join('\n');
  setContent(v); $('text').value = v; renderPreview(); renderList(); renderViewToggle();
}
function renderViewToggle() {
  const s = curSong(); const pauta = !!s && viewOf(parseSong(s.content)) === 'pauta';
  $('vBox').disabled = $('vStaff').disabled = !s;
  $('vBox').classList.toggle('on', !!s && !pauta); $('vStaff').classList.toggle('on', pauta);
  // na pauta os compassos se ajustam às cifras: não há "compassos por linha"
  $('cols').disabled = !sl || pauta;
  $('cols').title = pauta ? 'Na pauta cada compasso tem a largura das suas cifras e as linhas quebram sozinhas' : '';
}
$('vBox').onclick = () => setView('caixas');
$('vStaff').onclick = () => setView('pauta');
$('tUp').onclick = () => transpose(1);
$('tDown').onclick = () => transpose(-1);
$('scale').addEventListener('change', async () => {
  const s = curSong(); if (!s) return;
  const v = +$('scale').value;
  sl.songs.forEach(x => { if (x.id === s.id) x.font_scale = v; });
  renderPreview();
  try { await api('PUT', '/songs/' + s.id, { font_scale: v }); }
  catch (err) { toast('Não consegui salvar o tamanho: ' + err.message); }
});
$('cols').addEventListener('change', async () => {
  if (!sl) return;
  const cols = +$('cols').value;
  try { const upd = await api('PATCH', '/setlists/' + sl.id, { cols }); sl.cols = upd.cols; syncSummary(); renderPreview(); }
  catch (err) { toast(err.message); }
});

/* ---------------- PDF ---------------- */
// Abre o PDF num visualizador dentro do app; baixar é opcional (botão no visualizador)
let pdfUrl = null;
let pdfMake = null; // refaz o PDF atual (quando muda a folha do setlist)
function openViewer(doc, filename, title, opts = {}) {
  pdfMake = opts.remake || null;
  $('coverPanel').hidden = !opts.cover;
  if (opts.cover) fillCoverPanel();
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  doc.setProperties({ title, creator: 'Tectune' });
  pdfUrl = URL.createObjectURL(new Blob([doc.output('arraybuffer')], { type: 'application/pdf' }));
  $('pdfTitle').textContent = title;
  $('pdfPages').textContent = `${doc.getNumberOfPages()} ${doc.getNumberOfPages() === 1 ? 'página' : 'páginas'}`;
  $('pdfDownload').href = pdfUrl; $('pdfDownload').download = filename;
  $('pdfOpen').href = pdfUrl;
  $('pdfFrame').src = pdfUrl + '#view=FitH';
  if (!$('dlgPdf').open) $('dlgPdf').showModal();
}
// painel "Folha do setlist": visualização, tamanho da letra e o que mostrar.
// Cada mudança refaz o PDF na hora e fica salva no setlist.
$('coverScale').innerHTML = '<option value="0">Auto (maior que cabe em 1 folha)</option>' + COVER_STEPS.map(p => `<option value="${p}">${p}%</option>`).join('');
$('coverOpts').innerHTML = COVER_OPTS.map(([k, label]) => `<label><input type="checkbox" data-k="${k}"> ${label}</label>`).join('');
function fillCoverPanel() {
  const layout = sl.cover_layout || 'detalhada', o = coverOpts(sl.cover_opts);
  $('coverLayout').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === layout));
  $('coverScale').value = String(sl.cover_scale || 0);
  $('coverOpts').querySelectorAll('input').forEach(i => { i.checked = o[i.dataset.k]; });
  const r = resolveCoverScale(sl, sl.songs.map(s => s.content));
  $('coverFit').textContent = sl.cover_scale ? `Tamanho fixo em ${r.pct}%.` : `Automático: usando ${r.pct}%${r.pages ? ', em 1 folha' : ' (não coube em 1 folha)'}.`;
}
let coverSaveTimer = null;
function changeCover(patch) {
  if (!sl) return;
  Object.assign(sl, patch);
  fillCoverPanel();
  if (pdfMake) pdfMake();
  clearTimeout(coverSaveTimer);
  coverSaveTimer = setTimeout(async () => {
    try { await api('PATCH', '/setlists/' + sl.id, { cover_layout: sl.cover_layout, cover_scale: sl.cover_scale || 0, cover_opts: coverOpts(sl.cover_opts) }); syncSummary(); }
    catch (err) { toast('Não consegui salvar: ' + err.message); }
  }, 400);
}
$('coverLayout').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) changeCover({ cover_layout: b.dataset.v }); });
$('coverScale').addEventListener('change', () => changeCover({ cover_scale: +$('coverScale').value }));
// A− / A+ partem do tamanho em uso (no automático, do que ele escolheu)
const stepCover = d => {
  const cur = sl.cover_scale || resolveCoverScale(sl, sl.songs.map(s => s.content)).pct;
  const i = Math.max(0, Math.min(COVER_STEPS.length - 1, COVER_STEPS.indexOf(cur) + d));
  changeCover({ cover_scale: COVER_STEPS[i] });
};
$('coverSmaller').onclick = () => stepCover(1);
$('coverBigger').onclick = () => stepCover(-1);
$('coverOpts').addEventListener('change', e => {
  const k = e.target.dataset.k; if (!k) return;
  changeCover({ cover_opts: { ...coverOpts(sl.cover_opts), [k]: e.target.checked } });
});
// imprime o PDF que está na visualização (se o navegador não deixar, abre em nova aba para imprimir de lá)
$('pdfPrint').onclick = () => {
  try { const w = $('pdfFrame').contentWindow; w.focus(); w.print(); }
  catch (e) { window.open(pdfUrl, '_blank'); }
};
$('dlgPdf').addEventListener('close', () => {
  $('pdfFrame').src = 'about:blank';
  if (pdfUrl) { const u = pdfUrl; pdfUrl = null; setTimeout(() => URL.revokeObjectURL(u), 1000); }
});
$('btnPdfSong').onclick = () => {
  const s = curSong(); if (!s) return;
  const doc = buildPdf({ setlist: sl, songs: [s], cols: sl.cols, cover: false, index: cur, total: sl.songs.length });
  const title = parseSong(s.content).meta.title || 'Sem título';
  if (hasErrors(s.content)) toast('Atenção: esta música tem erro de formatação (compassos marcados em vermelho)', 4500);
  openViewer(doc, slug(title) + '.pdf', title);
};
$('btnPdfAll').onclick = () => {
  if (!sl || !sl.songs.length) return;
  const bad = sl.songs.filter(s => hasErrors(s.content)).map(s => parseSong(s.content).meta.title || 'Sem título');
  if (bad.length) toast(`Atenção: ${bad.length === 1 ? 'a música' : 'as músicas'} ${bad.join(', ')} ${bad.length === 1 ? 'tem' : 'têm'} erro de formatação`, 5000);
  const make = () => openViewer(buildPdf({ setlist: sl, songs: sl.songs, cols: sl.cols, cover: true }),
    slug(sl.name) + '-cifras.pdf', `${sl.name} — show completo`, { cover: true, remake: () => make() });
  make();
};
// só a folha do setlist (lista de músicas)
$('btnPdfSetlist').onclick = () => {
  if (!sl || !sl.songs.length) return;
  const make = () => openViewer(buildPdf({ setlist: sl, songs: sl.songs, cols: sl.cols, coverOnly: true }),
    slug(sl.name) + '-setlist.pdf', `${sl.name} — folha do setlist`, { cover: true, remake: () => make() });
  make();
};

/* ---------------- contas e bandas ---------------- */
let authMode = 'login';
function showAuth() {
  $('bandScreen').hidden = true; $('authScreen').hidden = false; $('authErr').hidden = true;
  $('authForm').password.value = '';
  setTimeout(() => setAuthMode(authMode), 0);
}
function setAuthMode(m) {
  authMode = m; const reg = m === 'register';
  $('authNameL').hidden = !reg; $('pwHint').hidden = !reg; $('authErr').hidden = true;
  $('authTitle').textContent = reg ? 'Criar conta' : 'Entrar';
  $('authSub').textContent = reg ? 'Leva menos de um minuto. Depois é só criar a banda ou aceitar um convite.' : 'Bem-vindo de volta! Entre para ver o repertório da sua banda.';
  $('authSubmit').textContent = reg ? 'Criar conta' : 'Entrar';
  $('authSwitchText').textContent = reg ? 'Já tem conta?' : 'Ainda não tem conta?';
  $('authSwitch').textContent = reg ? 'Entrar' : 'Criar conta';
  $('authForm').password.autocomplete = reg ? 'new-password' : 'current-password';
  $('authForm').password.placeholder = reg ? 'Crie uma senha' : 'Sua senha';
  $('authForm')[reg ? 'name' : 'email'].focus();
}
$('authSwitch').onclick = () => setAuthMode(authMode === 'login' ? 'register' : 'login');
$('pwToggle').onclick = () => {
  const i = $('authForm').password, show = i.type === 'password';
  i.type = show ? 'text' : 'password'; $('pwToggle').textContent = show ? 'Ocultar' : 'Mostrar';
  $('pwToggle').setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
};
$('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target; const err = $('authErr'); err.hidden = true;
  const reg = authMode === 'register';
  // validação rápida antes de ir ao servidor
  const bad = (reg && !f.name.value.trim() && 'Informe seu nome')
    || (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.value.trim()) && 'Informe um e-mail válido')
    || (f.password.value.length < (reg ? 6 : 1) && (reg ? 'A senha precisa ter pelo menos 6 caracteres' : 'Informe a senha'));
  [f.name, f.email, f.password].forEach(i => i.removeAttribute('aria-invalid'));
  if (bad) {
    err.textContent = bad; err.hidden = false;
    const field = bad.includes('nome') ? f.name : bad.includes('mail') ? f.email : f.password;
    field.setAttribute('aria-invalid', 'true'); field.focus(); return;
  }
  const body = { email: f.email.value.trim(), password: f.password.value, ...(reg ? { name: f.name.value.trim() } : {}) };
  const btn = $('authSubmit'), label = btn.textContent;
  btn.disabled = true; btn.textContent = reg ? 'Criando conta…' : 'Entrando…';
  try {
    const r = await api('POST', reg ? '/auth/register' : '/auth/login', body);
    setToken(r.token); $('authScreen').hidden = true; f.reset();
    await start();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  finally { btn.disabled = false; btn.textContent = label; }
});
async function logout() {
  try { await api('POST', '/auth/logout'); } catch (e) { /* já saiu */ }
  setToken(null); me = null; live.set({ role: 'off' }); $('dlgBand').close();
  setlists = []; sl = null; cur = -1; showAuth();
}
$('bsLogout').onclick = logout; $('logoutBtn').onclick = logout;

const inviteHTML = i => `<div class="invite" data-inv="${i.id}"><span><b>${esc(i.invited_by || 'Alguém')}</b> convidou você para a banda <b>${esc(i.band_name)}</b></span>
  <button data-act="decline" class="ghost">Recusar</button><button data-act="accept" class="primary">Entrar na banda</button></div>`;
async function answerInvite(e) {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.closest('[data-inv]').dataset.inv;
  try {
    const bandOf = me.invites.find(i => i.id === id)?.band_id;
    me = await api('POST', `/invites/${id}/${b.dataset.act}`);
    if (b.dataset.act === 'accept') { bandId = bandOf; toast('Você entrou na banda'); }
    await enterBand();
  } catch (ex) { toast(ex.message); }
}
$('bsInvites').addEventListener('click', answerInvite);
$('inviteBar').addEventListener('click', answerInvite);
$('bsForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { const r = await api('POST', '/bands', { name: e.target.name.value.trim() }); me = r; bandId = r.id; e.target.reset(); await enterBand(); }
  catch (ex) { toast(ex.message); }
});

/** Entra na banda ativa (ou mostra a tela de criar banda / convites). */
async function enterBand() {
  if (!me.bands.length) {
    $('bandScreen').hidden = false; $('bsName').textContent = me.user.name;
    $('bsInvites').innerHTML = me.invites.map(inviteHTML).join('');
    return;
  }
  $('bandScreen').hidden = true;
  if (!me.bands.some(b => b.id === bandId)) bandId = me.bands[0].id;
  try { localStorage.setItem(BAND_KEY, bandId); } catch (e) {}
  const band = me.bands.find(b => b.id === bandId);
  const admin = band.role === 'admin';
  document.body.classList.toggle('readonly', !admin); document.body.classList.toggle('isadmin', admin);
  $('text').readOnly = !admin;
  $('bandSelect').innerHTML = me.bands.map(b => `<option value="${b.id}">${esc(b.name)}${b.role === 'admin' ? '' : ' (membro)'}</option>`).join('');
  $('bandSelect').value = bandId;
  $('inviteBar').hidden = !me.invites.length; $('inviteBar').innerHTML = me.invites.map(inviteHTML).join('');
  live.set({ role: 'off' }); renderLive();
  await loadSetlists();
  updateStatus();
}
$('bandSelect').addEventListener('change', async e => {
  await flush(); bandId = e.target.value; sl = null; setlists = [];
  try { localStorage.removeItem(LAST_KEY); } catch (ex) {}
  enterBand().catch(err => toast(err.message));
});

/* diálogo da banda: nome, membros, convites, conta */
let bandInfo = null;
function renderBandDialog() {
  const b = bandInfo; const admin = b.role === 'admin';
  const f = $('bandNameForm'); f.name.value = b.name; f.name.readOnly = !admin;
  $('bandMembers').innerHTML = b.members.map(m => `<li data-uid="${m.id}"><span class="who"><b>${esc(m.name)}</b>${m.id === me.user.id ? ' (você)' : ''}<small>${esc(m.email)}</small></span>
    <span class="role ${m.role}">${m.role === 'admin' ? 'Admin' : 'Membro'}</span>
    ${admin ? `<button data-act="role" data-role="${m.role === 'admin' ? 'membro' : 'admin'}" class="ghost">${m.role === 'admin' ? 'Tornar membro' : 'Tornar admin'}</button>
    ${m.id === me.user.id ? '' : '<button data-act="rm" class="ghost" title="Tirar da banda">✕</button>'}` : ''}</li>`).join('');
  $('bandInvites').innerHTML = b.invites.map(i => `<li data-inv="${i.id}"><span class="who"><b>${esc(i.name)}</b> · convite pendente<small>${esc(i.email)}</small></span>
    <button data-act="cancel" class="ghost">Cancelar convite</button></li>`).join('');
  $('acct').textContent = `${me.user.name} · ${me.user.email}`;
}
async function openBandDialog() {
  try { bandInfo = await api('GET', '/bands/' + bandId); renderBandDialog(); $('dlgBand').showModal(); }
  catch (e) { toast(e.message); }
}
$('bandBtn').onclick = openBandDialog;
async function refreshMe() { me = await api('GET', '/me'); }
$('bandNameForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { bandInfo = await api('PATCH', '/bands/' + bandId, { name: e.target.name.value.trim() }); renderBandDialog(); await refreshMe(); await enterBand(); toast('Nome salvo'); }
  catch (ex) { toast(ex.message); }
});
$('inviteForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { bandInfo = await api('POST', `/bands/${bandId}/invites`, { email: e.target.email.value.trim() }); e.target.reset(); renderBandDialog(); toast('Convite enviado — a pessoa vê ao entrar'); }
  catch (ex) { toast(ex.message, 4500); }
});
$('bandMembers').addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const uid = b.closest('li').dataset.uid;
  try {
    if (b.dataset.act === 'role') bandInfo = await api('PATCH', `/bands/${bandId}/members/${uid}`, { role: b.dataset.role });
    else bandInfo = await api('DELETE', `/bands/${bandId}/members/${uid}`);
    renderBandDialog();
    if (uid === me.user.id) { await refreshMe(); await enterBand(); }
  } catch (ex) { toast(ex.message, 4500); }
});
$('bandInvites').addEventListener('click', async e => {
  const b = e.target.closest('button[data-act="cancel"]'); if (!b) return;
  try { bandInfo = await api('DELETE', `/bands/${bandId}/invites/${b.closest('li').dataset.inv}`); renderBandDialog(); }
  catch (ex) { toast(ex.message); }
});
$('leaveBand').onclick = async () => {
  try { me = await api('DELETE', `/bands/${bandId}/members/${me.user.id}`); $('dlgBand').close(); bandId = null; await enterBand(); toast('Você saiu da banda'); }
  catch (ex) { toast(ex.message, 5000); }
};
$('newBandForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { const r = await api('POST', '/bands', { name: e.target.name.value.trim() }); me = r; bandId = r.id; e.target.reset(); $('dlgBand').close(); await enterBand(); toast('Banda criada — você é o admin'); }
  catch (ex) { toast(ex.message); }
});

/* ---------------- início ---------------- */
async function start() {
  if (!token) { showAuth(); return; }
  me = await api('GET', '/me');
  await enterBand();
}
start().catch(err => {
  if (!token) return;
  $('status').className = 'status err'; $('status').lastChild.textContent = 'Sem conexão com o servidor';
  toast(err.message, 5000);
});
