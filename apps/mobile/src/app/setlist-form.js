// Criar / editar / excluir setlist
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useData } from '../lib/store';
import { Button, confirmAsync } from '../components/ui';
import { C } from '../lib/theme';

// "12/12/2026" ⇄ "2026-12-12"
const toIso = br => { const m = String(br || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
const toBr = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const maskDate = v => { const d = v.replace(/\D/g, '').slice(0, 8); return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/'); };

export default function SetlistForm() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { setlists, createSetlist, updateSetlist, deleteSetlist } = useData();
  const cur = id ? setlists.find(s => s.id === id) : null;
  const [name, setName] = useState(cur?.name || '');
  const [date, setDate] = useState(toBr(cur?.event_date));
  const [venue, setVenue] = useState(cur?.venue || '');
  const [notes, setNotes] = useState(cur?.notes || '');
  const [cols, setCols] = useState(cur?.cols || 4);
  const [err, setErr] = useState(null);
  const save = async () => {
    if (!name.trim()) { setErr('Dê um nome para a setlist'); return; }
    if (date && !toIso(date)) { setErr('Data no formato DD/MM/AAAA'); return; }
    const data = { name: name.trim(), event_date: toIso(date), venue: venue.trim() || null, notes: notes.trim() || null, cols };
    if (cur) { await updateSetlist(cur.id, data); router.back(); }
    else { const nid = await createSetlist(data); router.replace(`/setlist/${nid}`); }
  };
  const remove = async () => {
    if (!(await confirmAsync('Excluir setlist?', `"${cur.name}" será excluída. As músicas continuam na biblioteca.`))) return;
    await deleteSetlist(cur.id);
    router.dismissAll ? router.dismissAll() : router.replace('/');
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: cur ? 'Editar setlist' : 'Nova setlist' }} />
      <Field label="Nome do show">
        <TextInput testID="sl-name" value={name} onChangeText={t => { setName(t); setErr(null); }} placeholder="Ex.: Casamento Ana & Pedro" style={st.input} autoFocus={!cur} />
      </Field>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Field label="Data" style={{ flex: 1 }}>
          <TextInput testID="sl-date" value={date} onChangeText={t => { setDate(maskDate(t)); setErr(null); }} placeholder="DD/MM/AAAA" keyboardType="number-pad" style={st.input} />
        </Field>
        <Field label="Compassos por linha" style={{ flex: 1 }}>
          <View style={st.seg}>
            {[4, 6, 8].map(n => (
              <Pressable key={n} onPress={() => setCols(n)} style={[st.segI, cols === n && st.segOn]}>
                <Text style={[st.segT, cols === n && { color: '#fff' }]}>{n}</Text>
              </Pressable>
            ))}
          </View>
        </Field>
      </View>
      <Field label="Local">
        <TextInput testID="sl-venue" value={venue} onChangeText={setVenue} placeholder="Ex.: Espaço Villa" style={st.input} />
      </Field>
      <Field label="Observações">
        <TextInput value={notes} onChangeText={setNotes} placeholder="Horário, formação, passagem de som…" multiline style={[st.input, { minHeight: 80, textAlignVertical: 'top' }]} />
      </Field>
      {err ? <Text style={{ color: C.danger, fontWeight: '700' }}>{err}</Text> : null}
      <Button testID="sl-save" kind="primary" title={cur ? 'Salvar' : 'Criar setlist'} onPress={save} />
      {cur ? <Button title="Excluir setlist" onPress={remove} style={{ borderColor: '#F0C8C8' }} /> : null}
    </ScrollView>
  );
}

function Field({ label, children, style }) {
  return <View style={[{ gap: 6 }, style]}><Text style={st.label}>{label}</Text>{children}</View>;
}

const st = StyleSheet.create({
  label: { fontSize: 12.5, fontWeight: '800', color: C.muted },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.ink, backgroundColor: '#fff' },
  seg: { flexDirection: 'row', borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: 'hidden', backgroundColor: '#fff' },
  segI: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  segOn: { backgroundColor: C.ink },
  segT: { fontSize: 16, fontWeight: '800', color: C.ink },
});
