// Telas antes do repertório: entrar / criar conta, e criar a 1ª banda ou aceitar um convite.
import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useData } from '../lib/store';
import { api } from '../lib/api';
import { Button } from './ui';
import { C } from '../lib/theme';
import { PROD_SERVER } from '../lib/server';

function Shell({ children }) {
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
        <View style={st.box}>
          <Text style={st.brand}>Tectune</Text>
          {children}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Login() {
  const { signIn, serverUrl } = useData();
  const router = useRouter();
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState(null);
  const [info, setInfo] = useState(null);
  const [unverified, setUnverified] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(null); setInfo(null); setUnverified(false); setBusy(true);
    try {
      const r = await signIn(mode, mode === 'register' ? f : { email: f.email, password: f.password });
      if (r?.pending) {
        setMode('login'); setF({ ...f, password: '' }); setUnverified(true);
        setInfo(`Conta criada! Enviamos um link de confirmação para ${r.email}. Abra o e-mail, confirme e depois entre aqui.`);
      }
    }
    catch (e) { setErr(e.message); if (e.code === 'unverified') setUnverified(true); }
    finally { setBusy(false); }
  };
  const resend = async () => {
    setErr(null);
    try { await api.resendConfirmation(serverUrl || PROD_SERVER, f.email.trim()); setInfo(`Enviamos um novo link para ${f.email.trim()}. Confira também o spam.`); }
    catch (e) { setErr(e.message); }
  };
  return (
    <Shell>
      <View style={st.tabs}>
        {[['login', 'Entrar'], ['register', 'Criar conta']].map(([m, l]) => (
          <Pressable key={m} testID={`auth-${m}`} onPress={() => setMode(m)} style={[st.tab, mode === m && st.tabOn]}>
            <Text style={[st.tabT, mode === m && { color: '#fff' }]}>{l}</Text>
          </Pressable>
        ))}
      </View>
      {mode === 'register' ? <Field label="Seu nome" testID="auth-name" value={f.name} onChangeText={v => setF({ ...f, name: v })} autoComplete="name" /> : null}
      <Field label="E-mail" testID="auth-email" value={f.email} onChangeText={v => setF({ ...f, email: v })} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <Field label="Senha" testID="auth-password" value={f.password} onChangeText={v => setF({ ...f, password: v })} secureTextEntry onSubmitEditing={submit} />
      {mode === 'login' ? (
        // a troca de senha acontece no site (o link chega por e-mail e abre lá)
        <Pressable testID="auth-forgot" onPress={() => Linking.openURL(`${serverUrl || PROD_SERVER}/?esqueci`)}>
          <Text style={st.forgot}>Esqueci minha senha</Text>
        </Pressable>
      ) : null}
      {err ? <Text style={st.err}>{err}</Text> : null}
      {info ? <Text testID="auth-info" style={st.info}>{info}</Text> : null}
      {unverified ? <Pressable testID="auth-resend" onPress={resend}><Text style={st.resend}>Reenviar e-mail de confirmação</Text></Pressable> : null}
      <Button testID="auth-submit" kind="primary" title={busy ? 'Aguarde…' : mode === 'register' ? 'Criar conta' : 'Entrar'} disabled={busy} onPress={submit} />
      <Pressable onPress={() => router.push('/settings')}><Text style={st.small}>Servidor: {serverUrl || 'procurar automaticamente'} · alterar</Text></Pressable>
    </Shell>
  );
}

export function InviteCard({ inv, onAnswer }) {
  return (
    <View style={st.invite}>
      <Text style={st.inviteT}><Text style={{ fontWeight: '800' }}>{inv.invited_by || 'Alguém'}</Text> convidou você para a banda <Text style={{ fontWeight: '800' }}>{inv.band_name}</Text></Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button small title="Recusar" onPress={() => onAnswer(inv, false)} style={{ flex: 1 }} />
        <Button testID="invite-accept" small kind="primary" title="Entrar na banda" onPress={() => onAnswer(inv, true)} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

export function BandSetup() {
  const { account, bandApi, signOut, refreshMe } = useData();
  const [name, setName] = useState('');
  const [err, setErr] = useState(null);
  const create = async () => {
    setErr(null);
    try { await bandApi((a, url) => a.createBand(url, name.trim()), r => r.id); }
    catch (e) { setErr(e.message); }
  };
  const answer = async (inv, accept) => {
    try { await bandApi((a, url) => a.answerInvite(url, inv.id, accept), accept ? inv.band_id : undefined); }
    catch (e) { setErr(e.message); }
  };
  return (
    <Shell>
      <Text style={st.h}>Olá, {account.user?.name || ''}!</Text>
      {account.invites.map(i => <InviteCard key={i.id} inv={i} onAnswer={answer} />)}
      <Text style={st.p}>Crie sua banda — você será o admin e poderá convidar os músicos que já têm conta.</Text>
      <Field label="Nome da banda" testID="band-name" value={name} onChangeText={setName} />
      {err ? <Text style={st.err}>{err}</Text> : null}
      <Button testID="band-create" kind="primary" title="Criar banda" disabled={!name.trim()} onPress={create} />
      <Button small kind="ghost" title="Verificar convites" onPress={() => refreshMe().catch(e => setErr(e.message))} />
      <Button small kind="ghost" title="Sair da conta" onPress={signOut} />
    </Shell>
  );
}

function Field({ label, ...props }) {
  return (
    <View style={{ gap: 5 }}>
      <Text style={st.label}>{label}</Text>
      <TextInput style={st.input} autoCorrect={false} {...props} />
    </View>
  );
}

const st = StyleSheet.create({
  info: { color: '#166534', backgroundColor: '#f0fdf4', borderColor: '#bbf7d0', borderWidth: 1, borderRadius: 10, padding: 10, fontWeight: '600', lineHeight: 20 },
  resend: { textAlign: 'center', color: C.accent || '#c2410c', fontWeight: '700', fontSize: 14 },
  forgot: { textAlign: 'right', color: C.muted || '#78716C', fontSize: 13, fontWeight: '600', marginTop: -4 },
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 18 },
  box: { backgroundColor: '#fff', borderRadius: 16, padding: 20, gap: 12, borderWidth: 1, borderColor: C.line, maxWidth: 440, width: '100%', alignSelf: 'center' },
  brand: { fontSize: 22, fontWeight: '900', color: C.ink, textAlign: 'center', marginBottom: 4 },
  tabs: { flexDirection: 'row', borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: 'hidden' },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabOn: { backgroundColor: C.ink },
  tabT: { fontWeight: '800', color: C.ink },
  label: { fontSize: 13, fontWeight: '700', color: C.ink },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: C.ink, backgroundColor: C.bg },
  err: { color: C.danger, fontWeight: '700' },
  small: { fontSize: 12, color: C.muted, textAlign: 'center' },
  h: { fontSize: 20, fontWeight: '800', color: C.ink },
  p: { fontSize: 14, color: C.muted, lineHeight: 20 },
  invite: { borderWidth: 1, borderColor: '#FED7AA', backgroundColor: '#FFF7ED', borderRadius: 12, padding: 12, gap: 10 },
  inviteT: { fontSize: 14.5, color: C.ink, lineHeight: 20 },
});
