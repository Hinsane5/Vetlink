import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createApiAdapters } from '../../data/remote/createApiAdapters';
import { ServerFarmService } from '../../application/ServerFarmService';
import type { ApiFarmRecord } from '../../application/ports/FarmReadRepository';
import type { AccountRole, SessionSnapshot } from '../../domain/auth';
import { Button } from '../components/Button';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { LoadingState } from '../components/Feedback';
import { TextField } from '../components/TextField';
import { colors, fonts, spacing, typeScale } from '../theme/tokens';

type Screen = 'loading' | 'roles' | 'login' | 'register' | 'home';

/** Server mode never opens the local fixture store or writes to SQLite. */
export function ServerAuthFlow({ baseUrl }: { baseUrl: string }) {
  const { auth, farms } = useMemo(() => {
    const adapters = createApiAdapters(baseUrl);
    return { auth: adapters.auth, farms: new ServerFarmService(adapters.farms, adapters.farmWrites) };
  }, [baseUrl]);
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<Screen>('loading');
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [role, setRole] = useState<AccountRole>('farmer');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [logoutVisible, setLogoutVisible] = useState(false);
  const [error, setError] = useState('');
  const [farmList, setFarmList] = useState<ApiFarmRecord[]>([]);
  const [farmName, setFarmName] = useState('');
  const [farmsBusy, setFarmsBusy] = useState(false);
  const [farmsLoaded, setFarmsLoaded] = useState(false);
  const farmCreateInFlight = useRef(false);

  useEffect(() => {
    let mounted = true;
    auth.restoreSession().then(
      (restored) => {
        if (!mounted) return;
        setSession(restored);
        if (restored) setRole(restored.activeRole);
        setScreen(restored ? 'home' : 'roles');
      },
      (cause) => {
        if (!mounted) return;
        setError(messageFor(cause));
        setScreen('roles');
      },
    );
    return () => { mounted = false; };
  }, [auth]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'login' || screen === 'register') {
        setError('');
        setScreen('roles');
        return true;
      }
      return screen === 'home';
    });
    return () => subscription.remove();
  }, [screen]);

  useEffect(() => {
    if (!session || session.activeRole !== 'farmer') {
      return;
    }
    let mounted = true;
    farms.list(session.activeRole).then(
      (records) => { if (mounted) { setFarmList(records); setFarmsLoaded(true); setFarmsBusy(false); } },
      (cause) => { if (mounted) { setError(messageFor(cause)); setFarmsLoaded(true); setFarmsBusy(false); } },
    );
    return () => { mounted = false; };
  }, [farms, session]);

  const createFarm = async () => {
    if (!session || farmCreateInFlight.current) return;
    farmCreateInFlight.current = true;
    setFarmsBusy(true);
    setError('');
    try {
      await farms.create(session.activeRole, farmName);
      setFarmList(await farms.list(session.activeRole));
      setFarmName('');
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      farmCreateInFlight.current = false;
      setFarmsBusy(false);
    }
  };

  const submit = async () => {
    if (busy) return;
    if (screen === 'register' && password !== confirmation) {
      setError('Kata sandi dan konfirmasi harus sama.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = screen === 'register'
        ? await auth.register({ name, email, password, role })
        : await auth.login({ email, password, role });
      setSession(next);
      setFarmsLoaded(false);
      setRole(next.activeRole);
      setPassword('');
      setConfirmation('');
      setScreen('home');
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const switchRole = async (nextRole: AccountRole) => {
    if (!session || busy || !session.roles.includes(nextRole)) return;
    setBusy(true);
    setError('');
    try {
      const next = await auth.switchRole(nextRole);
      setSession(next);
      setRole(next.activeRole);
      setFarmList([]);
      setFarmsLoaded(false);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await auth.logout();
      setLogoutVisible(false);
      setSession(null);
      setFarmList([]);
      setFarmsLoaded(false);
      setPassword('');
      setScreen('roles');
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  if (screen === 'loading') return <View style={styles.loading}><LoadingState label="Memeriksa sesi…" /></View>;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing[6], paddingBottom: insets.bottom + spacing[8] }]}>
        <Text style={styles.title}>VetLink</Text>
        {screen === 'roles' && <>
          <Text style={styles.heading}>Pilih Peran</Text>
          <Text style={styles.description}>Pilih peran akun untuk melanjutkan.</Text>
          <Button label="Peternak" role="farmer" selected={role === 'farmer'} variant="secondary" onPress={() => setRole('farmer')} />
          <Button label="Dokter Hewan" role="vet" selected={role === 'vet'} variant="secondary" onPress={() => setRole('vet')} />
          <Button label="Masuk" role={role} onPress={() => { setError(''); setScreen('login'); }} />
          <Button label="Daftar" role={role} variant="secondary" onPress={() => { setError(''); setScreen('register'); }} />
        </>}
        {(screen === 'login' || screen === 'register') && <>
          <Text style={styles.heading}>{screen === 'login' ? 'Masuk' : 'Daftar'} sebagai {role === 'farmer' ? 'Peternak' : 'Dokter Hewan'}</Text>
          {screen === 'register' && <TextField label="Nama lengkap" value={name} onChangeText={setName} autoCapitalize="words" />}
          <TextField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
          <TextField label="Kata sandi" value={password} onChangeText={setPassword} secureTextEntry autoComplete={screen === 'login' ? 'current-password' : 'new-password'} />
          {screen === 'register' && <TextField label="Konfirmasi kata sandi" value={confirmation} onChangeText={setConfirmation} secureTextEntry autoComplete="new-password" />}
          <Button label={screen === 'login' ? 'Masuk' : 'Buat akun'} role={role} onPress={submit} loading={busy} />
          <Button label="Kembali" role={role} variant="secondary" onPress={() => { setError(''); setScreen('roles'); }} />
        </>}
        {screen === 'home' && session && <>
          <Text style={styles.heading}>Akun {session.activeRole === 'farmer' ? 'Peternak' : 'Dokter Hewan'}</Text>
          <Text style={styles.description}>{session.displayName}{'\n'}{session.email}</Text>
          {session.activeRole === 'farmer' && <>
            <Text style={styles.heading}>Peternakan saya</Text>
            {(!farmsLoaded || farmsBusy) && <LoadingState label="Memuat peternakan…" />}
            {farmsLoaded && !farmsBusy && farmList.length === 0 && <Text style={styles.description}>Belum ada peternakan.</Text>}
            {farmList.map((farm) => <View key={farm.id} style={styles.farmCard}><Text style={styles.farmName}>{farm.name}</Text><Text style={styles.description}>{farm.species.length ? farm.species.join(', ') : 'Jenis ternak belum diisi'}</Text></View>)}
            <TextField label="Nama peternakan baru" value={farmName} onChangeText={setFarmName} />
            <Button label="Tambah peternakan" role="farmer" onPress={createFarm} loading={farmsBusy} />
          </>}
          {session.activeRole === 'vet' && <Text style={styles.description}>Data layanan belum tersedia di tampilan ini.</Text>}
          {session.roles.length > 1 && session.roles.map((availableRole) => <Button key={availableRole} label={`Ganti Peran: ${availableRole === 'farmer' ? 'Peternak' : 'Dokter Hewan'}`} role={availableRole} variant="secondary" disabled={busy || availableRole === session.activeRole} onPress={() => switchRole(availableRole)} />)}
          <Button label="Keluar" role={session.activeRole} variant="secondary" disabled={busy} onPress={() => setLogoutVisible(true)} />
        </>}
        {!!error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
      </ScrollView>
      <ConfirmationDialog visible={logoutVisible} title="Keluar dari akun?" message="Anda perlu masuk kembali untuk mengakses akun ini." role={session?.activeRole ?? role} confirmLabel="Keluar" onConfirm={logout} onCancel={() => setLogoutVisible(false)} loading={busy} destructive />
    </KeyboardAvoidingView>
  );
}

function messageFor(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Permintaan belum berhasil. Coba lagi.';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  loading: { flex: 1, backgroundColor: colors.cream },
  content: { flexGrow: 1, gap: spacing[4], paddingHorizontal: spacing[5] },
  title: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.title },
  heading: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.heading },
  description: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22 },
  error: { color: colors.orange, fontFamily: fonts.medium, fontSize: typeScale.body },
  farmCard: { padding: spacing[4], backgroundColor: colors.white, borderRadius: 14, gap: spacing[2] },
  farmName: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.section },
});
