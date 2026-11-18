// Edição básica da cifra no celular (fica pendente até sincronizar)
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { songCols, appendSection, parseSong, transposeText, validateSong } from '@tectune/core';
import { useData } from '../../lib/store';
import Sheet from '../../components/Sheet';
import { Button, Empty } from '../../components/ui';
import { C } from '../../lib/theme';

const SECTION_PICKS = ['Intro', 'Verso', 'Pré-refrão', 'Refrão', 'Ponte', 'Solo', 'Final'];

export default function Edit() {
  const { id } = useLocalSearchParams();
  const { songs, updateSong, syncError, readonly } = useData();
  const song = songs[id];
  // o texto só é carregado quando a música existe (evita gravar vazio por cima ao abrir uma música recém-criada)
  const [text, setText] = useState(song ? song.content : null);
  useEffect(() => { if (text === null && song) setText(song.content); }, [song]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tab, setTab] = useState('texto');
  // tablet / celular deitado: código e prévia lado a lado; celular em pé: abas Código | Prévia
  const { width: winW } = useWindowDimensions();
  const split = winW >= 700;
  const [width, setWidth] = useState(0);
  const timer = useRef(null);

  // salva no celular 0,6 s depois de parar de digitar
  useEffect(() => {
    if (!song || text === null || text === song.content) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => updateSong(id, { content: text }), 600);
    return () => clearTimeout(timer.current);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(() => parseSong(text ?? ''), [text]);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherName, setOtherName] = useState('');
  // nova seção no fim, já com um compasso para receber os acordes
  const addSection = name => {
    name = String(name || '').trim(); if (!name) return;
    setText(t => appendSection(t ?? '', name));
    setOtherOpen(false); setOtherName('');
    if (!split) setTab('texto');
  };
  const issues = useMemo(() => validateSong(parsed), [parsed]);
  if (!song) return <Empty title="Música não encontrada" />;
  const errors = issues.filter(i => i.level === 'error').length;
  const code = (
    <View style={{ flex: 1 }}>
      {issues.length ? (
        <ScrollView style={st.issues} contentContainerStyle={{ padding: 10, gap: 6 }}>
          {issues.map((i, k) => (
            <Text key={k} style={st.issue}>
              <Text style={{ color: i.level === 'error' ? C.danger : C.warn }}>● </Text>
              <Text style={st.ln}>linha {i.line} · </Text>
              <Text style={{ fontWeight: '700' }}>{i.where}: </Text>{i.msg}
            </Text>
          ))}
        </ScrollView>
      ) : null}
      <TextInput
        testID="song-text"
        value={text ?? ''}
        onChangeText={readonly ? undefined : setText}
        editable={!readonly}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        textAlignVertical="top"
        style={st.input}
      />
    </View>
  );
  const preview = (
    <ScrollView contentContainerStyle={{ padding: 12 }} onLayout={e => setWidth(e.nativeEvent.layout.width - 24)} testID="song-preview">
      <Sheet song={parsed} cols={songCols(parsed, 4)} width={width} />
    </ScrollView>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: parsed.meta.title || 'Editar cifra' }} />
      <View style={st.tools}>
        {split ? <Text style={[st.tabT, { marginRight: 'auto' }]}>Código · Prévia</Text> : (
          <View style={st.tabs}>
            {['texto', 'prévia'].map(t => (
              <Pressable key={t} testID={`tab-${t}`} onPress={() => setTab(t)} style={[st.tab, tab === t && st.tabOn]}>
                <Text style={[st.tabT, tab === t && { color: '#fff' }]}>{t === 'texto' ? 'Código' : 'Prévia'}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {readonly ? <Text style={st.tomL}>Só leitura (você é membro)</Text> : (
          <>
            <Text style={st.tomL}>Tom</Text>
            <Button small title="−½" onPress={() => setText(t => transposeText(t ?? '', -1))} />
            <Button small title="+½" onPress={() => setText(t => transposeText(t ?? '', 1))} />
          </>
        )}
      </View>
      {readonly ? null : (
        <View style={st.secRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.secChips} keyboardShouldPersistTaps="handled">
            <Text style={st.secL}>{parsed.sections.length ? '+ Seção' : 'Comece por uma seção:'}</Text>
            {SECTION_PICKS.map(n => (
              <Pressable key={n} testID={`sec-${n}`} onPress={() => addSection(n)} style={st.chip}><Text style={st.chipT}>{n}</Text></Pressable>
            ))}
            {otherOpen ? (
              <View style={st.other}>
                <TextInput testID="sec-name" autoFocus value={otherName} onChangeText={setOtherName} placeholder="Nome da seção"
                  onSubmitEditing={() => addSection(otherName)} returnKeyType="done" style={st.otherIn} />
                <Pressable onPress={() => addSection(otherName)} style={[st.chip, st.chipOk]}><Text style={[st.chipT, { color: '#fff' }]}>Criar</Text></Pressable>
              </View>
            ) : (
              <Pressable testID="sec-other" onPress={() => setOtherOpen(true)} style={[st.chip, st.chipGhost]}><Text style={st.chipT}>Outro nome…</Text></Pressable>
            )}
          </ScrollView>
        </View>
      )}
      <Text style={[st.state, { color: errors ? C.danger : song.dirty || text !== song.content ? C.warn : C.ok }]}>
        {errors ? `${errors} ${errors === 1 ? 'erro' : 'erros'} de formatação · ` : ''}
        {text !== song.content ? 'Salvando no celular…' : song.dirty ? (syncError ? 'Salvo no celular · será enviado quando houver conexão' : 'Salvo no celular · enviando…') : 'Salvo e sincronizado'}
      </Text>

      {split ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={{ flex: 1, borderRightWidth: 1, borderRightColor: C.line }}>{code}</View>
          <View style={{ flex: 1 }}>{preview}</View>
        </View>
      ) : tab === 'texto' ? code : preview}
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  tools: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, backgroundColor: C.panel, borderBottomWidth: 1, borderBottomColor: C.line },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 9, borderWidth: 1, borderColor: C.line, marginRight: 'auto', overflow: 'hidden' },
  tab: { paddingHorizontal: 14, paddingVertical: 7 },
  tabOn: { backgroundColor: C.ink },
  tabT: { fontWeight: '700', color: C.ink },
  tomL: { fontWeight: '700', color: C.ink, marginRight: 2 },
  secRow: { borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.panel },
  secChips: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  secL: { fontWeight: '700', color: C.muted, marginRight: 2, fontSize: 13 },
  chip: { borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipGhost: { borderStyle: 'dashed' },
  chipOk: { backgroundColor: C.ink, borderColor: C.ink },
  chipT: { fontWeight: '700', color: C.ink, fontSize: 13.5 },
  other: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  otherIn: { borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, minWidth: 150, color: C.ink },
  state: { fontSize: 12.5, fontWeight: '600', paddingHorizontal: 14, paddingVertical: 6 },
  issues: { maxHeight: 150, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  issue: { fontSize: 13, color: C.ink, lineHeight: 18 },
  ln: { color: C.muted, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) },
  input: { flex: 1, padding: 14, fontSize: 15, lineHeight: 23, color: C.ink, backgroundColor: C.panel, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) },
});
