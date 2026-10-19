import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { AccountRole, SessionSnapshot } from '../../domain/auth';
import type { NotificationCategory, PreferencesSnapshot, PreferencesUpdate } from '../../application/PreferencesService';
import { Button } from '../components/Button';
import { ErrorState, InlineFeedback, LoadingState } from '../components/Feedback';
import { Icon, type IconName } from '../components/Icon';
import { colors, fonts, layout, roleTokens, spacing, typeScale } from '../theme/tokens';

type Page = 'settings' | 'preferences' | 'help';
type Props = {
  store: LocalStore;
  session: SessionSnapshot;
  onBack: () => void;
  onOpenProfile: () => void;
  onSwitchRole: () => void;
  onLogout: () => void;
};

const categoryCopy: Record<NotificationCategory, { label: string; description: string }> = {
  consultations: { label: 'Konsultasi dan jadwal', description: 'Permintaan, perubahan jadwal, dan pesan layanan.' },
  reminders: { label: 'Pengingat perawatan', description: 'Pengingat terjadwal dan pembaruan tindak lanjut.' },
  commerce: { label: 'Pesanan dan pembayaran', description: 'Perubahan status pesanan serta pembayaran.' },
};

const helpEntries: { id: string; title: string; body: string }[] = [
  { id: 'consultation', title: 'Bagaimana membuka detail layanan?', body: 'Buka Kotak Masuk atau Konsultasi, lalu pilih pembaruan yang ingin dilihat. Dokter hanya dapat membuka pasien yang terhubung dengan layanannya.' },
  { id: 'reminder', title: 'Apa bedanya pengingat dan tindak lanjut?', body: 'Pengingat memiliki status pengiriman dan status perawatan. Jadwal tindak lanjut dan laporan perkembangan Peternak tersimpan sebagai catatan terpisah.' },
  { id: 'preferences', title: 'Apa yang berubah saat preferensi dimatikan?', body: 'Preferensi mengatur kategori pembaruan. Notifikasi yang sudah tersimpan tetap dapat dibaca di Kotak Masuk.' },
  { id: 'role', title: 'Bagaimana mengganti peran?', body: 'Pilih Ganti Peran untuk kembali ke pemilih peran. Pilihan peran tidak menambah hak akses akun.' },
];

