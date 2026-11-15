// Grade de compassos (render nativo). Usada na tela de palco e na prévia.
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { wrapRows, rowHasTop, barLines, rowIsTall, sectionLengths, viewOf, staffBarWidth, flowStaff, voiceLines } from '@tectune/core';
import Chord, { tokenWidth } from './Chord';
import { C } from '../lib/theme';

const GAP = 5;
const LINE = '#78716C';
// linha com algo em cima (casa, anotação, entrada da voz) ou embaixo (letra)
const rowTop = row => rowHasTop(row) || row.some(b => b.voice);
// linhas de letra embaixo (uma por passada, se houver)
const rowLyr = row => Math.max(0, ...row.map(b => voiceLines(b.voice).length));

function Bar({ b, barW, barH, base, active, progress, played, cursor, onPress, pauta, pos, lyrW }) {
  if (pauta) return <StaffBar {...{ b, barW, barH, base, active, progress, played, cursor, onPress, pos, lyrW }} />;
  const L = b.layout;
  const multi = L.spans.length > 1 || !!L.error;
  const padL = b.start ? 12 : 4, padR = b.end ? 12 : 4;
  const inner = barW - padL - padR;
  // mais de 2 acordes → duas linhas (metade dos tempos em cada); mesmo tamanho para todos os acordes do compasso
  const lines = barLines(L);
  let k = 1;
  for (const ln of lines) for (const sp of ln.spans) {
    const w = tokenWidth(sp.tok, base);
    if (w > 0) k = Math.min(k, (inner * sp.len / ln.grid - 6) / w);
  }
  const size = Math.max(9, base * Math.max(0.3, k) * (lines.length > 1 ? 0.92 : 1));

  return (
    <Pressable
      onPress={onPress}
      style={[
        st.bar,
        { width: barW, height: barH, paddingLeft: padL, paddingRight: padR },
        b.start && st.rs, b.end && st.re,
        (L.error || b.mel?.error) && st.err,
        cursor && st.cursor,
        active && st.active,
        played && !active && { opacity: 0.38 },
      ]}
    >
      <Above b={b} />
      {b.start && <View style={[st.dots, { left: 3 }]}><View style={st.dot} /><View style={st.dot} /></View>}
      {b.end && <View style={[st.dots, { right: 3 }]}><View style={st.dot} /><View style={st.dot} /></View>}

      <View style={{ flex: 1 }}>
        {lines.map((ln, li) => {
          const starts = new Set(ln.spans.map(s => s.start));
          return (
            <View key={li} style={[st.beats, li > 0 && st.line2]}>
              {ln.spans.map((sp, i) => (
                <View key={i} style={[st.slot, { flex: sp.len }, i > 0 && st.sep, multi && { paddingBottom: 6 }]}>
                  <Chord tok={sp.tok} size={size} />
                </View>
              ))}
              {multi && (
                <View style={st.ticks} pointerEvents="none">
                  {Array.from({ length: ln.grid }, (_, i) => (
                    <View key={i} style={[st.tick, starts.has(i) && st.tickOn]} />
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </View>
      {active && progress != null && (
        <View style={st.progressTrack} pointerEvents="none">
          <View style={[st.progress, { width: `${Math.min(100, progress * 100)}%` }]} />
        </View>
      )}
      {L.error || b.mel?.error ? <View style={st.flag}><Text style={st.flagT}>!</Text></View> : null}
      <Extras b={b} barH={barH} lyrW={lyrW} />
    </Pressable>
  );
}

// em cima do compasso: casa (1. 2.), "VOZ", anotação e nº de vezes
function Above({ b }) {
  return (
    <>
      {(b.passes || b.note || b.voice) && (
        <View style={[st.above, b.passes && st.aboveE, b.endingCont && st.aboveC]} pointerEvents="none">
          {b.ending ? <Text style={st.en}>{b.ending}.</Text> : null}
          {b.voice ? <Text style={st.vz}>VOZ</Text> : null}
          {b.note ? <Text style={st.bn} numberOfLines={1}>{b.note}</Text> : null}
        </View>
      )}
      {b.end && b.times ? <Text style={st.rt}>{b.times}x</Text> : null}
    </>
  );
}
// letra embaixo do compasso e marca de frase com notas
function Extras({ b, barH, staff, lyrW }) {
  return (
    <>
      {/* a letra vai só até o próximo compasso com letra (ou o fim da linha) e quebra se não couber */}
      {voiceLines(b.voice).length ? <Text style={[st.lyr, { top: barH + 3, width: lyrW || 200 }]} pointerEvents="none">{voiceLines(b.voice).join('\n')}</Text> : null}
      {b.melody ? <Text style={staff ? st.melStaff : st.mel} pointerEvents="none">♪</Text> : null}
    </>
  );
}

// Compasso na pauta: 5 linhas, barras e a cifra em destaque sobre as linhas
function StaffBar({ b, barW, barH, base, active, progress, played, cursor, onPress, pos = {}, lyrW }) {
  const L = b.layout, sp = barH / 4;
  const padL = b.start ? 13 : 4, padR = b.end ? 13 : pos.secEnd ? 8 : 4;
  const inner = barW - padL - padR;
  let k = 1;
  for (const s2 of L.spans) { const w = tokenWidth(s2.tok, base); if (w > 0) k = Math.min(k, (inner * s2.len / L.grid - 8) / w); }
  const size = Math.max(9, base * Math.max(0.3, k));
  const bg = active ? '#FFEDD5' : L.error || b.mel?.error ? '#FEF2F2' : C.bg;
  const dot = (top, side) => <View style={[st.sdot, { top }, side === 'r' ? { right: 5 } : { left: 5 }]} />;
  return (
    <Pressable
      onPress={onPress}
      style={[
        st.sbar, { width: barW, height: barH, paddingLeft: padL, paddingRight: padR, backgroundColor: L.error || b.mel?.error || active ? bg : 'transparent' },
        pos.first && { borderLeftWidth: 1.5 }, b.start && { borderLeftWidth: 4 }, (b.end || (pos.secEnd && pos.fin)) && { borderRightWidth: 4 },
        cursor && st.scursor, active && st.sactive, played && !active && { opacity: 0.38 },
      ]}
    >
      {[0, 1, 2, 3, 4].map(i => <View key={i} pointerEvents="none" style={[st.sline, { top: i * sp - (i === 4 ? 1 : 0) }]} />)}
      {b.start && <><View style={[st.thin, { left: 2 }]} />{dot(1.5 * sp - 2.5)}{dot(2.5 * sp - 2.5)}</>}
      {b.end && <><View style={[st.thin, { right: 2 }]} />{dot(1.5 * sp - 2.5, 'r')}{dot(2.5 * sp - 2.5, 'r')}</>}
      {!b.end && pos.secEnd && <View style={[st.thin, { right: pos.fin ? 2 : 3 }]} />}
      <Above b={b} />
      <View style={st.beats}>
        {L.spans.map((s2, i) => (
          <View key={i} style={[st.slot, { flex: s2.len, overflow: 'visible' }]}>
            {s2.tok === '/' || s2.tok === '.' || s2.tok === '_' ? null : (
              <View style={{ backgroundColor: bg, paddingHorizontal: 3, borderRadius: 3 }}>
                {s2.tok === '%' ? <Text style={{ fontSize: size * 1.1, fontWeight: '800', color: C.ink }}>%</Text> : <Chord tok={s2.tok} size={size} />}
              </View>
            )}
          </View>
        ))}
      </View>
      {active && progress != null && (
        <View style={[st.progressTrack, { bottom: -6, height: 3 }]} pointerEvents="none">
          <View style={[st.progress, { width: `${Math.min(100, progress * 100)}%`, height: 3 }]} />
        </View>
      )}
      {L.error || b.mel?.error ? <View style={st.flag}><Text style={st.flagT}>!</Text></View> : null}
      <Extras b={b} barH={barH} lyrW={lyrW} staff />
    </Pressable>
  );
}
const MemoBar = memo(Bar);

/**
 * props: song (parseSong), cols, width, scale, activeId, progress, playedIds (Set), cursorId,
 *        onBarPress(id), onRowLayout(ids[], y)
 */
export default function Sheet({ song, cols, width, scale = 1, activeId, progress, playedIds, cursorId, onBarPress, onRowLayout }) {
  if (!width) return null;
  const barW = (width - GAP * (cols - 1)) / cols;
  const base = Math.min(30, Math.max(14, barW * 0.27)) * scale;
  const pauta = viewOf(song) === 'pauta';
  // na pauta a altura do compasso é a do pentagrama (4 espaços)
  const barH = pauta ? Math.max(40, Math.min(60, barW * 0.46)) * Math.max(0.75, scale) : Math.max(46, Math.min(78, barW * 0.6)) * Math.max(0.75, scale);
  const lastSec = song.sections.reduce((k, x, i) => (x.rows.length ? i : k), -1);
  const out = [];
  const lens = sectionLengths(song);
  song.sections.forEach((s, si) => {
    if (s.name || s.times || lens[si]) {
      out.push(
        <View key={`h${si}`} style={st.secH}>
          {s.name ? <Text style={st.pill}>{s.name.toUpperCase()}</Text> : null}
          {s.times ? <Text style={st.sx}>{s.times}x</Text> : null}
          {lens[si] ? <Text style={st.slen}>{lens[si]} {lens[si] === 1 ? 'compasso' : 'compassos'}</Text> : null}
        </View>,
      );
    }
    if (s.notes.length) out.push(<Text key={`n${si}`} style={st.secNotes}>{s.notes.join(' · ')}</Text>);
    let rows;
    if (pauta) {
      // pauta: sem compassos por linha — cada compasso com a largura das suas cifras (todas no mesmo
      // tamanho) e as linhas quebrando e esticando como numa partitura
      const bars = s.rows.flat();
      const widths = bars.map(b => Math.max(staffBarWidth(b, t => tokenWidth(t, base), { gap: base * 0.7, pad: 10, repeat: 10 }), base * 4, width / 8));
      rows = flowStaff(widths, width - 1).map(line => Object.assign(line.map(x => bars[x.i]), { w: line.map(x => Math.floor(x.w * 10) / 10) }));
    } else rows = wrapRows(s.rows, cols);
    rows.forEach((row, ri) => {
      const ids = row.map(b => b.id);
      const lastRow = ri === rows.length - 1;
      // largura da letra de cada compasso: até o próximo compasso com letra ou o fim da linha
      const ws = row.map((b, bi) => (pauta ? row.w[bi] : barW + GAP));
      const hasL = row.map(b => voiceLines(b.voice).length > 0);
      const lyrW = row.map((b, i) => {
        if (!hasL[i]) return 0;
        let w = 0, j = i;
        for (; j < row.length; j++) { if (j > i && hasL[j]) break; w += ws[j]; }
        if (j === row.length) w += Math.max(0, width - ws.reduce((a, x) => a + x, 0)); // fim da linha: usa o espaço livre
        return Math.max(40, w - 10);
      });
      // linhas que a letra ocupa (estimativa: ~7px por caractere em itálico 13)
      const nLyr = Math.max(0, ...row.map((b, i) => (hasL[i] ? voiceLines(b.voice).reduce((a, t) => a + Math.max(1, Math.ceil((t.length * 7) / lyrW[i])), 0) : 0)));
      out.push(
        <View
          key={`r${si}-${ri}`}
          style={[st.row, pauta && { gap: 0, marginBottom: 14 }, rowTop(row) && { marginTop: 20 }, nLyr > 0 && { marginBottom: (pauta ? 13 : 7) + 17 * nLyr }]}
          onLayout={onRowLayout ? e => onRowLayout(ids, e.nativeEvent.layout.y, e.nativeEvent.layout.height) : undefined}
        >
          {row.map((b, bi) => (
            <MemoBar
              key={b.id}
              b={b}
              pauta={pauta}
              lyrW={lyrW[bi]}
              pos={pauta ? { first: bi === 0, secEnd: lastRow && bi === row.length - 1, fin: si === lastSec } : undefined}
              barW={pauta ? row.w[bi] : barW}
              barH={!pauta && rowIsTall(row) ? barH * 1.7 : barH}
              base={base}
              active={b.id === activeId}
              progress={b.id === activeId ? progress : null}
              played={playedIds ? playedIds.has(b.id) : false}
              cursor={b.id === cursorId}
              onPress={onBarPress ? () => onBarPress(b.id) : undefined}
            />
          ))}
        </View>,
      );
    });
    out.push(<View key={`g${si}`} style={{ height: 10 }} />);
  });
  return <>{out}</>;
}

const st = StyleSheet.create({
  secH: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 8 },
  pill: { backgroundColor: C.ink, color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5, overflow: 'hidden' },
  sx: { color: C.accent, fontWeight: '800', fontSize: 15 },
  slen: { color: C.muted, fontWeight: '600', fontSize: 12 },
  aboveC: { borderLeftWidth: 0, left: -6 },
  secNotes: { fontStyle: 'italic', color: C.muted, fontSize: 13, marginTop: -2, marginBottom: 8 },
  row: { flexDirection: 'row', gap: GAP, marginBottom: 6 },
  bar: { backgroundColor: C.cell, borderWidth: 1, borderColor: C.cellLine, borderRadius: 7, flexDirection: 'row', alignItems: 'stretch' },
  rs: { borderLeftWidth: 4, borderLeftColor: C.ink },
  re: { borderRightWidth: 4, borderRightColor: C.ink },
  err: { borderColor: C.danger, borderWidth: 2, backgroundColor: '#FEF2F2' },
  cursor: { borderColor: C.accent, borderWidth: 2, borderStyle: 'dashed' },
  active: { borderColor: C.accent, borderWidth: 3, backgroundColor: '#FFF4EC', shadowColor: C.accent, shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
  dots: { position: 'absolute', top: '50%', marginTop: -9, height: 18, justifyContent: 'space-between' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.ink },
  above: { position: 'absolute', left: -1, right: 0, top: -17, flexDirection: 'row', gap: 4, height: 15, alignItems: 'flex-end' },
  aboveE: { borderLeftWidth: 1.5, borderTopWidth: 1.5, borderColor: C.ink, paddingLeft: 3, top: -18 },
  en: { fontSize: 11, fontWeight: '800', color: C.ink },
  bn: { fontSize: 11, fontStyle: 'italic', color: C.muted, flexShrink: 1 },
  rt: { position: 'absolute', right: 2, top: -16, fontSize: 11.5, fontWeight: '800', color: C.accent },
  beats: { flex: 1, flexDirection: 'row' },
  line2: { borderTopWidth: 1, borderTopColor: '#CFC6B9', borderStyle: 'dashed' },
  slot: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  sep: { borderLeftWidth: 1, borderLeftColor: '#CFC6B9', borderStyle: 'dashed' },
  ticks: { position: 'absolute', left: 0, right: 0, bottom: 4, flexDirection: 'row' },
  tick: { flex: 1, height: 3, marginHorizontal: 3, borderRadius: 2, backgroundColor: C.tickOff },
  tickOn: { backgroundColor: C.tickOn },
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, borderBottomLeftRadius: 5, borderBottomRightRadius: 5, overflow: 'hidden' },
  progress: { height: 4, backgroundColor: C.accent },
  flag: { position: 'absolute', top: -8, right: -6, width: 17, height: 17, borderRadius: 9, backgroundColor: C.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  flagT: { color: '#fff', fontSize: 10, fontWeight: '900' },
  vz: { fontSize: 10, fontWeight: '900', color: '#fff', backgroundColor: C.accent, paddingHorizontal: 4, borderRadius: 3, overflow: 'hidden', letterSpacing: 0.5 },
  lyr: { position: 'absolute', left: 3, width: 600, fontSize: 13, lineHeight: 17, fontStyle: 'italic', color: C.ink },
  mel: { position: 'absolute', left: 4, top: 1, fontSize: 12, fontWeight: '800', color: C.accent },
  melStaff: { position: 'absolute', right: 2, top: -16, fontSize: 12, fontWeight: '800', color: C.accent },
  // pauta
  sbar: { flexDirection: 'row', alignItems: 'stretch', borderColor: C.ink, borderRightWidth: 1.5 },
  sline: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: LINE },
  thin: { position: 'absolute', top: 0, bottom: 0, width: 1.5, backgroundColor: C.ink },
  sdot: { position: 'absolute', width: 5, height: 5, borderRadius: 3, backgroundColor: C.ink },
  sactive: { borderColor: C.accent },
  scursor: { borderStyle: 'dashed' },
});
