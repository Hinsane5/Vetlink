import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createApiAdapters } from '../../data/remote/createApiAdapters';
import { ExpoPendingCareReportStore } from '../../data/remote/ExpoPendingCareReportStore';
import { ExpoPendingServerBookingStore } from '../../data/remote/ExpoPendingServerBookingStore';
import { ExpoServerChatStateStore } from '../../data/remote/ExpoServerChatStateStore';
import { ExpoServerChatMediaStore } from '../../data/remote/ExpoServerChatMediaStore';
import { ExpoServerVetVerificationStore } from '../../data/remote/ExpoServerVetVerificationStore';
import * as Crypto from 'expo-crypto';
import { ServerFarmService } from '../../application/ServerFarmService';
import { ServerLivestockService } from '../../application/ServerLivestockService';
import { ServerLivestockHealthService } from '../../application/ServerLivestockHealthService';
import { ServerPatientService } from '../../application/ServerPatientService';
import { ServerVetDirectoryService } from '../../application/ServerVetDirectoryService';
import { ServerVetScheduleService } from '../../application/ServerVetScheduleService';
import { ServerConsultationService } from '../../application/ServerConsultationService';
import { ServerClinicalService } from '../../application/ServerClinicalService';
import { ServerBookingService } from '../../application/ServerBookingService';
import { ServerNotificationsService } from '../../application/ServerNotificationsService';
import { ServerNotificationContextService } from '../../application/ServerNotificationContextService';
import { ServerProfileService } from '../../application/ServerProfileService';
import { ServerChatService } from '../../application/ServerChatService';
import { ServerVetVerificationService } from '../../application/ServerVetVerificationService';
import type { ApiFarmRecord } from '../../application/ports/FarmReadRepository';
import type { AccountRole, SessionSnapshot } from '../../domain/auth';
import { speciesLabel } from '../../domain/catalog';
import { DomainError } from '../../domain/errors';
import { Button } from '../components/Button';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { LoadingState } from '../components/Feedback';
import { TextField } from '../components/TextField';
import { ServerLivestockSection } from '../livestock/ServerLivestockSection';
import { ServerPatientsSection } from '../patients/ServerPatientsSection';
import { ServerVetDirectorySection } from '../directory/ServerVetDirectorySection';
import { ServerConsultationSection } from '../consultations/ServerConsultationSection';
import { ServerFarmAddressesSection } from '../farms/ServerFarmAddressesSection';
import { ServerNotificationsSection } from '../notifications/ServerNotificationsSection';
import { ServerProfileSection } from '../profile/ServerProfileSection';
import { ServerHelpSection } from '../profile/ServerHelpSection';
import { colors, fonts, spacing, typeScale } from '../theme/tokens';

type Screen = 'loading' | 'roles' | 'login' | 'register' | 'home';

