import { parseSong, transposeText, sheetHTML, lyricsHTML, buildPdf, resolveScale, validateSong, esc, fmtDate, norm, viewOf } from './cifra.js';
import { Player } from './player.js';
import { Live } from './live.js';
import {
  COVER_STEPS, COVER_OPTS, coverOpts, flowStaff, buildTimeline, barSeconds, parseBpm, sectionLengths,
  keyChords, usedChords, setBarChords, addBarChord, insertBarAfter, appendBar, deleteBar, toggleRepeatStart, toggleRepeatEnd,
  setRepeatTimes, setBarEnding, setBarNote, setBarLyric, barLyric, appendSection,
  setMeta, renameSection, setSectionTimes, duplicateSection, moveSection, deleteSection,
  barPlays, barLyricPasses, setBarLyricPass,
} from '/core/index.js';
import { resolveCoverScale } from './cifra.js';

const $ = id => document.getElementById(id);
const LAST_KEY = 'grade-cifras-ultima-setlist';
// música nova começa sem estrutura: quem monta as seções (e a ordem delas) é o músico
const NEW_SONG = `título: Nova música
artista:
tom: C
bpm: 90
compasso: 4/4
`;
const SECTION_PICKS = ['Intro', 'Verso', 'Pré-refrão', 'Refrão', 'Ponte', 'Solo', 'Final'];

/* ---------------- link do show (convidado, sem conta) ---------------- */
// /s/<token> abre o show só para ver e acompanhar o ao vivo
const GUEST = (location.pathname.match(/^\/s\/([A-Za-z0-9_-]{20,64})\/?$/) || [])[1] || null;
const INST_KEY = 'tectune-instrumento', NAME_KEY = 'grade-cifras-nome';

/* ---------------- API ---------------- */
const TOKEN_KEY = 'grade-cifras-token', BAND_KEY = 'grade-cifras-banda';
let token = null, bandId = null, me = null;
try { token = localStorage.getItem(TOKEN_KEY); bandId = localStorage.getItem(BAND_KEY); } catch (e) {}
const authHeaders = () => (GUEST ? {} : { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(bandId ? { 'x-band': bandId } : {}) });
async function api(method, url, body) {
  const r = await fetch('/api' + url, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.startsWith('/auth/') && !GUEST) { setToken(null); showAuth(); }
  if (!r.ok) throw Object.assign(new Error(j.error || `Erro ${r.status}`), { status: r.status, code: j.code });
  return j;
}
function setToken(t) { token = t; try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

/* ---------------- estado ---------------- */
let setlists = [];   // resumo de todas as setlists
let sl = null;       // setlist aberta (com músicas)
let cur = -1;        // índice da música aberta em sl.songs
let selBar = null;   // compasso selecionado no editor visual: "seção:compasso" ou "+seção" (compasso novo no fim)

function toast(msg, ms = 2800) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
const slug = s => norm(s || 'cifra').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cifra';
const curSong = () => (sl && cur >= 0 ? sl.songs[cur] : null);
const isAdmin = () => document.body.classList.contains('isadmin');
const isPalco = () => document.body.classList.contains('palco');
const mmss = s => { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function songSecs(song) { const bpm = parseBpm(song.meta.bpm); return bpm ? buildTimeline(song).length * barSeconds(song.meter, bpm) : null; }
const SEC_COLORS = { intro: '#FF7A2F', verso: '#3DD6B5', estrofe: '#3DD6B5', pre: '#8FA8FF', refrao: '#F2C14E', coro: '#F2C14E', ponte: '#E58FD0', solo: '#9FD36B', final: '#C9C2B7', fim: '#C9C2B7', outro: '#C9C2B7' };
const CYCLE = ['#FF7A2F', '#3DD6B5', '#8FA8FF', '#F2C14E', '#E58FD0', '#9FD36B'];
function secColor(name, i) {
  const n = norm(name || '').replace(/[^a-z]/g, '');
  for (const k in SEC_COLORS) if (n.startsWith(k)) return SEC_COLORS[k];
  return CYCLE[i % CYCLE.length];
}

/* ---------------- salvamento automático ---------------- */
const pending = new Map(); // songId -> conteúdo ainda não salvo
let saveTimer = null, savingP = null, saveErr = false;

function updateStatus() {
  const el = $('status'); let cls = 'ok', msg = 'Salvo';
  if (!navigator.onLine) { cls = 'off'; msg = pending.size ? 'Offline · não salvo' : 'Offline'; }
  else if (GUEST) { cls = 'ok'; msg = 'Pelo link'; }
  else if (savingP) { cls = ''; msg = 'Salvando…'; }
  else if (saveErr) { cls = 'err'; msg = 'Erro ao salvar'; }
  else if (pending.size) { cls = 'dirty'; msg = 'Não salvo'; }
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

/* ---------------- telas: Show | Cifra ---------------- */
function go(view) {
  document.body.dataset.view = view;
  document.querySelectorAll('.rail [data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === view));
  document.querySelector('.appmain').scrollTop = 0;
  if (view === 'song') { renderSongView(); renderPreview(); }
  else renderShow();
}
document.querySelectorAll('.rail [data-go]').forEach(b => { b.onclick = () => { if (b.dataset.go === 'song' && !curSong()) { toast('Escolha ou crie uma música no show'); return; } go(b.dataset.go); }; });
$('mShow').onclick = () => { if (!curSong()) { toast('O show ainda não tem músicas'); return; } go('song'); setPalco(true); };
$('backShow').onclick = () => go('show');
$('shareJump').onclick = () => { go('show'); setTimeout(() => $('shareCard').scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); };
$('songPrev').onclick = () => openSong(cur - 1);
$('songNext').onclick = () => openSong(cur + 1);
function openSong(i) {
  if (!sl || i < 0 || i >= sl.songs.length) return;
  cur = i; selBar = null; undo.length = 0;
  if (document.body.dataset.view !== 'song') go('song'); else { renderAll(); document.querySelector('.appmain').scrollTop = 0; }
}

/* ---------------- setlists ---------------- */
function slLabel(s) { return s.name + (s.event_date ? ` — ${fmtDate(s.event_date)}` : ''); }

function renderSelect() {
  const sel = $('slSelect');
  sel.innerHTML = setlists.length
    ? setlists.map(s => `<option value="${s.id}">${esc(slLabel(s))}</option>`).join('')
    : '<option value="">Nenhum show</option>';
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
  cur = sl.songs.length ? 0 : -1; selBar = null;
  try { localStorage.setItem(LAST_KEY, id); } catch (e) {}
  if (live.role !== 'off' && live.room !== sl.id) live.set({ role: 'off' });
  renderSelect(); renderAll();
}

function syncSummary() {
  const s = setlists.find(x => x.id === sl?.id);
  if (s) Object.assign(s, { name: sl.name, event_date: sl.event_date, venue: sl.venue, cols: sl.cols, song_count: sl.songs.length });
  renderSelect();
}

$('slSelect').addEventListener('change', e => { if (e.target.value) openSetlist(e.target.value).catch(err => toast(err.message)); });

/* diálogo do show */
let dlgMode = 'new';
function openSetlistDialog(mode) {
  dlgMode = mode;
  const f = $('formSetlist');
  $('dlgSetlistTitle').textContent = mode === 'new' ? 'Novo show' : 'Editar show';
  const d = mode === 'edit' && sl ? sl : { name: '', event_date: '', venue: '', notes: '', cols: 4 };
  f.name.value = d.name || ''; f.event_date.value = d.event_date || '';
  f.venue.value = d.venue || ''; f.notes.value = d.notes || ''; f.cols.value = String(d.cols || 4);
  const del = $('slDelete'); del.style.display = mode === 'edit' ? '' : 'none';
  del.classList.remove('armed'); del.textContent = 'Excluir show';
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
      toast('Show criado');
    } else {
      const upd = await api('PATCH', '/setlists/' + sl.id, body);
      await flush();
      sl = upd; if (cur >= sl.songs.length) cur = sl.songs.length - 1;
      $('dlgSetlist').close();
      setlists = await api('GET', '/setlists'); renderSelect(); renderAll();
      toast('Show atualizado');
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
    toast('Show excluído (as músicas continuam na biblioteca)');
  } catch (err) { toast(err.message); }
};
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

/* ---------------- músicas do show ---------------- */
async function setOrder(ids, newCur) {
  await flush();
  sl = await api('PUT', `/setlists/${sl.id}/songs`, { songIds: ids });
  cur = sl.songs.length ? Math.max(0, Math.min(newCur, sl.songs.length - 1)) : -1;
  syncSummary(); renderAll();
}
const ids = () => sl.songs.map(s => s.id);
const hasErrors = text => validateSong(text).some(i => i.level === 'error');
function songStatus(text) {
  const is = validateSong(text);
  if (is.some(i => i.level === 'error')) return ['err', 'Revisar'];
  if (is.length) return ['warn', 'Avisos'];
  if (!parseBpm(parseSong(text).meta.bpm)) return ['warn', 'Sem BPM'];
  return ['ok', 'Pronta'];
}

function renderShow() {
  const head = $('slTitle'), meta = $('slMeta'), when = $('slWhen');
  if (!sl) {
    head.textContent = GUEST ? 'Show' : 'Nenhum show ainda'; when.textContent = '';
    meta.textContent = GUEST ? '' : 'Crie o primeiro show em “Novo show”.';
  } else {
    head.textContent = sl.name;
    when.textContent = [longDate(sl.event_date), sl.venue].filter(Boolean).join(' · ');
    let total = 0, ready = 0, attn = 0;
    for (const s of sl.songs) { const p = parseSong(s.content); total += songSecs(p) || 0; songStatus(s.content)[0] === 'ok' ? ready++ : attn++; }
    const n = sl.songs.length;
    meta.innerHTML = n
      ? `${n} ${n === 1 ? 'música' : 'músicas'}${total ? ` · ${Math.round(total / 60)} min de show` : ''} · <span class="okc">${ready} ${ready === 1 ? 'pronta' : 'prontas'}</span>${attn ? `, <span class="warnc">${attn} ${attn === 1 ? 'precisa' : 'precisam'} de atenção</span>` : ''}`
      : '';
  }
  ['btnPdfAll', 'btnPdfSetlist'].forEach(id => { $(id).disabled = !sl || !sl.songs.length; });
  ['songNew', 'songLib', 'slEdit'].forEach(id => { $(id).disabled = !sl; });
  $('goLive').disabled = $('goFollow').disabled = !sl || !sl.songs.length;
  renderList(); renderCurve(); renderShare(); renderBand();
}
function longDate(d) {
  if (!d) return '';
  const [Y, M, D] = d.split('-').map(Number);
  const s = new Date(Y, M - 1, D).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function renderList() {
  const ol = $('songList');
  if (!sl) { ol.innerHTML = GUEST ? '<li class="listempty">Show indisponível.</li>' : `<li class="listempty bigempty"><b>Comece pelo seu primeiro show</b><span>Um show é a lista de músicas de um ensaio, uma apresentação ou do seu estudo.</span>${isAdmin() ? '<button type="button" class="accent" data-act="newshow">Criar meu primeiro show</button>' : ''}</li>`; return; }
  if (!sl.songs.length) { ol.innerHTML = `<li class="listempty bigempty"><b>Este show ainda não tem músicas</b>${isAdmin() ? '<span>Crie uma cifra do zero ou traga uma que já está na biblioteca.</span><span class="row2"><button type="button" class="accent" data-act="newsong">Nova música</button><button type="button" data-act="lib">Da biblioteca</button></span>' : ''}</li>`; return; }
  ol.innerHTML = sl.songs.map((s, i) => {
    const p = parseSong(s.content), m = p.meta; const secs = songSecs(p); const [stc, stl] = songStatus(s.content);
    return `<li class="${i === cur ? 'on' : ''}" data-i="${i}" tabindex="0">
      <span class="n">${i + 1}</span>
      <span class="tt"><b>${esc(m.title || 'Sem título')}</b><small>${esc(m.artist || '—')}</small></span>
      <span class="k">${esc(m.key || '—')}</span>
      <span class="m">${m.bpm ? esc(String(parseBpm(m.bpm) || m.bpm)) + ' bpm' : '— bpm'}</span>
      <span class="m">${secs ? mmss(secs) : '—'}</span>
      <span class="st ${stc}">${stl}</span>
      <span class="acts admin-only">
        <button type="button" data-a="up" aria-label="Subir"><svg aria-hidden="true"><use href="#i-up"/></svg></button>
        <button type="button" data-a="down" aria-label="Descer"><svg aria-hidden="true"><use href="#i-down"/></svg></button>
        <button type="button" data-a="dup" aria-label="Duplicar como nova música"><svg aria-hidden="true"><use href="#i-copy"/></svg></button>
        <button type="button" data-a="rm" aria-label="Tirar do show (continua na biblioteca)"><svg aria-hidden="true"><use href="#i-x"/></svg></button>
      </span></li>`;
  }).join('');
}
$('songList').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('li[data-i]')) openSong(+e.target.dataset.i); });
$('songList').addEventListener('click', async e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'newshow') return openSetlistDialog('new');
  if (act === 'newsong') return $('songNew').click();
  if (act === 'lib') return $('songLib').click();
  const li = e.target.closest('li[data-i]'); if (!li) return;
  const i = +li.dataset.i; const a = e.target.closest('button')?.dataset.a;
  if (!a) { openSong(i); return; }
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

function renderCurve() {
  const box = $('curve');
  box.closest('.card').hidden = !sl || sl.songs.length < 2; // curva só faz sentido com 2 ou mais músicas
  if (!sl || !sl.songs.length) { box.innerHTML = '<span class="curveempty">Adicione músicas para ver a curva do show.</span>'; return; }
  const bpms = sl.songs.map(s => parseBpm(parseSong(s.content).meta.bpm));
  box.setAttribute('aria-label', 'BPM em ordem: ' + bpms.map(b => b || 'sem BPM').join(', '));
  box.innerHTML = sl.songs.map((s, i) => {
    const b = bpms[i]; const h = b ? Math.round(10 + (Math.min(Math.max(b, 50), 180) - 50) / 130 * 62) : 18;
    return `<button type="button" class="cb${b && b >= 115 ? ' hi' : ''}${i === cur ? ' on' : ''}${b ? '' : ' nob'}" data-i="${i}" title="${esc(parseSong(s.content).meta.title || 'Sem título')}"><small>${b ? Math.round(b) : '—'}</small><i style="height:${h}px"></i></button>`;
  }).join('');
}
$('curve').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) openSong(+b.dataset.i); });

