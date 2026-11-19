import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AccountRole } from '../../domain/auth';
import type { ApiConsultationDetail, ApiConsultationListItem, ApiConsultationVisit } from '../../application/ports/ApiConsultationRepository';
import type { ApiClinicalNote } from '../../application/ports/ApiClinicalRepository';
import type { ApiVetSlot } from '../../application/ports/VetDirectoryReadRepository';
import type { ServerConsultationService } from '../../application/ServerConsultationService';
import type { ServerClinicalService } from '../../application/ServerClinicalService';
import type { ServerChatService } from '../../application/ServerChatService';
import type { ServerVetScheduleService } from '../../application/ServerVetScheduleService';
import type { ServerCareCoordinationService } from '../../application/ServerCareCoordinationService';
import { Button } from '../components/Button';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { LoadingState } from '../components/Feedback';
import { TextArea, TextField } from '../components/TextField';
import { ServerClinicalSection } from './ServerClinicalSection';
import { ServerChatSection } from '../chat/ServerChatSection';
import { ServerCareCoordinationSection } from './ServerCareCoordinationSection';
import { colors, fonts, spacing, typeScale } from '../theme/tokens';

const statusLabels: Record<ApiConsultationListItem['status'], string> = {
  draft: 'Draft', awaiting_payment: 'Menunggu pembayaran', requested: 'Menunggu Dokter', scheduled: 'Terjadwal',
  reschedule_pending: 'Menunggu jadwal', in_progress: 'Berlangsung', completed: 'Selesai', rejected: 'Ditolak', cancelled: 'Dibatalkan',
};
const visitLabels: Record<NonNullable<ApiConsultationVisit>['stage'], string> = {
  scheduled: 'Terjadwal', en_route: 'Dalam perjalanan', arrived: 'Sudah tiba', examining: 'Pemeriksaan berlangsung', completed: 'Selesai',
};