/** Server mode never opens the local fixture store or writes to SQLite. */
export function ServerAuthFlow({ baseUrl }: { baseUrl: string }) {
  const { auth, farms, livestock, livestockHealth, patients, vets, vetSchedule, consultations, clinical, booking, notifications, notificationContext, profiles, chat, vetVerification } = useMemo(() => {
    const adapters = createApiAdapters(baseUrl);
    const livestock = new ServerLivestockService(adapters.farms, adapters.livestock, adapters.livestockWrites);
    const vets = new ServerVetDirectoryService(adapters.vets);
    return {
      auth: adapters.auth,
      farms: new ServerFarmService(adapters.farms, adapters.farmWrites),
      livestock,
      livestockHealth: new ServerLivestockHealthService(livestock, adapters.livestockHealth, adapters.livestockHealth, new ExpoPendingCareReportStore(), () => Crypto.randomUUID()),
      patients: new ServerPatientService(adapters.patients, adapters.livestockHealth),
      vets,
      vetSchedule: new ServerVetScheduleService(adapters.vetSchedule, vets),
      consultations: new ServerConsultationService(adapters.consultations, () => Crypto.randomUUID()),
      clinical: new ServerClinicalService(adapters.clinical),
      booking: new ServerBookingService(adapters.farms, adapters.livestock, adapters.vets, adapters.consultations, new ExpoPendingServerBookingStore()),
      notifications: new ServerNotificationsService(adapters.notifications),
      notificationContext: new ServerNotificationContextService(adapters.careCoordination),
      profiles: new ServerProfileService(adapters.profiles),
      chat: new ServerChatService(adapters.chat, new ExpoServerChatStateStore(), () => Crypto.randomUUID(), adapters.media, new ExpoServerChatMediaStore()),
      vetVerification: new ServerVetVerificationService(adapters.profiles, new ExpoServerVetVerificationStore(), () => Crypto.randomUUID()),
    };
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
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [error, setError] = useState('');
  const [farmList, setFarmList] = useState<ApiFarmRecord[]>([]);
  const [farmName, setFarmName] = useState('');
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);
  const [farmsBusy, setFarmsBusy] = useState(false);
  const [farmsLoaded, setFarmsLoaded] = useState(false);
  const [farmLoadFailed, setFarmLoadFailed] = useState(false);
  const [farmWriteUncertain, setFarmWriteUncertain] = useState(false);
  const farmCreateInFlight = useRef(false);
  const farmAddressesBackHandler = useRef<(() => boolean) | null>(null);
  const livestockBackHandler = useRef<(() => boolean) | null>(null);
  const patientBackHandler = useRef<(() => boolean) | null>(null);
  const directoryBackHandler = useRef<(() => boolean) | null>(null);
  const consultationBackHandler = useRef<(() => boolean) | null>(null);
  const notificationsBackHandler = useRef<(() => boolean) | null>(null);
  const profileBackHandler = useRef<(() => boolean) | null>(null);
  const helpBackHandler = useRef<(() => boolean) | null>(null);

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
      if (screen === 'home') {
        if (profileBackHandler.current?.()) return true;
        if (notificationsBackHandler.current?.()) return true;
        if (helpBackHandler.current?.()) return true;
        if (farmAddressesBackHandler.current?.()) return true;
        if (patientBackHandler.current?.()) return true;
        if (consultationBackHandler.current?.()) return true;
        if (directoryBackHandler.current?.()) return true;
        return livestockBackHandler.current?.() ?? true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [screen]);

  useEffect(() => {
    if (!session || session.activeRole !== 'farmer') {
      return;
    }
    let mounted = true;
    farms.list(session.activeRole).then(
      (records) => { if (mounted) { setFarmList(records); setFarmsLoaded(true); setFarmLoadFailed(false); setFarmsBusy(false); } },
      (cause) => { if (mounted) { setError(messageFor(cause)); setFarmsLoaded(true); setFarmLoadFailed(true); setFarmsBusy(false); } },
    );
    return () => { mounted = false; };
  }, [farms, session]);

  const createFarm = async () => {
    if (!session || farmCreateInFlight.current || farmsBusy || !farmsLoaded || farmLoadFailed || farmWriteUncertain) return;
    farmCreateInFlight.current = true;
    setFarmsBusy(true);
    setError('');
    try {
      const created = await farms.create(session.activeRole, farmName);
      setFarmList((current) => [...current.filter((farm) => farm.id !== created.id), created]);
      setFarmsLoaded(true);
      setFarmLoadFailed(false);
      setFarmName('');
    } catch (cause) {
      setError(messageFor(cause));
      if (cause instanceof DomainError && cause.code === 'SERVICE_UNAVAILABLE') setFarmWriteUncertain(true);
    } finally {
      farmCreateInFlight.current = false;
      setFarmsBusy(false);
    }
  };

  const refreshFarms = async () => {
    if (!session || !farmsLoaded || farmsBusy || farmCreateInFlight.current) return;
    setFarmsBusy(true);
    setError('');
    try {
      const records = await farms.list(session.activeRole);
      setFarmList(records);
      setFarmsLoaded(true);
      setFarmLoadFailed(false);
      if (farmWriteUncertain) {
        if (records.some((farm) => farm.name === farmName.trim().replace(/\s+/g, ' '))) {
          setFarmName('');
          setError('Peternakan dengan nama itu ada dalam daftar. Periksa sebelum membuat lagi.');
        }
        setFarmWriteUncertain(false);
      }
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
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
      setFarmLoadFailed(false);
      setFarmWriteUncertain(false);
      setSelectedFarmId(null);
      setNotificationsOpen(false);
      setProfileOpen(false);
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
      setFarmLoadFailed(false);
      setFarmWriteUncertain(false);
      setSelectedFarmId(null);
      setNotificationsOpen(false);
      setProfileOpen(false);
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
      setFarmLoadFailed(false);
      setFarmWriteUncertain(false);
      setSelectedFarmId(null);
      setPassword('');
      setScreen('roles');
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const selectedFarm = farmList.find((farm) => farm.id === selectedFarmId) ?? null;

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
          {profileOpen ? <ServerProfileSection service={profiles} verificationService={vetVerification} role={session.activeRole} userId={session.userId} onExit={() => setProfileOpen(false)} onNameSaved={(displayName) => setSession((current) => current ? { ...current, displayName } : current)} backHandlerRef={profileBackHandler} />
            : notificationsOpen ? <ServerNotificationsSection service={notifications} contextService={notificationContext} role={session.activeRole} onExit={() => setNotificationsOpen(false)} backHandlerRef={notificationsBackHandler} />
            : helpOpen ? <ServerHelpSection role={session.activeRole} onExit={() => setHelpOpen(false)} backHandlerRef={helpBackHandler} /> : <>
          <Text style={styles.heading}>Akun {session.activeRole === 'farmer' ? 'Peternak' : 'Dokter Hewan'}</Text>
          <Text style={styles.description}>{session.displayName}{'\n'}{session.email}</Text>
          <Button label="Kotak Masuk & Preferensi Notifikasi" role={session.activeRole} variant="secondary" onPress={() => setNotificationsOpen(true)} />
          <Button label="Profil dan verifikasi" role={session.activeRole} variant="secondary" onPress={() => setProfileOpen(true)} />
          <Button label="Bantuan" role={session.activeRole} variant="secondary" onPress={() => setHelpOpen(true)} />
          {session.activeRole === 'farmer' && <>
            <Text style={styles.heading}>Peternakan saya</Text>
            {(!farmsLoaded || farmsBusy) && <LoadingState label="Memuat peternakan…" />}
            {farmsLoaded && !farmsBusy && !farmLoadFailed && farmList.length === 0 && <Text style={styles.description}>Belum ada peternakan.</Text>}
            {farmList.map((farm) => <View key={farm.id} style={styles.farmCard}>
              <Text style={styles.farmName}>{farm.name}</Text>
              <Text style={styles.description}>{farm.species.length ? farm.species.map(speciesLabel).join(', ') : 'Semua jenis ternak'}</Text>
              <Button label={selectedFarmId === farm.id ? 'Peternakan dipilih' : `Pilih ${farm.name}`} role="farmer" variant="secondary" selected={selectedFarmId === farm.id} disabled={farmsBusy} onPress={() => setSelectedFarmId(farm.id)} />
            </View>)}
            <TextField label="Nama peternakan baru" value={farmName} onChangeText={setFarmName} />
            {farmWriteUncertain ? <Text style={styles.description}>Muat ulang peternakan sebelum mencoba menyimpan lagi.</Text> : null}
            <Button label="Tambah peternakan" role="farmer" onPress={createFarm} loading={farmsBusy} disabled={!farmsLoaded || farmLoadFailed || farmWriteUncertain} />
            <Button label="Muat ulang peternakan" role="farmer" variant="secondary" onPress={refreshFarms} disabled={!farmsLoaded || farmsBusy} />
            <ServerFarmAddressesSection service={farms} farms={farmList} onFarmsChanged={setFarmList} backHandlerRef={farmAddressesBackHandler} />
            {selectedFarm ? <ServerLivestockSection key={selectedFarm.id} service={livestock} healthService={livestockHealth} farm={selectedFarm} userId={session.userId} backHandlerRef={livestockBackHandler} /> : null}
          </>}
          {session.activeRole === 'vet' && <ServerPatientsSection service={patients} backHandlerRef={patientBackHandler} />}
          {session.activeRole === 'farmer' && <ServerVetDirectorySection service={vets} bookingService={booking} livestockService={livestock} farms={farmList} userId={session.userId} backHandlerRef={directoryBackHandler} />}
          <ServerConsultationSection key={session.activeRole} service={consultations} clinicalService={clinical} chatService={chat} scheduleService={vetSchedule} role={session.activeRole} userId={session.userId} backHandlerRef={consultationBackHandler} />
          {session.roles.length > 1 && session.roles.map((availableRole) => <Button key={availableRole} label={`Ganti Peran: ${availableRole === 'farmer' ? 'Peternak' : 'Dokter Hewan'}`} role={availableRole} variant="secondary" disabled={busy || availableRole === session.activeRole} onPress={() => switchRole(availableRole)} />)}
          <Button label="Keluar" role={session.activeRole} variant="secondary" disabled={busy} onPress={() => setLogoutVisible(true)} />
          </>}
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
