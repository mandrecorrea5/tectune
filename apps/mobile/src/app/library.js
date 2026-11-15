// Biblioteca de músicas: buscar, criar, editar, excluir — e escolher músicas para uma setlist
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { norm, parseSong } from '@tectune/core';
import { useData } from '../lib/store';
import { Button, Empty, Fab, confirmAsync } from '../components/ui';
import { C } from '../lib/theme';

export default function Library() {
  const { pick } = useLocalSearchParams(); // id da setlist quando estamos escolhendo músicas para ela
  const router = useRouter();
  const { songs, setlists, createSong, deleteSong, setSetlistSongs } = useData();
  const ro = useData().readonly;
  const target = pick ? setlists.find(s => s.id === pick) : null;
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const usage = {};
    for (const s of setlists) for (const id of s.song_ids) usage[id] = (usage[id] || 0) + 1;
    const nq = norm(q.trim());
    return Object.values(songs).map(s => {
      const m = parseSong(s.content).meta;
      return { id: s.id, title: m.title || 'Sem título', artist: m.artist || '', key: m.key, bpm: m.bpm, used: usage[s.id] || 0, dirty: !!s.dirty };
    })
      .filter(s => !nq || norm(s.title).includes(nq) || norm(s.artist).includes(nq))
      .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  }, [songs, setlists, q]);

  const inShow = new Set(target?.song_ids || []);
  const add = id => setSetlistSongs(target.id, [...target.song_ids, id]);
  const remove = async s => {
    const msg = s.used ? `Ela também sai de ${s.used} ${s.used === 1 ? 'setlist' : 'setlists'}.` : 'Esta ação não pode ser desfeita.';
    if (await confirmAsync(`Excluir "${s.title}"?`, msg)) await deleteSong(s.id);
  };
  const newSong = async () => {
    const id = await createSong();
    if (target) await setSetlistSongs(target.id, [...target.song_ids, id]);
    router.push(`/edit/${id}`);
  };

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: target ? `Adicionar a "${target.name}"` : 'Biblioteca de músicas' }} />
      <View style={st.search}>
        <TextInput testID="lib-search" value={q} onChangeText={setQ} placeholder="Buscar por título ou artista…" style={st.input} autoCorrect={false} clearButtonMode="while-editing" />
      </View>
      <FlatList
        data={list}
        keyExtractor={s => s.id}
        contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 100, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Empty title={q ? 'Nada encontrado' : 'Biblioteca vazia'} text={q ? 'Tente outro termo.' : 'Crie sua primeira música.'} />}
        renderItem={({ item }) => (
          <Pressable testID="lib-item" style={({ pressed }) => [st.row, pressed && { opacity: 0.85 }]} onPress={() => router.push(`/edit/${item.id}`)}>
            <View style={{ flex: 1 }}>
              <Text style={st.t}>{item.title}{target && inShow.has(item.id) ? <Text style={st.tag}>  no show</Text> : null}</Text>
              <Text style={st.s} numberOfLines={1}>
                {[item.artist, item.key && `Tom ${item.key}`, item.bpm && `${item.bpm} bpm`, `em ${item.used} ${item.used === 1 ? 'setlist' : 'setlists'}`].filter(Boolean).join(' · ')}
                {item.dirty ? ' · a enviar' : ''}
              </Text>
            </View>
            {ro ? null : target
              ? <Button testID="lib-add" small kind={inShow.has(item.id) ? 'default' : 'primary'} title={inShow.has(item.id) ? '+ de novo' : 'Adicionar'} onPress={() => add(item.id)} />
              : <Button small kind="ghost" title="Excluir" onPress={() => remove(item)} />}
          </Pressable>
        )}
      />
      {ro ? null : <Fab testID="lib-new" title="+ Nova música" onPress={newSong} />}
    </View>
  );
}

const st = StyleSheet.create({
  search: { padding: 12, paddingBottom: 4, backgroundColor: C.panel, borderBottomWidth: 1, borderBottomColor: C.line },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.ink, backgroundColor: '#fff', marginBottom: 8 },
  row: { backgroundColor: '#fff', borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.line },
  t: { fontSize: 16, fontWeight: '700', color: C.ink },
  tag: { fontSize: 12, fontWeight: '800', color: C.ok },
  s: { fontSize: 12.5, color: C.muted, marginTop: 2 },
});
