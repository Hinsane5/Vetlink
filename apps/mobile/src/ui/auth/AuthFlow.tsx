import { useEffect, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { AccountRole, SessionSnapshot } from '../../domain/auth';
import { DomainError } from '../../domain/errors';
import { Button } from '../components/Button';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { Icon, type IconName } from '../components/Icon';
import { LoadingState } from '../components/Feedback';
import { TextField } from '../components/TextField';
import { ProfileFlow } from '../profile/ProfileFlow';
import { DashboardFlow } from '../dashboard/DashboardFlow';
import { colors, fonts, layout, radii, spacing, typeScale } from '../theme/tokens';

type AuthScreen = 'loading' | 'splash' | 'onboarding' | 'roles' | 'login' | 'register' | 'reset' | 'home' | 'profile';

const onboarding = [
  {
    icon: 'paw-print' as IconName,
    title: 'Kenali kondisi ternak',
    description: 'Simpan informasi ternak dan riwayat perawatannya dalam satu tempat.',
  },
  {
    icon: 'stethoscope' as IconName,
    title: 'Terhubung dengan dokter hewan',
    description: 'Pilih layanan yang sesuai dan bicarakan kebutuhan ternak Anda.',
  },
  {
    icon: 'messages-square' as IconName,
    title: 'Ikuti perawatan bersama',
    description: 'Catatan konsultasi dan tindak lanjut tetap terhubung dengan ternak.',
  },
];

export function AuthFlow({ store }: { store: LocalStore }) {
  const [screen, setScreen] = useState<AuthScreen>('loading');
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [selectedRole, setSelectedRole] = useState<AccountRole>('farmer');
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [logoutDialogVisible, setLogoutDialogVisible] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([store.auth.restoreSession(), store.authStore.hasCompletedOnboarding()]).then(
      ([restored, onboardingCompleted]) => {
        if (!mounted) return;
        if (restored) {
          setSession(restored);
          setSelectedRole(restored.activeRole);
          setScreen('home');
        } else {
          setScreen(onboardingCompleted ? 'roles' : 'splash');
        }
      },
      () => {
        if (mounted) {
          setErrorMessage('Data akun lokal belum dapat dibaca. Tutup lalu buka kembali aplikasi.');
          setScreen('roles');
        }
      },
    );
    return () => {
      mounted = false;
    };
  }, [store]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (logoutDialogVisible) {
        setLogoutDialogVisible(false);
        return true;
      }
      if (screen === 'home' || screen === 'loading') return false;
      if (screen === 'profile') return true;
      if (screen === 'onboarding') {
        if (onboardingStep > 0) setOnboardingStep((step) => step - 1);
        else setScreen('splash');
        return true;
      }
      if (screen === 'login') {
        setScreen('roles');
        setAuthNotice('');
        return true;
      }
      if (screen === 'register' || screen === 'reset') {
        setScreen('login');
        setErrorMessage('');
        setResetMessage('');
        return true;
      }
      if (screen === 'roles') {
        if (!session && onboardingStep >= 0) setScreen('splash');
        else setScreen('home');
        return true;
      }
      if (screen === 'splash') return false;
      return false;
    });
    return () => subscription.remove();
  }, [logoutDialogVisible, onboardingStep, screen, session]);

  const startOnboarding = () => {
    setOnboardingStep(0);
    setScreen('onboarding');
  };

  const finishOnboarding = async () => {
    let saved = true;
    try {
      await store.authStore.markOnboardingCompleted();
    } catch {
      saved = false;
      setErrorMessage('Preferensi belum tersimpan. Anda tetap dapat melanjutkan.');
    }
    if (saved) setErrorMessage('');
    setScreen('roles');
  };

  const onContinueFromRoles = async (intent: 'login' | 'register') => {
    setErrorMessage('');
    setAuthNotice('');
    if (session?.roles.includes(selectedRole) && intent === 'login') {
      try {
        setBusy(true);
        const next = await store.auth.switchRole(selectedRole);
        setSession(next);
        setScreen('home');
      } catch (error) {
        setErrorMessage(messageFor(error));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (session && !session.roles.includes(selectedRole)) {
      setAuthNotice('Akun yang sedang aktif belum memiliki peran ini. Masuk atau daftar dengan akun lain.');
    }
    setScreen(intent);
  };

  const submitLogin = async () => {
    setBusy(true);
    setErrorMessage('');
    try {
      const next = await store.auth.login({ email, password, role: selectedRole });
      setSession(next);
      setSelectedRole(next.activeRole);
      setAuthNotice('');
      setScreen('home');
    } catch (error) {
      setErrorMessage(messageFor(error));
    } finally {
      setBusy(false);
    }
  };

  const submitRegistration = async () => {
    if (password !== confirmPassword) {
      setErrorMessage('Kata sandi dan konfirmasi harus sama.');
      return;
    }
    setBusy(true);
    setErrorMessage('');
    try {
      const next = await store.auth.register({ name, email, password, role: selectedRole });
      setSession(next);
      setSelectedRole(next.activeRole);
      setAuthNotice('');
      setScreen('home');
    } catch (error) {
      setErrorMessage(messageFor(error));
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async () => {
    if (password !== confirmPassword) {
      setErrorMessage('Kata sandi dan konfirmasi harus sama.');
      return;
    }
    setBusy(true);
    setErrorMessage('');
    try {
      await store.auth.resetPassword({ email, role: selectedRole, newPassword: password });
      setResetMessage('Pemulihan lokal selesai. Jika akun ini tersimpan di perangkat, masuk menggunakan kata sandi baru. Tidak ada email yang dikirim.');
      setPassword('');
      setConfirmPassword('');
    } catch (error) {
      setErrorMessage(messageFor(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmLogout = async () => {
    setBusy(true);
    try {
      await store.auth.logout();
      setSession(null);
      setSelectedRole('farmer');
      setLogoutDialogVisible(false);
      setScreen('roles');
    } catch {
      setErrorMessage('Sesi belum dapat dihapus. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.cream} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboard}
      >
        {screen === 'home' && session ? (
          <DashboardFlow
            store={store}
            session={session}
            onOpenProfile={() => {
              setErrorMessage('');
              setScreen('profile');
            }}
            onSwitchRole={() => {
              setErrorMessage('');
              setScreen('roles');
            }}
            onLogout={() => setLogoutDialogVisible(true)}
          />
        ) : screen === 'loading' ? (
          <LoadingState label="Memeriksa sesi akun…" />
        ) : (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.content}>
              {screen === 'splash' ? (
                <SplashScreen onStart={startOnboarding} />
              ) : null}

              {screen === 'onboarding' ? (
                <OnboardingScreen
                  step={onboardingStep}
                  onBack={() => onboardingStep > 0 ? setOnboardingStep((step) => step - 1) : setScreen('splash')}
                  onNext={() => onboardingStep < onboarding.length - 1 ? setOnboardingStep((step) => step + 1) : void finishOnboarding()}
                  onSkip={() => void finishOnboarding()}
                />
              ) : null}

              {screen === 'roles' ? (
                <RoleSelectionScreen
                  selectedRole={selectedRole}
                  allowedRoles={session?.roles ?? []}
                  isSwitching={Boolean(session)}
                  busy={busy}
                  error={errorMessage}
                  onSelect={(role) => {
                    setSelectedRole(role);
                    setErrorMessage('');
                  }}
                  onLogin={() => void onContinueFromRoles('login')}
                  onRegister={() => void onContinueFromRoles('register')}
                />
              ) : null}

              {screen === 'login' ? (
                <LoginScreen
                  role={selectedRole}
                  email={email}
                  password={password}
                  busy={busy}
                  error={errorMessage}
                  notice={authNotice}
                  onEmail={setEmail}
                  onPassword={setPassword}
                  onSubmit={() => void submitLogin()}
                  onBack={() => {
                    setErrorMessage('');
                    setAuthNotice('');
                    setScreen('roles');
                  }}
                  onRegister={() => {
                    setErrorMessage('');
                    setConfirmPassword('');
                    setScreen('register');
                  }}
                  onReset={() => {
                    setErrorMessage('');
                    setResetMessage('');
                    setPassword('');
                    setConfirmPassword('');
                    setScreen('reset');
                  }}
                />
              ) : null}

              {screen === 'register' ? (
                <RegisterScreen
                  role={selectedRole}
                  name={name}
                  email={email}
                  password={password}
                  confirmPassword={confirmPassword}
                  busy={busy}
                  error={errorMessage}
                  onName={setName}
                  onEmail={setEmail}
                  onPassword={setPassword}
                  onConfirmPassword={setConfirmPassword}
                  onSubmit={() => void submitRegistration()}
                  onBack={() => {
                    setErrorMessage('');
                    setScreen('login');
                  }}
                  onLogin={() => {
                    setErrorMessage('');
                    setScreen('login');
                  }}
                />
              ) : null}

              {screen === 'reset' ? (
                <ResetScreen
                  role={selectedRole}
                  email={email}
                  password={password}
                  confirmPassword={confirmPassword}
                  busy={busy}
                  error={errorMessage}
                  success={resetMessage}
                  onEmail={setEmail}
                  onPassword={setPassword}
                  onConfirmPassword={setConfirmPassword}
                  onSubmit={() => void submitReset()}
                  onBack={() => {
                    setErrorMessage('');
                    setResetMessage('');
                    setScreen('login');
                  }}
                  onLogin={() => {
                    setErrorMessage('');
                    setResetMessage('');
                    setScreen('login');
                  }}
                />
              ) : null}

              {screen === 'profile' && session ? (
                <ProfileFlow
                  store={store}
                  session={session}
                  onBack={() => setScreen('home')}
                  onDisplayNameChange={(displayName) => setSession((current) => current ? { ...current, displayName } : current)}
                />
              ) : null}
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
      <ConfirmationDialog
        visible={logoutDialogVisible}
        title="Keluar dari akun?"
        message="Sesi pada perangkat ini akan diakhiri. Akun, profil, dan data lokal lainnya tetap tersimpan."
        role={session?.activeRole ?? selectedRole}
        confirmLabel="Keluar"
        cancelLabel="Tetap masuk"
        destructive
        loading={busy}
        onCancel={() => setLogoutDialogVisible(false)}
        onConfirm={() => void confirmLogout()}
      />
    </SafeAreaView>
  );
}

function SplashScreen({ onStart }: { onStart: () => void }) {
  return (
    <View style={styles.centeredScreen}>
      <BrandMark size={88} />
      <Text accessibilityRole="header" style={styles.splashTitle}>VetLink</Text>
      <Text style={styles.splashSubtitle}>Teman merawat ternak dan menjaga kesehatannya.</Text>
      <Button label="Mulai" role="farmer" onPress={onStart} style={styles.bottomButton} />
    </View>
  );
}

function OnboardingScreen({
  step,
  onBack,
  onNext,
  onSkip,
}: {
  step: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const page = onboarding[step];
  return (
    <View style={styles.screen}>
      <View style={styles.topActions}>
        <IconAction label="Kembali" icon="arrow-left" onPress={onBack} />
        <Pressable accessibilityRole="button" onPress={onSkip} style={styles.linkHit}>
          <Text style={styles.textLink}>Lewati</Text>
        </Pressable>
      </View>
      <View style={styles.onboardingHero}>
        <View style={styles.illustrationCircle}>
          <Icon name={page.icon} size={58} color={colors.brown} />
        </View>
      </View>
      <Text accessibilityRole="header" style={styles.pageTitle}>{page.title}</Text>
      <Text style={styles.pageDescription}>{page.description}</Text>
      <View style={styles.pagination} accessibilityLabel={`Halaman ${step + 1} dari ${onboarding.length}`}>
        {onboarding.map((item, index) => (
          <View key={item.title} style={[styles.pageDot, index === step && styles.pageDotSelected]} />
        ))}
      </View>
      <Button
        label={step === onboarding.length - 1 ? 'Mulai' : 'Lanjut'}
        role="farmer"
        onPress={onNext}
        style={styles.bottomButton}
      />
    </View>
  );
}

function RoleSelectionScreen({
  selectedRole,
  allowedRoles,
  isSwitching,
  busy,
  error,
  onSelect,
  onLogin,
  onRegister,
}: {
  selectedRole: AccountRole;
  allowedRoles: AccountRole[];
  isSwitching: boolean;
  busy: boolean;
  error: string;
  onSelect: (role: AccountRole) => void;
  onLogin: () => void;
  onRegister: () => void;
}) {
  return (
    <View style={styles.screen}>
      <BrandHeader />
      <Text accessibilityRole="header" style={styles.pageTitle}>{isSwitching ? 'Ganti Peran' : 'Pilih Peran'}</Text>
      <Text style={styles.pageDescription}>
        {isSwitching ? 'Pilih profil yang sudah terhubung ke akun ini.' : 'Pilih cara Anda menggunakan VetLink.'}
      </Text>
      <RoleCard
        role="farmer"
        selected={selectedRole === 'farmer'}
        available={allowedRoles.includes('farmer')}
        isSwitching={isSwitching}
        onPress={() => onSelect('farmer')}
      />
      <RoleCard
        role="vet"
        selected={selectedRole === 'vet'}
        available={allowedRoles.includes('vet')}
        isSwitching={isSwitching}
        onPress={() => onSelect('vet')}
      />
      {error ? <InlineError message={error} /> : null}
      <Button
        label={isSwitching && allowedRoles.includes(selectedRole) ? 'Ganti Peran' : isSwitching ? 'Masuk dengan Akun Lain' : 'Masuk'}
        role={selectedRole}
        loading={busy}
        onPress={onLogin}
      />
      <Button label={isSwitching ? 'Daftar Akun Lain' : 'Daftar Akun'} role={selectedRole} variant="secondary" onPress={onRegister} />
    </View>
  );
}

function RoleCard({
  role,
  selected,
  available,
  isSwitching,
  onPress,
}: {
  role: AccountRole;
  selected: boolean;
  available: boolean;
  isSwitching: boolean;
  onPress: () => void;
}) {
  const farmer = role === 'farmer';
  const title = farmer ? 'Peternak' : 'Dokter Hewan';
  const description = farmer
    ? 'Kelola ternak, konsultasi, dan perawatan.'
    : 'Kelola layanan, pasien, dan catatan pemeriksaan.';
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.roleCard, selected && styles.roleCardSelected, isSwitching && !available && styles.roleCardUnavailable]}
    >
      <View style={styles.roleIcon}>
        <Icon name={farmer ? 'paw-print' : 'stethoscope'} size={28} />
      </View>
      <View style={styles.roleCopy}>
        <Text style={styles.roleTitle}>{title}</Text>
        <Text style={styles.roleDescription}>{description}</Text>
        {isSwitching ? (
          <Text style={styles.roleHint}>{available ? 'Terhubung ke akun ini' : 'Perlu masuk dengan akun lain'}</Text>
        ) : null}
      </View>
      <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
        {selected ? <View style={styles.radioInner} /> : null}
      </View>
    </Pressable>
  );
}

function LoginScreen({
  role,
  email,
  password,
  busy,
  error,
  notice,
  onEmail,
  onPassword,
  onSubmit,
  onBack,
  onRegister,
  onReset,
}: {
  role: AccountRole;
  email: string;
  password: string;
  busy: boolean;
  error: string;
  notice: string;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  onRegister: () => void;
  onReset: () => void;
}) {
  return (
    <View style={styles.screen}>
      <AuthHeader onBack={onBack} role={role} />
      <Text accessibilityRole="header" style={styles.pageTitle}>Masuk</Text>
      <Text style={styles.pageDescription}>Lanjutkan sebagai {roleLabel(role)}.</Text>
      {notice ? <InlineNotice message={notice} /> : null}
      <TextField
        label="Email"
        placeholder="nama@email.com"
        value={email}
        onChangeText={onEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="emailAddress"
        returnKeyType="next"
      />
      <TextField
        label="Kata sandi"
        placeholder="Masukkan kata sandi"
        value={password}
        onChangeText={onPassword}
        secureTextEntry
        autoCapitalize="none"
        textContentType="password"
        returnKeyType="done"
        onSubmitEditing={onSubmit}
      />
      <Pressable accessibilityRole="button" onPress={onReset} style={styles.alignEndHit}>
        <Text style={styles.textLink}>Lupa kata sandi?</Text>
      </Pressable>
      {error ? <InlineError message={error} /> : null}
      <Button label="Masuk" role={role} loading={busy} onPress={onSubmit} />
      <View style={styles.inlineLinkRow}>
        <Text style={styles.inlineText}>Belum punya akun?</Text>
        <Pressable accessibilityRole="button" onPress={onRegister} style={styles.linkHit}>
          <Text style={styles.textLink}>Daftar</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RegisterScreen({
  role,
  name,
  email,
  password,
  confirmPassword,
  busy,
  error,
  onName,
  onEmail,
  onPassword,
  onConfirmPassword,
  onSubmit,
  onBack,
  onLogin,
}: {
  role: AccountRole;
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  busy: boolean;
  error: string;
  onName: (value: string) => void;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onConfirmPassword: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  onLogin: () => void;
}) {
  return (
    <View style={styles.screen}>
      <AuthHeader onBack={onBack} role={role} />
      <Text accessibilityRole="header" style={styles.pageTitle}>Buat Akun {role === 'farmer' ? 'Peternak' : 'Dokter'}</Text>
      <Text style={styles.pageDescription}>Isi data akun untuk mulai menggunakan VetLink.</Text>
      <TextField
        label={role === 'farmer' ? 'Nama lengkap' : 'Nama dokter hewan'}
        placeholder="Nama Anda"
        value={name}
        onChangeText={onName}
        autoCapitalize="words"
        textContentType="name"
        returnKeyType="next"
      />
      <TextField
        label="Email"
        placeholder="nama@email.com"
        value={email}
        onChangeText={onEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="emailAddress"
        returnKeyType="next"
      />
      <TextField
        label="Kata sandi"
        placeholder="Minimal 8 karakter"
        value={password}
        onChangeText={onPassword}
        secureTextEntry
        autoCapitalize="none"
        textContentType="newPassword"
        returnKeyType="next"
      />
      <TextField
        label="Ulangi kata sandi"
        placeholder="Masukkan kembali kata sandi"
        value={confirmPassword}
        onChangeText={onConfirmPassword}
        secureTextEntry
        autoCapitalize="none"
        textContentType="newPassword"
        returnKeyType="done"
        onSubmitEditing={onSubmit}
      />
      {role === 'vet' ? <InlineNotice message="Profil dokter baru dimulai dengan status verifikasi belum diajukan." /> : null}
      {error ? <InlineError message={error} /> : null}
      <Button label="Daftar" role={role} loading={busy} onPress={onSubmit} />
      <View style={styles.inlineLinkRow}>
        <Text style={styles.inlineText}>Sudah punya akun?</Text>
        <Pressable accessibilityRole="button" onPress={onLogin} style={styles.linkHit}>
          <Text style={styles.textLink}>Masuk</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ResetScreen({
  role,
  email,
  password,
  confirmPassword,
  busy,
  error,
  success,
  onEmail,
  onPassword,
  onConfirmPassword,
  onSubmit,
  onBack,
  onLogin,
}: {
  role: AccountRole;
  email: string;
  password: string;
  confirmPassword: string;
  busy: boolean;
  error: string;
  success: string;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onConfirmPassword: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  onLogin: () => void;
}) {
  return (
    <View style={styles.screen}>
      <AuthHeader onBack={onBack} role={role} />
      <Text accessibilityRole="header" style={styles.pageTitle}>Atur Ulang Kata Sandi</Text>
      <Text style={styles.pageDescription}>Pemulihan ini berlaku untuk akun lokal yang tersimpan di perangkat ini.</Text>
      {!success ? (
        <>
          <TextField
            label="Email akun"
            placeholder="nama@email.com"
            value={email}
            onChangeText={onEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
          />
          <TextField
            label="Kata sandi baru"
            placeholder="Minimal 8 karakter"
            value={password}
            onChangeText={onPassword}
            secureTextEntry
            autoCapitalize="none"
            textContentType="newPassword"
          />
          <TextField
            label="Ulangi kata sandi baru"
            placeholder="Masukkan kembali kata sandi"
            value={confirmPassword}
            onChangeText={onConfirmPassword}
            secureTextEntry
            autoCapitalize="none"
            textContentType="newPassword"
          />
          <InlineNotice message="Tidak ada tautan email yang dikirim. Akun fixture bawaan tidak dapat diambil alih melalui reset lokal." />
          {error ? <InlineError message={error} /> : null}
          <Button label="Simpan Kata Sandi Baru" role={role} loading={busy} onPress={onSubmit} />
        </>
      ) : (
        <>
          <InlineNotice message={success} />
          <Button label="Kembali ke Masuk" role={role} onPress={onLogin} />
        </>
      )}
    </View>
  );
}

function AuthHeader({ onBack, role }: { onBack: () => void; role: AccountRole }) {
  return (
    <View style={styles.authHeader}>
      <IconAction label="Kembali" icon="arrow-left" onPress={onBack} />
      <Text style={styles.authRole}>{roleLabel(role)}</Text>
      <View style={styles.emptyAction} />
    </View>
  );
}

function BrandHeader() {
  return (
    <View style={styles.brandHeader}>
      <BrandMark size={40} />
      <Text style={styles.brandText}>VetLink</Text>
    </View>
  );
}

function BrandMark({ size }: { size: number }) {
  return (
    <View style={[styles.brandMark, { width: size, height: size, borderRadius: size / 3 }]}>
      <Icon name="paw-print" size={size * 0.46} color={colors.white} />
    </View>
  );
}

function IconAction({ label, icon, onPress }: { label: string; icon: IconName; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.iconAction}>
      <Icon name={icon} size={22} />
    </Pressable>
  );
}

function InlineError({ message }: { message: string }) {
  return <Text accessibilityRole="alert" style={styles.errorText}>{message}</Text>;
}

function InlineNotice({ message }: { message: string }) {
  return (
    <View style={styles.notice}>
      <Icon name="info" size={18} color={colors.brown} />
      <Text style={styles.noticeText}>{message}</Text>
    </View>
  );
}

function roleLabel(role: AccountRole): string {
  return role === 'farmer' ? 'Peternak' : 'Dokter Hewan';
}

function messageFor(error: unknown): string {
  if (!(error instanceof DomainError)) return 'Terjadi kendala. Periksa data lalu coba lagi.';
  switch (error.code) {
    case 'VALIDATION_FAILED':
      return error.message;
    case 'EMAIL_IN_USE':
      return error.message;
    case 'INVALID_CREDENTIALS':
      return error.message;
    case 'ROLE_NOT_ALLOWED':
      return error.message;
    case 'SESSION_INVALID':
      return error.message;
    case 'SESSION_STORAGE_FAILED':
      return error.message;
    default:
      return 'Data akun belum dapat disimpan. Coba lagi.';
  }
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  keyboard: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    paddingBottom: spacing[6],
    alignItems: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 430,
    flexGrow: 1,
  },
  screen: {
    flex: 1,
    gap: spacing[4],
  },
  centeredScreen: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing[4],
  },
  brandMark: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brown,
  },
  brandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  brandText: {
    color: colors.brown,
    fontFamily: fonts.bold,
    fontSize: 19,
  },
  splashTitle: {
    color: colors.brown,
    fontFamily: fonts.bold,
    fontSize: 34,
    textAlign: 'center',
  },
  splashSubtitle: {
    maxWidth: 290,
    color: colors.dark,
    fontFamily: fonts.regular,
    fontSize: typeScale.body,
    lineHeight: 22,
    textAlign: 'center',
  },
  bottomButton: {
    marginTop: 'auto',
  },
  topActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  iconAction: {
    width: layout.minimumTouchTarget,
    height: layout.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  emptyAction: {
    width: layout.minimumTouchTarget,
    height: layout.minimumTouchTarget,
  },
  linkHit: {
    minHeight: layout.minimumTouchTarget,
    minWidth: layout.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[2],
  },
  alignEndHit: {
    alignSelf: 'flex-end',
    minHeight: layout.minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing[2],
  },
  textLink: {
    color: colors.brown,
    fontFamily: fonts.semiBold,
    fontSize: typeScale.body,
    textDecorationLine: 'underline',
  },
  authHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  authRole: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: typeScale.small,
  },
  pageTitle: {
    color: colors.dark,
    fontFamily: fonts.bold,
    fontSize: typeScale.title,
    lineHeight: 32,
    flexShrink: 1,
  },
  pageDescription: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: typeScale.body,
    lineHeight: 21,
    flexShrink: 1,
  },
  onboardingHero: {
    minHeight: 310,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.cardFarmer,
    backgroundColor: colors.white,
  },
  illustrationCircle: {
    width: 176,
    height: 176,
    borderRadius: 88,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
  },
  pageDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.gold,
    opacity: 0.55,
  },
  pageDotSelected: {
    width: 24,
    opacity: 1,
  },
  roleCard: {
    minHeight: 96,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: radii.cardFarmer,
    backgroundColor: colors.white,
  },
  roleCardSelected: {
    borderWidth: 2,
    borderColor: colors.brown,
  },
  roleCardUnavailable: {
    opacity: 0.68,
  },
  roleIcon: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: colors.cream,
  },
  roleCopy: {
    flex: 1,
    gap: 3,
  },
  roleTitle: {
    color: colors.dark,
    fontFamily: fonts.semiBold,
    fontSize: typeScale.body,
  },
  roleDescription: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: typeScale.small,
    lineHeight: 18,
  },
  roleHint: {
    color: colors.brown,
    fontFamily: fonts.medium,
    fontSize: typeScale.caption,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: colors.brown,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.brown,
  },
  inlineLinkRow: {
    minHeight: layout.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  inlineText: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: typeScale.body,
  },
  errorText: {
    color: colors.orange,
    fontFamily: fonts.medium,
    fontSize: typeScale.small,
    lineHeight: 19,
    flexShrink: 1,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radii.button,
    backgroundColor: '#F2E2C7',
  },
  noticeText: {
    flex: 1,
    color: colors.dark,
    fontFamily: fonts.regular,
    fontSize: typeScale.small,
    lineHeight: 18,
  },
});
