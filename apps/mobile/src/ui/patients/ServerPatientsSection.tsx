import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { filterServerPatients, type ServerPatientDetail, type ServerPatientService } from '../../application/ServerPatientService';
import type { ApiPatientRecord } from '../../application/ports/PatientReadRepository';
import type { ApiHealthEvent } from '../../application/ports/LivestockHealthRepository';
import { speciesLabel } from '../../domain/catalog';
import { Button } from '../components/Button';
import { LoadingState } from '../components/Feedback';
import { TextField } from '../components/TextField';
import { colors, fonts, spacing, typeScale } from '../theme/tokens';
import { PrivateVideoPlayer } from '../components/PrivateVideoPlayer';

export function ServerPatientsSection({ service, userId, backHandlerRef }: {
  service: ServerPatientService;
  userId: string;
  backHandlerRef: { current: (() => boolean) | null };
}) {
  const [patients, setPatients] = useState<ApiPatientRecord[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ServerPatientDetail | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [mediaBusyId, setMediaBusyId] = useState<string | null>(null);
  const [mediaState, setMediaState] = useState<Record<string, { uris: Record<string, string>; error: string }>>({});
  const currentMediaState = selectedId ? mediaState[selectedId] : undefined;
  const mediaUris = currentMediaState?.uris ?? {};
  const mediaError = currentMediaState?.error ?? '';

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      service.listAssigned('vet').then(
        (records) => { if (active) setPatients(records); },
        (cause) => { if (active) { setPatients([]); setError(cause instanceof Error ? cause.message : 'Pasien belum dapat dimuat.'); } },
      ).finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [revision, service]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let active = true;
    const timer = setTimeout(() => {
      setDetailLoading(true);
      setDetailError('');
      service.getAssignedDetail('vet', selectedId).then(
        (result) => { if (active) setDetail(result); },
        (cause) => { if (active) { setDetail(null); setDetailError(cause instanceof Error ? cause.message : 'Detail pasien belum dapat dimuat.'); } },
      ).finally(() => { if (active) setDetailLoading(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [detailRevision, selectedId, service]);

  useEffect(() => {
    backHandlerRef.current = () => {
      if (!selectedId) return false;
      if (detailLoading) return true;
      setSelectedId(null);
      setDetail(null);
      setDetailError('');
      return true;
    };
    return () => { backHandlerRef.current = null; };
  }, [backHandlerRef, detailLoading, selectedId]);

  const shown = filterServerPatients(patients, query);
  if (selectedId) return <View style={styles.section}>
    <Button label="Kembali ke daftar pasien" role="vet" variant="secondary" disabled={detailLoading} onPress={() => { setSelectedId(null); setDetail(null); setDetailError(''); }} />
    <Text accessibilityRole="header" style={styles.heading}>Detail Pasien</Text>
    {detailLoading ? <LoadingState label="Memuat pasien dan riwayat kesehatan…" /> : null}
    {detailError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{detailError}</Text> : null}
    {!detailLoading && detailError ? <Button label="Muat ulang detail" role="vet" variant="secondary" onPress={() => { setDetail(null); setDetailRevision((value) => value + 1); }} /> : null}
    {detail ? <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{detail.patient.name} · {detail.patient.displayCode}</Text>
        <Text style={styles.body}>{speciesLabel(detail.patient.species)}{detail.patient.breed ? ` · ${detail.patient.breed}` : ''} · {sexLabel(detail.patient.sex)}</Text>
        <Text style={styles.body}>Peternak: {detail.patient.ownerName}</Text>
        {detail.patient.birthDate ? <Text style={styles.body}>Tanggal lahir: {formatBirthDate(detail.patient.birthDate)}</Text> : detail.patient.estimatedAgeMonths !== null ? <Text style={styles.body}>Perkiraan umur: {detail.patient.estimatedAgeMonths} bulan</Text> : null}
        {detail.patient.weightKg !== null ? <Text style={styles.body}>Berat: {detail.patient.weightKg} kg</Text> : null}
        <Text style={styles.body}>{detail.patient.serviceCount} layanan · terakhir {formatDate(detail.patient.lastServiceAt)}</Text>
      </View>
      <Text style={styles.heading}>Riwayat Kesehatan</Text>
      {detail.events.length === 0 ? <Text style={styles.body}>Belum ada catatan kesehatan pada layanan yang ditugaskan.</Text> : detail.events.map((event) => <HealthEventCard key={event.id} event={event} />)}
      <Text style={styles.heading}>Catatan Klinis Final</Text>
      {detail.clinicalNotes.length === 0 ? <Text style={styles.body}>Belum ada catatan klinis final pada layanan yang ditugaskan.</Text> : detail.clinicalNotes.map((note) => <View key={note.id} style={styles.card}>
        <Text style={styles.cardTitle}>Final · {formatDate(note.finalizedAt ?? '')}</Text>
        <ClinicalField label="Keluhan" value={note.complaint} />
        <ClinicalField label="Temuan" value={note.findings} />
        <ClinicalField label="Penilaian" value={note.assessment} />
        <ClinicalField label="Tindakan" value={note.actions} />
        <ClinicalField label="Instruksi perawatan" value={note.careInstructions} />
      </View>)}
      <Text style={styles.heading}>Foto dan Lampiran Layanan</Text>
      {detail.media?.length ? detail.media.map((item) => <View key={item.id} style={styles.card}>
        <Text style={styles.cardTitle}>{item.source === 'message' ? 'Pesan konsultasi' : 'Laporan perkembangan'} · {item.filename}</Text>
        <Text style={styles.body}>{item.kind === 'image' ? 'Foto' : 'Video'} · {formatDate(item.createdAt)}</Text>
        {mediaUris[item.id] && item.kind === 'image' ? <Image source={{ uri: mediaUris[item.id] }} accessibilityLabel={`Lampiran ${item.filename}`} resizeMode="contain" style={styles.mediaPreview} /> : null}
        {mediaUris[item.id] && item.kind === 'video' ? <PrivateVideoPlayer uri={mediaUris[item.id]} label={`Video pasien ${item.filename}`} /> : null}
        {mediaError ? <Text accessibilityRole="alert" style={styles.error}>{mediaError}</Text> : null}
        <Button label={mediaUris[item.id] ? 'Foto dibuka' : mediaBusyId === item.id ? 'Membuka foto…' : item.kind === 'image' ? 'Buka foto privat' : 'Unduh video privat'} role="vet" variant="secondary" disabled={!!mediaBusyId} onPress={() => {
          setMediaBusyId(item.id);
          setMediaState((current) => ({ ...current, [selectedId]: { ...(current[selectedId] ?? { uris: {}, error: '' }), error: '' } }));
          service.downloadPatientMedia('vet', userId, item).then(
            (uri) => setMediaState((current) => {
              const patientState = current[selectedId] ?? { uris: {}, error: '' };
              return { ...current, [selectedId]: { ...patientState, uris: { ...patientState.uris, [item.id]: uri } } };
            }),
            (cause) => setMediaState((current) => ({ ...current, [selectedId]: { ...(current[selectedId] ?? { uris: {}, error: '' }), error: cause instanceof Error ? cause.message : 'Lampiran pasien belum dapat dibuka.' } })),
          ).finally(() => setMediaBusyId(null));
        }} />
      </View>) : <Text style={styles.body}>Belum ada foto atau lampiran pada pesan dan laporan pasien ini.</Text>}
      <Text style={styles.body}>Catatan final hanya baca; lampiran hanya berasal dari layanan yang ditugaskan dan diunduh privat.</Text>
      <Button label="Muat ulang riwayat" role="vet" variant="secondary" disabled={detailLoading} onPress={() => { setDetail(null); setDetailRevision((value) => value + 1); }} />
    </> : null}
  </View>;

  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>Pasien terkait layanan saya</Text>
    <TextField label="Cari pasien" value={query} onChangeText={setQuery} placeholder="Nama, kode, jenis, atau Peternak" />
    {loading ? <LoadingState label="Memuat pasien…" /> : null}
    {!loading && error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    {!loading && !error && patients.length === 0 ? <Text style={styles.body}>Belum ada pasien dari layanan yang ditugaskan.</Text> : null}
    {!loading && !error && patients.length > 0 && shown.length === 0 ? <Text style={styles.body}>Tidak ada pasien yang cocok.</Text> : null}
    {!loading && !error && shown.map((patient) => <View key={patient.id} style={styles.card}>
      <Text style={styles.cardTitle}>{patient.name} · {patient.displayCode}</Text>
      <Text style={styles.body}>{speciesLabel(patient.species)}{patient.breed ? ` · ${patient.breed}` : ''} · Peternak: {patient.ownerName}</Text>
      <Text style={styles.body}>{patient.serviceCount} layanan · terakhir {formatDate(patient.lastServiceAt)}</Text>
      <Text style={styles.body}>{patient.latestServiceType === 'chat' ? 'Chat' : 'Kunjungan'} · {statusLabel(patient.latestServiceStatus)}</Text>
      <Button label={`Lihat pasien ${patient.name}`} role="vet" variant="secondary" onPress={() => { setSelectedId(patient.id); setDetail(null); setDetailError(''); }} />
    </View>)}
    <Button label="Muat ulang pasien" role="vet" variant="secondary" disabled={loading} onPress={() => { setLoading(true); setError(''); setRevision((value) => value + 1); }} />
  </View>;
}

function HealthEventCard({ event }: { event: ApiHealthEvent }) {
  return <View style={styles.card}>
    <Text style={styles.cardTitle}>{healthLabel(event.kind)} · {formatDate(event.occurredAt)}</Text>
    <Text style={styles.body}>{sourceLabel(event.provenance)}</Text>
    <Text style={styles.body}>{event.description}</Text>
  </View>;
}

function ClinicalField({ label, value }: { label: string; value: string }) {
  return <View style={styles.clinicalField}><Text style={styles.clinicalLabel}>{label}</Text><Text selectable style={styles.body}>{value}</Text></View>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value));
}

function statusLabel(value: ApiPatientRecord['latestServiceStatus']): string {
  const labels: Record<ApiPatientRecord['latestServiceStatus'], string> = {
    requested: 'Diminta', scheduled: 'Terjadwal', reschedule_pending: 'Usulan jadwal', in_progress: 'Berlangsung',
    en_route: 'Dalam perjalanan', arrived: 'Sudah tiba', examining: 'Pemeriksaan', completed: 'Selesai',
    rejected: 'Ditolak', cancelled: 'Dibatalkan',
  };
  return labels[value];
}

function healthLabel(value: ApiHealthEvent['kind']): string {
  return { examination: 'Pemeriksaan', disease: 'Penyakit', vaccine: 'Vaksin', medication: 'Obat', care: 'Perawatan' }[value];
}

function sourceLabel(value: ApiHealthEvent['provenance']): string {
  return { farmer_report: 'Laporan Peternak', clinical_note: 'Catatan klinis final', reminder: 'Pengingat' }[value];
}

function sexLabel(value: ApiPatientRecord['sex']): string {
  return { female: 'Betina', male: 'Jantan', unknown: 'Belum diketahui' }[value];
}

function formatBirthDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'UTC' }).format(date);
}

const styles = StyleSheet.create({
  section: { gap: spacing[4] },
  heading: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.section },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21 },
  card: { backgroundColor: colors.white, borderRadius: 14, padding: spacing[4], gap: spacing[2] },
  cardTitle: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.body },
  clinicalField: { gap: spacing[1] },
  mediaPreview: { width: '100%', height: 220, borderRadius: 12, backgroundColor: colors.cream },
  clinicalLabel: { color: colors.muted, fontFamily: fonts.semiBold, fontSize: typeScale.small },
  error: { color: colors.orange, fontFamily: fonts.medium, fontSize: typeScale.body },
});
