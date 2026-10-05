import { useEffect, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { AccountRole, SessionSnapshot } from '../../domain/auth';
import { DomainError } from '../../domain/errors';
import { Button } from '../components/Button';
import { InlineFeedback } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { DashboardFlow } from '../dashboard/DashboardFlow';
import { ProfileFlow } from '../profile/ProfileFlow';
import { colors, fonts, layout, radii, spacing, typeScale } from '../theme/tokens';

export function FrontendFlow({ store }: { store: LocalStore }) {
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [screen, setScreen] = useState<'roles' | 'home' | 'profile'>('roles');
  const [selectedRole, setSelectedRole] = useState<AccountRole>('farmer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'roles' && session) {
        setScreen('home');
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [screen, session]);

  const openRole = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await store.preview.open(selectedRole);
      setSession(next);
      setScreen('home');
    } catch (cause) {
      setError(cause instanceof DomainError ? cause.message : 'Halaman peran belum dapat dibuka. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.cream} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {screen === 'home' && session ? (
        <DashboardFlow
          key={session.userId}
          store={store}
          session={session}
          onOpenProfile={() => setScreen('profile')}
          onSwitchRole={() => {
            setSelectedRole(session.activeRole);
            setScreen('roles');
          }}
        />
      ) : null}
      {screen === 'profile' && session ? (
        <ScrollView contentContainerStyle={styles.profileContent} keyboardShouldPersistTaps="handled">
          <ProfileFlow
            store={store}
            session={session}
            onBack={() => setScreen('home')}
            onDisplayNameChange={(displayName) => setSession((current) => current ? { ...current, displayName } : null)}
          />
        </ScrollView>
      ) : null}
      {screen === 'roles' ? (
        <ScrollView contentContainerStyle={styles.rolesContent} keyboardShouldPersistTaps="handled">
          <View style={styles.brandMark}><Icon name="paw-print" size={36} color={colors.white} /></View>
          <Text style={styles.brandName}>VetLink</Text>
          <Text accessibilityRole="header" style={styles.title}>{session ? 'Ganti Peran' : 'Pilih Peran'}</Text>
          <Text style={styles.subtitle}>Jelajahi layanan kesehatan ternak dari sisi yang Anda pilih.</Text>
          <RoleCard role="farmer" selected={selectedRole === 'farmer'} onPress={() => setSelectedRole('farmer')} />
          <RoleCard role="vet" selected={selectedRole === 'vet'} onPress={() => setSelectedRole('vet')} />
          {error ? <InlineFeedback message={error} tone="error" /> : null}
          <Button
            label={selectedRole === 'farmer' ? 'Lanjut sebagai Peternak' : 'Lanjut sebagai Dokter Hewan'}
            role={selectedRole}
            loading={busy}
            onPress={() => void openRole()}
            style={styles.continueButton}
          />
          {session ? <Button label="Kembali ke beranda" role={selectedRole} variant="secondary" onPress={() => setScreen('home')} /> : null}
        </ScrollView>
      ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function RoleCard({ role, selected, onPress }: { role: AccountRole; selected: boolean; onPress: () => void }) {
  const farmer = role === 'farmer';
  const title = farmer ? 'Peternak' : 'Dokter Hewan';
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.roleCard, selected && styles.roleCardSelected, pressed && styles.pressed]}
    >
      <View style={[styles.roleIcon, selected && styles.roleIconSelected]}>
        <Icon name={farmer ? 'paw-print' : 'stethoscope'} size={26} color={selected ? colors.white : colors.brown} />
      </View>
      <View style={styles.roleCopy}>
        <Text style={styles.roleTitle}>{title}</Text>
        <Text style={styles.roleDescription}>{farmer ? 'Kelola ternak dan lihat riwayat kesehatannya.' : 'Lihat pasien dan layanan yang terhubung.'}</Text>
      </View>
      <Icon name={selected ? 'check' : 'chevron-right'} size={22} color={colors.brown} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.cream },
  flex: { flex: 1 },
  rolesContent: { flexGrow: 1, paddingHorizontal: layout.contentHorizontal, paddingTop: spacing[8], paddingBottom: spacing[8], gap: spacing[4] },
  brandMark: { width: 68, height: 68, borderRadius: 20, backgroundColor: colors.brown, alignItems: 'center', justifyContent: 'center' },
  brandName: { color: colors.brown, fontFamily: fonts.bold, fontSize: 21, lineHeight: 28 },
  title: { color: colors.dark, fontFamily: fonts.bold, fontSize: typeScale.title, lineHeight: 32, marginTop: spacing[5] },
  subtitle: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21, marginBottom: spacing[2] },
  roleCard: { minHeight: 104, flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[4], backgroundColor: colors.white, borderRadius: radii.cardFarmer, borderWidth: 2, borderColor: colors.gold },
  roleCardSelected: { borderColor: colors.brown },
  roleIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' },
  roleIconSelected: { backgroundColor: colors.brown },
  roleCopy: { flex: 1, gap: spacing[1] },
  roleTitle: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.section, lineHeight: 24 },
  roleDescription: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 18 },
  continueButton: { marginTop: spacing[5] },
  profileContent: { flexGrow: 1, alignItems: 'center', paddingHorizontal: layout.contentHorizontal, paddingTop: spacing[3], paddingBottom: spacing[6] },
  pressed: { opacity: 0.82 },
});