$('songNew').onclick = async () => {
  if (!sl) return;
  try {
    const song = await api('POST', '/songs', { content: NEW_SONG });
    await setOrder([...ids(), song.id], sl.songs.length);
    selBar = null; go('song');
    toast('Música criada: dê um nome e comece pela primeira seção');
    setTimeout(() => { const h = $('shTitle'); if (!h.classList.contains('editable')) return; h.focus(); const r = document.createRange(); r.selectNodeContents(h); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }, 60);
  } catch (err) { toast(err.message); }
};

/* ---------------- biblioteca ---------------- */
let libTimer;
async function renderLib() {
  const q = $('libSearch').value.trim();
  const list = await api('GET', '/songs' + (q ? '?q=' + encodeURIComponent(q) : ''));
  const inShow = new Set(sl ? ids() : []);
  $('libList').innerHTML = list.length ? list.map(s => {
    const sub = [s.artist, s.song_key && 'Tom ' + s.song_key, s.bpm && s.bpm + ' bpm', `em ${s.setlist_count} ${s.setlist_count === 1 ? 'show' : 'shows'}`].filter(Boolean).join(' · ');
    return `<li data-id="${s.id}"><div class="info"><div class="t">${esc(s.title)}${inShow.has(s.id) ? '<span class="tag">neste show</span>' : ''}</div><div class="s">${esc(sub)}</div></div>
      <button data-a="add" ${sl ? '' : 'disabled'}>Adicionar</button>
      <button data-a="del" class="danger" title="Apagar da biblioteca e de todos os shows">Apagar</button></li>`;
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

/* ---------------- compartilhar: link + QR ---------------- */
const shareUrl = t => `${location.origin}/s/${t}`;
function qrSVG(text) {
  if (typeof window.qrcode !== 'function') return '';
  const q = window.qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(); let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return `<svg viewBox="-1 -1 ${n + 2} ${n + 2}" shape-rendering="crispEdges" aria-hidden="true"><path d="${d}" fill="#0E0D0C"/></svg>`;
}
let qrFor = null;
function renderShare() {
  const tok = sl ? (GUEST || sl.share_token || null) : null;
  $('shareCard').hidden = !sl;
  $('shareOffBox').hidden = !!tok; $('shareOnBox').hidden = !tok;
  ['shareReset', 'shareOff'].forEach(id => { const b = $(id); b.classList.remove('armed'); b.textContent = id === 'shareReset' ? 'Trocar link' : 'Desligar link'; });
  if (!tok) return;
  const url = shareUrl(tok);
  $('shareUrl').value = url;
  if (qrFor !== url) { $('qr').innerHTML = qrSVG(url); qrFor = url; }
  const msg = `${sl.name}: abra o show no Tectune e toque junto com a banda ${url}`;
  $('shareWa').href = 'https://wa.me/?text=' + encodeURIComponent(msg);
  $('shareMail').href = `mailto:?subject=${encodeURIComponent(sl.name + ' — repertório no Tectune')}&body=${encodeURIComponent(msg)}`;
  $('shareNative').hidden = !navigator.share;
}
$('shareCreate').onclick = async () => {
  try { const r = await api('POST', `/setlists/${sl.id}/share`, {}); sl.share_token = r.share_token; renderShare(); toast('Link criado: mande para a banda'); }
  catch (err) { toast(err.message); }
};
$('shareCopy').onclick = async () => {
  const v = $('shareUrl').value;
  try { await navigator.clipboard.writeText(v); } catch (e) { $('shareUrl').select(); document.execCommand('copy'); }
  $('shareCopy').textContent = 'Copiado'; setTimeout(() => { $('shareCopy').textContent = 'Copiar'; }, 1800);
};
$('shareNative').onclick = () => navigator.share?.({ title: sl.name, text: `${sl.name} no Tectune`, url: $('shareUrl').value }).catch(() => {});
$('shareReset').onclick = async () => {
  const b = $('shareReset');
  if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Confirmar: o link antigo para de abrir'; return; }
  try { const r = await api('POST', `/setlists/${sl.id}/share`, { reset: true }); sl.share_token = r.share_token; renderShare(); toast('Link trocado. Mande o novo para a banda'); }
  catch (err) { toast(err.message); }
};
$('shareOff').onclick = async () => {
  const b = $('shareOff');
  if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Confirmar: ninguém mais abre pelo link'; return; }
  try { await api('DELETE', `/setlists/${sl.id}/share`); sl.share_token = null; renderShare(); toast('Link desligado'); }
  catch (err) { toast(err.message); }
};

/* ---------------- banda neste show ---------------- */
let bandInfo = null;
const AV = ['#FF7A2F', '#3DD6B5', '#8FA8FF', '#F2C14E', '#E58FD0', '#9FD36B'];
const INST = { voz: 'Voz', harmonia: 'Violão / guitarra', baixo: 'Baixo', teclado: 'Teclado', bateria: 'Bateria', outro: 'Outro' };
const initials = n => (String(n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('') || '?').toUpperCase();
function renderBand() {
  const ul = $('bandList'); if (GUEST) return;
  const peers = live.status === 'on' ? (live.peers?.members || []) : [];
  const online = new Set(peers.map(p => norm(p.name)));
  const rows = (bandInfo?.members || []).map((m, i) => ({ name: m.name, sub: m.role === 'admin' ? 'Admin' : 'Membro', on: online.has(norm(m.name)), i }));
  peers.filter(p => p.guest).forEach((p, k) => rows.push({ name: p.name, sub: `${INST[p.inst] || 'Músico'} · pelo link`, on: true, i: rows.length + k }));
  ul.innerHTML = rows.length ? rows.map(r => `<li><span class="av" style="background:${AV[r.i % AV.length]}">${esc(initials(r.name))}</span>
    <span class="who"><b>${esc(r.name)}</b><small>${esc(r.sub)}</small></span><span class="${r.on ? 'on' : 'off'}">${r.on ? 'No ao vivo' : ''}</span></li>`).join('')
    : '<li class="hint">Carregando…</li>';
}
async function loadBandInfo() {
  if (GUEST || !bandId) return;
  try { bandInfo = await api('GET', '/bands/' + bandId); renderBand(); } catch (e) { /* sem banda ainda */ }
}
$('bandInvite').onclick = () => openBandDialog().then(() => setTimeout(() => $('inviteForm').email.focus(), 50));
$('bandManage').onclick = openBandDialog;

/* ---------------- ao vivo a partir da tela do show ---------------- */
$('goLive').onclick = () => {
  if (!sl || !sl.songs.length) return;
  const name = live.name || me?.user?.name || 'Diretor';
  live.set({ role: 'diretor', room: sl.id, name, view: showView });
  if (cur < 0) cur = 0;
  go('song'); setPalco(true); renderLive();
  toast('Você conduz: dê o play e a banda acompanha');
};
$('goFollow').onclick = () => {
  if (!sl || !sl.songs.length) return;
  live.set({ role: 'seguir', room: sl.id, name: live.name || me?.user?.name || 'Músico', view: showView });
  if (cur < 0) cur = 0;
  go('song'); setPalco(true); renderLive();
  toast('Seguindo: a música desce sozinha quando o play começar');
};

/* ---------------- cabeçalho da música ---------------- */
function renderSongView() {
  const s = curSong(); const p = s ? parseSong(s.content) : null; const m = p?.meta || {};
  const ta = $('text'); ta.disabled = !s; if (ta.value !== (s ? s.content : '')) ta.value = s ? s.content : '';
  $('crumbShow').textContent = sl ? sl.name : 'Show';
  $('songPos').textContent = sl && s ? `${cur + 1} de ${sl.songs.length}` : '';
  $('songPrev').disabled = !sl || cur <= 0; $('songNext').disabled = !sl || cur >= sl.songs.length - 1;
  const ed = !!s && isAdmin();
  editableText('shTitle', m.title || '', ed, s ? 'Sem título' : 'Nenhuma música');
  editableText('shArtist', m.artist || '', ed, '');
  editableText('shObs', m.notes || '', ed, '');
  $('shKey').textContent = m.key || '—';
  const bpmIn = $('shBpm');
  if (document.activeElement !== bpmIn) bpmIn.value = m.bpm ? String(parseBpm(m.bpm) || m.bpm) : '';
  bpmIn.readOnly = !ed; bpmIn.placeholder = ed ? '—' : '—';
  const tsel = $('shTime'); const lab = p ? p.meter.label : '4/4';
  if (![...tsel.options].some(o => o.value === lab)) tsel.add(new Option(lab, lab));
  tsel.value = lab; tsel.disabled = !ed;
  const secs = p && songSecs(p); $('shDur').textContent = secs ? mmss(secs) : '—';
  $('shDur').title = secs ? '' : 'Coloque o bpm: no cabeçalho para calcular';
  ['tUp', 'tDown', 'pPalco', 'shareJump'].forEach(id => { $(id).disabled = !s; });
  // resumo dos problemas de formatação
  const is = s ? validateSong(s.content) : [];
  const ne = is.filter(i => i.level === 'error').length, nw = is.length - ne;
  $('issuesSum').innerHTML = !s ? '' : (ne || nw)
    ? `${ne ? `<button type="button" class="e" data-code>${ne} ${ne === 1 ? 'erro' : 'erros'}</button>` : ''} ${nw ? `<button type="button" class="w" data-code>${nw} ${nw === 1 ? 'aviso' : 'avisos'}</button>` : ''}`
    : '<span class="ok"><svg aria-hidden="true"><use href="#i-check"/></svg>Sem erros de compasso</span>';
  renderViewToggle(); renderStruct(); renderDock(); renderInspector();
}
$('issuesSum').addEventListener('click', e => { if (e.target.closest('[data-code]')) setMode('code'); });

/* ---------------- modo Visual | Código ---------------- */
const MODE_KEY = 'tectune-modo';
function setMode(m) {
  document.body.classList.toggle('code', m === 'code');
  $('mVisual').classList.toggle('on', m !== 'code'); $('mCode').classList.toggle('on', m === 'code');
  try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
  renderPreview();
}
$('mVisual').onclick = () => setMode('visual');
$('mCode').onclick = () => setMode('code');

/* ---------------- editor e prévia ---------------- */
let pvTimer;
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
  const add = e.target.closest('.addbar'); if (add) { selectBar('+' + add.dataset.sec); $('chordIn').focus(); return; }
  const ly = e.target.closest('.ly[data-k]'); if (ly) { player.seekStep(+ly.dataset.k); return; } // linha da letra: começa dali
  const b = e.target.closest('.bar[data-line]'); if (!b) return;
  if (isPalco() || player.live) { player.seek(b.dataset.id); return; } // no palco: começa (ou pula) dali
  selectBar(b.dataset.id);
  if (document.body.classList.contains('code')) gotoLine(+b.dataset.line);
});
$('sheet').addEventListener('dblclick', e => { if (!isPalco() && e.target.closest('.bar[data-line]') && isAdmin()) $('chordIn').focus(); });

function renderPreview() {
  const s = curSong();
  renderIssues();
  const sheet = $('sheet'), badge = $('pages');
  badge.hidden = true; sheet.style.removeProperty('--s'); sheet.style.removeProperty('--hs');
  if (!sl) { sheet.innerHTML = `<div class="empty">Nenhum show ainda.</div>`; return; }
  if (!s) { sheet.innerHTML = `<div class="empty">Adicione uma música ao show para cifrar aqui.</div>`; return; }
  const fs = s.font_scale ?? 100;
  const { pct, pages } = resolveScale(s.content, sl.cols, fs);
  // na tela a leitura é sempre confortável (o tamanho de impressão só vale no PDF); no palco, A−/A+ ajustam
  const palco = isPalco();
  const k = palco ? palcoZoom : 1;
  sheet.style.setProperty('--s', k); sheet.style.setProperty('--hs', Math.min(1, 0.55 + 0.45 * k));
  sheet.classList.remove('tiny', 'pc2', 'pc3');
  const cantor = palco && showView === 'cantor';
  sheet.innerHTML = cantor ? lyricsHTML(s.content) : sheetHTML(s.content, sl.cols);
  if (!cantor) { decorateSheet(); fitSlots(); }
  renderShowBar();
  // play: mesma música → mantém a posição; outra música → recomeça
  if (playerSongId !== s.id) { playerSongId = s.id; player.text = null; player.load(s.content); }
  else player.load(s.content, { keep: true });
  player.paint();
  badge.hidden = false;
  badge.className = 'pages' + (pages > 1 ? ' over' : '');
  badge.textContent = `${fs === 0 ? 'Auto · ' : ''}${pct}% · ${pages} ${pages === 1 ? 'folha' : 'folhas'}`;
  badge.title = pages > 1 && fs === 0 ? 'Mesmo no tamanho mínimo não coube em uma folha' : '';
}
// cor de cada seção, compasso selecionado e o "+ compasso" no fim de cada seção
function decorateSheet() {
  const s = curSong(); const song = parseSong(s.content);
  if (!song.sections.length) {
    const empty = $('sheet').querySelector('.empty');
    if (empty && isAdmin() && !isPalco()) {
      empty.className = 'empty startsec';
      empty.innerHTML = `<b>Comece pela estrutura</b>
        <span>Adicione a primeira seção da música. Depois é só tocar no compasso e colocar os acordes e a letra; quando acabar, adicione a próxima.</span>
        <div class="secpicks">${SECTION_PICKS.map(n => `<button type="button" data-newsec="${esc(n)}">${esc(n)}</button>`).join('')}
        <button type="button" data-newsec="?" class="ghost">Outro nome…</button></div>`;
    }
  }
  const secs = [...$('sheet').querySelectorAll('.body > .sec')];
  secs.forEach((el, si) => {
    const sec = song.sections[si]; if (!sec) return;
    el.style.setProperty('--sc', secColor(sec.name, si));
    if (!isAdmin() || isPalco()) return;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'addbar' + (selBar === '+' + si ? ' sel' : ''); btn.dataset.sec = si;
    btn.setAttribute('aria-label', `Novo compasso em ${sec.name || 'seção ' + (si + 1)}`);
    btn.innerHTML = '<svg aria-hidden="true"><use href="#i-plus"/></svg>compasso';
    const rows = el.querySelectorAll(':scope > .row, :scope > .srow');
    if (rows.length) rows[rows.length - 1].appendChild(btn);
    else { const r = document.createElement('div'); r.className = 'row'; r.style.setProperty('--cols', sl.cols); r.appendChild(btn); el.appendChild(r); }
  });
  markSel();
}
function markSel() {
  $('sheet').querySelectorAll('.bar.sel, .addbar.sel').forEach(el => el.classList.remove('sel'));
  if (!selBar || isPalco()) return;
  const el = selBar[0] === '+' ? $('sheet').querySelector(`.addbar[data-sec="${selBar.slice(1)}"]`) : $('sheet').querySelector(`.bar[data-id="${selBar}"]`);
  if (el) el.classList.add('sel');
}
function selectBar(id, { scroll = false } = {}) {
  selBar = id; markSel(); renderInspector(); renderDock();
  if (scroll) {
    const el = $('sheet').querySelector('.sel');
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
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
  player.stop(); cur = n; selBar = null; renderAll();
  $('pScroll').scrollTo({ top: 0 });
}
function setPalco(on) {
  document.body.classList.toggle('palco', on);
  keepAwake(on); // no palco a tela não apaga
  if (on && document.body.dataset.view !== 'song') { document.body.dataset.view = 'song'; renderSongView(); }
  renderPreview();
}
// tocar já abre o modo palco
function playToggle() {
  if (!curSong()) return;
  const starting = !(player.mode === 'playing' || player.mode === 'count');
  if (starting && !isPalco()) { if (document.body.dataset.view !== 'song') go('song'); setPalco(true); }
  player.toggle();
}
$('pPlay').onclick = playToggle;
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
const VIEW_KEY = 'grade-cifras-visao';
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
  $('showTitle').textContent = sl && s ? `${cur + 1}/${sl.songs.length} · ${parseSong(s.content).meta.title || 'Sem título'}` : '';
  $('svMusico').classList.toggle('on', showView === 'musico'); $('svCantor').classList.toggle('on', showView === 'cantor');
}
function askExit() { $('exitText').textContent = (live.role !== 'off' ? 'Você também sai do show ao vivo. ' : '') + 'O play é interrompido.'; $('dlgExit').showModal(); }
$('showExit').onclick = askExit;
$('exitConfirm').onclick = () => {
  $('dlgExit').close(); live.set({ role: 'off' }); renderLive();
  player.locked = false; player.forceBarSec = null; player.stop(); setPalco(false);
  if (GUEST) go('show');
};

const live = new Live({ onPeers: () => { renderLive(); renderBand(); }, onStatus: () => { renderLive(); renderBand(); }, onState: r => applyRemote(r), token: () => token });
try { live.name = localStorage.getItem(NAME_KEY) || ''; } catch (e) {}
const following = () => live.role === 'seguir' && live.status === 'on' && !!live.director && !live.isDirector;
function applyRemote(r) {
  if (!following() || !sl) return;
  let k = sl.songs.findIndex(x => x.id === r.songId); if (k < 0) k = r.songIdx;
  // quem conduz deu o play: o palco abre sozinho em quem está seguindo
  if ((r.mode === 'playing' || r.mode === 'count') && !isPalco()) { cur = k >= 0 && k < sl.songs.length ? k : cur; document.body.dataset.view = 'song'; renderSongView(); setPalco(true); }
  if (k >= 0 && k < sl.songs.length && k !== cur) { player.locked = false; player.stop(); cur = k; renderAll(); player.locked = true; }
  player.applyRemote(r, live.serverNow());
}
let lastSig = '', wasDirector = false;
// quem conduz manda o estado a cada mudança de verdade (play, pausa, salto, andamento, música)
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
  else if (live.isDirector) { lab.textContent = `Você conduz · ${live.peers?.count || 1}`; b.classList.add('ok'); }
  else if (live.director) { lab.textContent = `Seguindo ${live.director}`; b.classList.add('ok'); }
  else { lab.textContent = 'Aguardando quem conduz'; b.classList.add('wait'); }
  $('liveOpts').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.role === live.role));
  const p = live.peers;
  $('liveMembers').innerHTML = live.role !== 'off' && p ? `<b>Conectados (${p.count})</b>` + p.members.map(m => `<span>${m.director ? '★' : '•'} ${esc(m.name)} · ${m.inst ? esc(INST[m.inst] || m.inst) : m.view === 'cantor' ? 'letra' : 'acordes'}${m.guest ? ' · pelo link' : ''}</span>`).join('') : '';
  if (live.isDirector && !wasDirector) broadcast(true);
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
document.querySelectorAll('#pctl button').forEach(b => b.addEventListener('click', () => b.blur()));
document.addEventListener('keyup', e => { if (e.key === ' ' && e.target?.tagName === 'BUTTON') e.preventDefault(); });
window.__player = player; // útil para depurar no console

