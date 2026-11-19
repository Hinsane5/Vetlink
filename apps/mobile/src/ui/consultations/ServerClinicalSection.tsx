import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ServerClinicalService } from '../../application/ServerClinicalService';
import type { ApiClinicalNote, ApiRecommendationItem } from '../../application/ports/ApiClinicalRepository';
import type { ApiConsultationDetail } from '../../application/ports/ApiConsultationRepository';
import type { AccountRole } from '../../domain/auth';
import { clinicalFieldLabels, type ClinicalNoteField } from '../../domain/clinicalNotes';
import { DomainError } from '../../domain/errors';
import { Button } from '../components/Button';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { LoadingState } from '../components/Feedback';
import { TextArea, TextField } from '../components/TextField';
import { colors, fonts, spacing, typeScale } from '../theme/tokens';

type NoteFields = Pick<ApiClinicalNote, 'complaint' | 'findings' | 'assessment' | 'actions' | 'careInstructions'>;
type RecommendationDraftItem = Pick<ApiRecommendationItem, 'title' | 'instructions' | 'note'>;
const noteOrder: ClinicalNoteField[] = ['complaint', 'findings', 'assessment', 'actions', 'careInstructions'];
const emptyNote = (): NoteFields => ({ complaint: '', findings: '', assessment: '', actions: '', careInstructions: '' });
const noteFrom = (note: ApiClinicalNote): NoteFields => ({ complaint: note.complaint, findings: note.findings, assessment: note.assessment, actions: note.actions, careInstructions: note.careInstructions });
const emptyItems = (): RecommendationDraftItem[] => [];

