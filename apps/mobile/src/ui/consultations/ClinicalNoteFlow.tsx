import { useCallback, useEffect, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { SessionSnapshot } from '../../domain/auth';
import { clinicalFieldLabels, type ClinicalNoteField, type ClinicalNoteFields, type ClinicalNoteSnapshot } from '../../domain/clinicalNotes';
import type { ConsultationDetail } from '../../domain/consultations';
import { DomainError } from '../../domain/errors';
import { Button } from '../components/Button';
import { ErrorState, InlineFeedback, LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { TextArea } from '../components/TextField';
import { colors, fonts, layout, radii, roleTokens, spacing, typeScale } from '../theme/tokens';

type Props = { store: LocalStore; session: SessionSnapshot; consultationId: string; onExit: () => void };
const fieldOrder: ClinicalNoteField[] = ['complaint', 'findings', 'assessment', 'actions', 'careInstructions'];

export function ClinicalNoteFlow({ store, session, consultationId, onExit }: Props) {
  const role = session.activeRole;
  const [consultation, setConsultation] = useState<ConsultationDetail | null>(null);
  const [note, setNote] = useState<ClinicalNoteSnapshot | null>(null);
  const [fields, setFields] = useState<ClinicalNoteFields>(emptyFields());
  const [saved, setSaved] = useState<ClinicalNoteFields>(emptyFields());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [review, setReview] = useState(false);
  const [leave, setLeave] = useState(false);
  const [completeDialog, setCompleteDialog] = useState(false);
  const dirty = JSON.stringify(fields) !== JSON.stringify(saved);
  const status = String(consultation?.record.payload.status ?? '');
  const editable = role === 'vet' && consultation?.verified === true && consultation.paid && status === 'in_progress'
    && (consultation.record.payload.type !== 'visit' || consultation.visit?.payload.stage === 'examining')
    && note?.status !== 'final';
  const isFinal = note?.status === 'final';
  const canComplete = role === 'vet' && isFinal && status === 'in_progress';

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextConsultation, nextNote] = await Promise.all([
        store.consultations.detail(session.userId, role, consultationId),
        store.clinicalNotes.load(session.userId, role, consultationId),
      ]);
      setConsultation(nextConsultation);
      setNote(nextNote);
      const initial = nextNote?.fields ?? { ...emptyFields(), complaint: String(nextConsultation.record.payload.complaint ?? '') };
      setFields(initial);
      setSaved(initial);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setLoading(false);
    }
  }, [consultationId, role, session.userId, store]);
  useEffect(() => { const timer = setTimeout(() => { void reload(); }, 0); return () => clearTimeout(timer); }, [reload]);

  const back = useCallback(() => {
    if (busy) return;
    if (review) { setReview(false); return; }
    if (dirty && editable) { setLeave(true); return; }
    onExit();
  }, [busy, dirty, editable, onExit, review]);
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => handler.remove();
  }, [back]);

  const saveDraft = async (leaveAfter = false) => {
    if (!editable) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = await store.clinicalNotes.saveDraft(session.userId, consultationId, note?.record.version ?? null, fields);
      setNote(next); setSaved(next.fields); setFields(next.fields); setLeave(false);
      setNotice('Draft catatan tersimpan di perangkat ini.');
      if (leaveAfter) onExit();
    } catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  };

  const openReview = async () => {
    if (!editable) return;
    if (dirty || !note) {
      setBusy(true); setError(''); setNotice('');
      try {
        const next = await store.clinicalNotes.saveDraft(session.userId, consultationId, note?.record.version ?? null, fields);
        setNote(next); setSaved(next.fields); setFields(next.fields); setReview(true);
      } catch (cause) { setError(messageFor(cause)); }
      finally { setBusy(false); }
    } else setReview(true);
  };

  const finalize = async () => {
    if (!note || !editable) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = await store.clinicalNotes.finalize(session.userId, consultationId, note.record.version);
      setNote(next); setFields(next.fields); setSaved(next.fields); setReview(false);
      setNotice('Catatan final tersimpan. Status layanan tetap berlangsung.');
      const refreshed = await store.consultations.detail(session.userId, role, consultationId);
      setConsultation(refreshed);
    } catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  };

  const complete = async () => {
    if (!note || !consultation || !canComplete) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await store.clinicalNotes.complete(session.userId, {
        consultationId,
        consultationVersion: consultation.record.version,
        noteVersion: note.record.version,
        visitVersion: consultation.record.payload.type === 'visit' ? consultation.visit?.version ?? null : null,
        operationKey: `consultation-complete:${consultationId}:${consultation.record.version}:${note.record.version}`,
        confirmed: true,
      });
      setCompleteDialog(false);
      setNotice('Layanan selesai. Pendapatan bersih tercatat menunggu penyelesaian lokal.');
      await reload();
    } catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  };

  return <View style={styles.root}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Kembali" disabled={busy} onPress={back} style={styles.back}>
        <Icon name="arrow-left" color={colors.brown} size={22} />
      </Pressable>
      <Text accessibilityRole="header" style={styles.title}>{review ? 'Tinjau catatan final' : isFinal ? 'Hasil pemeriksaan' : 'Catatan pemeriksaan'}</Text>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {error ? <ErrorState message={error} role={role} onRetry={() => { void reload(); }} /> : null}
      {notice ? <InlineFeedback message={notice} /> : null}
      {loading ? <LoadingState label="Memuat catatan pemeriksaan…" /> : null}
      {!loading && consultation ? <>
        <View style={styles.card}>
          <Text style={styles.heading}>{String(consultation.record.payload.displayCode ?? 'Layanan')}</Text>
          <Meta label="Pasien" value={consultation.animalName} />
          <Meta label={role === 'vet' ? 'Peternak' : 'Dokter'} value={consultation.otherPartyName} />
          {isFinal ? <InlineFeedback message={`Catatan final · ${formatDate(note?.finalizedAt ?? null)}`} /> : null}
          {!isFinal && role === 'farmer' ? <InlineFeedback message="Dokter belum mengirim catatan pemeriksaan final." /> : null}
          {!isFinal && role === 'vet' && !editable ? <InlineFeedback message="Catatan dapat disimpan saat layanan berlangsung dan pemeriksaan sudah dimulai." /> : null}
        </View>
        {!loading && consultation && (role === 'vet' || isFinal) ? <View style={styles.card}>
          {fieldOrder.map((field) => review || isFinal || role === 'farmer'
            ? <Meta key={field} label={clinicalFieldLabels[field]} value={fields[field] || 'Belum dicatat.'} />
            : <TextArea
                key={field}
                label={clinicalFieldLabels[field]}
                value={fields[field]}
                editable={editable && !busy}
                maxLength={2000}
                helperText="Maksimal 2.000 karakter"
                onChangeText={(value) => setFields((current) => ({ ...current, [field]: value }))}
              />)}
        </View> : null}
        {editable && !review ? <>
          <Button role={role} label="Simpan Draft" loading={busy} onPress={() => { void saveDraft(); }} />
          <Button role={role} variant="secondary" label="Tinjau sebelum finalisasi" disabled={busy} onPress={() => { void openReview(); }} />
        </> : null}
        {editable && review ? <>
          <InlineFeedback message="Periksa seluruh bagian. Setelah final, catatan hanya dapat dibaca dan tidak bisa diedit." />
          <Button role={role} label="Finalisasi catatan" loading={busy} onPress={() => { void finalize(); }} />
          <Button role={role} variant="secondary" disabled={busy} label="Kembali mengedit" onPress={() => setReview(false)} />
        </> : null}
        {canComplete ? <>
          <InlineFeedback message="Catatan sudah final. Status layanan belum berubah sampai Dokter mengonfirmasi penyelesaian." />
          <Button role={role} label="Selesaikan layanan" disabled={busy} onPress={() => setCompleteDialog(true)} />
        </> : null}
        {isFinal && status === 'completed' ? <InlineFeedback message="Layanan ini sudah selesai. Catatan final tetap hanya baca." /> : null}
      </> : null}
    </ScrollView>

    <Modal visible={leave} transparent animationType="fade" onRequestClose={() => { if (!busy) setLeave(false); }}>
      <SafeAreaProvider><SafeAreaView style={styles.backdrop}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.dialog}><Text accessibilityRole="header" style={styles.heading}>Perubahan belum tersimpan</Text>
          {error ? <InlineFeedback message={error} tone="error" /> : null}
          <Button role={role} label="Simpan Draft" loading={busy} onPress={() => { void saveDraft(true); }} />
          <Button role={role} variant="secondary" disabled={busy} label="Buang Perubahan" onPress={() => { setFields(saved); setLeave(false); setError(''); onExit(); }} />
          <Button role={role} variant="secondary" disabled={busy} label="Tetap Mengedit" onPress={() => setLeave(false)} />
        </View>
      </KeyboardAvoidingView></SafeAreaView></SafeAreaProvider>
    </Modal>

    <Modal visible={completeDialog} transparent animationType="fade" onRequestClose={() => { if (!busy) setCompleteDialog(false); }}>
      <SafeAreaProvider><SafeAreaView style={styles.backdrop}><View style={styles.dialog}>
        <Text accessibilityRole="header" style={styles.heading}>Konfirmasi penyelesaian</Text>
        <Text style={styles.body}>Tandai {String(consultation?.record.payload.displayCode ?? 'layanan')} selesai? Catatan final terkunci. Status layanan dan tahap kunjungan akan diperbarui bersama. Pendapatan bersih dicatat sebagai menunggu.</Text>
        {error ? <InlineFeedback message={error} tone="error" /> : null}
        <Button role={role} label="Ya, selesaikan layanan" loading={busy} onPress={() => { void complete(); }} />
        <Button role={role} variant="secondary" disabled={busy} label="Batal" onPress={() => { setCompleteDialog(false); setError(''); }} />
      </View></SafeAreaView></SafeAreaProvider>
    </Modal>
  </View>;
}