export function ServerConsultationSection({ service, clinicalService, chatService, scheduleService, careService, role, userId, backHandlerRef }: {
  service: ServerConsultationService;
  clinicalService: ServerClinicalService;
  chatService: ServerChatService;
  scheduleService: ServerVetScheduleService;
  careService: ServerCareCoordinationService;
  role: AccountRole;
  userId: string;
  backHandlerRef: { current: (() => boolean) | null };
}) {
  const [rows, setRows] = useState<ApiConsultationListItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clinicalOpen, setClinicalOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [careOpen, setCareOpen] = useState(false);
  const [detail, setDetail] = useState<ApiConsultationDetail | null>(null);
  const [visit, setVisit] = useState<ApiConsultationVisit | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionUncertain, setActionUncertain] = useState(false);
  const [actionError, setActionError] = useState('');
  const [acceptVisible, setAcceptVisible] = useState(false);
  const [rejectVisible, setRejectVisible] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [cancelVisible, setCancelVisible] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [proposalDecision, setProposalDecision] = useState<'accept' | 'decline' | null>(null);
  const [startChatVisible, setStartChatVisible] = useState(false);
  const [proposalVisible, setProposalVisible] = useState(false);
  const [proposalSlots, setProposalSlots] = useState<ApiVetSlot[]>([]);
  const [proposalTimezone, setProposalTimezone] = useState<string | null>(null);
  const [proposalTimezoneError, setProposalTimezoneError] = useState('');
  const [selectedProposalStart, setSelectedProposalStart] = useState('');
  const [proposalLoading, setProposalLoading] = useState(false);
  const [proposalError, setProposalError] = useState('');
  const clinicalBackHandlerRef = useRef<(() => boolean) | null>(null);
  const chatBackHandlerRef = useRef<(() => boolean) | null>(null);
  const careBackHandlerRef = useRef<(() => boolean) | null>(null);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      service.list(role).then(
        (items) => { if (active) setRows(items); },
        (cause) => { if (active) { setRows([]); setError(cause instanceof Error ? cause.message : 'Konsultasi belum dapat dimuat.'); } },
      ).finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [revision, role, service]);

  useEffect(() => {
    backHandlerRef.current = () => {
      if (!selectedId) return false;
      if (careOpen && careBackHandlerRef.current?.()) return true;
      if (chatOpen && chatBackHandlerRef.current?.()) return true;
      if (clinicalOpen && clinicalBackHandlerRef.current?.()) return true;
      if (detailLoading || actionBusy) return true;
      setSelectedId(null);
      setClinicalOpen(false);
      setDetail(null);
      setDetailError('');
      return true;
    };
    return () => { backHandlerRef.current = null; };
  }, [actionBusy, backHandlerRef, careOpen, chatOpen, clinicalOpen, detailLoading, selectedId]);

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setClinicalOpen(false);
    setChatOpen(false);
    setCareOpen(false);
    setDetail(null);
    setVisit(null);
    setProposalTimezone(null);
    setProposalTimezoneError('');
    setDetailError('');
    setDetailLoading(true);
    try {
      const result = await service.getDetail(role, id);
      setDetail(result.consultation);
      setVisit(result.visit);
      if (role === 'farmer' && result.consultation.proposals.some((item) => item.status === 'pending')) {
        try {
          setProposalTimezone(await scheduleService.timezoneFor(role, userId, result.consultation.vetId));
        } catch (cause) {
          setProposalTimezoneError(messageFor(cause, 'Zona waktu Dokter belum dapat dimuat.'));
        }
      }
      setActionUncertain(false);
      setActionError('');
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : 'Detail konsultasi belum dapat dimuat.');
    } finally {
      setDetailLoading(false);
    }
  };

  const respondToRequest = async (action: 'accept' | 'reject') => {
    if (!detail || actionBusy || actionUncertain) return;
    setActionBusy(true); setActionError('');
    try {
      const result = await service.respondToRequest(role, userId, detail, action, rejectReason);
      setDetail(result.consultation); setVisit(result.visit);
      setAcceptVisible(false); setRejectVisible(false); setRejectReason('');
      setRows((current) => current.map((row) => row.id === result.consultation.id
        ? { ...row, status: result.consultation.status, visitStage: result.consultation.visitStage, version: result.consultation.version }
        : row));
    } catch (cause) {
      setActionUncertain(true);
      setActionError(messageFor(cause, 'Respons belum dapat dipastikan. Muat ulang status server sebelum melanjutkan.'));
    } finally { setActionBusy(false); }
  };

  const respondToProposal = async (decision: 'accept' | 'decline') => {
    if (!detail || actionBusy || actionUncertain) return;
    const proposal = detail.proposals.find((item) => item.status === 'pending');
    if (!proposal) { setActionError('Usulan jadwal aktif tidak ditemukan. Muat ulang detail server.'); setActionUncertain(true); return; }
    setActionBusy(true); setActionError('');
    try {
      const result = await service.respondToProposal(role, userId, detail, proposal.id, decision);
      setDetail(result.consultation); setVisit(result.visit); setProposalDecision(null);
      setRows((current) => current.map((row) => row.id === result.consultation.id
        ? { ...row, status: result.consultation.status, startsAt: result.consultation.startsAt, endsAt: result.consultation.endsAt, version: result.consultation.version }
        : row));
    } catch (cause) {
      setActionUncertain(true);
      setActionError(messageFor(cause, 'Keputusan jadwal belum dapat dipastikan. Muat ulang status server sebelum melanjutkan.'));
    } finally { setActionBusy(false); }
  };

  const cancelConsultation = async () => {
    if (!detail || actionBusy || actionUncertain) return;
    setActionBusy(true); setActionError('');
    try {
      const result = await service.cancel(role, userId, detail, cancelReason);
      setDetail(result.consultation); setVisit(result.visit);
      setCancelVisible(false); setCancelReason('');
      setRows((current) => current.map((row) => row.id === result.consultation.id
        ? { ...row, status: result.consultation.status, refundStatus: result.consultation.refundStatus, version: result.consultation.version }
        : row));
    } catch (cause) {
      setActionUncertain(true);
      setActionError(messageFor(cause, 'Pembatalan belum dapat dipastikan. Muat ulang status server sebelum melanjutkan.'));
    } finally { setActionBusy(false); }
  };

  const openProposalForm = async () => {
    if (!detail || actionBusy || actionUncertain) return;
    setProposalVisible(true); setProposalLoading(true); setProposalError('');
    setSelectedProposalStart(''); setProposalSlots([]); setProposalTimezone(null); setProposalTimezoneError('');
    try {
      const result = await scheduleService.proposalSlots(role, userId, detail.serviceType);
      setProposalSlots(result.slots); setProposalTimezone(result.timezone); setProposalTimezoneError('');
      if (!result.slots.length) setProposalError('Belum ada slot terbuka dalam 14 hari ke depan.');
    } catch (cause) {
      const message = messageFor(cause, 'Slot usulan belum dapat dimuat.');
      setProposalError(message); setProposalTimezoneError(message);
    } finally { setProposalLoading(false); }
  };

  const submitProposal = async () => {
    if (!detail || !selectedProposalStart || actionBusy || actionUncertain) return;
    setActionBusy(true); setActionError(''); setProposalError('');
    try {
      const result = await service.proposeSchedule(role, userId, detail, selectedProposalStart);
      setDetail(result.consultation); setVisit(result.visit); setProposalVisible(false);
      setRows((current) => current.map((row) => row.id === result.consultation.id
        ? { ...row, status: result.consultation.status, version: result.consultation.version }
        : row));
    } catch (cause) {
      setActionUncertain(true);
      const message = messageFor(cause, 'Usulan jadwal belum dapat dipastikan. Muat ulang status server sebelum melanjutkan.');
      setActionError(message); setProposalError(message);
    } finally { setActionBusy(false); }
  };

  const advanceVisit = async (action: 'depart' | 'arrive' | 'start-examination') => {
    if (!detail || !visit || actionBusy || actionUncertain) return;
    setActionBusy(true); setActionError('');
    try {
      const result = await service.advanceVisit(role, userId, detail, visit, action);
      setDetail(result.consultation); setVisit(result.visit);
      setRows((current) => current.map((row) => row.id === result.consultation.id
        ? { ...row, status: result.consultation.status, visitStage: result.consultation.visitStage, version: result.consultation.version }
        : row));
    } catch (cause) {
      setActionUncertain(true);
      setActionError(messageFor(cause, 'Tahap belum dapat diperbarui. Muat ulang detail untuk memastikan status server.'));
    } finally { setActionBusy(false); }
  };

  const startChat = async () => {
    if (!detail || actionBusy || actionUncertain) return;
    setActionBusy(true); setActionError('');
    try {
      const updated = await service.startChat(role, userId, detail);
      setDetail(updated); setStartChatVisible(false);
      setRows((current) => current.map((row) => row.id === updated.id ? { ...row, status: updated.status, version: updated.version } : row));
    } catch (cause) {
      setActionUncertain(true);
      setActionError(messageFor(cause, 'Chat belum dapat dimulai. Muat ulang status server sebelum melanjutkan.'));
    } finally { setActionBusy(false); }
  };

  const completeVisit = async (note: ApiClinicalNote) => {
    if (actionBusy) throw new Error('Perubahan kunjungan lain masih berlangsung.');
    if (actionUncertain) throw new Error('Muat ulang status server sebelum mengulangi tindakan.');
    if (!detail || !visit) throw new Error('Detail kunjungan harus dimuat ulang sebelum diselesaikan.');
    setActionBusy(true); setActionError('');
    try {
      const result = await service.completeVisit(role, userId, detail, visit, note);
      setDetail(result.consultation); setVisit(result.visit);
      setRows((current) => current.map((row) => row.id === result.consultation.id
        ? { ...row, status: result.consultation.status, visitStage: result.consultation.visitStage, completedAt: result.consultation.completionAt, version: result.consultation.version }
        : row));
    } catch (cause) {
      setActionUncertain(true);
      setActionError(messageFor(cause, 'Penyelesaian belum dapat dipastikan. Muat ulang status server sebelum melanjutkan.'));
      throw cause;
    } finally { setActionBusy(false); }
  };

  const term = query.trim().toLocaleLowerCase('id-ID');
  const shown = rows.filter((row) => !term || [row.displayCode, row.animalName, row.animalCode]
    .some((value) => value.toLocaleLowerCase('id-ID').includes(term)));
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>Konsultasi dari server</Text>
    {selectedId ? <>
      {!clinicalOpen && !chatOpen && !careOpen ? <Button label="Kembali ke daftar konsultasi" role={role} variant="secondary" disabled={detailLoading || actionBusy} onPress={() => { setSelectedId(null); setClinicalOpen(false); setDetail(null); setDetailError(''); }} /> : null}
      {careOpen && detail ? <ServerCareCoordinationSection service={careService} clinicalService={clinicalService} consultation={detail} role={role} userId={userId} onExit={() => setCareOpen(false)} backHandlerRef={careBackHandlerRef} />
        : chatOpen && detail ? <ServerChatSection service={chatService} role={role} userId={userId} consultation={detail} onExit={() => setChatOpen(false)} backHandlerRef={chatBackHandlerRef} /> : clinicalOpen && detail ? <ServerClinicalSection service={clinicalService} role={role} consultation={detail} onCompleteVisit={completeVisit} onExit={() => setClinicalOpen(false)} backHandlerRef={clinicalBackHandlerRef} /> : <>
        {detailLoading ? <LoadingState label="Memuat detail konsultasi…" /> : null}
        {detailError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{detailError}</Text> : null}
        {!detailLoading && detailError ? <Button label="Coba muat ulang" role={role} variant="secondary" onPress={() => openDetail(selectedId)} /> : null}
        {actionError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{actionError}</Text> : null}
        {actionUncertain ? <Button label="Muat ulang status server" role={role} variant="secondary" disabled={actionBusy || detailLoading} onPress={() => openDetail(selectedId)} /> : null}
        {detail ? <Detail
          role={role}
          consultation={detail}
          visit={visit}
          actionBusy={actionBusy || actionUncertain}
          proposalTimezone={proposalTimezone}
          proposalTimezoneError={proposalTimezoneError}
          onRetryTimezone={() => { void openDetail(selectedId); }}
          onAccept={() => setAcceptVisible(true)}
          onReject={() => { setRejectReason(''); setRejectVisible(true); }}
          onCancel={() => { setCancelReason(''); setCancelVisible(true); }}
          onRespondProposal={(decision) => setProposalDecision(decision)}
          onProposeSchedule={() => { void openProposalForm(); }}
          onStartChat={() => setStartChatVisible(true)}
          onAdvanceVisit={(action) => { void advanceVisit(action); }}
          onOpenClinical={() => setClinicalOpen(true)}
          onOpenCare={() => setCareOpen(true)}
          onOpenChat={() => { setClinicalOpen(false); setChatOpen(true); }}
        /> : null}
        <ConfirmationDialog visible={acceptVisible} title="Terima permintaan layanan?" message="Permintaan akan menjadi terjadwal setelah server memeriksa verifikasi Dokter dan ketersediaan waktu." role="vet" confirmLabel="Terima permintaan" cancelLabel="Kembali" onConfirm={() => { void respondToRequest('accept'); }} onCancel={() => setAcceptVisible(false)} loading={actionBusy} confirmDisabled={actionUncertain || !detail || detail.status !== 'requested' || detail.paymentStatus !== 'succeeded'} />
        <Modal visible={rejectVisible} transparent animationType="fade" onRequestClose={() => { if (!actionBusy) setRejectVisible(false); }}>
          <View style={styles.modalBackdrop}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.rejectDialog}>
                <Text accessibilityRole="header" style={styles.cardTitle}>Tolak permintaan</Text>
                <Text style={styles.body}>Berikan alasan 3–1.000 karakter. Jika pembayaran sudah terjadi, server akan mencatat kebutuhan pengembalian dana; aplikasi tidak memproses transfer dana.</Text>
                <TextArea label="Alasan penolakan" value={rejectReason} onChangeText={setRejectReason} editable={!actionBusy && !actionUncertain} maxLength={1000} helperText="Alasan akan tersimpan pada layanan." />
                {actionError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{actionError}</Text> : null}
                <Button role="vet" label="Tolak permintaan" loading={actionBusy} disabled={actionUncertain || rejectReason.trim().length < 3} onPress={() => { void respondToRequest('reject'); }} />
                <Button role="vet" variant="secondary" label="Kembali" disabled={actionBusy} onPress={() => setRejectVisible(false)} />
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </Modal>
        <Modal visible={cancelVisible} transparent animationType="fade" onRequestClose={() => { if (!actionBusy) setCancelVisible(false); }}>
          <View style={styles.modalBackdrop}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.rejectDialog}>
                <Text accessibilityRole="header" style={styles.cardTitle}>Batalkan layanan?</Text>
                <Text style={styles.body}>Pembatalan hanya tersedia sebelum Dokter memulai layanan. Pembayaran yang berhasil akan ditandai perlu ditangani; aplikasi tidak mengirim pengembalian dana.</Text>
                <TextArea label="Alasan pembatalan" value={cancelReason} onChangeText={setCancelReason} editable={!actionBusy && !actionUncertain} maxLength={1000} helperText="Alasan 3–1.000 karakter akan tersimpan pada layanan." />
                {actionError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{actionError}</Text> : null}
                {actionUncertain ? <Button role="farmer" variant="secondary" label="Muat ulang status server" disabled={actionBusy || detailLoading} onPress={() => { setCancelVisible(false); void openDetail(selectedId!); }} />
                  : <Button role="farmer" label="Batalkan layanan" loading={actionBusy} disabled={cancelReason.trim().length < 3} onPress={() => { void cancelConsultation(); }} />}
                {!actionUncertain ? <Button role="farmer" variant="secondary" label="Kembali" disabled={actionBusy} onPress={() => setCancelVisible(false)} /> : null}
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </Modal>
        <ConfirmationDialog visible={startChatVisible} title="Mulai konsultasi chat?" message="Chat akan menjadi berlangsung untuk Peternak dan Dokter pada layanan ini." role="vet" confirmLabel="Mulai chat" cancelLabel="Kembali" onConfirm={() => { void startChat(); }} onCancel={() => setStartChatVisible(false)} loading={actionBusy} confirmDisabled={actionUncertain || !detail || detail.serviceType !== 'chat' || detail.status !== 'scheduled' || detail.paymentStatus !== 'succeeded'} />
        <ConfirmationDialog visible={proposalDecision !== null} title={proposalDecision === 'accept' ? 'Setujui usulan jadwal?' : 'Tolak usulan jadwal?'} message={proposalDecisionMessage(detail, proposalDecision, proposalTimezone)} role={role} confirmLabel={proposalDecision === 'accept' ? 'Setuju dan simpan' : 'Tolak usulan'} cancelLabel="Kembali" onConfirm={() => { if (proposalDecision) void respondToProposal(proposalDecision); }} onCancel={() => setProposalDecision(null)} loading={actionBusy} confirmDisabled={actionUncertain || !detail || detail.status !== 'reschedule_pending' || !proposalTimezone} />
        <Modal visible={proposalVisible} transparent animationType="fade" onRequestClose={() => { if (!actionBusy) setProposalVisible(false); }}>
          <View style={styles.modalBackdrop}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.rejectDialog}>
                <Text accessibilityRole="header" style={styles.cardTitle}>Usulkan jadwal baru</Text>
                <Text style={styles.body}>Pilih slot yang tersedia menurut jadwal Dokter ({proposalTimezone ?? 'zona waktu server'}). Peternak harus menyetujui sebelum waktu layanan berubah.</Text>
                {proposalLoading ? <LoadingState label="Memuat slot server…" /> : null}
                {proposalError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{proposalError}</Text> : null}
                {!proposalLoading && proposalTimezone && proposalSlots.map((slot) => <Button key={slot.startsAt} role="vet" variant={selectedProposalStart === slot.startsAt ? 'primary' : 'secondary'} label={formatSlotRange(slot, proposalTimezone)} disabled={actionBusy || actionUncertain} onPress={() => setSelectedProposalStart(slot.startsAt)} />)}
                {!proposalLoading && proposalError && !actionUncertain ? <Button role="vet" variant="secondary" label="Muat ulang slot" disabled={actionBusy} onPress={() => { void openProposalForm(); }} /> : null}
                {actionUncertain ? <Button role="vet" variant="secondary" label="Kembali ke detail untuk memuat ulang status" onPress={() => setProposalVisible(false)} /> : <Button role="vet" label="Kirim usulan jadwal" loading={actionBusy} disabled={proposalLoading || actionUncertain || !selectedProposalStart || !detail || !['requested', 'scheduled'].includes(detail.status)} onPress={() => { void submitProposal(); }} />}
                {!actionUncertain ? <Button role="vet" variant="secondary" label="Kembali" disabled={actionBusy} onPress={() => setProposalVisible(false)} /> : null}
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </Modal>
      </>}
    </> : <>
      <TextField label="Cari konsultasi" value={query} onChangeText={setQuery} placeholder="Kode layanan atau ternak" />
      {loading ? <LoadingState label="Memuat konsultasi…" /> : null}
      {!loading && error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      {!loading && !error && rows.length === 0 ? <Text style={styles.body}>Belum ada konsultasi pada akun ini.</Text> : null}
      {!loading && !error && rows.length > 0 && shown.length === 0 ? <Text style={styles.body}>Tidak ada konsultasi yang cocok.</Text> : null}
      {!loading && !error && shown.map((row) => <View key={row.id} style={styles.card}>
        <Text style={styles.cardTitle}>{row.displayCode} · {row.animalName}</Text>
        <Text style={styles.body}>{row.serviceType === 'chat' ? 'Chat' : 'Kunjungan'} · {statusLabels[row.status]}</Text>
        <Text style={styles.body}>{formatDate(row.startsAt)} · {formatRupiah(row.feeAmountIdr)}</Text>
        <Button label={`Buka konsultasi ${row.displayCode}`} role={role} variant="secondary" onPress={() => openDetail(row.id)} />
      </View>)}
      <Button label="Muat ulang konsultasi" role={role} variant="secondary" disabled={loading} onPress={() => { setLoading(true); setError(''); setRevision((value) => value + 1); }} />
    </>}
  </View>;
}

