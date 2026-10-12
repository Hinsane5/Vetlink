import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { SessionSnapshot } from '../../domain/auth';
import type { DomainEntity } from '../../domain/entities';
import type { ClinicalNoteSnapshot } from '../../domain/clinicalNotes';
import type { RecommendationSnapshot } from '../../domain/recommendations';
import type { DirectorySchedule } from '../../domain/directory';
import { actionLabels, consultationLabel, consultationTab, emptyProposalInput, type ConsultationAction, type ConsultationCommand, type ConsultationDetail, type ProposalInput, type VisitAction } from '../../domain/consultations';
import { DomainError } from '../../domain/errors';
import { Button } from '../components/Button';
import { TextArea, TextField } from '../components/TextField';
import { EmptyState, ErrorState, InlineFeedback, LoadingState } from '../components/Feedback';
import { StatusBadge } from '../components/StatusBadge';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { Icon } from '../components/Icon';
import { colors, fonts, radii, roleTokens, spacing } from '../theme/tokens';

type Form = { action: 'propose' | 'reject' | 'cancel'; input: ProposalInput; saved: ProposalInput; draft: DomainEntity | null; schedule: DirectorySchedule | null };
type Tab = 'requests' | 'appointments' | 'history';
export function ConsultationFlow({ store, session, initialId, initialTab = 'requests', onExit, onOpenAnimal, onOpenChat, onOpenClinicalNote, onOpenRecommendation, onOpenCare }: { store: LocalStore; session: SessionSnapshot; initialId?: string; initialTab?: Tab; onExit: () => void; onOpenAnimal: (id: string) => void; onOpenChat: (id: string) => void; onOpenClinicalNote: (id: string) => void; onOpenRecommendation: (id: string) => void; onOpenCare: (id: string) => void }) {
  const role = session.activeRole;
  const [selectedId, setSelectedId] = useState(initialId ?? '');
  const [items, setItems] = useState<ConsultationDetail[]>([]);
  const [detail, setDetail] = useState<ConsultationDetail | null>(null);
  const [clinicalNote, setClinicalNote] = useState<ClinicalNoteSnapshot | null>(null);
  const [recommendation, setRecommendation] = useState<RecommendationSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [leave, setLeave] = useState(false);
  const [confirm, setConfirm] = useState<ConsultationCommand | null>(null);
  const [visitConfirm, setVisitConfirm] = useState<VisitAction | null>(null);
  const [photoId, setPhotoId] = useState('');
  const locked = useRef(false);
  const reload = useCallback(async () => {
    setError(''); setLoading(true);
    try {
      if (selectedId) {
        const [nextDetail, nextNote, nextRecommendation] = await Promise.all([
          store.consultations.detail(session.userId, role, selectedId),
          store.clinicalNotes.load(session.userId, role, selectedId),
          store.recommendations.load(session.userId, role, selectedId),
        ]);
        setDetail(nextDetail); setClinicalNote(nextNote); setRecommendation(nextRecommendation);
      } else { setItems(await store.consultations.list(session.userId, role)); setDetail(null); setClinicalNote(null); setRecommendation(null); }
    } catch (cause) { setDetail(null); setClinicalNote(null); setRecommendation(null); setItems([]); setError(message(cause)); }
    finally { setLoading(false); }
  }, [role, selectedId, session.userId, store]);
  useEffect(() => { const timer = setTimeout(() => { void reload(); }, 0); return () => clearTimeout(timer); }, [reload]);
  const back = useCallback(() => {
    if (busy) return;
    if (photoId) { setPhotoId(''); return; }
    if (form) {
      if (JSON.stringify(form.input) !== JSON.stringify(form.saved)) setLeave(true); else setForm(null);
    } else if (selectedId && !initialId) { setSelectedId(''); setFeedback(''); }
    else onExit();
  }, [busy, form, initialId, onExit, photoId, selectedId]);
  useEffect(() => { const handler = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; }); return () => handler.remove(); }, [back]);
  const run = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(message(cause)); }
    finally { locked.current = false; setBusy(false); }
  };
  const openForm = (action: Form['action']) => { void run(async () => {
    if (!detail) return;
    const [draft, schedule] = action === 'propose' ? await Promise.all([store.consultations.draft(session.userId, detail.record.id), store.consultations.slots(session.userId, detail.record.id)]) : [null, null];
    const input = draft?.payload.input as ProposalInput | undefined ?? { ...emptyProposalInput };
    setForm({ action, input, saved: { ...input }, draft, schedule }); setFeedback('');
  }); };
  const openPhoto = (id: string) => { void run(async () => {
    if (!detail) return;
    const latest = await store.consultations.detail(session.userId, role, detail.record.id);
    if (!latest.attachments.some((item) => item.id === id && item.kind === 'image')) throw new DomainError('FORBIDDEN', 'Foto tidak tersedia lagi.');
    setDetail(latest); setPhotoId(id);
  }); };
  const command = (action: ConsultationAction): ConsultationCommand | null => detail ? { id: detail.record.id, version: detail.record.version, action, operationKey: `consultation:${detail.record.id}:${detail.record.version}:${role}:${action}`, proposalId: detail.proposal?.id, ...(form ? form.input : {}) } : null;
  const saveDraft = () => { void run(async () => {
    if (!form || !detail) return;
    const draft = await store.consultations.saveDraft(session.userId, detail.record.id, form.draft, form.input);
    setForm({ ...form, draft, saved: { ...form.input } }); setLeave(false); setFeedback('Draft jadwal tersimpan.');
    if (leave) setForm(null);
  }); };
  const discard = () => { void run(async () => {
    if (form?.action === 'propose' && detail) await store.consultations.discardDraft(session.userId, detail.record.id, form.draft);
    setForm(null); setLeave(false); setError('');
  }); };
  const apply = () => { void run(async () => {
    if (!confirm) return;
    await store.consultations.act(session.userId, role, confirm);
    setConfirm(null); setForm(null); setFeedback(`${actionLabels[confirm.action]}.`); await reload();
  }); };
  const applyVisit = () => { void run(async () => {
    if (!detail?.visit || !visitConfirm) return;
    await store.consultations.advanceVisit(session.userId, role, {
      consultationId: detail.record.id,
      consultationVersion: detail.record.version,
      visitVersion: detail.visit.version,
      action: visitConfirm,
      operationKey: `visit:${detail.record.id}:${detail.visit.version}:${visitConfirm}`,
    });
    setVisitConfirm(null);
    setFeedback(`${actionLabels[visitConfirm]}.`);
    await reload();
  }); };
  const openAddressMap = async (address: string) => {
    try { await Linking.openURL(`geo:0,0?q=${encodeURIComponent(address)}`); }
    catch { setError('Aplikasi peta tidak tersedia. Gunakan alamat kunjungan yang tersimpan.'); }
  };
  const status = String(detail?.record.payload.status ?? '');
  const future = Date.parse(String(detail?.record.payload.startsAt)) > clock;
  const started = !!detail?.visit && detail.visit.payload.stage !== 'scheduled';
  const canDoctor = role === 'vet' && detail?.verified && detail.paid && future && !started;
  const cancellable = role === 'farmer' && !started && ['awaiting_payment', 'requested', 'scheduled', 'reschedule_pending'].includes(status);
  const chatPriorStatus = status === 'reschedule_pending' ? String(detail?.record.payload.previousStatus ?? 'scheduled') : status;
  const canOpenChat = detail?.record.payload.type === 'chat' && detail.paid && ['scheduled', 'in_progress', 'completed', 'cancelled'].includes(chatPriorStatus) && !['rejected', 'awaiting_payment'].includes(status);
  const canWriteClinicalNote = role === 'vet' && detail?.verified && detail.paid && status === 'in_progress'
    && (detail.record.payload.type !== 'visit' || detail.visit?.payload.stage === 'examining')
    && clinicalNote?.status !== 'final';
  const canShowClinicalResult = clinicalNote?.status === 'final';
  const canOpenRecommendation = role === 'vet' && canShowClinicalResult && detail
    && ((status === 'in_progress' && detail.verified && detail.paid) || recommendation?.status === 'sent');
  const photo = detail?.attachments.find((item) => item.id === photoId && item.kind === 'image');
  const shown = items.filter((item) => consultationTab(item.record) === tab && [item.otherPartyName, item.animalName, item.record.payload.displayCode].join(' ').toLocaleLowerCase('id').includes(query.trim().toLocaleLowerCase('id')));
  return <View style={styles.root}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Kembali" disabled={busy} onPress={back} style={styles.back}><Icon name="arrow-left" color={colors.brown} size={22} /></Pressable><Text accessibilityRole="header" style={styles.title}>{form ? form.action === 'propose' ? 'Usulkan jadwal' : form.action === 'reject' ? 'Tolak permintaan' : 'Batalkan layanan' : selectedId ? 'Detail layanan' : role === 'farmer' ? 'Konsultasi saya' : 'Layanan dokter'}</Text></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {error ? <ErrorState message={error} role={role} onRetry={() => { void reload(); }} /> : null}
      {feedback ? <InlineFeedback message={feedback} /> : null}
      {loading ? <LoadingState label="Memuat layanan…" /> : form ? <>
        <InlineFeedback message={form.action === 'propose' ? 'Jadwal saat ini tetap berlaku sampai Peternak menerima usulan. Waktu diperiksa ulang saat disetujui.' : 'Berikan alasan yang jelas. Tindakan akan dikonfirmasi sebelum disimpan.'} />
        {form.action === 'propose' ? <View style={styles.card}>
          <Text style={styles.heading}>Pilih waktu baru</Text><Text style={styles.body}>Zona waktu: {form.schedule?.timezone}</Text>
          {form.input.startsAt ? <Text style={styles.body}>Dipilih: {date(form.input.startsAt, form.schedule?.timezone)} – {time(form.input.endsAt, form.schedule?.timezone)}</Text> : null}
          {form.schedule?.slots.filter((slot) => slot.startsAt !== detail?.record.payload.startsAt).length ? form.schedule.slots.filter((slot) => slot.startsAt !== detail?.record.payload.startsAt).map((slot) => <Button key={slot.id} role={role} variant={slot.startsAt === form.input.startsAt ? 'primary' : 'secondary'} label={`${date(slot.startsAt, form.schedule?.timezone)} – ${time(slot.endsAt, form.schedule?.timezone)}`} disabled={busy} onPress={() => setForm({ ...form, input: { ...form.input, startsAt: slot.startsAt, endsAt: slot.endsAt } })} />) : <EmptyState title="Belum ada waktu tersedia" description="Periksa jadwal dokter sebelum mengirim usulan." role={role} />}
        </View> : null}
        <TextArea label="Alasan" value={form.input.reason} editable={!busy} maxLength={1000} helperText="3–1.000 karakter" onChangeText={(reason) => setForm({ ...form, input: { ...form.input, reason } })} />
        <Button role={role} label={form.action === 'propose' ? 'Tinjau usulan' : 'Lanjutkan'} disabled={busy || form.input.reason.trim().length < 3 || (form.action === 'propose' && !form.input.startsAt)} onPress={() => setConfirm(command(form.action))} />
        {form.action === 'propose' ? <Button role={role} label="Simpan Draft" variant="secondary" loading={busy} onPress={saveDraft} /> : null}
      </> : selectedId && detail ? <>
        <View style={[styles.card, { borderRadius: roleTokens[role].cardRadius }]}>
          <StatusBadge role={role} label={consultationLabel(status)} />
          <Text style={styles.heading}>{detail.record.payload.type === 'visit' ? 'Kunjungan dokter' : 'Konsultasi chat'}</Text><Text selectable style={styles.body}>{String(detail.record.payload.displayCode)}</Text>
          <Line label={role === 'farmer' ? 'Dokter' : 'Peternak'} value={detail.otherPartyName} /><Line label="Ternak" value={detail.animalName} />
          <Line label={`Waktu layanan · ${detail.timezone}`} value={`${date(String(detail.record.payload.startsAt), detail.timezone)} – ${time(String(detail.record.payload.endsAt), detail.timezone)}`} />
          <Line label="Keluhan" value={String(detail.record.payload.complaint || 'Belum ada keterangan.')} />
          {detail.record.payload.type === 'visit' ? detail.record.payload.visitAddressSnapshot ? <><Line label="Alamat kunjungan tersimpan" value={String(detail.record.payload.visitAddressSnapshot)} /><Button role={role} variant="secondary" label="Buka alamat di peta" disabled={busy} onPress={() => { void openAddressMap(String(detail.record.payload.visitAddressSnapshot)); }} /></> : <InlineFeedback message="Alamat kunjungan belum tersedia pada booking ini." /> : null}
          <Line label="Biaya layanan" value={rupiah(Number(detail.record.payload.feeSnapshot))} /><Line label="Pembayaran" value={detail.paid ? 'Pembayaran berhasil' : 'Belum dibayar'} />
          {status === 'awaiting_payment' ? <InlineFeedback message="Booking menunggu pembayaran. Layanan belum dikirim ke dokter." /> : null}
          {detail.record.payload.refundStatus === 'refund_needed' ? <InlineFeedback message="Pengembalian dana diperlukan. Dana belum dikembalikan." /> : null}
          {detail.record.payload.rejectionReason || detail.record.payload.cancellationReason ? <Line label="Alasan" value={String(detail.record.payload.rejectionReason || detail.record.payload.cancellationReason)} /> : null}
          {detail.record.payload.type === 'visit' && detail.visit ? <VisitProgress role={role} stage={String(detail.visit.payload.stage)} visit={detail.visit} timezone={detail.timezone} action={detail.proposal ? null : nextVisitAction(String(detail.visit.payload.stage))} pendingProposal={!!detail.proposal} busy={busy} onAdvance={setVisitConfirm} /> : null}
          {canOpenChat ? <Button role={role} label={['completed', 'cancelled'].includes(status) ? 'Lihat percakapan' : 'Buka chat'} onPress={() => onOpenChat(detail.record.id)} /> : null}
          {canWriteClinicalNote ? <Button role={role} label={clinicalNote ? 'Lanjutkan Catatan Pemeriksaan' : 'Catat Hasil Pemeriksaan'} onPress={() => onOpenClinicalNote(detail.record.id)} /> : null}
          {role === 'vet' && canShowClinicalResult && status === 'in_progress' ? <Button role={role} label="Selesaikan layanan" onPress={() => onOpenClinicalNote(detail.record.id)} /> : null}
          {role === 'farmer' && canShowClinicalResult ? <Button role={role} variant="secondary" label="Hasil pemeriksaan" onPress={() => onOpenClinicalNote(detail.record.id)} /> : null}
          {role === 'vet' && canShowClinicalResult && status !== 'in_progress' ? <Button role={role} variant="secondary" label="Lihat catatan final" onPress={() => onOpenClinicalNote(detail.record.id)} /> : null}
          {canOpenRecommendation ? <Button role={role} variant="secondary" label={recommendation?.status === 'sent' ? 'Lihat Rekomendasi Terkirim' : recommendation?.status === 'draft' ? 'Lanjutkan Rekomendasi' : 'Buat Rekomendasi'} disabled={busy} onPress={() => onOpenRecommendation(detail.record.id)} /> : null}
          {canShowClinicalResult ? <Button role={role} variant="secondary" label={role === 'vet' ? 'Tindak lanjut & pengingat' : 'Tindak lanjut & laporan'} disabled={busy} onPress={() => onOpenCare(detail.record.id)} /> : null}
          {role === 'farmer' || !['rejected', 'cancelled'].includes(status) ? <Button role={role} variant="secondary" label={role === 'vet' ? 'Riwayat pasien' : 'Lihat ternak'} onPress={() => onOpenAnimal(String(detail.record.payload.animalId))} /> : null}
        </View>
        {role === 'farmer' && recommendation?.status === 'sent' ? <View style={styles.card}>
          <Text style={styles.heading}>Rekomendasi dokter</Text>
          {recommendation.items.map((item, index) => <View key={item.id} style={styles.history}>
            <Line label={`Rekomendasi ${index + 1}`} value={item.titleSnapshot} />
            {item.productId ? <Line label="Produk terkait" value={`${item.productName ?? 'Produk katalog'}${item.productUnitPrice !== null ? ` · ${rupiah(item.productUnitPrice)}` : ''}`} /> : null}
            <Line label="Instruksi" value={item.instructions} />
            {item.note ? <Line label="Catatan tambahan" value={item.note} /> : null}
          </View>)}
          {!recommendation.items.length ? <InlineFeedback message="Belum ada item rekomendasi yang dapat ditampilkan." /> : null}
        </View> : null}
        {detail.attachments.length ? <View style={styles.card}><Text style={styles.heading}>Lampiran keluhan</Text>{detail.attachments.map((item) => <View key={item.id} style={styles.card}>
          <Text style={styles.body}>{item.filename}</Text>{item.kind === 'image' ? <Pressable accessibilityRole="button" accessibilityLabel={`Buka ${item.filename}`} disabled={busy} onPress={() => openPhoto(item.id)} style={styles.media}><Image source={{ uri: item.localUri }} style={styles.thumbnail} resizeMode="contain" onError={() => setError('Foto lokal tidak dapat dibuka.')} /></Pressable> : <Text style={styles.body}>Pemutaran video belum tersedia.</Text>}
        </View>)}</View> : null}
        {detail.proposal ? <View style={styles.card}><Text style={styles.heading}>Usulan jadwal baru</Text><Line label={`Waktu usulan · ${detail.timezone}`} value={`${date(String(detail.proposal.payload.startsAt), detail.timezone)} – ${time(String(detail.proposal.payload.endsAt), detail.timezone)}`} /><Line label="Alasan dokter" value={String(detail.proposal.payload.reason)} /><InlineFeedback message="Jadwal layanan belum berubah. Menunggu respons Peternak." />{role === 'farmer' ? <><Button role={role} label="Terima usulan" disabled={busy} onPress={() => setConfirm(command('approve'))} /><Button role={role} variant="secondary" label="Tolak usulan" disabled={busy} onPress={() => setConfirm(command('decline'))} /></> : null}</View> : null}
        {canDoctor && status === 'requested' && !detail.proposal ? <><Button role={role} label="Terima permintaan" disabled={busy} onPress={() => setConfirm(command('accept'))} /><Button role={role} variant="secondary" label="Tolak permintaan" disabled={busy} onPress={() => openForm('reject')} /></> : null}
        {canDoctor && ['requested', 'scheduled'].includes(status) && !detail.proposal ? <Button role={role} variant="secondary" label="Usulkan jadwal lain" disabled={busy} onPress={() => openForm('propose')} /> : null}
        {role === 'vet' && !detail.verified ? <InlineFeedback message="Verifikasi diperlukan sebelum menanggapi permintaan." /> : null}
        {role === 'vet' && status === 'requested' && !future ? <InlineFeedback message="Waktu permintaan sudah lewat. Permintaan ini tidak dapat diterima." /> : null}
        {cancellable ? <Button role={role} variant="secondary" label="Batalkan layanan" disabled={busy} onPress={() => openForm('cancel')} /> : null}
        <View style={styles.card}><Text style={styles.heading}>Riwayat status</Text><Line label={date(detail.record.createdAt)} value="Layanan tercatat" />{detail.history.length ? detail.history.map((item) => {
          const action = String(item.payload.action);
          const summary = action === 'finalize_note' ? 'Catatan final tersimpan dan layanan tetap berlangsung.'
            : action === 'complete' ? 'Layanan dan kunjungan ditandai selesai.'
              : item.payload.fromStage ? `${visitLabel(String(item.payload.fromStage))} → ${visitLabel(String(item.payload.toStage))}`
                : `${consultationLabel(String(item.payload.fromStatus))} → ${consultationLabel(String(item.payload.toStatus))}`;
          return <View key={item.id} style={styles.history}><Line label={date(item.createdAt)} value={actionLabels[action] ?? action} /><Text style={styles.body}>{summary}</Text>{item.payload.reason ? <Text style={styles.body}>{String(item.payload.reason)}</Text> : null}{['propose', 'approve'].includes(action) ? <Text style={styles.body}>{date(String(item.payload.startsAt))} – {time(String(item.payload.endsAt))}</Text> : null}</View>;
        }) : <Text style={styles.body}>Belum ada perubahan status yang tercatat.</Text>}</View>
      </> : !selectedId ? <>
        <View style={styles.tabs}>{(['requests', 'appointments', 'history'] as Tab[]).map((value) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={[styles.tab, tab === value && styles.activeTab]}><Text style={styles.tabText}>{value === 'requests' ? 'Permintaan' : value === 'appointments' ? 'Jadwal' : 'Riwayat'} ({items.filter((item) => consultationTab(item.record) === value).length})</Text></Pressable>)}</View>
        <TextField label="Cari layanan" placeholder="Nama, ternak, atau ID layanan" value={query} onChangeText={setQuery} />
        {shown.length ? shown.map((item) => <Pressable key={item.record.id} accessibilityRole="button" accessibilityLabel={`Detail ${String(item.record.payload.displayCode)}`} onPress={() => { setDetail(null); setSelectedId(item.record.id); setFeedback(''); }} style={styles.card}><Text style={styles.heading}>{item.otherPartyName}</Text><Text style={styles.body}>{item.animalName} · {item.record.payload.type === 'visit' ? 'Kunjungan' : 'Chat'}</Text><Text style={styles.body}>{String(item.record.payload.displayCode)}</Text><Text style={styles.body}>{date(String(item.record.payload.startsAt), item.timezone)}</Text><StatusBadge role={role} label={consultationLabel(String(item.record.payload.status))} /></Pressable>) : !error ? <EmptyState role={role} title="Tidak ada layanan" description={query ? 'Coba kata pencarian lain.' : 'Layanan dengan status ini akan tampil di sini.'} /> : null}
      </> : null}
    </ScrollView>
    <ConfirmationDialog visible={!!confirm} role={role} title="Konfirmasi tindakan" message={confirm ? `${confirmationText(confirm, detail)}${error ? `\n\n${error}` : ''}` : ''} confirmLabel={confirm?.action === 'propose' ? 'Kirim usulan' : confirm?.action === 'reject' ? 'Tolak permintaan' : confirm?.action === 'cancel' ? 'Batalkan layanan' : confirm?.action === 'decline' ? 'Tolak usulan' : 'Setujui'} loading={busy} onCancel={() => setConfirm(null)} onConfirm={apply} />
    <ConfirmationDialog visible={!!visitConfirm} role={role} title="Konfirmasi progres kunjungan" message={visitConfirm ? `${visitActionConfirmation(visitConfirm, detail)}${error ? `\n\n${error}` : ''}` : ''} confirmLabel={visitConfirm ? visitActionButtonLabel(visitConfirm) : 'Konfirmasi'} loading={busy} onCancel={() => setVisitConfirm(null)} onConfirm={applyVisit} />
    <Modal visible={leave} transparent animationType="fade" onRequestClose={() => { if (!busy) setLeave(false); }}><SafeAreaProvider><SafeAreaView style={styles.backdrop}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.card}><Text style={styles.heading}>Perubahan belum tersimpan</Text>{error ? <InlineFeedback message={error} /> : null}{form?.action === 'propose' ? <Button role={role} label="Simpan Draft" loading={busy} onPress={saveDraft} /> : null}<Button role={role} label="Buang" variant="secondary" disabled={busy} onPress={discard} /><Button role={role} label="Tetap Mengedit" variant="secondary" disabled={busy} onPress={() => setLeave(false)} /></ScrollView></KeyboardAvoidingView></SafeAreaView></SafeAreaProvider></Modal>
    <Modal visible={!!photo} onRequestClose={() => setPhotoId('')}><SafeAreaProvider><SafeAreaView style={styles.root}><Button role={role} label="Tutup foto" onPress={() => setPhotoId('')} />{error ? <InlineFeedback message={error} /> : null}{photo ? <Image source={{ uri: photo.localUri }} style={styles.fullPhoto} resizeMode="contain" onError={() => setError('Foto lokal tidak dapat dibuka.')} /> : null}</SafeAreaView></SafeAreaProvider></Modal>
  </View>;
}
function confirmationText(command: ConsultationCommand, detail: ConsultationDetail | null) {
  const code = String(detail?.record.payload.displayCode ?? '');
  const zone = detail?.timezone ?? 'Asia/Jakarta';
  if (command.action === 'propose') return `${code}\nWaktu baru: ${date(command.startsAt!, zone)} – ${time(command.endsAt!, zone)}\nAlasan: ${command.reason}\nJadwal berubah setelah Peternak menerima usulan.`;
  if (command.action === 'approve') return `${code}\nTerima waktu baru ${date(String(detail?.proposal?.payload.startsAt), zone)} – ${time(String(detail?.proposal?.payload.endsAt), zone)}? Ketersediaan diperiksa kembali.`;
  if (command.action === 'decline') return `${code}\nTolak usulan? Waktu layanan sebelumnya tetap disimpan.`;
  if (command.action === 'accept') return `${code}\nTerima permintaan pada ${date(String(detail?.record.payload.startsAt), zone)}? Layanan menjadi terjadwal.`;
  return `${code}\nAlasan: ${command.reason}\n${detail?.paid ? 'Pengembalian dana akan ditandai diperlukan; dana belum dikembalikan.' : 'Layanan akan dibatalkan.'}`;
}
function Line({ label, value }: { label: string; value: string }) { return <View style={styles.line}><Text style={styles.label}>{label}</Text><Text selectable style={styles.body}>{value}</Text></View>; }
function VisitProgress({ role, stage, visit, timezone, action, pendingProposal, busy, onAdvance }: { role: 'farmer' | 'vet'; stage: string; visit: DomainEntity; timezone: string; action: VisitAction | null; pendingProposal: boolean; busy: boolean; onAdvance: (action: VisitAction) => void }) {
  const stages = ['scheduled', 'en_route', 'arrived', 'examining', 'completed'];
  const timestamps: Record<string, unknown> = { en_route: visit.payload.departureAt, arrived: visit.payload.arrivalAt, examining: visit.payload.examinationStartedAt, completed: visit.payload.completedAt };
  const current = stages.indexOf(stage);
  return <View style={[styles.card, { borderRadius: roleTokens[role].cardRadius }]}>
    <Text style={styles.heading}>Progres kunjungan</Text>
    {stages.map((item, index) => <View key={item} style={styles.visitStep}>
      <View style={[styles.visitDot, index <= current && styles.visitDotActive]} />
      <View style={styles.visitStepText}><Text style={styles.body}>{visitLabel(item)}</Text>{timestamps[item] ? <Text style={styles.label}>{date(String(timestamps[item]), timezone)}</Text> : item === 'scheduled' ? <Text style={styles.label}>Jadwal disepakati</Text> : null}</View>
    </View>)}
    {role === 'vet' && action ? <Button role={role} label={visitActionButtonLabel(action)} disabled={busy} onPress={() => onAdvance(action)} /> : null}
    {role === 'vet' && pendingProposal ? <InlineFeedback message="Tunggu respons Peternak pada usulan jadwal sebelum memulai kunjungan." /> : null}
    {role === 'vet' && stage === 'examining' ? <InlineFeedback message="Buka Catatan Pemeriksaan pada detail layanan untuk menyimpan hasil dan menyelesaikan kunjungan." /> : null}
    {role === 'farmer' ? <Text style={styles.label}>Progres diperbarui oleh dokter yang ditugaskan.</Text> : null}
  </View>;
}
function date(value: string, timezone = 'Asia/Jakarta') { return Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(value)) : 'Belum ditentukan'; }
function time(value: string, timezone = 'Asia/Jakarta') { return Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(value)) : '—'; }
function rupiah(amount: number) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount); }
function visitLabel(stage: string) { return ({ scheduled: 'Terjadwal', en_route: 'Dalam perjalanan', arrived: 'Sudah tiba', examining: 'Pemeriksaan berlangsung', completed: 'Selesai' } as Record<string, string>)[stage] ?? stage; }
function nextVisitAction(stage: string): VisitAction | null { return ({ scheduled: 'depart', en_route: 'arrive', arrived: 'start_examination' } as Record<string, VisitAction>)[stage] ?? null; }
function visitActionButtonLabel(action: VisitAction) { return ({ depart: 'Mulai perjalanan', arrive: 'Konfirmasi sudah tiba', start_examination: 'Mulai pemeriksaan' } as Record<VisitAction, string>)[action]; }
function visitActionConfirmation(action: VisitAction, detail: ConsultationDetail | null) {
  const code = String(detail?.record.payload.displayCode ?? '');
  return ({ depart: `${code}\nTandai kunjungan sebagai dalam perjalanan? Peternak dapat melihat progres ini.`, arrive: `${code}\nKonfirmasi bahwa dokter sudah tiba di alamat kunjungan?`, start_examination: `${code}\nMulai pemeriksaan untuk kunjungan ini?` } as Record<VisitAction, string>)[action];
}
function message(cause: unknown) { return cause instanceof DomainError ? cause.message : 'Layanan belum dapat disimpan atau dimuat. Coba lagi.'; }
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream }, header: { flexDirection: 'row', alignItems: 'center', padding: spacing[4], gap: spacing[3] }, back: { minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.white, borderRadius: radii.button }, title: { flex: 1, fontFamily: fonts.bold, color: colors.brown, fontSize: 22, flexShrink: 1 }, content: { padding: spacing[4], gap: spacing[4], width: '100%', maxWidth: 480, alignSelf: 'center', flexGrow: 1 }, card: { backgroundColor: colors.white, padding: spacing[4], borderRadius: radii.cardVet, gap: spacing[3], minHeight: 48 }, heading: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: 18, flexShrink: 1 }, body: { color: colors.dark, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, flexShrink: 1 }, line: { gap: spacing[1] }, label: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 }, visitStep: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3], minHeight: 42 }, visitDot: { width: 14, height: 14, marginTop: 4, borderRadius: 7, borderWidth: 2, borderColor: colors.gold, backgroundColor: colors.white }, visitDotActive: { borderColor: colors.brown, backgroundColor: colors.brown }, visitStepText: { flex: 1, gap: spacing[1] }, tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] }, tab: { minHeight: 48, padding: spacing[3], borderRadius: radii.button, backgroundColor: colors.white, justifyContent: 'center' }, activeTab: { borderWidth: 2, borderColor: colors.brown }, tabText: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: 13 }, history: { gap: spacing[2], paddingTop: spacing[3], borderTopWidth: 1, borderColor: colors.cream }, thumbnail: { width: '100%', height: 180 }, media: { minHeight: 48 }, fullPhoto: { flex: 1 }, backdrop: { flex: 1, justifyContent: 'center', padding: spacing[5], backgroundColor: 'rgba(58,23,13,0.5)' },
});
