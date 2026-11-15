// Servidor (busca automática) e sincronização
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useData } from '../lib/store';
import { probeServers } from '../lib/server';
import { Button } from '../components/ui';
import { C } from '../lib/theme';

const fmt = iso => {
  if (!iso) return 'nunca';
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

export default function Settings() {
  const { serverUrl, setServerUrl, sync, syncing, syncError, lastSync, pendingCount, setlists, songs } = useData();
  const [url, setUrl] = useState(serverUrl || '');
  const [probe, setProbe] = useState(null);
  const [busy, setBusy] = useState(false);

  // testa o endereço digitado + todos os prováveis e mostra o resultado de cada um
  const search = async (typed = url) => {
    setBusy(true); setProbe(null);
    try {
      const res = await probeServers(typed);
      setProbe(res);
      const ok = res.find(r => r.ok);
      if (ok) { setUrl(ok.url); await setServerUrl(ok.url); }
    } finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <View style={st.card}>
        <Text style={st.h}>Servidor</Text>
        <TextInput
          testID="server-url"
          value={url}
          onChangeText={setUrl}
          placeholder="http://192.168.0.10:3000"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={st.input}
          onSubmitEditing={() => search()}
        />
        <Button testID="probe" title={busy ? 'Procurando…' : 'Conectar / procurar servidor'} kind="primary" disabled={busy} onPress={() => search()} />

        {probe && (
          <View style={st.probe}>
            {probe.map(r => (
              <View key={r.url} style={st.pRow}>
                <Text style={[st.pIcon, { color: r.ok ? C.ok : C.danger }]}>{r.ok ? '✓' : '✗'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={st.pUrl}>{r.url}</Text>
                  <Text style={st.pMsg}>{r.ok ? `respondeu em ${r.ms} ms` : r.error}</Text>
                </View>
              </View>
            ))}
            {!probe.some(r => r.ok) && (
              <Text style={[st.help, { color: C.danger }]}>
                Nenhum endereço respondeu. Confira: 1) o sistema está rodando no computador
                (abra http://localhost:3000 no navegador do Mac; se não abrir, rode "docker compose up -d");
                2) o celular está no mesmo Wi-Fi do computador; 3) o firewall do Mac permite conexões.
              </Text>
            )}
          </View>
        )}

        <Text style={st.help}>
          O app testa sozinho os endereços prováveis: o IP do computador que está rodando o Expo,
          10.0.2.2 (emulador Android) e localhost (simulador iOS). Em uso: {serverUrl || 'nenhum'}.
        </Text>
      </View>

      <View style={st.card}>
        <Text style={st.h}>Sincronização</Text>
        <Text style={st.line}>Última: {fmt(lastSync)}</Text>
        <Text style={st.line}>No celular: {setlists.length} setlists · {Object.keys(songs).length} músicas</Text>
        <Text style={st.line}>Alterações a enviar: {pendingCount}</Text>
        {syncError ? <Text style={[st.line, { color: C.danger }]}>{syncError}</Text> : null}
        <Button testID="sync-now" title={syncing ? 'Sincronizando…' : 'Sincronizar agora'} kind="accent" disabled={syncing} onPress={() => sync()} />
        <Text style={st.help}>
          Tudo fica salvo no banco do celular (SQLite) e funciona sem internet. Quando houver conexão,
          o app envia o que você fez aqui e recebe o que mudou no computador. Se a mesma música ou setlist
          for alterada nos dois lugares, vale a alteração mais recente.
        </Text>
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 10, borderWidth: 1, borderColor: C.line },
  h: { fontSize: 16, fontWeight: '800', color: C.ink },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.ink, backgroundColor: C.panel },
  help: { fontSize: 13, color: C.muted, lineHeight: 19 },
  line: { fontSize: 14, color: C.ink },
  probe: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, gap: 8, backgroundColor: C.panel },
  pRow: { flexDirection: 'row', gap: 8 },
  pIcon: { fontSize: 16, fontWeight: '900', width: 16 },
  pUrl: { fontSize: 14, fontWeight: '700', color: C.ink },
  pMsg: { fontSize: 12.5, color: C.muted },
});