function Detail({ role, consultation, visit, actionBusy, proposalTimezone, proposalTimezoneError, onRetryTimezone, onAccept, onReject, onCancel, onRespondProposal, onProposeSchedule, onStartChat, onAdvanceVisit, onOpenClinical, onOpenCare, onOpenChat }: {
  role: AccountRole;
  consultation: ApiConsultationDetail;
  visit: ApiConsultationVisit | null;
  actionBusy: boolean;
  proposalTimezone: string | null;
  proposalTimezoneError: string;
  onRetryTimezone: () => void;
  onAccept: () => void;
  onReject: () => void;
  onCancel: () => void;
  onRespondProposal: (decision: 'accept' | 'decline') => void;
  onProposeSchedule: () => void;
  onStartChat: () => void;
  onAdvanceVisit: (action: 'depart' | 'arrive' | 'start-examination') => void;
  onOpenClinical: () => void;
  onOpenCare: () => void;
  onOpenChat: () => void;
}) {
  const pendingProposals = consultation.proposals.filter((item) => item.status === 'pending');
  return <View style={styles.card}>
    <Text style={styles.cardTitle}>{consultation.displayCode} · {consultation.animalName}</Text>
    <Line label="Status" value={statusLabels[consultation.status]} />
    <Line label="Layanan" value={consultation.serviceType === 'chat' ? 'Chat' : 'Kunjungan'} />
    <Line label="Mulai" value={formatDate(consultation.startsAt)} />
    <Line label="Keluhan" value={consultation.complaint} />
    <Line label="Tarif" value={formatRupiah(consultation.feeAmountIdr)} />
    <Line label="Pembayaran" value={paymentLabel(consultation.paymentStatus)} />
    {consultation.refundStatus === 'refund_needed' ? <Line label="Pengembalian" value="Perlu ditangani sesuai kebijakan layanan" /> : null}
    {consultation.visitAddressSnapshot && consultation.serviceType === 'visit' ? <Line label="Alamat kunjungan" value={`${consultation.visitAddressSnapshot.addressLine}, ${consultation.visitAddressSnapshot.city}`} /> : null}
    {visit ? <Line label="Tahap kunjungan" value={visitLabels[visit.stage]} /> : null}
    <Text style={styles.body}>{role === 'farmer' ? 'Status ditampilkan dari akun server.' : 'Layanan ini muncul dari penugasan akun Dokter.'}</Text>
    {role === 'vet' && consultation.status === 'requested' && consultation.paymentStatus === 'succeeded' ? <>
      <Button role={role} label="Terima permintaan" disabled={actionBusy} onPress={onAccept} />
      <Button role={role} variant="secondary" label="Tolak permintaan" disabled={actionBusy} onPress={onReject} />
    </> : null}
    {canCancelConsultation(role, consultation)
      ? <Button role={role} variant="secondary" label="Batalkan layanan" disabled={actionBusy} onPress={onCancel} /> : null}
    {role === 'farmer' && consultation.status === 'reschedule_pending' && pendingProposals.length === 1 ? <View style={styles.proposalCard}>
      <Text style={styles.cardTitle}>Usulan jadwal baru</Text>
      <Line label="Zona waktu Dokter" value={proposalTimezone ?? 'Memuat zona waktu…'} />
      {proposalTimezone ? <>
        <Line label="Mulai" value={formatDateInTimezone(pendingProposals[0].startsAt, proposalTimezone)} />
        <Line label="Selesai" value={formatDateInTimezone(pendingProposals[0].endsAt, proposalTimezone)} />
        <Button role={role} label="Setuju dengan jadwal" disabled={actionBusy} onPress={() => onRespondProposal('accept')} />
        <Button role={role} variant="secondary" label="Tolak usulan" disabled={actionBusy} onPress={() => onRespondProposal('decline')} />
      </> : proposalTimezoneError ? <>
        <Text accessibilityLiveRegion="polite" style={styles.error}>{proposalTimezoneError}</Text>
        <Button role={role} variant="secondary" label="Muat ulang zona waktu" disabled={actionBusy} onPress={onRetryTimezone} />
      </> : <LoadingState label="Memuat zona waktu Dokter…" />}
    </View> : null}
    {role === 'vet' && ['requested', 'scheduled'].includes(consultation.status) && consultation.paymentStatus === 'succeeded' && pendingProposals.length === 0 ? <Button role={role} variant="secondary" label="Usulkan jadwal lain" disabled={actionBusy} onPress={onProposeSchedule} /> : null}
    {consultation.status === 'rejected' && consultation.rejectionReason ? <Line label="Alasan penolakan" value={consultation.rejectionReason} /> : null}
    {consultation.status === 'cancelled' && consultation.cancellationReason ? <Line label="Alasan pembatalan" value={consultation.cancellationReason} /> : null}
    {role === 'vet' && visit && consultation.status === 'scheduled' && consultation.paymentStatus === 'succeeded' && visit.stage === 'scheduled' ? <Button role={role} label={actionBusy ? 'Menyimpan…' : 'Mulai perjalanan'} disabled={actionBusy} onPress={() => onAdvanceVisit('depart')} /> : null}
    {role === 'vet' && visit && consultation.status === 'scheduled' && consultation.paymentStatus === 'succeeded' && visit.stage === 'en_route' ? <Button role={role} label={actionBusy ? 'Menyimpan…' : 'Konfirmasi sudah tiba'} disabled={actionBusy} onPress={() => onAdvanceVisit('arrive')} /> : null}
    {role === 'vet' && visit && consultation.status === 'scheduled' && consultation.paymentStatus === 'succeeded' && visit.stage === 'arrived' ? <Button role={role} label={actionBusy ? 'Menyimpan…' : 'Mulai pemeriksaan'} disabled={actionBusy} onPress={() => onAdvanceVisit('start-examination')} /> : null}
    {role === 'vet' && consultation.serviceType === 'chat' && consultation.status === 'scheduled' && consultation.paymentStatus === 'succeeded' ? <Button role={role} label="Mulai konsultasi chat" disabled={actionBusy} onPress={onStartChat} /> : null}
    {consultation.serviceType === 'chat' && consultation.status === 'in_progress' && consultation.paymentStatus === 'succeeded' ? <Button role={role} variant="secondary" label="Buka chat konsultasi" onPress={onOpenChat} /> : null}
    <Button role={role} variant="secondary" label="Buka catatan klinis dan rekomendasi" onPress={onOpenClinical} />
    {consultation.paymentStatus === 'succeeded' && ['scheduled', 'in_progress', 'completed'].includes(consultation.status)
      ? <Button role={role} variant="secondary" label="Buka tindak lanjut & pengingat" onPress={onOpenCare} /> : null}
  </View>;
}

