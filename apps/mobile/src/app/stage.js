// Modo Show: tela cheia, sem editor. Navega pelas músicas da setlist e dá o play no BPM.
// Visões: Músico (cifra) ou Cantor (só a letra). Ao vivo: o diretor musical dá o play e
// os aparelhos da banda que estão "seguindo" rolam junto. Para sair é preciso confirmar.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { songCols, parseSong, buildTimeline, barSeconds, pulseInfo, parseBpm, transposeText, viewOf, lyricEvents } from '@tectune/core';
import { useData } from '../lib/store';
import { getDb, kvGet, kvSet } from '../lib/db';
import { useLive } from '../lib/live';
import Sheet from '../components/Sheet';
import Lyrics, { currentEvent } from '../components/Lyrics';
import { Button, Chip, Empty } from '../components/ui';
import { C } from '../lib/theme';

const now = () => (globalThis.performance?.now ? performance.now() : Date.now()) / 1000;
const RATES = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25];
const pref = (key, set, ok) => getDb().then(db => kvGet(db, key)).then(v => { if (v != null && (!ok || ok(v))) set(v); }).catch(() => {});
const savePref = (key, v) => getDb().then(db => kvSet(db, key, v)).catch(() => {});

export default function Show() {
  useKeepAwake(); // tela sempre acesa no show
  const { setlist: slId, i } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setlists, songs, updateSong, serverUrl, readonly, account } = useData();
  const sl = setlists.find(s => s.id === slId);
  const ids = sl?.song_ids || [];
  const [idx, setIdx] = useState(() => Math.max(0, Math.min(Number(i) || 0, ids.length - 1)));
  const song = songs[ids[idx]];

  const parsed = useMemo(() => parseSong(song?.content || ''), [song?.content]);
  const timeline = useMemo(() => buildTimeline(parsed), [parsed]);
  const events = useMemo(() => lyricEvents(parsed, timeline), [parsed, timeline]);
  const occ = useMemo(() => {
    const first = {}, last = {};
    timeline.forEach((s, k) => { if (!(s.id in first)) first[s.id] = k; last[s.id] = k; });
    return { first, last };
  }, [timeline]);
  const meter = parsed.meter;
  const pulse = pulseInfo(meter);
  const songBpm = parseBpm(parsed.meta.bpm);

  // preferências do aparelho: visão, contagem, ao vivo
  const [view, setView] = useState('musico'); // musico | cantor
  const [countIn, setCountIn] = useState(true);
  const [role, setRole] = useState('off');    // off | diretor | seguir
  const [name, setName] = useState('');
  useEffect(() => {
    pref('showView', setView, v => v === 'musico' || v === 'cantor');
    pref('countIn', v => setCountIn(v !== 'off'));
    pref('liveName', setName);
  }, []);
  const chooseView = v => { setView(v); savePref('showView', v); };
  const toggleCountIn = () => setCountIn(v => { savePref('countIn', !v ? 'on' : 'off'); return !v; });

  // ao vivo
  const live = useLive({ server: serverUrl, room: sl?.id, role, name: name || account.user?.name || '', view, token: account.token });
  const director = live.peers?.director;
  const following = role === 'seguir' && !!director && !live.isDirector; // há um diretor comandando
  const remote = following ? live.remote : null;

  const [bpm, setBpm] = useState(songBpm || 90);
  const [rateIdx, setRateIdx] = useState(RATES.indexOf(1));
  const rate = RATES[rateIdx];
  const [remoteBarSec, setRemoteBarSec] = useState(null);
  const barSec = following && remoteBarSec ? remoteBarSec : barSeconds(meter, bpm * rate);

  const [mode, setMode] = useState('stopped'); // stopped | count | playing | paused | done
  const [pos, setPos] = useState(0);            // posição no roteiro, em compassos (fracionário)
  const [cursor, setCursor] = useState(0);      // passo de onde o play começa
  const [countBeat, setCountBeat] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [colsPref, setColsPref] = useState(null);
  const [seekTick, setSeekTick] = useState(0);  // avisa a banda de um salto durante o play
  const [panel, setPanel] = useState(null);     // null | 'live' | 'exit'
  const clock = useRef({ t0: 0, base: 0 });
  const barSecRef = useRef(barSec);
  const cursorRef = useRef(0);
  const pendingRemote = useRef(null);

  // layout (para rolar até a linha atual)
  const scrollRef = useRef(null);
  const rowsRef = useRef({});
  const linesRef = useRef({});
  const [sheetY, setSheetY] = useState(0);
  const [viewH, setViewH] = useState(600);
  const [width, setWidth] = useState(0);

  // sair do show só confirmando (botão voltar do Android também pergunta)
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setPanel('exit'); return true; });
    return () => sub.remove();
  }, []);

  // segue o estado que o diretor mandou
  const applyRemote = useCallback(r => {
    const lag = Math.max(0, (live.serverNow() - r.t0) / 1000);
    barSecRef.current = r.barSec; setRemoteBarSec(r.barSec);
    clock.current = { t0: now() - lag, base: r.base };
    setCursor(r.cursor || 0); cursorRef.current = r.mode === 'count' ? r.base : (r.cursor || 0);
    if (r.mode === 'playing') { setPos(r.base + lag / r.barSec); setMode('playing'); }
    else if (r.mode === 'count') { setPos(r.base); setCountBeat(1); setMode('count'); }
    else { setPos(r.pos ?? r.base); setMode(r.mode); }
  }, [live]);

  // troca de música → volta ao início
  useEffect(() => {
    setMode('stopped'); setPos(0); setCursor(0); cursorRef.current = 0;
    setBpm(songBpm || 90);
    rowsRef.current = {}; linesRef.current = {};
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    if (pendingRemote.current) { const r = pendingRemote.current; pendingRemote.current = null; applyRemote(r); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, song?.id]);
  useEffect(() => { if (mode === 'stopped') setBpm(songBpm || 90); }, [songBpm]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!remote) return;
    let k = ids.indexOf(remote.songId);
    if (k < 0) k = remote.songIdx;
    if (k >= 0 && k < ids.length && k !== idx) { pendingRemote.current = remote; setIdx(k); return; }
    applyRemote(remote);
  }, [remote]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!following) setRemoteBarSec(null); }, [following]);

  // mudança de andamento durante o play: mantém a posição atual
  useEffect(() => {
    const c = clock.current;
    if (mode === 'playing') { const t = now(); c.base += (t - c.t0) / barSecRef.current; c.t0 = t; }
    barSecRef.current = barSec;
  }, [barSec]); // eslint-disable-line react-hooks/exhaustive-deps

  // diretor: manda o estado para a banda a cada mudança
  useEffect(() => {
    if (role !== 'diretor' || live.status !== 'on') return;
    const c = clock.current;
    const toServer = lt => live.serverNow() - (now() - lt) * 1000;
    live.send({
      songIdx: idx, songId: song?.id, mode, base: c.base, t0: toServer(c.t0), barSec: barSecRef.current,
      bpm: Math.round(bpm * rate), cursor, pos,
    });
  }, [role, live.status, live.peers?.count, idx, song?.id, mode, seekTick, barSec, cursor]); // eslint-disable-line react-hooks/exhaustive-deps

  // relógio
  useEffect(() => {
    if (mode !== 'count' && mode !== 'playing') return undefined;
    let raf, last = 0, stopped = false;
    const tick = () => {
      if (stopped) return;
      const t = now(), c = clock.current, bs = barSecRef.current;
      if (mode === 'count') {
        const el = t - c.t0;
        if (el >= bs) { c.t0 = c.t0 + bs; c.base = cursorRef.current; setMode('playing'); return; }
        setCountBeat(Math.floor(el / (bs / pulse.pulses)) + 1);
      } else {
        const p = c.base + (t - c.t0) / bs;
        if (p >= timeline.length) { setPos(timeline.length); setMode('done'); return; }
        if (t - last > 0.033) { last = t; setPos(p); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, [mode, timeline.length, pulse.pulses]);

  const play = useCallback(() => {
    if (!timeline.length || following) return;
    if (mode === 'paused') { clock.current = { t0: now(), base: pos }; setMode('playing'); return; }
    const start = mode === 'done' ? 0 : cursor;
    cursorRef.current = start; setPos(start); setCountBeat(1);
    clock.current = { t0: now(), base: start };
    setMode(countIn ? 'count' : 'playing'); // sem contagem: começa direto
  }, [mode, pos, cursor, timeline.length, countIn, following]);
  const pause = useCallback(() => {
    if (following) return;
    const c = clock.current;
    if (mode === 'playing') setPos(c.base + (now() - c.t0) / barSecRef.current);
    setMode(mode === 'count' ? 'stopped' : 'paused');
  }, [mode, following]);
  const stop = useCallback(() => { if (!following) { setMode('stopped'); setPos(cursor); } }, [cursor, following]);

  // tocar num compasso (ou numa linha da letra) começa dali; durante o play, salta sem parar
  const seekTo = useCallback(k => {
    if (following || k < 0 || k >= timeline.length) return;
    if (mode === 'playing') { clock.current = { t0: now(), base: k }; setPos(k); setSeekTick(x => x + 1); return; }
    setCursor(k); cursorRef.current = k; setPos(k);
    if (mode === 'done') setMode('stopped');
  }, [following, timeline.length, mode]);
  const onBarPress = useCallback(id => {
    if (!(id in occ.first)) return;
    const cur = Math.floor(pos);
    let k = timeline.findIndex((s, j) => j >= cur && s.id === id);
    if (k < 0) k = occ.first[id];
    seekTo(k);
  }, [occ, pos, timeline, seekTo]);

  const goSong = d => { if (following) return; const n = idx + d; if (n >= 0 && n < ids.length) setIdx(n); };
  // muda o tom sem parar a música (altera e salva a cifra; sincroniza depois)
  const transposeSong = d => { if (song && !following && !readonly) updateSong(song.id, { content: transposeText(song.content, d) }); };

  // estado visual
  const live2 = mode === 'playing' || mode === 'paused';
  const step = Math.max(0, Math.min(timeline.length - 1, Math.floor(pos)));
  const activeId = live2 ? timeline[step]?.id : mode === 'count' ? timeline[cursor]?.id : null;
  const cursorId = mode === 'stopped' || mode === 'done' ? timeline[cursor]?.id : null;
  const progress = live2 ? pos - Math.floor(pos) : mode === 'count' ? 0 : null;
  const playedIds = useMemo(() => {
    if (mode === 'done') return new Set(timeline.map(s => s.id));
    if (!live2) return null;
    const set = new Set();
    for (const [id, k] of Object.entries(occ.last)) if (k < step) set.add(id);
    return set;
  }, [live2, mode, step, occ, timeline]);
  const curEvent = currentEvent(events, live2 || mode === 'done' ? step : mode === 'count' ? cursor : -1);

  // rolagem automática: mantém a linha atual a ~28% do topo
  const focusId = activeId || cursorId;
  useEffect(() => {
    if (view !== 'musico' || !focusId || !(mode === 'playing' || mode === 'count')) return;
    const r = rowsRef.current[focusId];
    if (r) scrollRef.current?.scrollTo({ y: Math.max(0, sheetY + r.y - viewH * 0.28), animated: true });
  }, [focusId, mode, sheetY, viewH, view]);
  useEffect(() => {
    if (view !== 'cantor' || curEvent < 0 || !(mode === 'playing' || mode === 'count')) return;
    const y = linesRef.current[curEvent];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, sheetY + y - viewH * 0.3), animated: true });
  }, [curEvent, mode, sheetY, viewH, view]);

  const onRowLayout = useCallback((barIds, y, h) => { for (const id of barIds) rowsRef.current[id] = { y, h }; }, []);
  const onLineLayout = useCallback((k, y) => { linesRef.current[k] = y; }, []);

  if (!sl) return <Empty title="Setlist não encontrada" />;
  if (!song) return <Empty title="Música não encontrada" text="Sincronize novamente." />;

  const m = parsed.meta;
  const songC = songCols(parsed, sl.cols); // compassos por linha: da música
  const autoCols = width && width < 600 ? Math.min(4, songC) : songC;
  const cols = colsPref || autoCols;
  const secName = timeline[step] ? parsed.sections[timeline[step].sec]?.name : '';
  const next = ids[idx + 1] ? parseSong(songs[ids[idx + 1]]?.content || '').meta.title : null;
  const shownBpm = following && live.remote?.bpm ? live.remote.bpm : Math.round(bpm * rate);

  const liveLabel = role === 'off' ? 'Ao vivo'
    : live.status !== 'on' ? (live.status === 'connecting' ? 'Conectando…' : 'Sem conexão')
      : live.isDirector ? `Diretor · ${live.peers?.count || 1}`
        : director ? `Seguindo ${director}` : 'Aguardando diretor';
  const liveColor = role === 'off' ? C.muted : live.status !== 'on' ? C.danger : live.isDirector || director ? C.ok : C.warn;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      {/* topo: sair, música, visão e ao vivo */}
      <View style={st.top}>
        <Pressable testID="show-exit" onPress={() => setPanel('exit')} hitSlop={8} style={st.exitBtn}><Text style={st.exitT}>Sair</Text></Pressable>
        <Text style={st.topT} numberOfLines={1}>{width > 480 ? `Música ${idx + 1} de ${ids.length}` : `${idx + 1}/${ids.length}`}</Text>
        <View style={st.seg}>
          {[['musico', 'Músico'], ['cantor', 'Cantor']].map(([v, l]) => (
            <Pressable key={v} testID={`view-${v}`} onPress={() => chooseView(v)} style={[st.segI, view === v && st.segOn]}>
              <Text style={[st.segT, view === v && { color: '#fff' }]}>{l}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable testID="live-btn" onPress={() => setPanel('live')} hitSlop={6} style={[st.liveBtn, { borderColor: liveColor }]}>
          <View style={[st.dot, { backgroundColor: liveColor }]} />
          <Text style={[st.liveT, { color: role === 'off' ? C.ink : liveColor }]} numberOfLines={1}>{liveLabel}</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        onLayout={e => { setViewH(e.nativeEvent.layout.height); setWidth(e.nativeEvent.layout.width - 24); }}
        contentContainerStyle={{ padding: 12, paddingBottom: viewH * 0.6 }}
      >
        <View style={st.head}>
          <View style={{ flex: 1 }}>
            <Text style={st.title}>{m.title || 'Sem título'}</Text>
            {m.artist ? <Text style={st.artist}>{m.artist}</Text> : null}
          </View>
          <View style={st.chips}>
            {m.key && view === 'musico' ? <Chip label="TOM" value={m.key} /> : null}
            <Chip label="COMPASSO" value={meter.label} />
          </View>
        </View>
        {m.notes ? <Text style={st.notes}>{m.notes}</Text> : null}
        {!timeline.length ? <Empty title="Sem compassos" text="Esta música ainda não tem compassos escritos." /> : null}
        <View onLayout={e => setSheetY(e.nativeEvent.layout.y)}>
          {view === 'cantor' ? (
            <Lyrics events={events} current={curEvent} scale={zoom} live={live2 || mode === 'done' || mode === 'count'}
              onPress={following ? undefined : seekTo} onLineLayout={onLineLayout} />
          ) : (
            <Sheet
              song={parsed}
              cols={cols}
              width={width}
              scale={zoom}
              activeId={activeId}
              progress={progress}
              playedIds={playedIds}
              cursorId={cursorId}
              onBarPress={following ? undefined : onBarPress}
              onRowLayout={onRowLayout}
            />
          )}
        </View>
      </ScrollView>

      {mode === 'count' && (
        <View style={st.countWrap} pointerEvents="none">
          <Text style={st.count}>{countBeat}</Text>
          <Text style={st.countL}>contagem · {pulse.pulses} {pulse.pulses === 1 ? 'tempo' : 'tempos'}</Text>
        </View>
      )}

      {mode === 'done' && !following && (
        <View style={st.done}>
          <Text style={st.doneT}>Fim da música</Text>
          {next ? <Button kind="accent" title={`Próxima: ${next}  ▶`} onPress={() => goSong(1)} /> : <Text style={st.doneT}>Última do show 🎉</Text>}
        </View>
      )}

      {/* barra de controles */}
      <View style={[st.bar, { paddingBottom: 12 + insets.bottom }]}>
        <View style={st.info}>
          <Text style={st.infoT} numberOfLines={1}>
            {following ? `Seguindo o play de ${director} · ` : ''}
            {live2 || mode === 'count'
              ? `${secName || '—'} · compasso ${Math.min(step + 1, timeline.length)} de ${timeline.length}`
              : following ? 'aguardando o play' : `${timeline.length} compassos · toque ${view === 'cantor' ? 'numa linha' : 'num compasso'} para começar dali`}
          </Text>
          <View style={st.zoom}>
            {view === 'musico' && !following && !readonly ? (
              <View style={st.tom}>
                <Text style={st.tomL}>Tom</Text><Text style={st.tomV}>{m.key || '—'}</Text>
                <Pressable testID="key-down" onPress={() => transposeSong(-1)} hitSlop={8}><Text style={st.zoomT}>−½</Text></Pressable>
                <Pressable testID="key-up" onPress={() => transposeSong(1)} hitSlop={8}><Text style={st.zoomT}>+½</Text></Pressable>
              </View>
            ) : null}
            {!following ? <Pressable testID="count-in" onPress={toggleCountIn} hitSlop={8}><Text style={[st.zoomT, !countIn && { color: C.muted, textDecorationLine: 'line-through' }]}>Contar</Text></Pressable> : null}
            {/* na pauta os compassos se ajustam às cifras: não há compassos por linha */}
            {view === 'musico' && viewOf(parsed) !== 'pauta' && <Pressable testID="cols" onPress={() => setColsPref(cols > 2 ? 2 : autoCols)} hitSlop={8}><Text style={st.zoomT}>▦ {cols}</Text></Pressable>}
            <Pressable onPress={() => setZoom(z => Math.max(0.7, +(z - 0.1).toFixed(2)))} hitSlop={8}><Text style={st.zoomT}>A−</Text></Pressable>
            <Pressable onPress={() => setZoom(z => Math.min(1.8, +(z + 0.1).toFixed(2)))} hitSlop={8}><Text style={st.zoomT}>A+</Text></Pressable>
          </View>
        </View>
        <View style={[st.controls, following && { opacity: 0.35 }]} pointerEvents={following ? 'none' : 'auto'}>
          <Ctl testID="prev-song" label="⏮" onPress={() => goSong(-1)} disabled={idx === 0} />
          <View style={st.tempo}>
            <Ctl label="−" onPress={() => setRateIdx(r => Math.max(0, r - 1))} small />
            <Pressable onLongPress={() => setRateIdx(RATES.indexOf(1))} style={st.tempoBox}>
              <Text style={st.tempoT}>{pulse.symbol} = {shownBpm}</Text>
              <Text style={st.tempoS}>{songBpm ? `${Math.round(rate * 100)}%` : 'sem BPM na cifra'}</Text>
            </Pressable>
            <Ctl label="+" onPress={() => setRateIdx(r => Math.min(RATES.length - 1, r + 1))} small />
          </View>
          {mode === 'playing' || mode === 'count'
            ? <Ctl testID="pause" label="❚❚" onPress={pause} big />
            : <Ctl testID="play" label="▶" onPress={play} big disabled={!timeline.length} />}
          <Ctl label="■" onPress={stop} disabled={mode === 'stopped'} />
          <Ctl testID="next-song" label="⏭" onPress={() => goSong(1)} disabled={idx >= ids.length - 1} />
        </View>
      </View>

      {panel === 'exit' && (
        <Overlay onClose={() => setPanel(null)}>
          <Text style={st.pTitle}>Sair do modo Show?</Text>
          <Text style={st.pText}>{role !== 'off' ? 'Você também sai do show ao vivo. ' : ''}O play é interrompido.</Text>
          <View style={st.pRow}>
            <Button title="Continuar no show" onPress={() => setPanel(null)} style={{ flex: 1 }} />
            <Button testID="show-exit-confirm" kind="accent" title="Sair" onPress={() => { setRole('off'); setPanel(null); router.back(); }} style={{ flex: 1 }} />
          </View>
        </Overlay>
      )}
      {panel === 'live' && (
        <Overlay onClose={() => setPanel(null)}>
          <Text style={st.pTitle}>Show ao vivo</Text>
          <Text style={st.pText}>
            O diretor musical dá o play e todos que estão seguindo acompanham a música descendo, cada um na sua visão.
            Todos precisam estar conectados ao servidor{serverUrl ? ` (${serverUrl})` : ''} e com esta setlist sincronizada.
          </Text>
          <Text style={st.pLabel}>Seu nome</Text>
          <TextInput testID="live-name" value={name} onChangeText={v => { setName(v); savePref('liveName', v); }} placeholder="Ex.: Marcos (baixo)" style={st.input} />
          <Text style={st.pLabel}>Neste aparelho</Text>
          <View style={{ gap: 8 }}>
            {[['diretor', 'Sou o diretor', 'Meu play comanda a banda'], ['seguir', 'Seguir o diretor', 'A música desce sozinha com o play do diretor'], ['off', 'Sozinho', 'Sem conexão com a banda']].map(([v, l, d]) => (
              <Pressable key={v} testID={`live-${v}`} onPress={() => setRole(v)} style={[st.opt, role === v && st.optOn]}>
                <Text style={[st.optT, role === v && { color: '#fff' }]}>{l}</Text>
                <Text style={[st.optD, role === v && { color: '#fff', opacity: 0.85 }]}>{d}</Text>
              </Pressable>
            ))}
          </View>
          {!serverUrl && role !== 'off' ? <Text style={[st.pText, { color: C.danger }]}>Configure o servidor em Ajustes para usar o show ao vivo.</Text> : null}
          {role !== 'off' && live.peers ? (
            <View style={{ gap: 2 }}>
              <Text style={st.pLabel}>Conectados ({live.peers.count})</Text>
              {live.peers.members.map((p, k) => (
                <Text key={k} style={st.pText}>{p.director ? '★ ' : '• '}{p.name}{p.view === 'cantor' ? ' · cantor' : ' · músico'}</Text>
              ))}
            </View>
          ) : null}
          <Button kind="accent" title="Pronto" onPress={() => setPanel(null)} />
        </Overlay>
      )}
    </View>
  );
}

function Overlay({ children, onClose }) {
  return (
    <Pressable style={st.overlay} onPress={onClose}>
      <Pressable style={st.panel} onPress={() => {}}>{children}</Pressable>
    </Pressable>
  );
}

function Ctl({ label, onPress, disabled, big, small, testID }) {
  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      hitSlop={6}
      style={({ pressed }) => [st.ctl, big && st.ctlBig, small && st.ctlSmall, disabled && { opacity: 0.3 }, pressed && { opacity: 0.6 }]}
    >
      <Text style={[st.ctlT, big && { color: '#fff', fontSize: 22 }, small && { fontSize: 20 }]}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: C.panel, borderBottomWidth: 1, borderBottomColor: C.line },
  exitBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff' },
  exitT: { fontWeight: '800', color: C.ink, fontSize: 13 },
  topT: { flex: 1, fontWeight: '800', color: C.ink, fontSize: 14 },
  seg: { flexDirection: 'row', borderWidth: 1, borderColor: C.line, borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff' },
  segI: { paddingHorizontal: 10, paddingVertical: 6 },
  segOn: { backgroundColor: C.ink },
  segT: { fontWeight: '800', fontSize: 13, color: C.ink },
  liveBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8, borderWidth: 1.5, backgroundColor: '#fff', maxWidth: 160 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  liveT: { fontWeight: '800', fontSize: 12.5 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingBottom: 8, borderBottomWidth: 2.5, borderBottomColor: C.ink, marginBottom: 6 },
  title: { fontSize: 24, fontWeight: '800', color: C.ink },
  artist: { fontSize: 14, color: C.muted, marginTop: 2 },
  chips: { flexDirection: 'row', gap: 6 },
  notes: { fontStyle: 'italic', color: C.muted, fontSize: 13.5, marginBottom: 4 },
  countWrap: { position: 'absolute', top: '30%', left: 0, right: 0, alignItems: 'center' },
  count: { fontSize: 120, fontWeight: '900', color: C.accent, opacity: 0.9 },
  countL: { fontSize: 14, color: C.muted, fontWeight: '700' },
  done: { position: 'absolute', left: 16, right: 16, bottom: 140, backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 10, alignItems: 'center', borderWidth: 1, borderColor: C.line, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, elevation: 6 },
  doneT: { fontSize: 15, fontWeight: '800', color: C.ink },
  bar: { backgroundColor: C.panel, borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: 10, paddingTop: 6 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, marginBottom: 4 },
  infoT: { flex: 1, fontSize: 12.5, color: C.muted, fontWeight: '600' },
  zoom: { flexDirection: 'row', gap: 14 },
  zoomT: { fontSize: 15, fontWeight: '800', color: C.ink },
  tom: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 10, marginRight: 2, borderRightWidth: 1, borderRightColor: C.line },
  tomL: { fontSize: 12, fontWeight: '700', color: C.muted },
  tomV: { fontSize: 15, fontWeight: '800', color: C.accent, minWidth: 26 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ctl: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  ctlBig: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.accent },
  ctlSmall: { width: 34, height: 34 },
  ctlT: { fontSize: 20, color: C.ink, fontWeight: '800' },
  tempo: { flexDirection: 'row', alignItems: 'center' },
  tempoBox: { alignItems: 'center', minWidth: 78 },
  tempoT: { fontSize: 16, fontWeight: '800', color: C.ink },
  tempoS: { fontSize: 11, color: C.muted, fontWeight: '600' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(28,25,23,0.45)', justifyContent: 'center', padding: 18 },
  panel: { backgroundColor: C.bg, borderRadius: 16, padding: 18, gap: 10, maxWidth: 520, width: '100%', alignSelf: 'center' },
  pTitle: { fontSize: 19, fontWeight: '800', color: C.ink },
  pText: { fontSize: 14, color: C.muted, lineHeight: 20 },
  pLabel: { fontSize: 12, fontWeight: '800', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 4 },
  pRow: { flexDirection: 'row', gap: 10 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.ink },
  opt: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 11, backgroundColor: '#fff' },
  optOn: { backgroundColor: C.ink, borderColor: C.ink },
  optT: { fontWeight: '800', fontSize: 15, color: C.ink },
  optD: { fontSize: 12.5, color: C.muted, marginTop: 2 },
});