export function ServerClinicalSection({ service, role, consultation, onExit, backHandlerRef }: {
  service: ServerClinicalService;
  role: AccountRole;
  consultation: ApiConsultationDetail;
  onExit: () => void;
  backHandlerRef: { current: (() => boolean) | null };
}) {
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState<ApiClinicalNote | null>(null);
  const [fields, setFields] = useState<NoteFields>(emptyNote());
  const [savedFields, setSavedFields] = useState<NoteFields>(emptyNote());
  const [items, setItems] = useState<RecommendationDraftItem[]>(emptyItems());
  const [savedItems, setSavedItems] = useState<RecommendationDraftItem[]>(emptyItems());
  const [recommendation, setRecommendation] = useState<{ id: string | null; status: 'draft' | 'sent'; version: number; items: ApiRecommendationItem[] | null; sentAt: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [recommendationError, setRecommendationError] = useState('');
  const [notice, setNotice] = useState('');
  const [review, setReview] = useState(false);
  const [recommendationReview, setRecommendationReview] = useState(false);
  const [leave, setLeave] = useState(false);
  const [finalizeVisible, setFinalizeVisible] = useState(false);
  const [sendRecommendationVisible, setSendRecommendationVisible] = useState(false);

  const noteWindow = role === 'vet' && consultation.status === 'in_progress'
    && consultation.paymentStatus === 'succeeded'
    && (consultation.serviceType === 'chat' || consultation.visitStage === 'examining');
  const noteEditable = noteWindow && note !== null && note.status !== 'final';
  const noteDirty = noteEditable && JSON.stringify(fields) !== JSON.stringify(savedFields);
  const recommendationEditable = noteWindow && note?.status === 'final' && recommendation?.status !== 'sent';
  const recommendationDirty = recommendationEditable && JSON.stringify(items) !== JSON.stringify(savedItems);
  const dirty = !!noteDirty || !!recommendationDirty;
  const canFinalize = noteEditable && note?.id !== null && noteOrder.every((field) => fields[field].trim().length > 0);
  const canSendRecommendation = recommendationEditable && items.length > 0 && items.every((item) => item.title.trim().length > 0);

  const reload = useCallback(async () => {
    setLoading(true);
    setNoteError('');
    setRecommendationError('');
    const [noteResult, recommendationResult] = await Promise.allSettled([
      service.getNote(role, consultation.id),
      service.getRecommendation(role, consultation.id),
    ]);
    if (noteResult.status === 'fulfilled') {
      const savedNote = noteResult.value;
      setNote(savedNote);
      const nextFields = savedNote
        ? noteFrom(savedNote)
        : role === 'vet' ? { ...emptyNote(), complaint: consultation.complaint } : emptyNote();
      if (savedNote?.id === null && role === 'vet' && !nextFields.complaint.trim()) nextFields.complaint = consultation.complaint;
      setFields(nextFields);
      setSavedFields(nextFields);
    } else {
      setNoteError(messageFor(noteResult.reason));
    }
    if (recommendationResult.status === 'fulfilled') {
      const savedRecommendation = recommendationResult.value;
      setRecommendation(savedRecommendation);
      const nextItems = (savedRecommendation?.items ?? []).map(({ title, instructions, note: itemNote }) => ({ title, instructions, note: itemNote }));
      setItems(nextItems);
      setSavedItems(nextItems);
    } else {
      setRecommendationError(messageFor(recommendationResult.reason));
    }
    if (noteResult.status === 'fulfilled' && recommendationResult.status === 'fulfilled') setUncertain(false);
    setLoading(false);
  }, [consultation.complaint, consultation.id, role, service]);

  useEffect(() => { const timer = setTimeout(() => { void reload(); }, 0); return () => clearTimeout(timer); }, [reload]);

  const requestExit = useCallback(() => {
    if (busy) return true;
    if (review) { setReview(false); return true; }
    if (recommendationReview) { setRecommendationReview(false); return true; }
    if (dirty) { setLeave(true); return true; }
    onExit();
    return true;
  }, [busy, dirty, onExit, recommendationReview, review]);

  useEffect(() => {
    backHandlerRef.current = requestExit;
    return () => { backHandlerRef.current = null; };
  }, [backHandlerRef, requestExit]);

  const persistNote = async () => {
    const saved = await service.saveNote(role, consultation.id, { expectedVersion: note?.version ?? 1, ...fields });
    setNote(saved);
    setFields(noteFrom(saved));
    setSavedFields(noteFrom(saved));
    return saved;
  };

  const saveNoteDraft = async () => {
    if (!noteEditable || busy || uncertain) return;
    setBusy(true); setNoteError(''); setNotice('');
    try {
      await persistNote();
      setNotice('Draft catatan klinis tersimpan di server.');
    } catch (cause) {
      setNoteError(messageFor(cause)); setUncertain(hasUncertainOutcome(cause));
    } finally { setBusy(false); }
  };

  const openReview = async () => {
    if (!noteEditable || busy || uncertain) return;
    setBusy(true); setNoteError(''); setNotice('');
    try {
      if (noteDirty || note?.id === null) await persistNote();
      setReview(true);
    } catch (cause) {
      setNoteError(messageFor(cause)); setUncertain(hasUncertainOutcome(cause));
    } finally { setBusy(false); }
  };

  const finalize = async () => {
    if (!note || !canFinalize || busy || uncertain) return;
    setBusy(true); setNoteError(''); setNotice('');
    try {
      const finalNote = await service.finalizeNote(role, consultation.id, note.version);
      setNote(finalNote);
      setFields(noteFrom(finalNote));
      setSavedFields(noteFrom(finalNote));
      setReview(false);
      setFinalizeVisible(false);
      setNotice('Catatan final tersimpan. Status layanan tetap berlangsung.');
      void reload();
    } catch (cause) {
      setNoteError(messageFor(cause)); setUncertain(hasUncertainOutcome(cause)); setFinalizeVisible(false);
    } finally { setBusy(false); }
  };

  const persistRecommendation = async () => {
    const saved = await service.saveRecommendation(role, consultation.id, {
      expectedVersion: recommendation?.version ?? 1,
      items: items.map((item) => ({ title: item.title.trim(), instructions: item.instructions.trim(), note: item.note.trim() })),
    });
    setRecommendation(saved);
    const nextItems = (saved.items ?? []).map(({ title, instructions, note: itemNote }) => ({ title, instructions, note: itemNote }));
    setItems(nextItems);
    setSavedItems(nextItems);
    return saved;
  };

  const saveRecommendationDraft = async () => {
    if (!recommendationEditable || busy || uncertain) return;
    setBusy(true); setRecommendationError(''); setNotice('');
    try {
      await persistRecommendation();
      setNotice('Draft rekomendasi tersimpan di server.');
    } catch (cause) {
      setRecommendationError(messageFor(cause)); setUncertain(hasUncertainOutcome(cause));
    } finally { setBusy(false); }
  };

  const sendRecommendation = async () => {
    if (!recommendation || !recommendationReview || !canSendRecommendation || busy || uncertain) return;
    setBusy(true); setRecommendationError(''); setNotice('');
    try {
      const saved = recommendationDirty ? await persistRecommendation() : recommendation;
      const sent = await service.sendRecommendation(role, consultation.id, saved.version);
      setRecommendation(sent);
      setRecommendationReview(false);
      setSendRecommendationVisible(false);
      setNotice('Rekomendasi terkirim kepada Peternak. Pembelian dan checkout dilakukan oleh Peternak.');
      void reload();
    } catch (cause) {
      setRecommendationError(messageFor(cause)); setUncertain(hasUncertainOutcome(cause));
    } finally { setBusy(false); }
  };

  const openRecommendationReview = async () => {
    if (!recommendationEditable || !canSendRecommendation || busy || uncertain) return;
    setBusy(true); setRecommendationError(''); setNotice('');
    try {
      if (recommendationDirty || recommendation?.id === null) await persistRecommendation();
      setRecommendationReview(true);
    } catch (cause) {
      setRecommendationError(messageFor(cause)); setUncertain(hasUncertainOutcome(cause));
    } finally { setBusy(false); }
  };

  const saveDraftsAndExit = async () => {
    if (busy || uncertain) return;
    setBusy(true); setNoteError(''); setRecommendationError('');
    try {
      if (noteDirty) await persistNote();
      if (recommendationDirty) await persistRecommendation();
      setLeave(false);
      onExit();
    } catch (cause) {
      setNoteError(messageFor(cause)); setUncertain(hasUncertainOutcome(cause));
    } finally { setBusy(false); }
  };

  const discardAndExit = () => {
    setFields(savedFields); setItems(savedItems); setLeave(false); onExit();
  };

  return <View style={styles.section}>
    <Button label="Kembali ke konsultasi" role={role} variant="secondary" disabled={busy} onPress={requestExit} />
    <Text accessibilityRole="header" style={styles.heading}>Catatan klinis dan rekomendasi</Text>
    {loading ? <LoadingState label="Memuat data klinis server…" /> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {uncertain ? <Text style={styles.body}>Hasil simpan belum pasti. Muat ulang data server sebelum melanjutkan; permintaan tidak akan diulang otomatis.</Text> : null}
    {uncertain ? <Button role={role} variant="secondary" label="Muat ulang data klinis" loading={loading} disabled={busy} onPress={() => { void reload(); }} /> : null}
    {!loading && noteError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{noteError}</Text> : null}
    {!loading && recommendationError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{recommendationError}</Text> : null}
    {!loading && role === 'farmer' && !note && !noteError ? <Text style={styles.body}>Dokter belum mengirim catatan klinis final.</Text> : null}
    {!loading && note ? <View style={styles.card}>
      <Text style={styles.cardTitle}>{note.status === 'final' ? 'Catatan final' : 'Draft catatan Dokter'}</Text>
      {note.status === 'final' ? <Text style={styles.body}>Tanggal finalisasi: {formatDate(note.finalizedAt)}</Text> : null}
      {noteOrder.map((field) => review || role === 'farmer' || note.status === 'final' || !noteEditable
        ? <View key={field} style={styles.fieldReadOnly}><Text style={styles.label}>{clinicalFieldLabels[field]}</Text><Text selectable style={styles.body}>{fields[field] || 'Belum dicatat.'}</Text></View>
        : <TextArea key={field} label={clinicalFieldLabels[field]} value={fields[field]} onChangeText={(value) => setFields((current) => ({ ...current, [field]: value }))} editable={!busy && !uncertain} maxLength={field === 'complaint' ? 4000 : 8000} helperText="Catatan ini hanya terkait layanan yang ditugaskan." />)}
    </View> : null}
    {!loading && noteEditable && !review ? <>
      <Button role="vet" label="Simpan Draft" loading={busy} disabled={uncertain} onPress={() => { void saveNoteDraft(); }} />
      <Button role="vet" variant="secondary" label="Tinjau sebelum finalisasi" loading={busy} disabled={uncertain || !noteOrder.every((field) => fields[field].trim())} onPress={() => { void openReview(); }} />
    </> : null}
    {!loading && review && noteEditable ? <>
      <Text style={styles.body}>Pastikan seluruh bagian terisi. Setelah final, catatan hanya dapat dibaca. Finalisasi tidak menyelesaikan layanan.</Text>
      <Button role="vet" label="Finalisasi catatan" disabled={!canFinalize || busy || uncertain} onPress={() => setFinalizeVisible(true)} />
      <Button role="vet" variant="secondary" disabled={busy} label="Kembali mengedit" onPress={() => setReview(false)} />
    </> : null}
    {!loading && role === 'vet' && note?.status === 'final' ? <>
      <Text style={styles.heading}>Rekomendasi untuk Peternak</Text>
      {recommendation?.status === 'sent' ? <Text style={styles.body}>Rekomendasi telah dikirim pada {formatDate(recommendation.sentAt)}. Peternak melakukan pembelian dan checkout sendiri.</Text> : null}
      {!recommendationReview && recommendationError ? null : !recommendationReview && recommendation?.status === 'draft' ? items.map((item, index) => <View key={`item-${index}`} style={styles.card}>
        <Text style={styles.cardTitle}>Rekomendasi {index + 1}</Text>
        <TextField label="Judul" value={item.title} editable={recommendationEditable && !busy && !uncertain} maxLength={160} onChangeText={(title) => setItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, title } : entry))} />
        <TextArea label="Instruksi" value={item.instructions} editable={recommendationEditable && !busy && !uncertain} maxLength={2000} onChangeText={(instructions) => setItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, instructions } : entry))} />
        <TextArea label="Catatan" value={item.note} editable={recommendationEditable && !busy && !uncertain} maxLength={2000} onChangeText={(noteText) => setItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, note: noteText } : entry))} />
        {recommendationEditable ? <Button role="vet" variant="secondary" label={`Hapus rekomendasi ${index + 1}`} disabled={busy || uncertain} onPress={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} /> : null}
      </View>) : null}
      {!loading && recommendation?.status === 'draft' && recommendationEditable ? <>
        {!recommendationReview ? <>
          <Text style={styles.body}>Rekomendasi harus terkait layanan ini. Dokter menyarankan; Peternak memutuskan pembelian sendiri.</Text>
          <Button role="vet" variant="secondary" label="Tambah rekomendasi" disabled={busy || uncertain || items.length >= 50} onPress={() => setItems((current) => [...current, { title: '', instructions: '', note: '' }])} />
          <Button role="vet" variant="secondary" label="Simpan Draft Rekomendasi" loading={busy} disabled={uncertain} onPress={() => { void saveRecommendationDraft(); }} />
          <Button role="vet" label="Tinjau rekomendasi sebelum dikirim" loading={busy} disabled={!canSendRecommendation || uncertain} onPress={() => { void openRecommendationReview(); }} />
        </> : <>
          <Text style={styles.body}>Tinjau teks yang akan dikirim kepada Peternak. Setelah terkirim, rekomendasi hanya dapat dibaca.</Text>
          {items.map((item, index) => <View key={`review-${index}`} style={styles.fieldReadOnly}>
            <Text style={styles.label}>Rekomendasi {index + 1} · {item.title}</Text>
            {item.instructions ? <Text style={styles.body}>{item.instructions}</Text> : null}
            {item.note ? <Text style={styles.body}>{item.note}</Text> : null}
          </View>)}
          <Button role="vet" label="Kirim rekomendasi" loading={busy} disabled={!canSendRecommendation || uncertain} onPress={() => setSendRecommendationVisible(true)} />
          <Button role="vet" variant="secondary" label="Kembali mengedit rekomendasi" disabled={busy} onPress={() => setRecommendationReview(false)} />
        </>}
      </> : null}
    </> : null}
    {!loading && role === 'farmer' && !recommendation && !recommendationError ? <Text style={styles.body}>Belum ada rekomendasi terkirim dari Dokter.</Text> : null}
    {!loading && role === 'farmer' && recommendation?.status === 'sent' ? <View style={styles.card}>
      <Text style={styles.cardTitle}>Rekomendasi Dokter</Text>
      {(recommendation.items ?? []).map((item, index) => <View key={`sent-${index}`} style={styles.fieldReadOnly}>
        <Text style={styles.label}>{item.title}</Text>
        {item.instructions ? <Text style={styles.body}>{item.instructions}</Text> : null}
        {item.note ? <Text style={styles.body}>{item.note}</Text> : null}
      </View>)}
      <Text style={styles.body}>Rekomendasi bukan pesanan. Peternak menentukan sendiri apakah akan membeli melalui checkout.</Text>
    </View> : null}

    <Modal visible={leave} transparent animationType="fade" onRequestClose={() => { if (!busy) setLeave(false); }}>
      <View style={[styles.backdrop, { paddingTop: insets.top + spacing[4], paddingBottom: insets.bottom + spacing[4] }]}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.dialogWrap}>
          <View style={styles.dialog}>
            <Text accessibilityRole="header" style={styles.cardTitle}>Perubahan belum tersimpan</Text>
            {noteError || recommendationError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{noteError || recommendationError}</Text> : null}
            <Button role={role} label="Simpan Draft" loading={busy} disabled={uncertain} onPress={() => { void saveDraftsAndExit(); }} />
            <Button role={role} variant="secondary" label="Buang Perubahan" disabled={busy} onPress={discardAndExit} />
            <Button role={role} variant="secondary" label="Tetap Mengedit" disabled={busy} onPress={() => setLeave(false)} />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
    <ConfirmationDialog visible={finalizeVisible} title="Finalisasi catatan?" message="Catatan yang telah final hanya dapat dibaca dan tidak mengubah status layanan." role="vet" confirmLabel="Finalisasi" cancelLabel="Kembali mengedit" onConfirm={() => { void finalize(); }} onCancel={() => setFinalizeVisible(false)} loading={busy} confirmDisabled={!canFinalize || uncertain} />
    <ConfirmationDialog visible={sendRecommendationVisible} title="Kirim rekomendasi kepada Peternak?" message="Rekomendasi akan dikirim untuk dibaca. Peternak memilih sendiri apakah akan membeli melalui checkout." role="vet" confirmLabel="Kirim rekomendasi" cancelLabel="Tinjau lagi" onConfirm={() => { void sendRecommendation(); }} onCancel={() => setSendRecommendationVisible(false)} loading={busy} confirmDisabled={!canSendRecommendation || uncertain} />
  </View>;
}