function Line({ label, value }: { label: string; value: string }) {
  return <View style={styles.line}><Text style={styles.label}>{label}</Text><Text style={styles.body}>{value}</Text></View>;
}

function paymentLabel(value: ApiConsultationDetail['paymentStatus']): string {
  return value === 'succeeded' ? 'Berhasil' : value === 'pending' ? 'Menunggu' : value === 'failed' ? 'Gagal' : value === 'expired' ? 'Kedaluwarsa' : 'Belum ada pembayaran';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value));
}

function formatSlotRange(slot: ApiVetSlot, timezone: string): string {
  const format = (value: string) => new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(value));
  return `${format(slot.startsAt)} – ${format(slot.endsAt)}`;
}

function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

function canCancelConsultation(role: AccountRole, consultation: ApiConsultationDetail): boolean {
  if (role !== 'farmer' || consultation.paymentStatus !== 'succeeded'
    || !['requested', 'scheduled', 'reschedule_pending'].includes(consultation.status)) return false;
  if (consultation.serviceType !== 'visit') return true;
  if (consultation.visitStage === 'scheduled') return true;
  return consultation.visitStage === null
    && (consultation.status === 'requested'
      || (consultation.status === 'reschedule_pending' && consultation.reschedulePreviousStatus === 'requested'));
}

