// Músicas de uma setlist: tocar, organizar (subir/descer/tirar), adicionar nova ou da biblioteca
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { parseSong, validateSong } from '@tectune/core';
import { useData } from '../../lib/store';
import { viewPdf, sharePdf } from '../../lib/pdf';
import { Button, Empty } from '../../components/ui';
import { C, fmtDate } from '../../lib/theme';

export default function SetlistScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { setlists, songs, createSong, setSetlistSongs, readonly } = useData();
  const sl = setlists.find(s => s.id === id);
  const [organize, setOrganize] = useState(false);
  const [busy, setBusy] = useState(false);

  const items = useMemo(() => (sl?.song_ids || []).map((sid, i) => {
    const s = songs[sid];
    const p = parseSong(s?.content || '');
    return {
      key: `${sid}-${i}`, i, id: sid, title: p.meta.title || 'Sem título', artist: p.meta.artist,
      info: [p.meta.key && `Tom ${p.meta.key}`, p.meta.bpm && `${p.meta.bpm} bpm`, p.meta.time && p.meter.label].filter(Boolean).join(' · '),
      bad: validateSong(p).some(x => x.level === 'error'), dirty: !!s?.dirty,
    };
  }), [sl, songs]);

  if (!sl) return <Empty title="Setlist não encontrada" text="Ela pode ter sido excluída." />;

  const ids = sl.song_ids;
  const move = (i, d) => { const n = [...ids]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setSetlistSongs(sl.id, n); };
  const removeAt = i => setSetlistSongs(sl.id, ids.filter((_, k) => k !== i));
  const addNew = async () => {
    const sid = await createSong();
    await setSetlistSongs(sl.id, [...ids, sid]);
    router.push(`/edit/${sid}`);
  };
  const pdfOpts = () => ({ setlist: sl, songs: ids.map(sid => songs[sid]).filter(Boolean), cols: sl.cols, cover: true });
  const run = fn => async () => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{
        title: sl.name,
        headerRight: () => (readonly ? null : <Button testID="sl-edit" small kind="ghost" title="Editar" onPress={() => router.push({ pathname: '/setlist-form', params: { id: sl.id } })} />),
      }} />
      <View style={st.head}>
        <Text style={st.info}>{[fmtDate(sl.event_date), sl.venue, `${items.length} ${items.length === 1 ? 'música' : 'músicas'}`].filter(Boolean).join(' · ')}</Text>
        {sl.notes ? <Text style={st.notes}>{sl.notes}</Text> : null}
        <View style={st.actions}>
          <Button testID="present-show" kind="accent" title="▶  Modo Show" disabled={!items.length} onPress={() => router.push({ pathname: '/stage', params: { setlist: sl.id, i: 0 } })} style={{ flex: 1 }} />
          <Button title="PDF" disabled={!items.length || busy} onPress={run(() => viewPdf(pdfOpts()))} />
          <Button title="Enviar" disabled={!items.length || busy} onPress={run(() => sharePdf(pdfOpts(), sl.name))} />
        </View>
        <Button testID="pdf-cover" small title="🖨  Folha do setlist (configurar e imprimir)"
          onPress={() => router.push({ pathname: '/setlist-cover', params: { id: sl.id } })} />
        {readonly ? null : <View style={st.actions}>
          <Button testID="add-new" small title="+ Nova música" onPress={addNew} style={{ flex: 1 }} />
          <Button testID="add-lib" small title="+ Da biblioteca" onPress={() => router.push({ pathname: '/library', params: { pick: sl.id } })} style={{ flex: 1 }} />
          <Button testID="organize" small kind={organize ? 'primary' : 'default'} title={organize ? 'Pronto' : 'Organizar'} disabled={!items.length} onPress={() => setOrganize(o => !o)} />
        </View>}
      </View>
      <FlatList
        data={items}
        keyExtractor={it => it.key}
        contentContainerStyle={{ padding: 12, gap: 8, flexGrow: 1 }}
        ListEmptyComponent={<Empty title="Show sem músicas" text="Crie uma música nova ou traga uma da biblioteca." />}
        renderItem={({ item }) => (
          <Pressable
            testID="song-item"
            style={({ pressed }) => [st.row, pressed && !organize && { opacity: 0.8 }]}
            onPress={organize ? undefined : () => router.push({ pathname: '/stage', params: { setlist: sl.id, i: item.i } })}
          >
            <Text style={st.n}>{item.i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={st.t}>{item.title}{item.bad ? <Text style={{ color: C.danger }}>  ●</Text> : null}</Text>
              <Text style={st.s} numberOfLines={1}>{[item.artist, item.info].filter(Boolean).join(' · ')}{item.dirty ? ' · a enviar' : ''}</Text>
            </View>
            {organize ? (
              <View style={st.org}>
                <Pressable hitSlop={6} onPress={() => move(item.i, -1)} style={st.ob}><Text style={st.obT}>↑</Text></Pressable>
                <Pressable hitSlop={6} onPress={() => move(item.i, 1)} style={st.ob}><Text style={st.obT}>↓</Text></Pressable>
                <Pressable testID="remove-song" hitSlop={6} onPress={() => removeAt(item.i)} style={st.ob}><Text style={[st.obT, { color: C.danger }]}>✕</Text></Pressable>
              </View>
            ) : (
              <Button testID="song-edit" small kind="ghost" title={readonly ? 'Ver cifra' : 'Editar'} onPress={() => router.push(`/edit/${item.id}`)} />
            )}
          </Pressable>
        )}
      />
    </View>
  );
}

const st = StyleSheet.create({
  head: { padding: 14, gap: 8, backgroundColor: C.panel, borderBottomWidth: 1, borderBottomColor: C.line },
  info: { fontSize: 14, color: C.muted },
  notes: { fontSize: 13.5, color: C.muted, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: 8 },
  row: { backgroundColor: '#fff', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: C.line },
  n: { width: 24, textAlign: 'center', fontWeight: '800', color: C.accent, fontSize: 16 },
  t: { fontSize: 16, fontWeight: '700', color: C.ink },
  s: { fontSize: 12.5, color: C.muted, marginTop: 2 },
  org: { flexDirection: 'row', gap: 4 },
  ob: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.panel },
  obT: { fontSize: 17, fontWeight: '800', color: C.ink },
});
