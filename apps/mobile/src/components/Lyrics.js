// Visão do cantor: só a letra, grande, na ordem em que a música é tocada.
// A linha da vez fica destacada; as que já passaram ficam apagadas. Tocar numa linha começa dali.
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { C } from '../lib/theme';

/** Índice do evento atual (última linha/seção que já começou no passo `step`). */
export function currentEvent(events, step) {
  let cur = -1;
  for (let i = 0; i < events.length; i++) { if (events[i].k <= step) cur = i; else break; }
  return cur;
}

function Lyrics({ events, current, scale = 1, live, onPress, onLineLayout }) {
  const hasText = events.some(e => e.kind === 'line' && e.text);
  if (!events.some(e => e.kind === 'line')) {
    return (
      <View style={st.empty}>
        <Text style={st.emptyT}>Esta música ainda não tem letra.</Text>
        <Text style={st.emptyS}>No editor, escreva a letra embaixo de cada seção, uma linha por vez:</Text>
        <Text style={st.code}>voz: primeira linha da letra{'\n'}voz: segunda linha{'\n'}voz 5: linha que entra no compasso 5</Text>
      </View>
    );
  }
  const size = 26 * scale;
  return (
    <View>
      {!hasText ? <Text style={st.hint}>Só as entradas da voz estão marcadas — a letra ainda não foi escrita.</Text> : null}
      {events.map((e, i) => {
        const past = live && i < current, now = live && i === current;
        if (e.kind === 'sec') {
          return (
            <Pressable key={i} onPress={onPress ? () => onPress(e.k) : undefined} onLayout={onLineLayout ? ev => onLineLayout(i, ev.nativeEvent.layout.y) : undefined}
              style={[st.sec, past && { opacity: 0.45 }]}>
              <Text style={[st.pill, now && { backgroundColor: C.accent }]}>{(e.name || 'Seção').toUpperCase()}</Text>
              {!e.lines ? <Text style={st.instr}>instrumental · {e.bars} {e.bars === 1 ? 'compasso' : 'compassos'}</Text> : null}
            </Pressable>
          );
        }
        return (
          <Pressable key={i} testID="lyric-line" onPress={onPress ? () => onPress(e.k) : undefined} onLayout={onLineLayout ? ev => onLineLayout(i, ev.nativeEvent.layout.y) : undefined}
            style={[st.line, now && st.lineNow]}>
            <Text style={[st.text, { fontSize: e.text ? size : size * 0.6, lineHeight: (e.text ? size : size * 0.6) * 1.25 },
              !e.text && st.cue, past && { color: C.muted, opacity: 0.55 }, now && { color: C.accent }]}>
              {e.text || '♪ entra a voz'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
export default memo(Lyrics);

const st = StyleSheet.create({
  sec: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, marginBottom: 6 },
  pill: { backgroundColor: C.ink, color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 0.8, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 5, overflow: 'hidden' },
  instr: { color: C.muted, fontStyle: 'italic', fontSize: 14 },
  line: { paddingVertical: 6, paddingHorizontal: 10, marginHorizontal: -10, borderRadius: 10 },
  lineNow: { backgroundColor: '#FFEDD5' },
  text: { fontWeight: '800', color: C.ink },
  cue: { fontWeight: '700', color: C.muted, fontStyle: 'italic' },
  hint: { color: C.muted, fontSize: 13, fontStyle: 'italic', marginTop: 8 },
  empty: { padding: 20, gap: 8, alignItems: 'flex-start' },
  emptyT: { fontSize: 18, fontWeight: '800', color: C.ink },
  emptyS: { fontSize: 14, color: C.muted },
  code: { fontFamily: 'monospace', fontSize: 14, color: C.ink, backgroundColor: '#fff', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: C.line },
});