function messageFor(cause: unknown, fallback: string): string { return cause instanceof Error ? cause.message : fallback; }

function proposalDecisionMessage(detail: ApiConsultationDetail | null, decision: 'accept' | 'decline' | null, timezone: string | null): string {
  if (!timezone) return 'Memuat zona waktu Dokter…';
  if (decision === 'decline') return 'Jadwal sebelumnya tetap berlaku.';
  if (decision === 'accept') {
    const proposal = detail?.proposals.find((item) => item.status === 'pending');
    return proposal ? `Anda menyetujui waktu ${formatDateInTimezone(proposal.startsAt, timezone)} (${timezone}). Jadwal baru berlaku setelah server menyimpan persetujuan.` : 'Usulan jadwal tidak tersedia. Muat ulang detail server.';
  }
  return '';
}

function formatDateInTimezone(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value));
}

const styles = StyleSheet.create({
  section: { gap: spacing[4] },
  heading: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.section },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21 },
  card: { backgroundColor: colors.white, borderRadius: 14, padding: spacing[4], gap: spacing[2] },
  cardTitle: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.body },
  label: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.caption },
  line: { gap: spacing[1] },
  error: { color: colors.orange, fontFamily: fonts.medium, fontSize: typeScale.body },
  proposalCard: { gap: spacing[2], padding: spacing[3], borderRadius: 12, backgroundColor: colors.cream },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: spacing[4], backgroundColor: 'rgba(58,23,13,0.5)' },
  rejectDialog: { width: '100%', maxWidth: 420, alignSelf: 'center', padding: spacing[4], gap: spacing[3], borderRadius: 16, backgroundColor: colors.white },
});
