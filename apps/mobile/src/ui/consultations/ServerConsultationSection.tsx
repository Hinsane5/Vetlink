import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AccountRole } from '../../domain/auth';
import type { ApiConsultationDetail, ApiConsultationListItem, ApiConsultationVisit } from '../../application/ports/ApiConsultationRepository';
import type { ApiClinicalNote } from '../../application/ports/ApiClinicalRepository';
import type { ServerConsultationService } from '../../application/ServerConsultationService';
import type { ServerClinicalService } from '../../application/ServerClinicalService';
import type { ServerChatService } from '../../application/ServerChatService';
import { Button } from '../components/Button';
import { LoadingState } from '../components/Feedback';
import { TextField } from '../components/TextField';
import { ServerClinicalSection } from './ServerClinicalSection';
import { ServerChatSection } from '../chat/ServerChatSection';
import { colors, fonts, spacing, typeScale } from '../theme/tokens';

const statusLabels: Record<ApiConsultationListItem['status'], string> = {
  draft: 'Draft', awaiting_payment: 'Menunggu pembayaran', requested: 'Menunggu Dokter', scheduled: 'Terjadwal',
  reschedule_pending: 'Menunggu jadwal', in_progress: 'Berlangsung', completed: 'Selesai', rejected: 'Ditolak', cancelled: 'Dibatalkan',
};
const visitLabels: Record<NonNullable<ApiConsultationVisit>['stage'], string> = {
  scheduled: 'Terjadwal', en_route: 'Dalam perjalanan', arrived: 'Sudah tiba', examining: 'Pemeriksaan berlangsung', completed: 'Selesai',
};