/* ---------------- atalhos ---------------- */
// no palco: espaço toca, ← → trocam de música (pedais Bluetooth). No editor visual: ← → andam pelos compassos.
document.addEventListener('keydown', e => {
  const t = e.target;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); flush().then(() => toast('Salvo')); return; }
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (document.querySelector('dialog[open]')) return;
  const editing = document.body.dataset.view === 'song' && !isPalco() && !document.body.classList.contains('code') && isAdmin() && curSong();
  if (editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoEdit(); return; }
  if (editing && selBar && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (/^[A-Ga-g]$/.test(e.key)) { e.preventDefault(); const i = $('chordIn'); i.value = e.key.toUpperCase(); i.focus(); return; }
    if (e.key === '%') { e.preventDefault(); putChord('%'); return; }
    if (e.key === '-') { e.preventDefault(); putChord('-'); return; }
    if (e.key === 'Enter') { e.preventDefault(); $('chordIn').focus(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); delBar(); return; }
    if (e.key === 'Escape') { selectBar(null); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); moveSel(e.key === 'ArrowRight' ? 1 : -1); return; }
  }
  if (e.key === ' ') { e.preventDefault(); if (t && t.tagName === 'BUTTON') t.blur(); playToggle(); }
  else if (e.key === 'Escape') {
    if (isPalco()) { e.preventDefault(); setTimeout(askExit, 0); }
    else if (!player.locked) player.stop();
  }
  else if (isPalco() && (e.key === 'ArrowRight' || e.key === 'PageDown')) { e.preventDefault(); gotoSong(1); }
  else if (isPalco() && (e.key === 'ArrowLeft' || e.key === 'PageUp')) { e.preventDefault(); gotoSong(-1); }
});