export function AccountSettingsFlow({ store, session, onBack, onOpenProfile, onSwitchRole, onLogout }: Props) {
  const role = session.activeRole;
  const cardRadius = roleTokens[role].cardRadius;
  const [page, setPage] = useState<Page>('settings');
  const [preferences, setPreferences] = useState<PreferencesSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [logoutVisible, setLogoutVisible] = useState(false);
  const [openHelpId, setOpenHelpId] = useState('');

  const reloadPreferences = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPreferences(await store.preferences.load(session.userId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Preferensi belum dapat dimuat.');
    } finally {
      setLoading(false);
    }
  }, [session.userId, store]);

  useEffect(() => {
    const request = setTimeout(() => { void reloadPreferences(); }, 0);
    return () => clearTimeout(request);
  }, [reloadPreferences]);

  const back = useCallback(() => {
    if (logoutVisible) {
      setLogoutVisible(false);
      return;
    }
    if (page !== 'settings') {
      setPage('settings');
      setError('');
      setNotice('');
      return;
    }
    onBack();
  }, [logoutVisible, onBack, page]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => subscription.remove();
  }, [back]);

  const savePreferences = async (patch: PreferencesUpdate) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await store.preferences.update(session.userId, patch);
      setPreferences(saved);
      setNotice('Preferensi berhasil disimpan.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Preferensi belum tersimpan. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  const title = page === 'settings' ? 'Pengaturan akun' : page === 'preferences' ? 'Preferensi notifikasi' : 'Bantuan';
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Kembali" onPress={back} style={styles.headerButton}>
          <Icon name="arrow-left" size={22} color={colors.brown} />
        </Pressable>
        <Text accessibilityRole="header" style={styles.headerTitle}>{title}</Text>
        <View style={styles.headerButton} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {error ? <ErrorState message={error} role={role} onRetry={() => void reloadPreferences()} /> : null}
        {notice ? <InlineFeedback message={notice} tone="success" /> : null}
        {page === 'settings' ? (
          <>
            <View style={[styles.accountCard, { borderRadius: cardRadius }]}>
              <View style={[styles.avatar, role === 'farmer' ? styles.farmerAvatar : styles.vetAvatar]}>
                <Icon name={role === 'farmer' ? 'paw-print' : 'stethoscope'} size={24} color={role === 'farmer' ? colors.orange : colors.brown} />
              </View>
              <View style={styles.accountCopy}>
                <Text style={styles.accountName}>{session.displayName}</Text>
                <Text style={styles.accountRole}>{roleLabel(role)}</Text>
              </View>
            </View>
            <Text accessibilityRole="header" style={styles.sectionTitle}>Akun</Text>
            <SettingsRow role={role} icon="user-round" title="Profil" description="Ubah informasi profil dan data layanan." onPress={onOpenProfile} />
            <SettingsRow role={role} icon="bell" title="Preferensi notifikasi" description="Atur pembaruan konsultasi, perawatan, dan pesanan." onPress={() => { setPage('preferences'); setError(''); setNotice(''); }} />
            <SettingsRow role={role} icon="circle-help" title="Bantuan" description="Panduan singkat penggunaan VetLink." onPress={() => { setPage('help'); setError(''); setNotice(''); }} />
            <View style={[styles.infoCard, { borderRadius: cardRadius }]}>
              <Text style={styles.infoLabel}>Bahasa</Text>
              <Text style={styles.infoValue}>Indonesia</Text>
            </View>
            <View style={[styles.infoCard, { borderRadius: cardRadius }]}>
              <Text style={styles.infoLabel}>Akses dan privasi</Text>
              <Text style={styles.infoBody}>Dokter hanya melihat pasien yang terkait dengan layanannya. Mengganti peran tidak menambah hak akses.</Text>
            </View>
            <Button label="Ganti Peran" role={role} variant="secondary" onPress={onSwitchRole} />
            <Button label="Keluar" role={role} variant="accent" onPress={() => setLogoutVisible(true)} />
          </>
        ) : null}

        {page === 'preferences' ? (
          <>
            <Text style={styles.description}>Pengaturan kategori tidak menghapus pembaruan yang sudah tersimpan di Kotak Masuk.</Text>
            {loading ? <LoadingState label="Memuat preferensi…" /> : null}
            {!loading && preferences ? (
              <>
                <PreferenceSwitch
                  role={role}
                  label="Semua notifikasi"
                  description="Aktifkan atau nonaktifkan seluruh kategori pembaruan."
                  value={preferences.enabled}
                  disabled={busy}
                  onChange={(enabled) => void savePreferences({ enabled })}
                />
                {(['consultations', 'reminders', 'commerce'] as const).map((category) => (
                  <PreferenceSwitch
                    key={category}
                    role={role}
                    label={categoryCopy[category].label}
                    description={categoryCopy[category].description}
                    value={preferences.notifications[category]}
                    disabled={busy}
                    onChange={(enabled) => void savePreferences({ notifications: { [category]: enabled } })}
                  />
                ))}
              </>
            ) : null}
          </>
        ) : null}

        {page === 'help' ? (
          <>
            <Text style={styles.description}>Pilih topik untuk melihat panduan singkat.</Text>
            {helpEntries.map((entry) => {
              const expanded = openHelpId === entry.id;
              return (
                <Pressable
                  key={entry.id}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  onPress={() => setOpenHelpId(expanded ? '' : entry.id)}
                  style={({ pressed }) => [styles.helpCard, { borderRadius: cardRadius }, pressed && styles.pressed]}
                >
                  <View style={styles.helpHeading}>
                    <Text style={styles.helpTitle}>{entry.title}</Text>
                    <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.brown} />
                  </View>
                  {expanded ? <Text style={styles.helpBody}>{entry.body}</Text> : null}
                </Pressable>
              );
            })}
          </>
        ) : null}
      </ScrollView>
      <Modal visible={logoutVisible} transparent animationType="fade" onRequestClose={() => setLogoutVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View accessibilityViewIsModal style={[styles.dialog, { borderRadius: cardRadius }]}>
            <Text accessibilityRole="header" style={styles.dialogTitle}>Keluar dari sesi ini?</Text>
            <Text style={styles.dialogCopy}>Anda akan kembali ke Pilih Peran. Data akun dan layanan yang tersimpan tetap ada.</Text>
            <Button label="Keluar" role={role} variant="accent" onPress={onLogout} />
            <Button label="Batal" role={role} variant="secondary" onPress={() => setLogoutVisible(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SettingsRow({ role, icon, title, description, onPress }: { role: AccountRole; icon: IconName; title: string; description: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.settingsRow, { borderRadius: roleTokens[role].cardRadius }, pressed && styles.pressed]}>
      <View style={[styles.rowIcon, role === 'farmer' ? styles.farmerIcon : styles.vetIcon]}><Icon name={icon} size={21} color={role === 'farmer' ? colors.orange : colors.brown} /></View>
      <View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowDescription}>{description}</Text></View>
      <Icon name="chevron-right" size={20} color={colors.muted} />
    </Pressable>
  );
}