export function ServerConsultationSection({ service, clinicalService, chatService, role, userId, backHandlerRef }: {
  service: ServerConsultationService;
  clinicalService: ServerClinicalService;
  chatService: ServerChatService;
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
  const [detail, setDetail] = useState<ApiConsultationDetail | null>(null);
  const [visit, setVisit] = useState<ApiConsultationVisit | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionUncertain, setActionUncertain] = useState(false);
  const [actionError, setActionError] = useState('');
  const clinicalBackHandlerRef = useRef<(() => boolean) | null>(null);
  const chatBackHandlerRef = useRef<(() => boolean) | null>(null);

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
  }, [actionBusy, backHandlerRef, chatOpen, clinicalOpen, detailLoading, selectedId, clinicalBackHandlerRef]);

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setClinicalOpen(false);
    setChatOpen(false);
    setDetail(null);
    setVisit(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const result = await service.getDetail(role, id);
      setDetail(result.consultation);
      setVisit(result.visit);
      setActionUncertain(false);
      setActionError('');
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : 'Detail konsultasi belum dapat dimuat.');
    } finally {
      setDetailLoading(false);
    }
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
      {!clinicalOpen && !chatOpen ? <Button label="Kembali ke daftar konsultasi" role={role} variant="secondary" disabled={detailLoading || actionBusy} onPress={() => { setSelectedId(null); setClinicalOpen(false); setDetail(null); setDetailError(''); }} /> : null}
      {chatOpen && detail ? <ServerChatSection service={chatService} role={role} userId={userId} consultation={detail} onExit={() => setChatOpen(false)} backHandlerRef={chatBackHandlerRef} /> : clinicalOpen && detail ? <ServerClinicalSection service={clinicalService} role={role} consultation={detail} onCompleteVisit={completeVisit} onExit={() => setClinicalOpen(false)} backHandlerRef={clinicalBackHandlerRef} /> : <>
        {detailLoading ? <LoadingState label="Memuat detail konsultasi…" /> : null}
        {detailError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{detailError}</Text> : null}
        {!detailLoading && detailError ? <Button label="Coba muat ulang" role={role} variant="secondary" onPress={() => openDetail(selectedId)} /> : null}
        {actionError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{actionError}</Text> : null}
        {actionUncertain ? <Button label="Muat ulang status server" role={role} variant="secondary" disabled={actionBusy || detailLoading} onPress={() => openDetail(selectedId)} /> : null}
        {detail ? <Detail role={role} consultation={detail} visit={visit} actionBusy={actionBusy || actionUncertain} onAdvanceVisit={(action) => void advanceVisit(action)} onOpenClinical={() => setClinicalOpen(true)} onOpenChat={() => { setClinicalOpen(false); setChatOpen(true); }} /> : null}
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

function Detail({ role, consultation, visit, actionBusy, onAdvanceVisit, onOpenClinical, onOpenChat }: {
  role: AccountRole;
  consultation: ApiConsultationDetail;
  visit: ApiConsultationVisit | null;
  actionBusy: boolean;
  onAdvanceVisit: (action: 'depart' | 'arrive' | 'start-examination') => void;
  onOpenClinical: () => void;
  onOpenChat: () => void;
}) {
  return <View style={styles.card}>
    <Text style={styles.cardTitle}>{consultation.displayCode} · {consultation.animalName}</Text>
    <Line label="Status" value={statusLabels[consultation.status]} />
    <Line label="Layanan" value={consultation.serviceType === 'chat' ? 'Chat' : 'Kunjungan'} />
    <Line label="Mulai" value={formatDate(consultation.startsAt)} />
    <Line label="Keluhan" value={consultation.complaint} />
    <Line label="Tarif" value={formatRupiah(consultation.feeAmountIdr)} />
    <Line label="Pembayaran" value={paymentLabel(consultation.paymentStatus)} />
    {consultation.refundStatus === 'refund_needed' ? <Line label="Pengembalian" value="Perlu ditangani sesuai kebijakan layanan" /> : null}
    {consultation.rejectionReason ? <Line label="Alasan" value={consultation.rejectionReason} /> : null}
    {consultation.visitAddressSnapshot && consultation.serviceType === 'visit' ? <Line label="Alamat kunjungan" value={`${consultation.visitAddressSnapshot.addressLine}, ${consultation.visitAddressSnapshot.city}`} /> : null}
    {visit ? <Line label="Tahap kunjungan" value={visitLabels[visit.stage]} /> : null}
    <Text style={styles.body}>{role === 'farmer' ? 'Status ditampilkan dari akun server.' : 'Layanan ini muncul dari penugasan akun Dokter.'}</Text>
    {role === 'vet' && visit && consultation.status === 'scheduled' && consultation.paymentStatus === 'succeeded' && visit.stage === 'scheduled' ? <Button role={role} label={actionBusy ? 'Menyimpan…' : 'Mulai perjalanan'} disabled={actionBusy} onPress={() => onAdvanceVisit('depart')} /> : null}
    {role === 'vet' && visit && consultation.status === 'scheduled' && consultation.paymentStatus === 'succeeded' && visit.stage === 'en_route' ? <Button role={role} label={actionBusy ? 'Menyimpan…' : 'Konfirmasi sudah tiba'} disabled={actionBusy} onPress={() => onAdvanceVisit('arrive')} /> : null}
    {role === 'vet' && visit && consultation.status === 'scheduled' && consultation.paymentStatus === 'succeeded' && visit.stage === 'arrived' ? <Button role={role} label={actionBusy ? 'Menyimpan…' : 'Mulai pemeriksaan'} disabled={actionBusy} onPress={() => onAdvanceVisit('start-examination')} /> : null}
    {consultation.serviceType === 'chat' && consultation.status === 'in_progress' && consultation.paymentStatus === 'succeeded' ? <Button role={role} variant="secondary" label="Buka chat konsultasi" onPress={onOpenChat} /> : null}
    <Button role={role} variant="secondary" label="Buka catatan klinis dan rekomendasi" onPress={onOpenClinical} />
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

function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

function messageFor(cause: unknown, fallback: string): string { return cause instanceof Error ? cause.message : fallback; }

const styles = StyleSheet.create({
  section: { gap: spacing[4] },
  heading: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.section },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21 },
  card: { backgroundColor: colors.white, borderRadius: 14, padding: spacing[4], gap: spacing[2] },
  cardTitle: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.body },
  label: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.caption },
  line: { gap: spacing[1] },
  error: { color: colors.orange, fontFamily: fonts.medium, fontSize: typeScale.body },
});