/* ---------------- edição visual ---------------- */
const undo = []; // conteúdos anteriores da música aberta (⌘Z)
function applyEdit(r) {
  const s = curSong(); if (!s || !r) return;
  if (r.text !== s.content) { undo.push(s.content); if (undo.length > 100) undo.shift(); setContent(r.text); $('text').value = r.text; }
  selBar = r.id;
  renderPreview(); renderSongView(); renderList();
}
function undoEdit() {
  const prev = undo.pop(); if (prev == null) { toast('Nada para desfazer'); return; }
  setContent(prev); $('text').value = prev; renderPreview(); renderSongView(); renderList();
}
const song = () => parseSong(curSong().content);
const isNew = () => selBar && selBar[0] === '+';
const secOf = id => +String(id).replace('+', '').split(':')[0];
function normChord(t) { t = String(t).trim(); return /^[a-g]/.test(t) ? t[0].toUpperCase() + t.slice(1) : t; }
function nextSel(sg, id) {
  const [si, bi] = id.split(':').map(Number);
  return bi + 1 < sg.sections[si].rows.flat().length ? `${si}:${bi + 1}` : '+' + si;
}
// põe o acorde no compasso selecionado. "Dividir" ligado: entra junto com os outros, senão troca e avança.
function putChord(ch, { split = splitOn } = {}) {
  if (!isAdmin() || !curSong()) return;
  const text = curSong().content, sg = parseSong(text);
  if (!selBar) {
    const last = sg.sections.length - 1;
    if (last < 0) { pendingChord = [ch]; openSectionDialog(); return; }
    selBar = '+' + last;
  }
  if (isNew()) {
    const si = secOf(selBar);
    const r = appendBar(text, si, sg, [ch]);
    applyEdit({ text: r.text, id: split ? r.id : '+' + si });
    return;
  }
  if (split) { applyEdit(addBarChord(text, selBar, sg, ch)); return; }
  const r = setBarChords(text, selBar, sg, [ch]);
  applyEdit({ text: r.text, id: nextSel(sg, selBar) });
}
function delBar() {
  if (!selBar || isNew()) return;
  const r = deleteBar(curSong().content, selBar, song());
  applyEdit({ text: r.text, id: r.id || '+' + secOf(selBar) });
}
function moveSel(d) {
  const sg = song(); const all = [];
  sg.sections.forEach((s, si) => { s.rows.flat().forEach((b, bi) => all.push(`${si}:${bi}`)); all.push('+' + si); });
  let i = all.indexOf(selBar); if (i < 0) i = d > 0 ? -1 : all.length;
  const n = Math.max(0, Math.min(all.length - 1, i + d));
  selectBar(all[n], { scroll: true });
}
let splitOn = false, joinNext = false; // joinNext: depois do espaço, o próximo acorde entra no mesmo compasso
$('tSplit').onclick = () => { splitOn = !splitOn; $('tSplit').classList.toggle('on', splitOn); $('tSplit').setAttribute('aria-pressed', String(splitOn)); };
$('tSim').onclick = () => putChord('%', { split: false });
$('tRest').onclick = () => putChord('-');
$('tAdd').onclick = () => {
  if (!curSong()) return;
  const text = curSong().content, sg = parseSong(text);
  if (!selBar || isNew()) { const si = selBar ? secOf(selBar) : sg.sections.length - 1; if (si < 0) return; applyEdit(appendBar(text, si, sg)); return; }
  applyEdit(insertBarAfter(text, selBar, sg));
};
// digitar o acorde: Enter põe e avança, espaço põe e continua no mesmo compasso (divide), Esc sai
$('chordIn').addEventListener('keydown', e => {
  const i = e.target; const v = i.value.trim();
  if (e.key === 'Enter' || e.key === 'Tab') {
    const join = joinNext; joinNext = false;
    if (!v) { if (e.key === 'Enter') { e.preventDefault(); moveSel(1); } return; }
    e.preventDefault();
    const toks = v.split(/\s+/).map(normChord);
    if (toks.length === 1 && join && selBar && !isNew()) { const sg = song(); const r = addBarChord(curSong().content, selBar, sg, toks[0]); applyEdit({ text: r.text, id: nextSel(sg, selBar) }); }
    else if (toks.length === 1) putChord(toks[0]);
    else if (isNew()) { const si = secOf(selBar); applyEdit({ text: appendBar(curSong().content, si, song(), toks).text, id: '+' + si }); }
    else if (selBar) { const sg = song(); const r = setBarChords(curSong().content, selBar, sg, toks); applyEdit({ text: r.text, id: nextSel(sg, selBar) }); }
    else if (!song().sections.length) { pendingChord = toks; openSectionDialog(); }
    else toks.forEach(t => putChord(t, { split: true }));
    i.value = '';
  } else if (e.key === ' ' && v) {
    e.preventDefault(); putChord(normChord(v), { split: true }); i.value = ''; joinNext = true;
  } else if (e.key === 'Escape') { i.value = ''; i.blur(); }
  else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !v) { e.preventDefault(); moveSel(e.key === 'ArrowRight' ? 1 : -1); }
});

/* barra de acordes do tom */
function renderDock() {
  const s = curSong(); if (!s) return;
  const sg = parseSong(s.content);
  const kc = keyChords(sg.meta.key);
  $('dockKeyName').textContent = sg.meta.key || '—';
  $('dockKey').innerHTML = kc.length ? kc.map(k => `<button type="button" class="cchip" data-ch="${esc(k.chord)}" aria-label="Pôr ${esc(k.chord)}"><small>${k.deg}</small><b>${esc(k.chord)}</b></button>`).join('')
    : '<span class="hint">Coloque o <b>tom:</b> no cabeçalho para ver os acordes do tom.</span>';
  const used = usedChords(sg, kc.map(k => k.chord));
  $('dockUsed').innerHTML = used.map(c => `<button type="button" class="cchip used" data-ch="${esc(c)}" aria-label="Pôr ${esc(c)}"><small>usado</small><b>${esc(c)}</b></button>`).join('');
  $('dock').classList.toggle('nosel', !selBar);
}
$('dock').addEventListener('click', e => { const b = e.target.closest('.cchip[data-ch]'); if (b) putChord(b.dataset.ch); });

