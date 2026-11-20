import { useCallback, useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { ApiFollowUp, ApiProgressReport, ApiReminder } from '../../application/ports/ApiCareCoordinationRepository';
import type { ApiConsultationDetail } from '../../application/ports/ApiConsultationRepository';
import type { PendingCareCoordinationOperation, ServerCareCoordinationService, ServerCareCoordinationSnapshot } from '../../application/ServerCareCoordinationService';
import type { ServerClinicalService } from '../../application/ServerClinicalService';
import type { AccountRole } from '../../domain/auth';
import type { SelectedAsset } from '../../domain/profiles';
import { DomainError } from '../../domain/errors';
import { localDisplay } from '../../domain/availability';
import { Button } from '../components/Button';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { EmptyState, InlineFeedback, LoadingState } from '../components/Feedback';
import { StatusBadge } from '../components/StatusBadge';
import { TextArea, TextField } from '../components/TextField';
import { colors, fonts, layout, radii, spacing, typeScale } from '../theme/tokens';

type FormPage = 'overview' | 'follow_up' | 'reminder' | 'report';
type Props = {
  service: ServerCareCoordinationService;
  clinicalService: ServerClinicalService;
  consultation: ApiConsultationDetail;
  role: AccountRole;
  userId: string;
  onExit: () => void;
  backHandlerRef: { current: (() => boolean) | null };
};

export function ServerCareCoordinationSection({ service, clinicalService, consultation, role, userId, onExit, backHandlerRef }: Props) {
  const [snapshot, setSnapshot] = useState<ServerCareCoordinationSnapshot | null>(null);
  const [pendingOperation, setPendingOperation] = useState<PendingCareCoordinationOperation | null>(null);
  const [finalNoteExists, setFinalNoteExists] = useState(false);
  const [page, setPage] = useState<FormPage>('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [leaveVisible, setLeaveVisible] = useState(false);
  const [completeReminder, setCompleteReminder] = useState<ApiReminder | null>(null);
  const [completeCareKey, setCompleteCareKey] = useState(() => service.newOperationKey());
  const [followUpStart, setFollowUpStart] = useState('');
  const [followUpEnd, setFollowUpEnd] = useState('');
  const [followUpReason, setFollowUpReason] = useState('');
  const [followUpKey, setFollowUpKey] = useState(() => service.newOperationKey());
  const [reminderFollowUpId, setReminderFollowUpId] = useState<string | null>(null);
  const [reminderKind, setReminderKind] = useState<'care' | 'follow_up'>('care');
  const [reminderDueAt, setReminderDueAt] = useState('');
  const [reminderInstructions, setReminderInstructions] = useState('');
  const [reminderKey, setReminderKey] = useState(() => service.newOperationKey());
  const [reportFollowUp, setReportFollowUp] = useState<ApiFollowUp | null>(null);
  const [reportText, setReportText] = useState('');
  const [reportMedia, setReportMedia] = useState<SelectedAsset[]>([]);
  const [reportKey, setReportKey] = useState(() => service.newOperationKey());

  const dirty = page === 'follow_up' ? Boolean(followUpStart.trim() || followUpEnd.trim() || followUpReason.trim())
    : page === 'reminder' ? Boolean(reminderDueAt.trim() || reminderInstructions.trim() || reminderFollowUpId)
      : page === 'report' ? Boolean(reportText.trim() || reportMedia.length) : false;

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [result, note] = await Promise.all([
        service.load(role, userId, consultation),
        role === 'vet'
          ? clinicalService.getNote(role, consultation.id).catch((cause: unknown) => {
            if (cause instanceof DomainError && cause.code === 'NOT_FOUND') return null;
            throw cause;
          })
          : Promise.resolve(null),
      ]);
      setSnapshot(result);
      setFinalNoteExists(note?.status === 'final');
      setPendingOperation(result.pending);
      if (result.pending) {
        setUncertain(true);
        if (result.pending.type === 'follow_up') {
          setFollowUpStart(localDisplay(result.pending.startsAt, result.timezone));
          setFollowUpEnd(localDisplay(result.pending.endsAt, result.timezone));
          setFollowUpReason(result.pending.reason);
          setFollowUpKey(result.pending.idempotencyKey);
          setPage('follow_up');
        } else if (result.pending.type === 'reminder') {
          setReminderFollowUpId(result.pending.followUpId);
          setReminderKind(result.pending.kind);
          setReminderDueAt(localDisplay(result.pending.dueAt, result.timezone));
          setReminderInstructions(result.pending.instructions);
          setReminderKey(result.pending.idempotencyKey);
          setPage('reminder');
        } else if (result.pending.type === 'progress_report') {
          const pending = result.pending;
          setReportFollowUp(result.followUps.find((item) => item.id === pending.followUpId) ?? null);
          setReportText(pending.text);
          setReportMedia((pending.attachments ?? []).map(({ file }) => ({ ...file, kind: file.mimeType === 'video/mp4' ? 'video' : 'image' })));
          setReportKey(pending.idempotencyKey);
          setPage('report');
        } else {
          const pending = result.pending;
          setCompleteCareKey(pending.idempotencyKey);
          setCompleteReminder(result.reminders.find((item) => item.id === pending.reminderId) ?? null);
          setPage('overview');
        }
      } else {
        setUncertain(false);
      }
    } catch (cause) {
      setError(messageFor(cause, 'Tindak lanjut belum dapat dimuat.'));
    } finally {
      setLoading(false);
    }
  }, [clinicalService, consultation, role, service, userId]);

  useEffect(() => {
    const timer = setTimeout(() => { void reload(); }, 0);
    return () => clearTimeout(timer);
  }, [reload]);

  const clearFollowUp = () => { setFollowUpStart(''); setFollowUpEnd(''); setFollowUpReason(''); setFollowUpKey(service.newOperationKey()); };
  const clearReminder = () => { setReminderFollowUpId(null); setReminderKind('care'); setReminderDueAt(''); setReminderInstructions(''); setReminderKey(service.newOperationKey()); };
  const clearReport = () => { setReportFollowUp(null); setReportText(''); setReportMedia([]); setReportKey(service.newOperationKey()); };
  const back = useCallback(() => {
    if (busy) return true;
    if (completeReminder) { setCompleteReminder(null); return true; }
    if (leaveVisible) { setLeaveVisible(false); return true; }
    if (page !== 'overview') {
      if (dirty) setLeaveVisible(true);
      else setPage('overview');
      return true;
    }
    onExit();
    return true;
  }, [busy, completeReminder, dirty, leaveVisible, onExit, page]);
  useEffect(() => {
    backHandlerRef.current = back;
    return () => { backHandlerRef.current = null; };
  }, [back, backHandlerRef]);

  const runMutation = async (action: () => Promise<void>, success: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true); setError(''); setNotice('');
    try {
      await action();
      setPage('overview');
      setUncertain(false);
      setPendingOperation(null);
      setNotice(success);
      clearFollowUp(); clearReminder(); clearReport();
      await reload();
      return true;
    } catch (cause) {
      const failureMessage = messageFor(cause, 'Perubahan belum berhasil.');
      setError(failureMessage);
      if (cause instanceof DomainError && ['SERVICE_UNAVAILABLE', 'API_RESPONSE_INVALID', 'IDEMPOTENCY_CONFLICT', 'SESSION_STORAGE_FAILED'].includes(cause.code)) {
        setUncertain(true);
        await reload();
        setError(failureMessage);
      } else {
        setPendingOperation(null);
        setUncertain(false);
        setFollowUpKey(service.newOperationKey()); setReminderKey(service.newOperationKey()); setReportKey(service.newOperationKey());
      }
      return false;
    } finally { setBusy(false); }
  };

  const saveFollowUp = () => runMutation(async () => {
    if (pendingOperation) { await service.retryPending(role, userId, consultation); return; }
    if (!snapshot) throw new DomainError('INVALID_STATE', 'Muat data layanan sebelum menyimpan.');
    await service.scheduleFollowUp(role, userId, consultation, snapshot.timezone, {
      startsAt: followUpStart, endsAt: followUpEnd, reason: followUpReason, operationKey: followUpKey,
    });
  }, 'Tindak lanjut tersimpan dari akun server.');

  const saveReminder = () => runMutation(async () => {
    if (pendingOperation) { await service.retryPending(role, userId, consultation); return; }
    if (!snapshot) throw new DomainError('INVALID_STATE', 'Muat data layanan sebelum menyimpan.');
    await service.createReminder(role, userId, consultation, snapshot.timezone, {
      followUpId: reminderFollowUpId, kind: reminderKind, dueAt: reminderDueAt,
      instructions: reminderInstructions, operationKey: reminderKey,
    });
  }, 'Pengingat tersimpan. Status pengiriman tetap menunggu hasil adapter server.');

  const saveReport = () => runMutation(async () => {
    if (pendingOperation) { await service.retryPending(role, userId, consultation); return; }
    if (!reportFollowUp) throw new DomainError('INVALID_STATE', 'Pilih tindak lanjut untuk laporan.');
    await service.submitReport(role, userId, consultation, reportFollowUp, { text: reportText, operationKey: reportKey, attachments: reportMedia });
  }, 'Laporan perkembangan terkirim kepada Dokter yang menangani.');

  const pickReportMedia = async () => {
    if (busy || uncertain || reportMedia.length >= 5) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'], allowsMultipleSelection: true,
        selectionLimit: 5 - reportMedia.length, quality: 0.9,
      });
      if (result.canceled) return;
      const selected: SelectedAsset[] = result.assets.map((asset) => ({
        uri: asset.uri,
        filename: asset.fileName ?? (asset.type === 'video' ? 'video.mp4' : 'foto.jpg'),
        mimeType: asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
        byteSize: asset.fileSize ?? null,
        kind: asset.type === 'video' ? 'video' : 'image',
      }));
      setReportMedia((current) => [...current, ...selected].slice(0, 5));
      setError('');
    } catch (cause) {
      setError(messageFor(cause, 'Pemilih foto/video belum dapat dibuka.'));
    }
  };

  const completeCare = () => {
    const reminder = completeReminder;
    if (!reminder) return;
    void runMutation(async () => {
      if (pendingOperation) { await service.retryPending(role, userId, consultation); return; }
      await service.completeCare(role, userId, consultation, reminder, completeCareKey);
    }, 'Perawatan dan catatan kesehatannya dikonfirmasi oleh server.').then((saved) => {
      if (saved) { setCompleteCareKey(service.newOperationKey()); setCompleteReminder(null); }
    });
  };

  const writeReady = consultation.paymentStatus === 'succeeded'
    && ['scheduled', 'in_progress', 'completed'].includes(consultation.status);
  return <View style={styles.root}>
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.title}>Tindak lanjut & pengingat</Text>
      <Button role={role} variant="secondary" label="Kembali ke konsultasi" disabled={busy} onPress={back} />
    </View>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {loading ? <LoadingState label="Memuat data layanan server…" /> : null}
        {error ? <InlineFeedback message={error} tone="error" /> : null}
        {notice ? <InlineFeedback message={notice} /> : null}
        {!loading && error ? <Button role={role} variant="secondary" label="Muat ulang dari server" disabled={busy} onPress={() => { void reload(); }} /> : null}
        {!loading && snapshot && page === 'overview' ? <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Pemeriksaan ulang</Text>
            <Text style={styles.helper}>Waktu memakai zona {snapshot.timezone}. Penjadwalan dan kelayakan diperiksa server.</Text>
            {snapshot.followUps.length ? snapshot.followUps.map((item) => <FollowUpCard key={item.id} item={item} timezone={snapshot.timezone} role={role} onReport={() => { setReportFollowUp(item); setReportText(''); setReportMedia([]); setReportKey(service.newOperationKey()); setPage('report'); setError(''); setNotice(''); }} />)
              : <EmptyState title="Belum ada tindak lanjut" description={role === 'vet' ? 'Dokter dapat menjadwalkan pemeriksaan ulang setelah catatan final tersimpan.' : 'Dokter belum menjadwalkan pemeriksaan ulang.'} role={role} />}
            {role === 'vet' && writeReady && finalNoteExists ? <Button role={role} label="Jadwalkan pemeriksaan ulang" disabled={busy || uncertain} onPress={() => { setPage('follow_up'); setError(''); setNotice(''); }} /> : null}
            {role === 'vet' && writeReady && !finalNoteExists ? <Text style={styles.helper}>Catatan klinis final diperlukan sebelum jadwal tindak lanjut dibuat.</Text> : null}
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Pengingat</Text>
            <Text style={styles.helper}>Pengiriman pengingat terpisah dari status perawatan.</Text>
            {snapshot.reminders.length ? snapshot.reminders.map((item) => <ReminderCard key={item.id} item={item} timezone={snapshot.timezone} role={role} onComplete={() => { setCompleteCareKey(service.newOperationKey()); setCompleteReminder(item); }} />)
              : <EmptyState title="Belum ada pengingat" description="Pengingat layanan ini akan tampil setelah tersimpan." role={role} />}
            {writeReady ? <Button role={role} variant="secondary" label="Buat pengingat" disabled={busy || uncertain} onPress={() => { setPage('reminder'); setError(''); setNotice(''); }} /> : null}
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{role === 'vet' ? 'Laporan Peternak' : 'Laporan perkembangan'}</Text>
            <Text style={styles.helper}>Laporan disimpan terpisah dari catatan klinis dan riwayat kesehatan.</Text>
            {snapshot.reports.length ? snapshot.reports.map((item) => <ReportCard key={item.id} item={item} timezone={snapshot.timezone} role={role} service={service} userId={userId} consultation={consultation} />)
              : <EmptyState title="Belum ada laporan" description={role === 'farmer' ? 'Kirim laporan setelah Dokter menjadwalkan tindak lanjut.' : 'Laporan Peternak akan tampil di sini.'} role={role} />}
          </View>
        </> : null}
        {!loading && snapshot && page === 'follow_up' ? <View style={styles.card}>
          <Text style={styles.cardTitle}>Waktu pemeriksaan ulang</Text>
          <Text style={styles.helper}>Tanggal/jam lokal Dokter ({snapshot.timezone}), format YYYY-MM-DD HH:mm.</Text>
          <TextField label="Mulai" value={followUpStart} onChangeText={setFollowUpStart} editable={!busy && !uncertain} placeholder="YYYY-MM-DD HH:mm" maxLength={16} keyboardType="numbers-and-punctuation" />
          <TextField label="Selesai" value={followUpEnd} onChangeText={setFollowUpEnd} editable={!busy && !uncertain} placeholder="YYYY-MM-DD HH:mm" maxLength={16} keyboardType="numbers-and-punctuation" />
          <TextArea label="Alasan tindak lanjut" value={followUpReason} onChangeText={setFollowUpReason} editable={!busy && !uncertain} maxLength={1000} helperText="3–1.000 karakter. Catatan tetap berada pada layanan ini." />
          <Button role={role} label={uncertain ? 'Kirim ulang permintaan yang sama' : 'Simpan tindak lanjut'} loading={busy} disabled={busy || (uncertain ? false : !writeReady)} onPress={() => { void saveFollowUp(); }} />
        </View> : null}
        {!loading && snapshot && page === 'reminder' ? <View style={styles.card}>
          <Text style={styles.cardTitle}>Pengingat layanan</Text>
          <Text style={styles.helper}>Tanggal/jam memakai zona {snapshot.timezone}. Pengingat baru menunggu status delivery server.</Text>
          <View style={styles.choiceRow}>
            <Button role={role} selected={reminderKind === 'care'} label="Perawatan" disabled={busy || uncertain} onPress={() => setReminderKind('care')} />
            <Button role={role} variant="secondary" selected={reminderKind === 'follow_up'} label="Tindak lanjut" disabled={busy || uncertain} onPress={() => setReminderKind('follow_up')} />
          </View>
          {snapshot.followUps.map((item) => <Button key={item.id} role={role} variant="secondary" selected={reminderFollowUpId === item.id} label={`${reminderFollowUpId === item.id ? 'Tertaut · ' : 'Tautkan · '}${formatDate(item.startsAt, snapshot.timezone)}`} disabled={busy || uncertain} onPress={() => setReminderFollowUpId(reminderFollowUpId === item.id ? null : item.id)} />)}
          <TextField label="Jatuh tempo" value={reminderDueAt} onChangeText={setReminderDueAt} editable={!busy && !uncertain} placeholder="YYYY-MM-DD HH:mm" maxLength={16} keyboardType="numbers-and-punctuation" />
          <TextArea label="Instruksi" value={reminderInstructions} onChangeText={setReminderInstructions} editable={!busy && !uncertain} maxLength={500} helperText="3–500 karakter. Jangan masukkan dosis obat." />
          <Button role={role} label={uncertain ? 'Kirim ulang permintaan yang sama' : 'Simpan pengingat'} loading={busy} disabled={busy || (uncertain ? false : !writeReady)} onPress={() => { void saveReminder(); }} />
        </View> : null}
        {!loading && snapshot && page === 'report' ? <View style={styles.card}>
          <Text style={styles.cardTitle}>Laporan perkembangan</Text>
          <Text style={styles.helper}>Laporan ini dikirim ke Dokter yang menangani, bukan sebagai catatan pemeriksaan.</Text>
          {reportFollowUp ? <Text style={styles.helper}>Tindak lanjut {formatDate(reportFollowUp.startsAt, snapshot.timezone)}</Text> : null}
          <TextArea label="Perkembangan ternak" value={reportText} onChangeText={setReportText} editable={!busy && !uncertain} maxLength={2000} helperText="3–2.000 karakter." />
          {reportMedia.map((asset, index) => <View key={`${asset.uri}-${index}`} style={styles.row}>
            <Text style={styles.helper}>{asset.kind === 'video' ? 'Video' : 'Foto'} · {asset.filename}</Text>
            <Button role={role} variant="secondary" label="Hapus lampiran" disabled={busy || uncertain} onPress={() => setReportMedia((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
          </View>)}
          <Button role={role} variant="secondary" label={`Tambah foto/video (${reportMedia.length}/5)`} disabled={busy || uncertain || reportMedia.length >= 5} onPress={() => { void pickReportMedia(); }} />
          <Button role={role} label={uncertain ? 'Kirim ulang laporan yang sama' : 'Kirim laporan'} loading={busy} disabled={busy || uncertain && !reportFollowUp} onPress={() => { void saveReport(); }} />
        </View> : null}
      </ScrollView>
    </KeyboardAvoidingView>
    <ConfirmationDialog visible={!!completeReminder} title="Konfirmasi perawatan" message="Tandai perawatan sudah dilakukan? Server menyimpan status dan satu catatan kesehatan. Status delivery pengingat tetap terpisah." role={role} confirmLabel="Tandai dilakukan" onConfirm={completeCare} onCancel={() => setCompleteReminder(null)} loading={busy} />
    <Modal visible={leaveVisible} transparent animationType="fade" onRequestClose={() => { if (!busy) setLeaveVisible(false); }}>
      <View style={styles.modalBackdrop}><View style={styles.dialog}>
        <Text accessibilityRole="header" style={styles.cardTitle}>Perubahan belum tersimpan</Text>
        <Text style={styles.body}>Buang isi form dan kembali ke tindak lanjut?</Text>
        <Button role={role} label="Buang perubahan" disabled={busy} onPress={() => { setLeaveVisible(false); setPage('overview'); clearFollowUp(); clearReminder(); clearReport(); setError(''); setUncertain(false); }} />
        <Button role={role} variant="secondary" label="Tetap mengedit" disabled={busy} onPress={() => setLeaveVisible(false)} />
      </View></View>
    </Modal>
  </View>;
}

function FollowUpCard({ item, timezone, role, onReport }: { item: ApiFollowUp; timezone: string; role: AccountRole; onReport: () => void }) {
  const tone = item.status === 'scheduled' ? 'pending' : item.status === 'completed' ? 'success' : 'error';
  return <View style={styles.itemCard}>
    <View style={styles.row}><Text style={styles.cardTitle}>Pemeriksaan ulang</Text><StatusBadge role={role} label={item.status === 'scheduled' ? 'Terjadwal' : item.status === 'completed' ? 'Selesai' : 'Dibatalkan'} tone={tone} /></View>
    <Text style={styles.body}>{formatDate(item.startsAt, timezone)} – {formatTime(item.endsAt, timezone)}</Text>
    <Text selectable style={styles.body}>{item.reason}</Text>
    {role === 'farmer' && item.status !== 'cancelled' ? <Button role={role} variant="secondary" label="Kirim laporan perkembangan" onPress={onReport} /> : null}
  </View>;
}

function ReminderCard({ item, timezone, role, onComplete }: { item: ApiReminder; timezone: string; role: AccountRole; onComplete: () => void }) {
  return <View style={styles.itemCard}>
    <View style={styles.row}><Text style={styles.cardTitle}>{item.kind === 'care' ? 'Perawatan' : 'Tindak lanjut'}</Text><StatusBadge role={role} label={item.deliveryStatus === 'sent' ? 'Terkirim' : item.deliveryStatus === 'failed' ? 'Gagal' : 'Menunggu'} tone={item.deliveryStatus === 'sent' ? 'success' : item.deliveryStatus === 'failed' ? 'error' : 'pending'} /></View>
    <Text style={styles.helper}>Jatuh tempo · {formatDate(item.dueAt, timezone)}</Text>
    <Text style={styles.body}>{item.instructions}</Text>
    <Text style={styles.helper}>Perawatan · {item.careStatus === 'done' ? `Dilakukan${item.completedAt ? ` · ${formatDate(item.completedAt, timezone)}` : ''}` : 'Belum dikonfirmasi'}</Text>
    {item.deliveryStatus === 'sent' && item.careStatus === 'scheduled' ? <InlineFeedback message="Pengingat terkirim; perawatan belum dinyatakan dilakukan." /> : null}
    {role === 'farmer' && item.kind === 'care' && item.careStatus === 'scheduled' ? <Button role={role} variant="secondary" label="Tandai perawatan dilakukan" onPress={onComplete} /> : null}
  </View>;
}

function ReportCard({ item, timezone, role, service, userId, consultation }: {
  item: ApiProgressReport; timezone: string; role: AccountRole; service: ServerCareCoordinationService;
  userId: string; consultation: ApiConsultationDetail;
}) {
  const [mediaBusyId, setMediaBusyId] = useState<string | null>(null);
  const [opened, setOpened] = useState<Record<string, { uri: string; kind: 'image' | 'video'; filename: string }>>({});
  const [mediaError, setMediaError] = useState('');
  return <View style={styles.itemCard}>
    <Text style={styles.helper}>{role === 'vet' ? `Diterima ${formatDate(item.submittedAt, timezone)}` : `Dikirim ${formatDate(item.submittedAt, timezone)}`}{role === 'vet' ? item.viewedAt ? ' · sudah dibaca' : ' · belum dibaca' : ''}</Text>
    <Text selectable style={styles.body}>{item.text}</Text>
    {item.attachmentIds.map((id) => <View key={id} style={styles.itemCard}>
      <Text style={styles.helper}>{opened[id]?.filename ?? `Lampiran ${id.slice(0, 8)}`}</Text>
      {opened[id]?.kind === 'image' ? <Image source={{ uri: opened[id].uri }} accessibilityLabel={`Lampiran ${opened[id].filename}`} resizeMode="contain" style={styles.mediaPreview} /> : null}
      {opened[id]?.kind === 'video' ? <Text style={styles.helper}>Video diunduh privat; pemutaran video belum tersedia.</Text> : null}
      {mediaError ? <InlineFeedback message={mediaError} tone="error" /> : null}
      <Button role={role} variant="secondary" label={opened[id] ? 'Lampiran dibuka' : mediaBusyId === id ? 'Membuka lampiran…' : 'Buka lampiran privat'} disabled={!!mediaBusyId} onPress={() => {
        setMediaBusyId(id); setMediaError('');
        service.downloadReportAttachment(role, userId, consultation, item, id).then(
          (result) => setOpened((current) => ({ ...current, [id]: { uri: result.localUri, kind: result.attachment.kind, filename: result.attachment.filename } })),
          (cause) => setMediaError(messageFor(cause, 'Lampiran laporan belum dapat dibuka.')),
        ).finally(() => setMediaBusyId(null));
      }} />
    </View>)}
  </View>;
}

function formatDate(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(date);
}
function formatTime(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(date);
}
function messageFor(cause: unknown, fallback: string): string { return cause instanceof Error ? cause.message : fallback; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  flex: { flex: 1 },
  header: { gap: spacing[3], paddingHorizontal: layout.contentHorizontal, paddingTop: spacing[2] },
  title: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.section, lineHeight: 26 },
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: layout.contentHorizontal, paddingTop: spacing[3], paddingBottom: spacing[8], gap: spacing[4], flexGrow: 1 },
  card: { padding: spacing[4], gap: spacing[3], backgroundColor: colors.white, borderRadius: radii.cardFarmer },
  itemCard: { padding: spacing[3], gap: spacing[2], borderRadius: radii.button, backgroundColor: colors.cream },
  cardTitle: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.body, lineHeight: 22, flexShrink: 1 },
  helper: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.label, lineHeight: 19 },
  mediaPreview: { width: '100%', height: 220, borderRadius: 12, backgroundColor: colors.cream },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22, flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing[2] },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: spacing[4], backgroundColor: 'rgba(34, 28, 20, 0.45)' },
  dialog: { width: '100%', maxWidth: 420, alignSelf: 'center', padding: spacing[5], gap: spacing[3], backgroundColor: colors.white, borderRadius: radii.cardFarmer },
});