function PreferenceSwitch({ role, label, description, value, disabled, onChange }: { role: AccountRole; label: string; description: string; value: boolean; disabled: boolean; onChange: (enabled: boolean) => void }) {
  return (
    <View style={[styles.preferenceRow, { borderRadius: roleTokens[role].cardRadius }]}>
      <View style={styles.preferenceCopy}>
        <Text style={styles.preferenceTitle}>{label}</Text>
        <Text style={styles.rowDescription}>{description}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: '#CDBFA7', true: role === 'farmer' ? colors.orange : colors.brown }}
        thumbColor={colors.white}
        style={styles.switch}
      />
    </View>
  );
}

function roleLabel(role: AccountRole): string { return role === 'farmer' ? 'Peternak' : 'Dokter Hewan'; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream, paddingHorizontal: spacing[4], paddingTop: spacing[2] },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerButton: { width: layout.minimumTouchTarget, height: layout.minimumTouchTarget, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.heading, textAlign: 'center' },
  content: { gap: spacing[3], paddingBottom: spacing[6] },
  accountCard: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[4], backgroundColor: colors.white },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  farmerAvatar: { backgroundColor: colors.cream }, vetAvatar: { backgroundColor: '#F1E8D5' },
  accountCopy: { flex: 1, gap: spacing[1] },
  accountName: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.heading, lineHeight: 25, flexShrink: 1 },
  accountRole: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.body },
  sectionTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.section, lineHeight: 25, marginTop: spacing[2] },
  settingsRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[3], backgroundColor: colors.white },
  pressed: { opacity: 0.8 },
  rowIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  farmerIcon: { backgroundColor: colors.cream }, vetIcon: { backgroundColor: '#F1E8D5' },
  rowCopy: { flex: 1, gap: spacing[1] },
  rowTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.body, lineHeight: 22 },
  rowDescription: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 18, flexShrink: 1 },
  infoCard: { gap: spacing[1], padding: spacing[4], backgroundColor: colors.white },
  infoLabel: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.body },
  infoValue: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body },
  infoBody: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21, flexShrink: 1 },
  description: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21 },
  preferenceRow: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[4], backgroundColor: colors.white },
  preferenceCopy: { flex: 1, gap: spacing[1] },
  preferenceTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.body, lineHeight: 22 },
  switch: { minWidth: 52 },
  helpCard: { minHeight: 56, gap: spacing[3], padding: spacing[4], backgroundColor: colors.white },
  helpHeading: { minHeight: layout.minimumTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  helpTitle: { flex: 1, color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.body, lineHeight: 22 },
  helpBody: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22, flexShrink: 1 },
  modalBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing[5], backgroundColor: 'rgba(30, 20, 15, 0.48)' },
  dialog: { width: '100%', maxWidth: 350, maxHeight: '85%', padding: spacing[5], gap: spacing[4], backgroundColor: colors.white },
  dialogTitle: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.heading, lineHeight: 29, flexShrink: 1 },
  dialogCopy: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21, flexShrink: 1 },
});