/* inspetor do compasso */
function renderInspector() {
  const s = curSong(); const where = $('barWhere'), beats = $('barBeats');
  const fields = ['barChords', 'barLyric', 'barNote', 'barEnding', 'barTimes', 'barRepStart', 'barRepEnd', 'barDel'];
  const off = v => fields.forEach(id => { $(id).disabled = v; });
  if (!s || !selBar) {
    where.textContent = s ? 'Toque num compasso' : '—';
    beats.style.setProperty('--n', 1);
    $('barPasses').hidden = true;
    beats.innerHTML = `<div class="empty">${s && isAdmin() ? 'Toque num compasso da cifra para editar. Ou digite um acorde direto: ele entra no fim.' : 'Toque num compasso para ver os detalhes.'}</div>`;
    fields.forEach(id => { if ($(id).tagName === 'INPUT' && $(id).type !== 'number') $(id).value = ''; });
    $('barRepStart').classList.remove('on'); $('barRepEnd').classList.remove('on');
    off(true); return;
  }
  const sg = parseSong(s.content);
  const si = secOf(selBar); const sec = sg.sections[si];
  if (isNew()) {
    where.textContent = `${sec?.name || 'Seção'} · novo compasso`;
    beats.style.setProperty('--n', 1);
    beats.innerHTML = '<div class="empty">Escolha um acorde embaixo (ou digite) para criar o compasso.</div>';
    $('barPasses').hidden = true;
    ['barChords', 'barLyric', 'barNote', 'barEnding'].forEach(id => { $(id).value = ''; });
    off(true); return;
  }
  const bi = +selBar.split(':')[1]; const b = sec?.rows.flat()[bi];
  if (!b) { selBar = null; return renderInspector(); }
  off(false);
  where.textContent = `${sec.name || 'Seção'} · ${bi + 1}`;
  const L = b.layout; const cells = [];
  for (let k = 0; k < L.grid; k++) { const sp = L.spans.find(x => x.start === k); cells.push(sp ? (sp.tok === '_' ? '—' : sp.tok === '-' ? 'pausa' : sp.tok) : '·'); }
  beats.style.setProperty('--n', Math.min(L.grid || 1, 6));
  beats.innerHTML = (cells.length ? cells : ['—']).slice(0, 12).map((c, k) => `<div><small>tempo ${k + 1}</small><b>${esc(c)}</b></div>`).join('');
  const ae = document.activeElement;
  const setv = (id, v) => { if (ae !== $(id)) $(id).value = v; };
  setv('barChords', b.tokens.filter(t => t !== '_').join(' '));
  setv('barLyric', barLyric(sg, selBar));
  setv('barNote', b.note || '');
  setv('barEnding', endingSpec(b.passes));
  $('barRepStart').classList.toggle('on', !!b.start); $('barRepEnd').classList.toggle('on', !!b.end);
  $('barTimes').disabled = !b.end; setv('barTimes', b.times || 2);
  $('barTimesL').style.opacity = b.end ? 1 : .4;
  renderPasses(sg);
}
// [1,2,3] → "1-3"; [1,3] → "1,3"
function endingSpec(p) {
  if (!p || !p.length) return '';
  const runs = [];
  for (const n of p) { const r = runs[runs.length - 1]; if (r && n === r[1] + 1) r[1] = n; else runs.push([n, n]); }
  return runs.map(([a, b]) => (a === b ? `${a}` : b === a + 1 ? `${a},${b}` : `${a}-${b}`)).join(',');
}
const onField = (id, fn) => $(id).addEventListener('change', () => { if (!selBar || isNew() || !curSong()) return; applyEdit(fn($(id).value, curSong().content, song())); });
onField('barChords', (v, t, sg) => setBarChords(t, selBar, sg, v.split(/\s+/).filter(Boolean).map(normChord)));
onField('barLyric', (v, t, sg) => setBarLyric(t, selBar, sg, v));
onField('barNote', (v, t, sg) => setBarNote(t, selBar, sg, v));
onField('barEnding', (v, t, sg) => setBarEnding(t, selBar, sg, v));
onField('barTimes', (v, t, sg) => setRepeatTimes(t, selBar, sg, +v));
['barChords', 'barLyric', 'barNote', 'barEnding'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }));
$('barRepStart').onclick = () => { if (selBar && !isNew()) applyEdit(toggleRepeatStart(curSong().content, selBar, song())); };
$('barRepEnd').onclick = () => { if (selBar && !isNew()) applyEdit(toggleRepeatEnd(curSong().content, selBar, song())); };
$('barDel').onclick = delBar;

/* cabeçalho editável: título, artista, observação, bpm e fórmula */
function editableText(id, value, editable, fallback) {
  const el = $(id); if (document.activeElement === el) return;
  el.textContent = value || (editable ? '' : fallback);
  el.contentEditable = editable ? 'plaintext-only' : 'false';
  if (editable && el.contentEditable !== 'plaintext-only') el.contentEditable = 'true'; // navegador sem plaintext-only
  el.classList.toggle('editable', editable);
  el.hidden = !editable && !value && !fallback;
  el.dataset.orig = value;
}
function editMeta(key, value) {
  const s = curSong(); if (!s || !isAdmin()) return;
  const text = setMeta(s.content, key, value);
  if (text !== s.content) applyEdit({ text, id: selBar });
}
[['shTitle', 'title'], ['shArtist', 'artist'], ['shObs', 'notes']].forEach(([id, key]) => {
  const el = $(id);
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    else if (e.key === 'Escape') { el.textContent = el.dataset.orig || ''; el.blur(); }
  });
  el.addEventListener('blur', () => {
    if (!el.classList.contains('editable')) return;
    const v = el.textContent.replace(/\s+/g, ' ').trim();
    if (v !== (el.dataset.orig || '')) editMeta(key, v); else renderSongView();
  });
  // colar texto com formatação: só o texto
  el.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' ')); });
});
$('shBpm').addEventListener('change', () => {
  const v = $('shBpm').value.replace(/\D/g, '');
  if (v && (+v < 20 || +v > 400)) { toast('Use um andamento entre 20 e 400 bpm'); renderSongView(); return; }
  editMeta('bpm', v);
});
$('shBpm').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('shBpm').blur(); } });
$('shTime').addEventListener('change', () => editMeta('time', $('shTime').value));

/* letra diferente em cada vez que o compasso toca */
let passOpen = false;
function renderPasses(sg) {
  const box = $('barPasses');
  const plays = selBar && !isNew() ? barPlays(sg, selBar) : 0;
  $('barLyricL').textContent = plays > 1 ? 'Letra (todas as vezes)' : 'Letra neste compasso';
  box.hidden = plays < 2 || !isAdmin() && !Object.keys(barLyricPasses(sg, selBar || '')).length;
  if (box.hidden) return;
  const passes = barLyricPasses(sg, selBar);
  const open = passOpen || Object.keys(passes).length > 0;
  $('barPassToggle').textContent = open ? 'Esconder a letra de cada vez' : `Letra diferente em cada vez (toca ${plays}×)`;
  $('barPassToggle').hidden = Object.keys(passes).length > 0;
  const fields = $('barPassFields'); fields.hidden = !open;
  if (fields.contains(document.activeElement)) return;
  const n = Math.min(plays, 12);
  fields.innerHTML = Array.from({ length: n }, (_, k) => k + 1).map(p => `<label>${p}ª vez<input data-pass="${p}" autocomplete="off" value="${esc(passes[p] || '')}" placeholder="igual às outras vezes"${isAdmin() ? '' : ' disabled'}></label>`).join('');
}
$('barPassToggle').onclick = () => { passOpen = !passOpen; renderPasses(song()); if (passOpen) $('barPassFields').querySelector('input')?.focus(); };
$('barPassFields').addEventListener('change', e => {
  const i = e.target.closest('[data-pass]'); if (!i || !selBar || isNew() || !curSong()) return;
  applyEdit(setBarLyricPass(curSong().content, selBar, song(), i.value, +i.dataset.pass));
});
$('barPassFields').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-pass]')) { e.preventDefault(); e.target.blur(); } });

/* estrutura da música */
function renderStruct() {
  const s = curSong(); const list = $('structList'), bar = $('structBar');
  if (!s) { list.innerHTML = ''; bar.innerHTML = ''; return; }
  const sg = parseSong(s.content); const lens = sectionLengths(sg); const bpm = parseBpm(sg.meta.bpm);
  const bs = bpm ? barSeconds(sg.meter, bpm) : 0;
  bar.innerHTML = sg.sections.map((x, i) => lens[i] ? `<i style="flex:${lens[i]};background:${secColor(x.name, i)}"></i>` : '').join('');
  const adm = isAdmin();
  list.innerHTML = sg.sections.map((x, i) => `<li><button type="button" data-si="${i}"><span class="dot" style="background:${secColor(x.name, i)}"></span>
    <span class="nm">${esc(x.name || 'Sem nome')}${x.times ? ` ×${x.times}` : ''}</span><span class="tm">${bs ? mmss(lens[i] * bs) : `${lens[i]} comp.`}</span></button>${adm ? `<button type="button" class="secmenu" data-sedit="${i}" aria-label="Editar a seção ${esc(x.name || i + 1)}" title="Renomear, repetir, mover, duplicar ou apagar">⋯</button>` : ''}</li>`).join('')
    || '<li class="hint">Nenhuma seção ainda.</li>';
}
$('structList').addEventListener('click', e => {
  const ed = e.target.closest('[data-sedit]'); if (ed) { openSecEdit(+ed.dataset.sedit); return; }
  const b = e.target.closest('[data-si]'); if (!b) return;
  const si = +b.dataset.si; const n = song().sections[si].rows.flat().length;
  if (document.body.classList.contains('code')) setMode('visual');
  selectBar(n ? `${si}:0` : '+' + si, { scroll: true });
});
// editar a seção: nome, quantas vezes toca, mover, duplicar, apagar
let editSi = null;
function openSecEdit(si) {
  const sg = song(); const sec = sg.sections[si]; if (!sec) return;
  editSi = si; const f = $('formSecEdit');
  f.name.value = sec.name || ''; f.times.value = sec.times || 1;
  refreshSecEdit(); $('secDelConfirm').hidden = true;
  $('dlgSecEdit').showModal(); f.name.focus();
}
function refreshSecEdit() {
  const n = song().sections.length; const f = $('formSecEdit');
  f.querySelector('[data-sa=up]').disabled = editSi <= 0;
  f.querySelector('[data-sa=down]').disabled = editSi >= n - 1;
}
$('formSecEdit').addEventListener('submit', e => {
  e.preventDefault(); const f = e.target; if (editSi == null || !curSong()) return;
  let t = curSong().content; let sg = parseSong(t); const sec = sg.sections[editSi];
  const name = f.name.value.trim(); const times = Math.max(1, Math.min(99, +f.times.value || 1));
  if (name && name !== sec.name) { t = renameSection(t, sg, editSi, name); sg = parseSong(t); }
  if (times !== (sec.times || 1)) t = setSectionTimes(t, sg, editSi, times);
  $('dlgSecEdit').close();
  if (t !== curSong().content) applyEdit({ text: t, id: selBar });
});
$('formSecEdit').addEventListener('click', e => {
  const b = e.target.closest('[data-sa]'); if (!b || editSi == null || !curSong()) return;
  const t = curSong().content, sg = parseSong(t), a = b.dataset.sa;
  if (a === 'up' || a === 'down') {
    const d = a === 'up' ? -1 : 1;
    applyEdit({ text: moveSection(t, sg, editSi, d), id: null }); editSi += d; refreshSecEdit();
  } else if (a === 'dup') {
    $('dlgSecEdit').close(); applyEdit({ text: duplicateSection(t, sg, editSi), id: `${editSi + 1}:0` });
    toast('Seção duplicada');
  } else if (a === 'del') {
    $('secDelName').textContent = sg.sections[editSi]?.name || 'esta seção'; $('secDelConfirm').hidden = false;
  } else if (a === 'delok') {
    $('dlgSecEdit').close(); applyEdit({ text: deleteSection(t, sg, editSi), id: null });
    toast('Seção apagada (⌘Z / Ctrl+Z desfaz)');
  }
});

