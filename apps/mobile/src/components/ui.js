// Pequenos componentes de interface
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { C } from '../lib/theme';

export function Button({ title, onPress, kind = 'default', disabled, style, small, testID }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        s.btn, small && s.small,
        kind === 'primary' && s.primary,
        kind === 'ghost' && s.ghost,
        kind === 'accent' && s.accent,
        disabled && { opacity: 0.4 },
        pressed && !disabled && { opacity: 0.75 },
        style,
      ]}
    >
      <Text style={[s.t, small && { fontSize: 13 }, (kind === 'primary' || kind === 'accent') && { color: '#fff' }]}>{title}</Text>
    </Pressable>
  );
}

/** Confirmação que funciona no celular (Alert) e no navegador (confirm). */
export function confirmAsync(title, message, okLabel = 'Excluir') {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise(resolve => Alert.alert(title, message, [
    { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
    { text: okLabel, style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

/** Botão redondo flutuante */
export function Fab({ title, onPress, testID }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [s.fab, pressed && { opacity: 0.85 }]}>
      <Text style={s.fabT}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, value }) {
  return (
    <View style={s.chip}>
      <Text style={s.chipL}>{label}</Text>
      <Text style={s.chipV}>{value}</Text>
    </View>
  );
}

export function Empty({ title, text, children }) {
  return (
    <View style={s.empty}>
      <Text style={s.emptyT}>{title}</Text>
      {text ? <Text style={s.emptyX}>{text}</Text> : null}
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  btn: { borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  small: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  primary: { backgroundColor: C.ink, borderColor: C.ink },
  accent: { backgroundColor: C.accent, borderColor: C.accent },
  ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  t: { fontSize: 15, fontWeight: '700', color: C.ink },
  chip: { borderWidth: 1.5, borderColor: C.ink, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3, alignItems: 'center', minWidth: 56 },
  chipL: { fontSize: 8.5, fontWeight: '800', letterSpacing: 0.8, color: C.muted },
  chipV: { fontSize: 15, fontWeight: '800', color: C.ink },
  fab: { position: 'absolute', right: 18, bottom: 28, backgroundColor: C.accent, borderRadius: 28, paddingHorizontal: 20, height: 56, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  fabT: { color: '#fff', fontWeight: '800', fontSize: 16 },
  empty: { padding: 24, alignItems: 'center', gap: 10 },
  emptyT: { fontSize: 18, fontWeight: '800', color: C.ink, textAlign: 'center' },
  emptyX: { fontSize: 14.5, color: C.muted, textAlign: 'center', lineHeight: 21 },
});