function formatDate(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Waktu tidak tersedia';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value));
}

function messageFor(cause: unknown): string {
  if (cause instanceof DomainError) return cause.message;
  return cause instanceof Error ? cause.message : 'Data klinis server belum dapat dimuat atau disimpan.';
}

function hasUncertainOutcome(cause: unknown): boolean {
  return !(cause instanceof DomainError) || ['SERVICE_UNAVAILABLE', 'API_RESPONSE_INVALID', 'VERSION_CONFLICT'].includes(cause.code);
}

const styles = StyleSheet.create({
  section: { gap: spacing[4] },
  heading: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.section },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22 },
  error: { color: colors.orange, fontFamily: fonts.medium, fontSize: typeScale.body, lineHeight: 21 },
  notice: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.body, lineHeight: 21 },
  card: { backgroundColor: colors.white, borderRadius: 14, padding: spacing[4], gap: spacing[3] },
  cardTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.body },
  fieldReadOnly: { gap: spacing[1], paddingTop: spacing[2], borderTopWidth: 1, borderColor: colors.cream },
  label: { color: colors.muted, fontFamily: fonts.medium, fontSize: typeScale.small, lineHeight: 18 },
  backdrop: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing[5], backgroundColor: 'rgba(58,23,13,0.5)' },
  dialogWrap: { width: '100%', alignSelf: 'center', maxWidth: 380 },
  dialog: { padding: spacing[5], gap: spacing[3], borderRadius: 16, backgroundColor: colors.white },
});