// nova seção: entra no fim da música com um compasso vazio já selecionado para receber os acordes
let pendingChord = null; // acorde digitado antes de existir qualquer seção
function openSectionDialog() {
  $('formSection').reset();
  $('secHint').hidden = !!song().sections.length;
  $('dlgSection').showModal(); $('formSection').name.focus();
}
function addSection(name) {
  name = String(name || '').trim(); if (!name || !curSong()) return;
  if (document.body.classList.contains('code')) setMode('visual');
  const text = appendSection(curSong().content, name);
  const si = parseSong(text).sections.length - 1;
  if (pendingChord) { // acordes digitados antes da seção existir entram no primeiro compasso dela
    const toks = pendingChord; pendingChord = null;
    const sg = parseSong(text); const r = setBarChords(text, `${si}:0`, sg, toks);
    applyEdit({ text: r.text, id: nextSel(sg, `${si}:0`) });
  } else applyEdit({ text, id: `${si}:0` });
  setTimeout(() => { const el = $('sheet').querySelector('.bar.sel, .addbar.sel'); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); $('chordIn')?.focus(); }, 30);
}
$('secAdd').onclick = openSectionDialog;
$('secPicks').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { $('formSection').name.value = b.textContent; $('formSection').requestSubmit(); } });
$('formSection').addEventListener('submit', e => {
  e.preventDefault();
  const name = e.target.name.value.trim(); if (!name) return;
  addSection(name); $('dlgSection').close();
});
$('dlgSection').addEventListener('close', () => { pendingChord = null; });
// música sem nenhuma seção: a folha vira o ponto de partida
$('sheet').addEventListener('click', e => {
  const b = e.target.closest('[data-newsec]'); if (!b) return;
  if (b.dataset.newsec === '?') openSectionDialog(); else addSection(b.dataset.newsec);
});

// Pauta: cada compasso com a largura que suas cifras pedem e as linhas quebrando como numa partitura.
function layoutStaff() {
  for (const row of $('sheet').querySelectorAll('.pauta .srow')) {
    const bars = [...row.children].filter(el => el.classList.contains('bar'));
    const W = row.clientWidth - (row.querySelector('.addbar') ? 0 : 0); if (!bars.length || !W) continue;
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
// Letra embaixo dos compassos: cada trecho vai só até o próximo compasso com letra (ou o fim da linha).
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
      if (maxH) L.idx.forEach(i => { bars[i].style.marginBottom = `${Math.ceil(maxH) + 8}px`; });
    }
  }
}
function fitSlots() {
  if (!$('sheet').offsetParent) return; // tela escondida: mede quando aparecer
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
  ['btnPdfSong', 'scale'].forEach(id => { $(id).disabled = !s; });
  $('scale').value = String(s?.font_scale ?? 100);
  $('cols').disabled = !sl; $('cols').value = String(sl?.cols || 4);
}
function renderAll() {
  renderEditor();
  if (document.body.dataset.view === 'song') { renderSongView(); renderPreview(); }
  else { renderShow(); }
  if (document.body.dataset.view === 'song') renderList(); // a lista também mostra o status
}

function setContent(v) {
  const s = curSong(); if (!s) return;
  sl.songs.forEach(x => { if (x.id === s.id) x.content = v; });
  if (isAdmin()) { pending.set(s.id, v); scheduleSave(); }
}
$('text').addEventListener('input', () => {
  setContent($('text').value);
  clearTimeout(pvTimer); pvTimer = setTimeout(() => { renderPreview(); renderSongView(); }, 120);
});
$('text').addEventListener('keydown', e => {
  if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, ' | '); }
});
// tom: admin muda e salva para todos; quem só vê muda só neste aparelho
function transpose(st) {
  const s = curSong(); if (!s) return;
  const v = transposeText(s.content, st);
  if (isAdmin()) { undo.push(s.content); setContent(v); }
  else { sl.songs.forEach(x => { if (x.id === s.id) x.content = v; }); if (!transpose._told) { toast('Tom mudado só no seu aparelho'); transpose._told = true; } }
  $('text').value = v; renderPreview(); renderSongView(); renderList();
}
// Caixas | Pauta: grava "formato: pauta" no cabeçalho da cifra (vale na tela, no palco e no PDF)
function setView(view) {
  const s = curSong(); if (!s || !isAdmin()) return;
  let lines = s.content.split('\n').filter(l => !/^\s*(formato|visual|visualiza[cç][aã]o|nota[cç][aã]o)\s*:/i.test(l));
  if (view === 'pauta') {
    let at = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (/^\[/.test(l) || l.includes('|')) break;
      if (/^[A-Za-zÀ-ÿçÇ]+\s*:/.test(l)) at = i + 1;
    }
    lines.splice(at, 0, 'formato: pauta');
  }
  const v = lines.join('\n');
  undo.push(s.content); setContent(v); $('text').value = v; renderPreview(); renderSongView();
}
function renderViewToggle() {
  const s = curSong(); const pauta = !!s && viewOf(parseSong(s.content)) === 'pauta';
  $('vBox').disabled = $('vStaff').disabled = !s || !isAdmin();
  $('vBox').classList.toggle('on', !!s && !pauta); $('vStaff').classList.toggle('on', pauta);
  $('cols').disabled = !sl || pauta || !isAdmin();
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
  if (!isAdmin()) return;
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
$('coverScale').innerHTML = '<option value="0">Auto (maior que cabe em 1 folha)</option>' + COVER_STEPS.map(p => `<option value="${p}">${p}%</option>`).join('');
$('coverOpts').innerHTML = COVER_OPTS.map(([k, label]) => `<label><input type="checkbox" data-k="${k}"> ${label}</label>`).join('');
function fillCoverPanel() {
  const layout = sl.cover_layout || 'detalhada', o = coverOpts(sl.cover_opts);
  $('coverLayout').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === layout));
  $('coverScale').value = String(sl.cover_scale || 0);
  $('coverOpts').querySelectorAll('input').forEach(i => { i.checked = o[i.dataset.k]; });
  const r = resolveCoverScale(sl, sl.songs.map(s => s.content));
  $('coverFit').textContent = sl.cover_scale ? `Tamanho fixo em ${r.pct}%.` : `Automático: usando ${r.pct}%${r.pages ? ', em 1 folha' : ' (não coube em 1 folha)'}.`;
  $('coverPanel').querySelectorAll('button, select, input').forEach(el => { el.disabled = !isAdmin(); });
}
let coverSaveTimer = null;
function changeCover(patch) {
  if (!sl || !isAdmin()) return;
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
const stepCover = d => {
  const c = sl.cover_scale || resolveCoverScale(sl, sl.songs.map(s => s.content)).pct;
  const i = Math.max(0, Math.min(COVER_STEPS.length - 1, COVER_STEPS.indexOf(c) + d));
  changeCover({ cover_scale: COVER_STEPS[i] });
};
$('coverSmaller').onclick = () => stepCover(1);
$('coverBigger').onclick = () => stepCover(-1);
$('coverOpts').addEventListener('change', e => {
  const k = e.target.dataset.k; if (!k) return;
  changeCover({ cover_opts: { ...coverOpts(sl.cover_opts), [k]: e.target.checked } });
});
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
$('btnPdfSetlist').onclick = () => {
  if (!sl || !sl.songs.length) return;
  const make = () => openViewer(buildPdf({ setlist: sl, songs: sl.songs, cols: sl.cols, coverOnly: true }),
    slug(sl.name) + '-setlist.pdf', `${sl.name} — folha do setlist`, { cover: true, remake: () => make() });
  make();
};

/* ---------------- contas e bandas ---------------- */
let authMode = 'login', resetToken = null, canReset = false, confirmToken = null;
const AUTH_TEXT = {
  login:    { title: 'Entrar', sub: 'Bem-vindo de volta! Entre para ver o repertório da sua banda.', btn: 'Entrar', busy: 'Entrando…', sw: ['Ainda não tem conta?', 'Criar conta'] },
  register: { title: 'Criar conta', sub: 'Leva menos de um minuto. Quem só vai tocar não precisa de conta: basta o link do show.', btn: 'Criar conta', busy: 'Criando conta…', sw: ['Já tem conta?', 'Entrar'] },
  forgot:   { title: 'Esqueci minha senha', sub: 'Informe o e-mail da sua conta e enviamos um link para criar uma senha nova.', btn: 'Enviar link', busy: 'Enviando…', sw: ['Lembrou a senha?', 'Entrar'] },
  reset:    { title: 'Criar nova senha', sub: 'Escolha a senha nova. Depois disso você já entra na sua conta.', btn: 'Salvar senha e entrar', busy: 'Salvando…', sw: ['Não precisa mais?', 'Entrar'] },
};
function showAuth() {
  $('authScreen').hidden = false; $('authErr').hidden = true;
  $('authForm').password.value = '';
  setTimeout(() => setAuthMode(authMode), 0);
}
function setAuthMode(m) {
  authMode = m; const reg = m === 'register', t = AUTH_TEXT[m];
  $('authNameL').hidden = !reg; $('pwHint').hidden = !(reg || m === 'reset');
  $('authEmailL').hidden = m === 'reset'; $('authPwL').hidden = m === 'forgot';
  $('forgotRow').hidden = !(m === 'login' && canReset);
  $('authErr').hidden = true; $('authOk').hidden = true; $('resendRow').hidden = true;
  $('authTitle').textContent = t.title; $('authSub').textContent = t.sub; $('authSubmit').textContent = t.btn;
  $('authSwitchText').textContent = t.sw[0]; $('authSwitch').textContent = t.sw[1];
  $('authPwLabel').textContent = m === 'reset' ? 'Senha nova' : 'Senha';
  const pw = $('authForm').password;
  pw.autocomplete = reg || m === 'reset' ? 'new-password' : 'current-password';
  pw.placeholder = reg ? 'Crie uma senha' : m === 'reset' ? 'Pelo menos 6 caracteres' : 'Sua senha';
  $('authForm')[reg ? 'name' : m === 'reset' ? 'password' : 'email'].focus();
}
$('authSwitch').onclick = () => setAuthMode(authMode === 'login' ? 'register' : 'login');
$('forgotLink').onclick = () => setAuthMode('forgot');
$('pwToggle').onclick = () => {
  const i = $('authForm').password, show = i.type === 'password';
  i.type = show ? 'text' : 'password'; $('pwToggle').textContent = show ? 'Ocultar' : 'Mostrar';
  $('pwToggle').setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
};
$('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target; const err = $('authErr'); err.hidden = true; $('authOk').hidden = true; $('resendRow').hidden = true;
  const m = authMode, reg = m === 'register', newPw = reg || m === 'reset';
  const bad = (reg && !f.name.value.trim() && 'Informe seu nome')
    || (m !== 'reset' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.value.trim()) && 'Informe um e-mail válido')
    || (m !== 'forgot' && f.password.value.length < (newPw ? 6 : 1) && (newPw ? 'A senha precisa ter pelo menos 6 caracteres' : 'Informe a senha'));
  [f.name, f.email, f.password].forEach(i => i.removeAttribute('aria-invalid'));
  if (bad) {
    err.textContent = bad; err.hidden = false;
    const field = bad.includes('nome') ? f.name : bad.includes('mail') ? f.email : f.password;
    field.setAttribute('aria-invalid', 'true'); field.focus(); return;
  }
  const btn = $('authSubmit');
  btn.disabled = true; btn.textContent = AUTH_TEXT[m].busy;
  try {
    if (m === 'forgot') {
      const r = await api('POST', '/auth/forgot', { email: f.email.value.trim() });
      $('authOk').textContent = 'Pronto! Se existir uma conta com esse e-mail, o link para criar a senha nova chega em instantes. Confira também o spam.';
      $('authOk').hidden = false;
      if (r.devLink) console.info('[dev] link de redefinição:', r.devLink);
      return;
    }
    const r = m === 'reset'
      ? await api('POST', '/auth/reset', { token: resetToken, password: f.password.value })
      : await api('POST', reg ? '/auth/register' : '/auth/login', { email: f.email.value.trim(), password: f.password.value, ...(reg ? { name: f.name.value.trim() } : {}) });
    if (r.pending) {
      const email = r.email; setAuthMode('login'); f.email.value = email; f.password.value = '';
      showPending(email, 'Conta criada! Enviamos um link de confirmação para ' + email + '. Abra o e-mail e clique em "Confirmar meu e-mail" para entrar.');
      if (r.devLink) console.info('[dev] link de confirmação:', r.devLink);
      return;
    }
    if (m === 'reset') { resetToken = null; authMode = 'login'; toast('Senha alterada. Bem-vindo de volta!'); }
    setToken(r.token); $('authScreen').hidden = true; f.reset();
    await start();
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false;
    if (ex.code === 'unverified') { pendingEmail = f.email.value.trim(); $('resendRow').hidden = false; }
  }
  finally { btn.disabled = false; btn.textContent = AUTH_TEXT[authMode].btn; }
});

