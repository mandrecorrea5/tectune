// Folha do setlist: configurações só da lista de músicas (visualização, tamanho da letra, o que mostrar)
// e impressão. Cada mudança fica salva no setlist na hora (e sincroniza com o servidor).
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { COVER_OPTS, coverOpts } from '@tectune/core';
import { useData } from '../lib/store';
import { Button } from '../components/ui';
import { C } from '../lib/theme';
import { COVER_LAYOUTS, COVER_STEPS, resolveCoverScale, coverPages } from '../lib/printHtml';
import { viewPdf, sharePdf } from '../lib/pdf';

export default function SetlistCover() {
  const { id } = useLocalSearchParams();
  const { setlists, songs, updateSetlist, readonly } = useData();
  const sl = setlists.find(s => s.id === id);
  const [busy, setBusy] = useState(false);
  if (!sl) return <Text style={{ padding: 20 }}>Setlist não encontrada.</Text>;

  const list = sl.song_ids.map(sid => songs[sid]).filter(Boolean);
  const layout = sl.cover_layout || 'detalhada';
  const scale = Number(sl.cover_scale) || 0;
  const opts = coverOpts(sl.cover_opts);
  const used = resolveCoverScale(sl, list);
  const pages = coverPages(sl, list);

  const set = patch => (readonly ? null : updateSetlist(sl.id, patch)); // membros só imprimem
  // A− / A+ partem do tamanho em uso (no automático, do que ele escolheu)
  const step = d => {
    const i = Math.max(0, Math.min(COVER_STEPS.length - 1, COVER_STEPS.indexOf(scale || used) + d));
    set({ cover_scale: COVER_STEPS[i] });
  };
  const pdfOpts = () => ({ setlist: sl, songs: list, cols: sl.cols, coverOnly: true });
  const run = fn => async () => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Stack.Screen options={{ title: 'Folha do setlist' }} />
      <Text style={st.hint}>Configurações só da lista de músicas do show. Ficam salvas neste setlist.</Text>

      <Group label="Visualização">
        <View style={st.seg}>
          {COVER_LAYOUTS.map(([v, label]) => (
            <Pressable key={v} testID={`cover-layout-${v}`} onPress={() => set({ cover_layout: v })} style={[st.segI, layout === v && st.segOn]}>
              <Text style={[st.segT, layout === v && { color: '#fff' }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </Group>

      <Group label="Tamanho da letra">
        <View style={st.seg}>
          <Pressable testID="cover-auto" onPress={() => set({ cover_scale: 0 })} style={[st.segI, { flex: 1.5 }, !scale && st.segOn]}>
            <Text style={[st.segT, !scale && { color: '#fff' }]}>Auto</Text>
          </Pressable>
          <Pressable testID="cover-smaller" onPress={() => step(1)} style={st.segI}><Text style={[st.segT, { fontSize: 17 }]}>A−</Text></Pressable>
          <View style={[st.segI, { flex: 1.2 }]}>
            <Text testID="cover-scale" style={[st.segT, { fontSize: 16 }]}>{scale || used}%</Text>
          </View>
          <Pressable testID="cover-bigger" onPress={() => step(-1)} style={st.segI}><Text style={[st.segT, { fontSize: 20 }]}>A+</Text></Pressable>
        </View>
        <Text testID="cover-fit" style={st.hint}>
          {scale ? `Tamanho fixo em ${scale}%` : `Automático: o maior que cabe em 1 folha (${used}%)`}
          {` · ${pages === 1 ? '1 folha' : `cerca de ${pages} folhas`}`}
        </Text>
      </Group>

      <Group label="Mostrar">
        <View style={st.box}>
          {COVER_OPTS.map(([k, label], i) => (
            <View key={k} style={[st.opt, i > 0 && st.optSep]}>
              <Text style={st.optT}>{label}</Text>
              <Switch testID={`cover-opt-${k}`} value={opts[k]} onValueChange={v => set({ cover_opts: { ...opts, [k]: v } })}
                trackColor={{ true: C.ink }} />
            </View>
          ))}
        </View>
      </Group>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button testID="cover-print" kind="primary" title="🖨  Imprimir" disabled={!list.length || busy} onPress={run(() => viewPdf(pdfOpts()))} style={{ flex: 1 }} />
        <Button title="Enviar PDF" disabled={!list.length || busy} onPress={run(() => sharePdf(pdfOpts(), `${sl.name} - setlist`))} style={{ flex: 1 }} />
      </View>
    </ScrollView>
  );
}

function Group({ label, children }) {
  return <View style={{ gap: 6 }}><Text style={st.label}>{label}</Text>{children}</View>;
}

const st = StyleSheet.create({
  label: { fontSize: 12.5, fontWeight: '800', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  hint: { fontSize: 12.5, color: C.muted },
  seg: { flexDirection: 'row', borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: 'hidden', backgroundColor: '#fff' },
  segI: { flex: 1, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: C.ink },
  segT: { fontSize: 14, fontWeight: '800', color: C.ink },
  box: { borderWidth: 1, borderColor: C.line, borderRadius: 10, backgroundColor: '#fff' },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 8 },
  optSep: { borderTopWidth: 1, borderTopColor: C.line },
  optT: { fontSize: 15, fontWeight: '600', color: C.ink },
});
