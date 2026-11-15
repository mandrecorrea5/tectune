// Início: setlists guardadas no celular
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useData } from '../lib/store';
import { Button, Empty, Fab } from '../components/ui';
import { Login, BandSetup } from '../components/AuthScreens';
import { C, fmtDate } from '../lib/theme';

function ago(iso) {
  if (!iso) return 'nunca';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  return fmtDate(iso.slice(0, 10));
}

export default function Home() {
  const router = useRouter();
  const { setlists, syncing, syncError, sync, lastSync, pendingCount, account, band, readonly } = useData();
  // antes do repertório: entrar na conta e ter uma banda
  if (!account.token) return <><Stack.Screen options={{ headerRight: () => null }} /><Login /></>;
  if (!band) return <><Stack.Screen options={{ headerRight: () => null }} /><BandSetup /></>;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{
        title: band.name,
        headerRight: () => (
          <View style={{ flexDirection: 'row' }}>
            <Button testID="band-btn" small kind="ghost" title={account.invites.length ? `Banda (${account.invites.length})` : 'Banda'} onPress={() => router.push('/band')} />
            <Button small kind="ghost" title="Músicas" onPress={() => router.push('/library')} />
            <Button small kind="ghost" title="⚙︎" onPress={() => router.push('/settings')} />
          </View>
        ),
      }} />
      <Pressable style={st.status} onPress={() => router.push('/settings')}>
        <View style={[st.dot, { backgroundColor: syncError ? C.danger : pendingCount ? C.warn : C.ok }]} />
        <Text style={st.statusT} numberOfLines={2}>
          {syncing ? 'Sincronizando…' : syncError ? 'Offline · tudo salvo no celular' : `Sincronizado ${ago(lastSync)}`}
          {pendingCount ? ` · ${pendingCount} ${pendingCount === 1 ? 'alteração a enviar' : 'alterações a enviar'}` : ''}
          {readonly ? ' · você é membro: só leitura' : ''}
        </Text>
      </Pressable>
      <FlatList
        data={setlists}
        keyExtractor={s => s.id}
        contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 100, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => sync()} />}
        ListEmptyComponent={
          <Empty
            title="Nenhuma setlist ainda"
            text="Crie sua primeira setlist aqui mesmo — funciona sem internet. Se o sistema do computador estiver rodando, puxe a tela para baixo para sincronizar."
          >
            {readonly ? null : <Button kind="primary" title="+ Nova setlist" onPress={() => router.push('/setlist-form')} />}
          </Empty>
        }
        renderItem={({ item }) => {
          const info = [fmtDate(item.event_date), item.venue].filter(Boolean).join(' · ');
          return (
            <Pressable testID="setlist-item" style={({ pressed }) => [st.card, pressed && { opacity: 0.8 }]} onPress={() => router.push(`/setlist/${item.id}`)}>
              <View style={{ flex: 1 }}>
                <Text style={st.name}>{item.name}{item.dirty ? <Text style={st.pend}>  ●</Text> : null}</Text>
                {info ? <Text style={st.info}>{info}</Text> : null}
              </View>
              <View style={st.count}><Text style={st.countN}>{item.song_ids.length}</Text><Text style={st.countL}>{item.song_ids.length === 1 ? 'música' : 'músicas'}</Text></View>
            </Pressable>
          );
        }}
      />
      {setlists.length && !readonly ? <Fab testID="new-setlist" title="+ Nova setlist" onPress={() => router.push('/setlist-form')} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 9, backgroundColor: C.panel, borderBottomWidth: 1, borderBottomColor: C.line },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusT: { fontSize: 12.5, color: C.muted, flex: 1 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: C.line },
  name: { fontSize: 18, fontWeight: '800', color: C.ink },
  pend: { fontSize: 12, color: C.warn },
  info: { fontSize: 13.5, color: C.muted, marginTop: 3 },
  count: { alignItems: 'center', minWidth: 54 },
  countN: { fontSize: 22, fontWeight: '800', color: C.accent },
  countL: { fontSize: 11, color: C.muted },
});
