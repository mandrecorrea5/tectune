// Banda: trocar de banda, membros (admin/membro), convites, criar outra banda e sair da conta.
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';
import { useData } from '../lib/store';
import { api } from '../lib/api';
import { InviteCard } from '../components/AuthScreens';
import { Button } from '../components/ui';
import { C } from '../lib/theme';

export default function BandScreen() {
  const { account, band, role, serverUrl, selectBand, bandApi, signOut, refreshMe } = useData();
  const admin = role === 'admin';
  const [info, setInfo] = useState(null);
  const [email, setEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [name, setName] = useState(band?.name || '');
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!account.bandId) return;
    setLoading(true);
    try { const r = await api.band(serverUrl, account.bandId); setInfo(r); setName(r.name); }
    catch (e) { setMsg({ err: true, t: e.message }); }
    finally { setLoading(false); }
  }, [account.bandId, serverUrl]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, ok) => {
    setMsg(null);
    try { const r = await fn(); if (r && r.members) setInfo(r); if (ok) setMsg({ t: ok }); }
    catch (e) { setMsg({ err: true, t: e.message }); }
  };
  const answer = (inv, accept) => run(() => bandApi((a, url) => a.answerInvite(url, inv.id, accept), accept ? inv.band_id : undefined), accept ? 'Você entrou na banda' : null);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { refreshMe().catch(() => {}); load(); }} />}>
      <Stack.Screen options={{ title: 'Banda' }} />
      {msg ? <Text style={[st.msg, msg.err && { color: C.danger }]}>{msg.t}</Text> : null}
      {account.invites.map(i => <InviteCard key={i.id} inv={i} onAnswer={answer} />)}

      {account.bands.length > 1 ? (
        <View style={st.card}>
          <Text style={st.h}>Suas bandas</Text>
          {account.bands.map(b => (
            <Button key={b.id} testID="band-pick" kind={b.id === account.bandId ? 'primary' : 'default'}
              title={`${b.name}${b.role === 'admin' ? '' : ' (membro)'}`} onPress={() => run(() => selectBand(b.id))} />
          ))}
        </View>
      ) : null}

      <View style={st.card}>
        <Text style={st.h}>{band?.name || 'Banda'} · {admin ? 'você é admin' : 'você é membro'}</Text>
        {admin ? (
          <View style={st.row}>
            <TextInput value={name} onChangeText={setName} style={[st.input, { flex: 1 }]} />
            <Button small title="Salvar" onPress={() => run(() => bandApi((a, url, id) => a.renameBand(url, id, name.trim())), 'Nome salvo')} />
          </View>
        ) : null}
        <Text style={st.label}>Membros</Text>
        {(info?.members || []).map(m => (
          <View key={m.id} style={st.member}>
            <View style={{ flex: 1 }}>
              <Text style={st.mName}>{m.name}{m.id === account.user?.id ? ' (você)' : ''}</Text>
              <Text style={st.mMail}>{m.email}</Text>
            </View>
            <Text style={[st.role, m.role === 'admin' && st.roleA]}>{m.role === 'admin' ? 'ADMIN' : 'MEMBRO'}</Text>
            {admin ? (
              <Button small kind="ghost" title={m.role === 'admin' ? 'Tornar membro' : 'Tornar admin'}
                onPress={() => run(async () => { const r = await api.setRole(serverUrl, account.bandId, m.id, m.role === 'admin' ? 'membro' : 'admin'); if (m.id === account.user?.id) await refreshMe(); return r; })} />
            ) : null}
            {admin && m.id !== account.user?.id ? (
              <Button small kind="ghost" title="✕" onPress={() => run(() => api.removeMember(serverUrl, account.bandId, m.id))} />
            ) : null}
          </View>
        ))}
        {admin ? (
          <>
            <Text style={st.label}>Convidar (quem já tem conta)</Text>
            <View style={st.row}>
              <TextInput testID="invite-email" value={email} onChangeText={setEmail} placeholder="E-mail" keyboardType="email-address" autoCapitalize="none" style={[st.input, { flex: 1 }]} />
              <Button testID="invite-send" small kind="primary" title="Convidar" onPress={() => run(async () => { const r = await api.invite(serverUrl, account.bandId, email.trim()); setEmail(''); return r; }, 'Convite enviado — a pessoa vê ao entrar no app')} />
            </View>
            {(info?.invites || []).map(i => (
              <View key={i.id} style={st.member}>
                <View style={{ flex: 1 }}><Text style={st.mName}>{i.name} · convite pendente</Text><Text style={st.mMail}>{i.email}</Text></View>
                <Button small kind="ghost" title="Cancelar" onPress={() => run(() => api.cancelInvite(serverUrl, account.bandId, i.id))} />
              </View>
            ))}
          </>
        ) : null}
        <Text style={st.p}>Admins editam músicas e setlists. Membros veem, tocam o Show e acompanham o ao vivo.</Text>
        <Button title="Sair desta banda" onPress={() => run(() => bandApi((a, url, id) => a.removeMember(url, id, account.user.id)))} />
      </View>

      <View style={st.card}>
        <Text style={st.h}>Criar outra banda</Text>
        <View style={st.row}>
          <TextInput value={newName} onChangeText={setNewName} placeholder="Nome da banda" style={[st.input, { flex: 1 }]} />
          <Button small title="Criar" disabled={!newName.trim()} onPress={() => run(async () => { await bandApi((a, url) => a.createBand(url, newName.trim()), r => r.id); setNewName(''); }, 'Banda criada — você é o admin')} />
        </View>
      </View>

      <View style={st.card}>
        <Text style={st.h}>Conta</Text>
        <Text style={st.p}>{account.user?.name} · {account.user?.email}</Text>
        <Button testID="logout" title="Sair da conta" onPress={signOut} />
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: C.line },
  h: { fontSize: 16, fontWeight: '800', color: C.ink },
  label: { fontSize: 12, fontWeight: '800', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 4 },
  p: { fontSize: 13.5, color: C.muted, lineHeight: 19 },
  msg: { fontSize: 14, fontWeight: '700', color: C.ok },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, color: C.ink, backgroundColor: C.bg },
  member: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 9 },
  mName: { fontWeight: '800', color: C.ink },
  mMail: { fontSize: 12, color: C.muted },
  role: { fontSize: 10.5, fontWeight: '800', color: C.ink, backgroundColor: C.panel, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, overflow: 'hidden' },
  roleA: { backgroundColor: C.ink, color: '#fff' },
});