let pendingEmail = null;
function showPending(email, text) {
  pendingEmail = email;
  $('authOk').textContent = text; $('authOk').hidden = false; $('resendRow').hidden = false; $('authErr').hidden = true;
}
$('resendBtn').onclick = async () => {
  const email = pendingEmail || $('authForm').email.value.trim();
  if (!email) return;
  $('resendBtn').disabled = true;
  try {
    const r = await api('POST', '/auth/resend', { email });
    showPending(email, 'Enviamos um novo link para ' + email + '. Confira também a caixa de spam.');
    if (r.devLink) console.info('[dev] link de confirmação:', r.devLink);
  } catch (ex) { $('authErr').textContent = ex.message; $('authErr').hidden = false; }
  finally { setTimeout(() => { $('resendBtn').disabled = false; }, 15000); }
};
async function confirmFromLink(t) {
  try {
    const r = await api('POST', '/auth/verify', { token: t });
    setToken(r.token); $('authScreen').hidden = true;
    toast('E-mail confirmado. Bem-vindo ao Tectune!', 4000);
    await start();
  } catch (ex) {
    authMode = 'login'; showAuth();
    setTimeout(() => {
      $('authErr').textContent = ex.message; $('authErr').hidden = false;
      if (ex.code === 'link_expired') $('resendRow').hidden = false;
    }, 50);
  }
}

// links que chegam por e-mail: ?redefinir=<token> (senha nova) e ?cadastro=<email> (convite)
(function linksDoEmail() {
  if (GUEST) return;
  const q = new URLSearchParams(location.search);
  const r = q.get('redefinir'), c = q.get('cadastro'), f = q.has('esqueci'), v = q.get('confirmar');
  if (v) { setToken(null); confirmToken = v; }
  else if (r) { resetToken = r; authMode = 'reset'; setToken(null); }
  else if (c && !token) { authMode = 'register'; $('authForm').email.value = c; }
  else if (f && !token) authMode = 'forgot';
  if (r || c || f || v) history.replaceState(null, '', location.pathname);
})();
if (!GUEST) api('GET', '/auth/options').then(o => { canReset = !!o.passwordReset; if (authMode === 'login' && !$('authScreen').hidden) $('forgotRow').hidden = !canReset; }).catch(() => {});

async function logout() {
  try { await api('POST', '/auth/logout'); } catch (e) { /* já saiu */ }
  setToken(null); me = null; live.set({ role: 'off' }); $('dlgBand').close(); $('dlgAccount').close();
  navigator.serviceWorker?.controller?.postMessage({ t: 'logout' }); // apaga o repertório guardado para uso offline
  setlists = []; sl = null; cur = -1; showAuth();
}
$('logoutBtn').onclick = logout;

const inviteHTML = i => `<div class="invite" data-inv="${i.id}"><span><b>${esc(i.invited_by || 'Alguém')}</b> convidou você para a banda <b>${esc(i.band_name)}</b></span>
  <button data-act="decline" class="ghost">Recusar</button><button data-act="accept" class="accent">Entrar na banda</button></div>`;
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
$('inviteBar').addEventListener('click', answerInvite);
/** Entra na banda ativa. Toda conta tem ao menos a banda padrão ("<Nome>'s band"), criada pelo servidor. */
async function enterBand() {
  if (!me.bands.length) { // segurança: servidor antigo ou corrida — cria a banda padrão daqui
    const first = (me.user.name || '').trim().split(/\s+/)[0] || 'Minha';
    me = await api('POST', '/bands', { name: `${first}'s band` });
  }
  if (!me.bands.some(b => b.id === bandId)) bandId = me.bands[0].id;
  try { localStorage.setItem(BAND_KEY, bandId); } catch (e) {}
  const band = me.bands.find(b => b.id === bandId);
  const admin = band.role === 'admin';
  document.body.classList.toggle('readonly', !admin); document.body.classList.toggle('isadmin', admin);
  $('text').readOnly = !admin;
  $('acctBtn').textContent = $('acctRailAv').textContent = $('acctAv').textContent = initials(me.user.name);
  $('acctName').textContent = me.user.name; $('acctEmail').textContent = me.user.email;
  $('acctBandName').textContent = band.name + (admin ? ' · admin' : ' · membro');
  if (!live.name) live.name = me.user.name;
  $('bandSelect').innerHTML = me.bands.map(b => `<option value="${b.id}">${esc(b.name)}${b.role === 'admin' ? '' : ' (membro)'}</option>`).join('');
  $('bandSelect').value = bandId;
  $('bandSelect').closest('.pick').hidden = me.bands.length < 2; // uma banda só: nada para escolher
  $('inviteBar').hidden = !me.invites.length; $('inviteBar').innerHTML = me.invites.map(inviteHTML).join('');
  live.set({ role: 'off' }); renderLive();
  bandInfo = null; loadBandInfo();
  await loadSetlists();
  updateStatus();
  maybeTour();
}
$('bandSelect').addEventListener('change', async e => {
  await flush(); bandId = e.target.value; sl = null; setlists = [];
  try { localStorage.removeItem(LAST_KEY); } catch (ex) {}
  enterBand().catch(err => toast(err.message));
});

/* diálogo da banda: nome, membros, convites, conta */
function renderBandDialog() {
  const b = bandInfo; const admin = b.role === 'admin';
  const f = $('bandNameForm'); f.name.value = b.name; f.name.readOnly = !admin;
  $('bandMembers').innerHTML = b.members.map(m => `<li data-uid="${m.id}"><span class="who"><b>${esc(m.name)}</b>${m.id === me.user.id ? ' (você)' : ''}<small>${esc(m.email)}</small></span>
    <span class="role ${m.role}">${m.role === 'admin' ? 'Admin' : 'Membro'}</span>
    ${admin ? `<button data-act="role" data-role="${m.role === 'admin' ? 'membro' : 'admin'}" class="ghost">${m.role === 'admin' ? 'Tornar membro' : 'Tornar admin'}</button>
    ${m.id === me.user.id ? '' : '<button data-act="rm" class="ghost" title="Tirar da banda">✕</button>'}` : ''}</li>`).join('');
  $('bandInvites').innerHTML = b.invites.map(i => `<li data-inv="${i.id}"><span class="who"><b>${esc(i.name)}</b> · convite pendente<small>${esc(i.email)}</small></span>
    <button data-act="cancel" class="ghost">Cancelar convite</button></li>`).join('');
}
async function openBandDialog() {
  try { bandInfo = await api('GET', '/bands/' + bandId); renderBandDialog(); renderBand(); $('dlgBand').showModal(); }
  catch (e) { toast(e.message); }
}
$('bandBtn').onclick = openBandDialog;
function openAccount() { renderInstall(); $('dlgAccount').showModal(); }
$('acctBtn').onclick = openAccount; $('acctRail').onclick = openAccount;
$('acctBand').onclick = () => { $('dlgAccount').close(); openBandDialog(); };
$('acctTour').onclick = () => { $('dlgAccount').close(); openTour(); };
$('acctInstall').onclick = () => { $('dlgAccount').close(); doInstall(); };
async function refreshMe() { me = await api('GET', '/me'); }
$('bandNameForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { bandInfo = await api('PATCH', '/bands/' + bandId, { name: e.target.name.value.trim() }); renderBandDialog(); await refreshMe(); await enterBand(); toast('Nome salvo'); }
  catch (ex) { toast(ex.message); }
});
$('inviteForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { bandInfo = await api('POST', `/bands/${bandId}/invites`, { email: e.target.email.value.trim() }); e.target.reset(); renderBandDialog(); toast(bandInfo.message || 'Convite enviado', 4500); }
  catch (ex) { toast(ex.message, 4500); }
});
$('bandMembers').addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const uid = b.closest('li').dataset.uid;
  try {
    if (b.dataset.act === 'role') bandInfo = await api('PATCH', `/bands/${bandId}/members/${uid}`, { role: b.dataset.role });
    else bandInfo = await api('DELETE', `/bands/${bandId}/members/${uid}`);
    renderBandDialog(); renderBand();
    if (uid === me.user.id) { await refreshMe(); await enterBand(); }
  } catch (ex) { toast(ex.message, 4500); }
});
$('bandInvites').addEventListener('click', async e => {
  const b = e.target.closest('button[data-act="cancel"]'); if (!b) return;
  try { bandInfo = await api('DELETE', `/bands/${bandId}/invites/${b.closest('li').dataset.inv}`); renderBandDialog(); }
  catch (ex) { toast(ex.message); }
});
$('leaveBand').onclick = async () => {
  const b = $('leaveBand');
  if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Confirmar: sair desta banda'; return; }
  b.classList.remove('armed'); b.textContent = 'Sair desta banda';
  try { me = await api('DELETE', `/bands/${bandId}/members/${me.user.id}`); $('dlgBand').close(); bandId = null; await enterBand(); toast('Você saiu da banda'); }
  catch (ex) { toast(ex.message, 5000); }
};
$('newBandForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { const r = await api('POST', '/bands', { name: e.target.name.value.trim() }); me = r; bandId = r.id; e.target.reset(); $('dlgBand').close(); await enterBand(); toast('Banda criada — você é o admin'); }
  catch (ex) { toast(ex.message); }
});

// virou o aparelho / redimensionou: refaz a folha na largura nova
let resizeT; addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (sl && document.body.dataset.view === 'song') renderPreview(); }, 150); });

