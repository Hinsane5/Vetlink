import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { SessionSnapshot } from '../../domain/auth';
import type { CareCoordinationSnapshot, ReminderKind } from '../../domain/careCoordination';
import type { DomainEntity } from '../../domain/entities';
import { DomainError } from '../../domain/errors';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, InlineFeedback, LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { TextArea, TextField } from '../components/TextField';
import { colors, fonts, layout, radii, roleTokens, spacing, typeScale } from '../theme/tokens';

type Screen = 'overview' | 'followUpForm' | 'reminderForm' | 'reportForm';

type Props = {
  store: LocalStore;
  session: SessionSnapshot;
  consultationId: string;
  onExit: () => void;
};

export function CareCoordinationFlow({ store, session, consultationId, onExit }: Props) {
  const role = session.activeRole;
  const [snapshot, setSnapshot] = useState<CareCoordinationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [screen, setScreen] = useState<Screen>('overview');
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [confirmReminder, setConfirmReminder] = useState<string | null>(null);

  const [followUpStart, setFollowUpStart] = useState('');
  const [followUpEnd, setFollowUpEnd] = useState('');
  const [followUpReason, setFollowUpReason] = useState('');
  const [followUpKey, setFollowUpKey] = useState(() => Crypto.randomUUID());
  const [reminderDueAt, setReminderDueAt] = useState('');
  const [reminderInstructions, setReminderInstructions] = useState('');
  const [reminderKind, setReminderKind] = useState<ReminderKind>('care');
  const [reminderFollowUpId, setReminderFollowUpId] = useState<string | null>(null);
  const [reminderKey, setReminderKey] = useState(() => Crypto.randomUUID());
  const [reportFollowUpId, setReportFollowUpId] = useState<string | null>(null);
  const [reportText, setReportText] = useState('');
  const [reportKey, setReportKey] = useState(() => Crypto.randomUUID());

  const dirty = useMemo(() => {
    if (screen === 'followUpForm') return Boolean(followUpStart.trim() || followUpEnd.trim() || followUpReason.trim());
    if (screen === 'reminderForm') return Boolean(reminderDueAt.trim() || reminderInstructions.trim() || reminderFollowUpId);
    if (screen === 'reportForm') return Boolean(reportText.trim());
    return false;
  }, [followUpEnd, followUpReason, followUpStart, reminderDueAt, reminderFollowUpId, reminderInstructions, reportText, screen]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await store.careCoordination.load(session.userId, role, consultationId);
      setSnapshot(next);
    } catch (cause) {
      setSnapshot(null);
      setError(messageFor(cause));
    } finally {
      setLoading(false);
    }
  }, [consultationId, role, session.userId, store]);

  useEffect(() => {
    const timer = setTimeout(() => { void reload(); }, 0);
    return () => clearTimeout(timer);
  }, [reload]);

  const clearFollowUp = () => {
    setFollowUpStart(''); setFollowUpEnd(''); setFollowUpReason(''); setFollowUpKey(Crypto.randomUUID());
  };
  const clearReminder = () => {
    setReminderDueAt(''); setReminderInstructions(''); setReminderKind('care'); setReminderFollowUpId(null); setReminderKey(Crypto.randomUUID());
  };
  const clearReport = () => { setReportText(''); setReportKey(Crypto.randomUUID()); setReportFollowUpId(null); };

  const back = useCallback(() => {
    if (busy) return true;
    if (confirmReminder) { setConfirmReminder(null); return true; }
    if (leaveDialog) { setLeaveDialog(false); return true; }
    if (screen !== 'overview') {
      if (dirty) setLeaveDialog(true);
      else setScreen('overview');
      return true;
    }
    onExit();
    return true;
  }, [busy, confirmReminder, dirty, leaveDialog, onExit, screen]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', back);
    return () => subscription.remove();
  }, [back]);

  const saveFollowUp = async () => {
    if (!snapshot || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await store.careCoordination.scheduleFollowUp(session.userId, consultationId, {
        startsAt: followUpStart,
        endsAt: followUpEnd,
        reason: followUpReason,
        operationKey: followUpKey,
      });
      setScreen('overview');
      clearFollowUp();
      setNotice(`Tindak lanjut tersimpan untuk ${formatDateTime(String(saved.payload.startsAt), snapshot.timezone)}. Jadwal tampil pada kalender dokter.`);
      await reload();
    } catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  };

  const saveReminder = async () => {
    if (!snapshot || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await store.careCoordination.createReminder(session.userId, role, {
        consultationId,
        followUpId: reminderFollowUpId,
        kind: reminderKind,
        dueAt: reminderDueAt,
        instructions: reminderInstructions,
        operationKey: reminderKey,
      });
      setScreen('overview');
      clearReminder();
      setNotice(`Pengingat tersimpan untuk ${formatDateTime(saved.dueAt, snapshot.timezone)}. Status pengiriman: belum terkirim.`);
      await reload();
    } catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  };

  const saveReport = async () => {
    if (!reportFollowUpId || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await store.careCoordination.submitProgressReport(session.userId, reportFollowUpId, {
        text: reportText,
        operationKey: reportKey,
      });
      setScreen('overview');
      clearReport();
      setNotice('Laporan perkembangan tersimpan dan tersedia bagi dokter yang menangani layanan ini.');
      await reload();
    } catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  };

  const completeCare = async () => {
    if (!confirmReminder || busy) return;
    const reminderId = confirmReminder;
    setBusy(true); setError(''); setNotice('');
    try {
      await store.careCoordination.completeCare(session.userId, reminderId);
      setConfirmReminder(null);
      setNotice('Perawatan tersimpan pada pengingat dan riwayat kesehatan ternak.');
      await reload();
    } catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Kembali" disabled={busy} onPress={back} style={styles.backButton}>
          <Icon name="arrow-left" color={colors.brown} size={22} />
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>{screen === 'followUpForm' ? 'Jadwalkan pemeriksaan ulang' : screen === 'reminderForm' ? 'Buat pengingat' : screen === 'reportForm' ? 'Laporan perkembangan' : 'Tindak lanjut & pengingat'}</Text>
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {loading ? <LoadingState label="Memuat tindak lanjut…" /> : null}
          {error ? <ErrorState message={error} role={role} onRetry={() => { void reload(); }} /> : null}
          {notice ? <InlineFeedback message={notice} /> : null}
          {!loading && snapshot && screen === 'overview' ? <>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Pemeriksaan ulang</Text>
              <Text style={styles.helper}>Waktu memakai zona {snapshot.timezone}. Jadwal tersimpan terpisah dari layanan asal.</Text>
              {snapshot.followUps.length ? snapshot.followUps.map((item) => <FollowUpCard
                key={item.id}
                record={item}
                timezone={snapshot.timezone}
                role={role}
                onReport={() => { setReportFollowUpId(item.id); setReportText(''); setReportKey(Crypto.randomUUID()); setScreen('reportForm'); setError(''); setNotice(''); }}
              />) : <EmptyState title="Belum ada tindak lanjut" description={role === 'vet' ? 'Jadwalkan pemeriksaan ulang dari layanan ini.' : 'Dokter belum menjadwalkan pemeriksaan ulang.'} role={role} />}
              {role === 'vet' ? snapshot.canScheduleFollowUp
                ? <Button label="Jadwalkan pemeriksaan ulang" role={role} onPress={() => { setScreen('followUpForm'); setError(''); setNotice(''); }} />
                : <InlineFeedback message="Dokter terverifikasi, layanan berbayar, dan catatan final diperlukan untuk menjadwalkan tindak lanjut." />
                : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Pengingat</Text>
              <Text style={styles.helper}>Pengiriman pengingat dan konfirmasi perawatan memiliki status terpisah.</Text>
              {snapshot.reminders.length ? snapshot.reminders.map((item) => <View key={item.record.id} style={styles.itemCard}>
                <View style={styles.itemHeading}>
                  <Text style={styles.itemTitle}>{item.kind === 'care' ? 'Perawatan' : 'Tindak lanjut'}</Text>
                  <StatusBadge role={role} label={deliveryLabel(item.deliveryStatus)} tone={item.deliveryStatus === 'sent' ? 'success' : item.deliveryStatus === 'failed' ? 'error' : 'pending'} />
                </View>
                <Line label="Jatuh tempo" value={formatDateTime(item.dueAt, snapshot.timezone)} />
                <Line label="Instruksi" value={item.instructions} />
                <Line label="Perawatan" value={item.careStatus === 'done' ? `Dilakukan · ${formatDateTime(item.completedAt ?? item.dueAt, snapshot.timezone)}` : 'Belum dikonfirmasi'} />
                {item.deliveryStatus === 'sent' && item.careStatus === 'scheduled' ? <InlineFeedback message="Pengingat terkirim; perawatan belum dinyatakan dilakukan." /> : null}
                {role === 'farmer' && item.kind === 'care' && item.careStatus === 'scheduled' ? <Button role={role} label="Tandai perawatan dilakukan" variant="secondary" disabled={busy} onPress={() => setConfirmReminder(item.record.id)} /> : null}
              </View>) : <EmptyState title="Belum ada pengingat" description="Pengingat yang terkait ternak ini akan tampil di sini." role={role} />}
              <Button role={role} label="Buat pengingat" variant="secondary" onPress={() => { setScreen('reminderForm'); setError(''); setNotice(''); }} />
            </View>

            {role === 'farmer' ? <View style={styles.card}>
              <Text style={styles.sectionTitle}>Laporan perkembangan</Text>
              <Text style={styles.helper}>Laporan tersimpan terpisah dari catatan kesehatan dan hanya dapat dibaca dokter yang ditugaskan.</Text>
              {snapshot.reports.length ? snapshot.reports.map((item) => <View key={item.record.id} style={styles.itemCard}>
                <Line label={`Dikirim ${formatDateTime(item.submittedAt, snapshot.timezone)}`} value={item.text} />
              </View>) : <EmptyState title="Belum ada laporan" description="Kirim laporan setelah dokter menjadwalkan pemeriksaan ulang." role={role} />}
            </View> : <View style={styles.card}>
              <Text style={styles.sectionTitle}>Laporan Peternak</Text>
              {snapshot.reports.length ? snapshot.reports.map((item) => <View key={item.record.id} style={styles.itemCard}>
                <Line label={`Diterima ${formatDateTime(item.submittedAt, snapshot.timezone)}`} value={item.text} />
                {item.viewedAt ? <Text style={styles.helper}>Dibaca {formatDateTime(item.viewedAt, snapshot.timezone)}</Text> : null}
              </View>) : <EmptyState title="Belum ada laporan" description="Laporan perkembangan Peternak akan tampil setelah dikirim." role={role} />}
            </View>}
          </> : null}

          {!loading && snapshot && screen === 'followUpForm' ? <View style={styles.card}>
            <Text style={styles.sectionTitle}>Waktu pemeriksaan ulang</Text>
            <Text style={styles.helper}>Gunakan tanggal dan jam lokal dokter ({snapshot.timezone}), format YYYY-MM-DD HH:mm.</Text>
            <TextField label="Mulai" value={followUpStart} onChangeText={setFollowUpStart} placeholder="2026-10-20 09:00" keyboardType="numbers-and-punctuation" maxLength={16} helperText="Contoh format; pilih waktu mendatang dalam jam kerja." />
            <TextField label="Selesai" value={followUpEnd} onChangeText={setFollowUpEnd} placeholder="2026-10-20 09:30" keyboardType="numbers-and-punctuation" maxLength={16} helperText="Waktu mulai harus sebelum selesai." />
            <TextArea label="Alasan / catatan tindak lanjut" value={followUpReason} onChangeText={setFollowUpReason} maxLength={1000} helperText="3–1.000 karakter" />
            {error ? <InlineFeedback message={error} tone="error" /> : null}
            <Button role={role} label="Simpan tindak lanjut" loading={busy} onPress={() => { void saveFollowUp(); }} />
          </View> : null}

          {!loading && snapshot && screen === 'reminderForm' ? <View style={styles.card}>
            <Text style={styles.sectionTitle}>Pengingat untuk ternak ini</Text>
            <Text style={styles.helper}>Waktu memakai zona {snapshot.timezone}. Pengingat baru tersimpan sebagai belum terkirim.</Text>
            <View style={styles.choiceRow}>
              <Button role={role} selected={reminderKind === 'care'} label="Perawatan" onPress={() => setReminderKind('care')} style={styles.choiceButton} />
              <Button role={role} selected={reminderKind === 'follow_up'} label="Tindak lanjut" variant="secondary" onPress={() => setReminderKind('follow_up')} style={styles.choiceButton} />
            </View>
            {snapshot.followUps.length ? <View style={styles.cardInset}>
              <Text style={styles.fieldLabel}>Tautkan tindak lanjut (opsional)</Text>
              <Button role={role} selected={!reminderFollowUpId} label="Tanpa tautan" variant="secondary" onPress={() => setReminderFollowUpId(null)} />
              {snapshot.followUps.map((item) => <Button key={item.id} role={role} selected={reminderFollowUpId === item.id} label={formatDateTime(String(item.payload.startsAt), snapshot.timezone)} variant="secondary" onPress={() => setReminderFollowUpId(item.id)} />)}
            </View> : null}
            <TextField label="Jatuh tempo" value={reminderDueAt} onChangeText={setReminderDueAt} placeholder="2026-10-20 09:00" keyboardType="numbers-and-punctuation" maxLength={16} helperText="Format YYYY-MM-DD HH:mm, pada waktu mendatang." />
            <TextArea label="Instruksi" value={reminderInstructions} onChangeText={setReminderInstructions} maxLength={500} helperText="3–500 karakter. Hindari mencatat dosis obat nyata." />
            {error ? <InlineFeedback message={error} tone="error" /> : null}
            <Button role={role} label="Simpan pengingat" loading={busy} onPress={() => { void saveReminder(); }} />
          </View> : null}

          {!loading && snapshot && screen === 'reportForm' ? <View style={styles.card}>
            <Text style={styles.sectionTitle}>Laporan perkembangan ternak</Text>
            <Text style={styles.helper}>Laporan ini dikirim kepada dokter yang membuat tindak lanjut. Ini bukan catatan pemeriksaan dokter.</Text>
            <TextArea label="Perkembangan" value={reportText} onChangeText={setReportText} maxLength={2000} helperText="3–2.000 karakter" placeholder="Tulis perubahan yang Anda amati." />
            {error ? <InlineFeedback message={error} tone="error" /> : null}
            <Button role={role} label="Kirim laporan" loading={busy} onPress={() => { void saveReport(); }} />
          </View> : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmationDialog
        visible={!!confirmReminder}
        title="Konfirmasi perawatan"
        message="Tandai perawatan sebagai dilakukan? Pengingat akan tetap memiliki status pengiriman tersendiri dan satu catatan perawatan akan masuk ke riwayat kesehatan."
        role={role}
        confirmLabel="Tandai dilakukan"
        loading={busy}
        onCancel={() => setConfirmReminder(null)}
        onConfirm={() => { void completeCare(); }}
      />
      <Modal visible={leaveDialog} transparent animationType="fade" onRequestClose={() => { if (!busy) setLeaveDialog(false); }}>
        <View style={styles.modalBackdrop}><View style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Perubahan belum tersimpan</Text>
          <Text style={styles.body}>Buang perubahan pada form ini?</Text>
          <Button role={role} label="Buang" disabled={busy} onPress={() => { setLeaveDialog(false); setScreen('overview'); clearFollowUp(); clearReminder(); clearReport(); setError(''); }} />
          <Button role={role} label="Tetap mengedit" variant="secondary" disabled={busy} onPress={() => setLeaveDialog(false)} />
        </View></View>
      </Modal>
    </View>
  );
}

function FollowUpCard({ record, timezone, role, onReport }: { record: DomainEntity; timezone: string; role: 'farmer' | 'vet'; onReport: () => void }) {
  const status = String(record.payload.status);
  return <View style={styles.itemCard}>
    <View style={styles.itemHeading}>
      <Text style={styles.itemTitle}>Pemeriksaan ulang</Text>
      <StatusBadge role={role} label={followUpStatus(status)} tone={status === 'scheduled' ? 'pending' : status === 'completed' ? 'success' : 'error'} />
    </View>
    <Line label="Waktu" value={`${formatDateTime(String(record.payload.startsAt), timezone)} – ${formatTime(String(record.payload.endsAt), timezone)}`} />
    <Line label="Catatan" value={String(record.payload.reason || 'Tidak ada catatan tambahan.')} />
    {role === 'farmer' && status !== 'cancelled' ? <Button role={role} variant="secondary" label="Kirim laporan perkembangan" onPress={onReport} /> : null}
  </View>;
}

function Line({ label, value }: { label: string; value: string }) {
  return <View style={styles.line}><Text style={styles.fieldLabel}>{label}</Text><Text selectable style={styles.body}>{value}</Text></View>;
}

function formatDateTime(value: string, timezone: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Waktu belum ditentukan' : new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(date);
}

function formatTime(value: string, timezone: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(date);
}

function deliveryLabel(value: string): string { return value === 'sent' ? 'Terkirim' : value === 'failed' ? 'Gagal' : 'Belum terkirim'; }
function followUpStatus(value: string): string { return value === 'completed' ? 'Selesai' : value === 'cancelled' ? 'Dibatalkan' : 'Terjadwal'; }
function messageFor(cause: unknown): string { return cause instanceof DomainError ? cause.message : 'Informasi tindak lanjut belum dapat dimuat atau disimpan. Coba lagi.'; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  flex: { flex: 1 },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.contentHorizontal, paddingVertical: spacing[2], gap: spacing[3], backgroundColor: colors.cream },
  backButton: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white, borderRadius: radii.button },
  title: { flex: 1, color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.section, lineHeight: 26, flexShrink: 1 },
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: layout.contentHorizontal, paddingTop: spacing[3], paddingBottom: spacing[8], gap: spacing[4], flexGrow: 1 },
  card: { padding: spacing[4], gap: spacing[3], backgroundColor: colors.white, borderRadius: radii.cardFarmer },
  itemCard: { padding: spacing[3], gap: spacing[2], borderRadius: radii.button, backgroundColor: colors.cream },
  itemHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing[2] },
  itemTitle: { flex: 1, color: colors.dark, fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 22, flexShrink: 1 },
  sectionTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: 18, lineHeight: 25, flexShrink: 1 },
  helper: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, flexShrink: 1 },
  line: { gap: spacing[1] },
  fieldLabel: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, flexShrink: 1 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  choiceButton: { flex: 1, minWidth: 120 },
  cardInset: { padding: spacing[3], gap: spacing[2], borderWidth: 1, borderColor: colors.gold, borderRadius: radii.button },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: spacing[4], backgroundColor: 'rgba(34, 28, 20, 0.45)' },
  dialog: { width: '100%', maxWidth: 420, alignSelf: 'center', padding: spacing[5], gap: spacing[3], backgroundColor: colors.white, borderRadius: roleTokens.farmer.cardRadius },
});
