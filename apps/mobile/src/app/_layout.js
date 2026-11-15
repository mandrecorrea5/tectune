import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { DataProvider, useData } from '../lib/store';
import { C } from '../lib/theme';

// Sincroniza ao abrir o app (se o servidor não responder, segue offline)
function AutoSync() {
  const { loaded, sync } = useData();
  const done = useRef(false);
  useEffect(() => {
    if (loaded && !done.current) { done.current = true; sync(); }
  }, [loaded, sync]);
  return null;
}

function Gate({ children }) {
  const { loaded } = useData();
  if (!loaded) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}><ActivityIndicator color={C.accent} /></View>;
  return children;
}

export default function RootLayout() {
  return (
    <DataProvider>
      <AutoSync />
      <StatusBar style="dark" />
      <Gate>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: C.panel },
            headerTintColor: C.ink,
            headerTitleStyle: { fontWeight: '800' },
            contentStyle: { backgroundColor: C.bg },
            headerBackTitle: 'Voltar',
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Tectune' }} />
          <Stack.Screen name="settings" options={{ title: 'Servidor e sincronização' }} />
          <Stack.Screen name="band" options={{ title: 'Banda' }} />
          <Stack.Screen name="setlist/[id]" options={{ title: 'Setlist' }} />
          <Stack.Screen name="setlist-form" options={{ title: 'Setlist', presentation: 'modal' }} />
          <Stack.Screen name="setlist-cover" options={{ title: 'Folha do setlist' }} />
          <Stack.Screen name="library" options={{ title: 'Biblioteca de músicas' }} />
          <Stack.Screen name="stage" options={{ title: 'Palco' }} />
          <Stack.Screen name="edit/[id]" options={{ title: 'Editar cifra' }} />
        </Stack>
      </Gate>
    </DataProvider>
  );
}