/* ---------------- entrada pelo link do show ---------------- */
const INST_HINT = {
  voz: 'No palco você vê a letra grande, na ordem em que a música é tocada.',
  harmonia: 'Acordes grandes no compasso. Dá para mudar o tom só no seu aparelho.',
  baixo: 'Acordes com a nota do baixo em destaque (em Ab/C, o C).',
  teclado: 'Acordes no compasso e as frases escritas na pauta, quando houver.',
  bateria: 'Estrutura, repetições e anotações em destaque; acordes mais discretos.',
  outro: 'A cifra completa, do jeito que foi escrita.',
};
let guestInst = null;
function pickInst(v) {
  guestInst = v;
  $('instGrid').querySelectorAll('button').forEach(b => { const on = b.dataset.inst === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  $('instHint').textContent = INST_HINT[v] || '';
}
$('instGrid').addEventListener('click', e => { const b = e.target.closest('[data-inst]'); if (b) pickInst(b.dataset.inst); });
function enterAsGuest(name, inst) {
  try { localStorage.setItem(NAME_KEY, name); localStorage.setItem(INST_KEY, inst); } catch (e) {}
  document.body.classList.forEach(c => { if (c.startsWith('inst-')) document.body.classList.remove(c); });
  document.body.classList.add('inst-' + inst);
  showView = inst === 'voz' ? 'cantor' : 'musico';
  live.name = name; live.inst = inst;
  $('joinScreen').hidden = true;
  go('show');
  // já entra seguindo: quando quem conduz der o play, o palco abre sozinho
  live.set({ role: 'seguir', room: sl.id, name, view: showView });
  renderLive();
}
$('joinForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = e.target.name.value.trim();
  if (!guestInst) { $('joinErr').textContent = 'Escolha o que você toca'; $('joinErr').hidden = false; return; }
  if (!name) { $('joinErr').textContent = 'Diga seu nome para a banda saber quem entrou'; $('joinErr').hidden = false; e.target.name.focus(); return; }
  $('joinErr').hidden = true;
  enterAsGuest(name, guestInst);
});
async function startGuest() {
  document.body.classList.add('guest', 'readonly');
  $('text').readOnly = true;
  $('goLive').hidden = true; $('goFollow').textContent = 'Abrir o palco';
  $('liveHint').textContent = 'Quando quem conduz der o play, a música abre sozinha aqui, no mesmo compasso.';
  live.share = GUEST;
  updateStatus();
  try {
    sl = await api('GET', '/public/shows/' + GUEST);
  } catch (err) {
    $('joinScreen').hidden = false; $('joinForm').querySelectorAll('fieldset, .field, button[type=submit], .joincard').forEach(el => { el.hidden = true; });
    $('joinWho').textContent = err.status === 404 ? 'Este link não existe mais ou foi desligado. Peça um link novo para quem montou o show.' : 'Não consegui abrir o show. Confira a internet e tente de novo.';
    return;
  }
  sl.share_token = GUEST; setlists = [sl]; cur = sl.songs.length ? 0 : -1;
  renderSelect();
  let total = 0; for (const s of sl.songs) total += songSecs(parseSong(s.content)) || 0;
  $('joinWho').textContent = `${sl.band_name} te chamou para tocar`;
  $('joinTitle').textContent = sl.name;
  $('joinWhen').textContent = [longDate(sl.event_date), sl.venue].filter(Boolean).join(' · ');
  $('joinCount').textContent = `${sl.songs.length} ${sl.songs.length === 1 ? 'música' : 'músicas'}${total ? ` · ${Math.round(total / 60)} min` : ''}`;
  let name = '', inst = '';
  try { name = localStorage.getItem(NAME_KEY) || ''; inst = localStorage.getItem(INST_KEY) || ''; } catch (e) {}
  $('joinForm').name.value = name;
  if (inst) pickInst(inst);
  renderAll();
  $('joinScreen').hidden = false;
}

/* ---------------- tutorial (primeiro acesso) ---------------- */
const TOUR = [
  { t: 'Bem-vindo ao Tectune', b: () => `Sua banda já está pronta: <b>${esc(me?.bands.find(x => x.id === bandId)?.name || 'sua banda')}</b>. Use para tocar com a banda ou para estudar sozinho. Dá para renomear, convidar gente ou criar outras bandas quando quiser.`, art: 'hello' },
  { t: 'Monte o show', b: () => 'Um show é a lista de músicas de um ensaio, de uma apresentação ou do seu estudo. Adicione músicas, reordene com as setas e veja a <b>curva de energia</b> do repertório.', art: 'show' },
  { t: 'Cifre tocando, não digitando', b: () => 'Na cifra, toque num compasso e depois num acorde da barra de baixo: ela já mostra os acordes do tom. Se preferir o teclado, digite o acorde: <b>Enter</b> põe e avança, <b>espaço</b> divide o compasso.', art: 'edit' },
  { t: 'Mande um link para a banda', b: () => 'Em <b>Chame a banda</b>, crie o link do show e mande pelo WhatsApp ou mostre o QR. Cada músico abre no celular, escolhe o instrumento e pronto: sem baixar app, sem criar conta.', art: 'share' },
  { t: 'Toque junto, no mesmo compasso', b: () => 'Toque em <b>Começar o show ao vivo</b> e dê o play: quem abriu o link vê a música descer junto com você, na visão de acordes ou de letra. No palco, a tela não apaga.', art: 'live' },
];
const TOUR_ART = {
  hello: '<div class="ta-logo"><b></b><b></b><b></b><b></b></div>',
  show: '<div class="ta-rows"><i><s>1</s><em>Velha Infância</em><u>G</u></i><i class="on"><s>2</s><em>Running Up That Hill</em><u>Bbm</u></i><i><s>3</s><em>Garota de Ipanema</em><u>F</u></i><div class="ta-curve"><span style="height:40%"></span><span style="height:70%" class="on"></span><span style="height:90%"></span><span style="height:55%"></span></div></div>',
  edit: '<div class="ta-edit"><div class="ta-bars"><span>G</span><span class="on">Em</span><span>C</span><span>D</span></div><div class="ta-chips"><span><small>I</small>G</span><span><small>ii</small>Am</span><span class="on"><small>vi</small>Em</span><span><small>IV</small>C</span></div></div>',
  share: '<div class="ta-share"><div class="ta-qr"></div><div class="ta-link">tectune.com.br/s/…</div><div class="ta-avs"><span style="background:#3DD6B5">JU</span><span style="background:#8FA8FF">RA</span><span style="background:#F2C14E">BI</span></div></div>',
  live: '<div class="ta-live"><small>AGORA</small><b>Gb</b><div class="ta-beats"><i class="on"></i><i class="on"></i><i></i><i></i></div></div>',
};
let tourAt = 0;
function renderTour() {
  const st = TOUR[tourAt];
  $('tourStep').textContent = `${tourAt + 1} de ${TOUR.length}`;
  $('tourTitle').textContent = st.t; $('tourBody').innerHTML = st.b();
  $('tourArt').innerHTML = TOUR_ART[st.art];
  $('tourDots').innerHTML = TOUR.map((_, i) => `<i class="${i === tourAt ? 'on' : ''}"></i>`).join('');
  $('tourBack').style.visibility = tourAt ? 'visible' : 'hidden';
  const last = tourAt === TOUR.length - 1;
  $('tourNext').textContent = last ? (setlists.length || !isAdmin() ? 'Começar' : 'Criar meu primeiro show') : 'Próximo';
  $('tourSkip').hidden = last;
}
function openTour() { tourAt = 0; renderTour(); $('dlgTour').showModal(); }
const tourKey = () => 'tectune-tutorial-' + (me?.user?.id || '');
function finishTour() { try { localStorage.setItem(tourKey(), '1'); } catch (e) {} $('dlgTour').close(); }
function maybeTour() { let seen = false; try { seen = localStorage.getItem(tourKey()) === '1'; } catch (e) {} if (!seen) openTour(); }
$('tourNext').onclick = () => {
  if (tourAt < TOUR.length - 1) { tourAt++; renderTour(); return; }
  finishTour();
  if (!setlists.length && isAdmin()) openSetlistDialog('new');
};
$('tourBack').onclick = () => { if (tourAt) { tourAt--; renderTour(); } };
$('tourSkip').onclick = finishTour;
$('dlgTour').addEventListener('cancel', () => { try { localStorage.setItem(tourKey(), '1'); } catch (e) {} });
// deslizar para os lados no celular
let tourX = null;
$('dlgTour').addEventListener('touchstart', e => { tourX = e.touches[0].clientX; }, { passive: true });
$('dlgTour').addEventListener('touchend', e => {
  if (tourX == null) return; const dx = e.changedTouches[0].clientX - tourX; tourX = null;
  if (dx < -50 && tourAt < TOUR.length - 1) { tourAt++; renderTour(); } else if (dx > 50 && tourAt) { tourAt--; renderTour(); }
});

/* ---------------- PWA: instalar, offline e tela acesa ---------------- */
// quem instala pelo link do show abre direto no show (manifest próprio do link)
if (GUEST) $('manifestLink').href = `/s/${GUEST}/manifest.webmanifest`;
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const INSTALL_KEY = 'tectune-instalar-depois';
let installEvt = null;
function renderInstall() {
  const can = !standalone() && (!!installEvt || isIOS);
  let later = false; try { later = localStorage.getItem(INSTALL_KEY) === '1'; } catch (e) {}
  $('installBtn').hidden = !can; $('installBar').hidden = !can || later; $('acctInstall').hidden = !can;
}
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; renderInstall(); });
addEventListener('appinstalled', () => { installEvt = null; renderInstall(); toast('Tectune instalado'); });
async function doInstall() {
  if (installEvt) { installEvt.prompt(); await installEvt.userChoice.catch(() => null); installEvt = null; renderInstall(); }
  else if (isIOS) $('dlgInstall').showModal();
}
$('installBtn').onclick = doInstall; $('installGo').onclick = doInstall;
$('installDismiss').onclick = () => { try { localStorage.setItem(INSTALL_KEY, '1'); } catch (e) {} renderInstall(); };
renderInstall();
// sem internet: continua mostrando o que já foi aberto; as alterações esperam a conexão voltar
addEventListener('online', () => { updateStatus(); toast('Conexão de volta'); if (pending.size) flush(); });
addEventListener('offline', () => { updateStatus(); toast('Sem internet: os shows já abertos continuam aqui'); });
// tela acesa durante o palco (Screen Wake Lock)
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { /* sem suporte ou aba em segundo plano */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && isPalco()) keepAwake(true); });

/* ---------------- início ---------------- */
try { setMode(localStorage.getItem(MODE_KEY) === 'code' ? 'code' : 'visual'); } catch (e) { setMode('visual'); }
async function start() {
  if (GUEST) return startGuest();
  if (confirmToken) { const t = confirmToken; confirmToken = null; return confirmFromLink(t); }
  if (!token) { showAuth(); return; }
  me = await api('GET', '/me');
  await enterBand();
}
go('show');
start().catch(err => {
  if (!token) return;
  $('status').className = 'status err'; $('status').lastChild.textContent = 'Sem conexão';
  toast(err.message, 5000);
});
