import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LocalStoreProvider } from './src/application/LocalStoreContext';
import { openLocalStore, retryLocalStoreBootstrap } from './src/data/local/sqlite/LocalStore';
import { FE01ComponentChecks } from './src/ui/dev/FE01ComponentChecks';
import { FE02StorageChecks } from './src/ui/dev/FE02StorageChecks';
import { Button } from './src/ui/components/Button';
import { LoadingState } from './src/ui/components/Feedback';
import { fontAssets } from './src/ui/theme/fontAssets';
import { AuthFlow } from './src/ui/auth/AuthFlow';
import { colors, fonts } from './src/ui/theme/tokens';
import type { LocalStore } from './src/data/local/sqlite/LocalStore';

export default function App() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const [localStore, setLocalStore] = useState<LocalStore | null>(null);
  const [storeFailed, setStoreFailed] = useState(false);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const bootstrap = bootstrapAttempt === 0 ? openLocalStore() : retryLocalStoreBootstrap();
    bootstrap.then(
      (store) => {
        if (active) {
          setLocalStore(store);
          setStoreFailed(false);
        }
      },
      () => {
        if (active) setStoreFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [bootstrapAttempt]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  if (!localStore) {
    return (
      <View style={styles.container}>
        {storeFailed ? (
          <View style={styles.bootstrapError}>
            <Text style={styles.bootstrapMessage}>Data lokal belum siap. Coba buka kembali.</Text>
            <Button
              label="Coba lagi"
              role="farmer"
              variant="secondary"
              onPress={() => setBootstrapAttempt((attempt) => attempt + 1)}
            />
          </View>
        ) : (
          <LoadingState label="Menyiapkan data VetLink…" />
        )}
        <StatusBar style="dark" />
      </View>
    );
  }

  if (__DEV__ && process.env.EXPO_PUBLIC_FE01_CHECKS === '1') {
    return (
      <LocalStoreProvider store={localStore}>
        <FE01ComponentChecks />
      </LocalStoreProvider>
    );
  }

  if (__DEV__ && process.env.EXPO_PUBLIC_FE02_CHECKS === '1') {
    return (
      <LocalStoreProvider store={localStore}>
        <FE02StorageChecks />
      </LocalStoreProvider>
    );
  }

  return (
    <LocalStoreProvider store={localStore}>
      <AuthFlow store={localStore} />
    </LocalStoreProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  bootstrapError: {
    maxWidth: 320,
    gap: 12,
    paddingHorizontal: 24,
  },
  bootstrapMessage: {
    color: colors.dark,
    fontFamily: fonts.medium,
    fontSize: 16,
    textAlign: 'center',
  },
});