function emptyFields(): ClinicalNoteFields { return { complaint: '', findings: '', assessment: '', actions: '', careInstructions: '' }; }
function Meta({ label, value }: { label: string; value: string }) { return <View style={styles.meta}><Text style={styles.label}>{label}</Text><Text selectable style={styles.body}>{value}</Text></View>; }
function formatDate(value: string | null): string { return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Waktu tidak tersedia'; }
function messageFor(error: unknown): string { return error instanceof DomainError ? error.message : 'Catatan pemeriksaan belum dapat dimuat atau disimpan.'; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingHorizontal: layout.contentHorizontal, paddingVertical: spacing[2] },
  back: { width: 48, height: 48, borderRadius: radii.button, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: colors.brown, fontFamily: fonts.bold, fontSize: 21, lineHeight: 28, flexShrink: 1 },
  content: { flexGrow: 1, width: '100%', maxWidth: 480, alignSelf: 'center', gap: spacing[4], padding: spacing[4], paddingBottom: spacing[8] },
  card: { gap: spacing[3], padding: spacing[4], borderRadius: roleTokens.vet.cardRadius, backgroundColor: colors.white },
  heading: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.heading, lineHeight: 28, flexShrink: 1 },
  meta: { gap: spacing[1], paddingTop: spacing[2], borderTopWidth: 1, borderColor: colors.cream },
  label: { color: colors.muted, fontFamily: fonts.medium, fontSize: typeScale.small, lineHeight: 18 },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22, flexShrink: 1 },
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing[5], backgroundColor: 'rgba(58,23,13,0.5)' },
  dialog: { width: '100%', maxWidth: 380, alignSelf: 'center', maxHeight: '90%', padding: spacing[5], gap: spacing[3], borderRadius: roleTokens.vet.cardRadius, backgroundColor: colors.white },
});
