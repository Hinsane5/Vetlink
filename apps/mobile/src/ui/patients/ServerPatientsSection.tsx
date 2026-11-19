import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { filterServerPatients, type ServerPatientService } from '../../application/ServerPatientService';
import type { ApiPatientRecord } from '../../application/ports/PatientReadRepository';
import { Button } from '../components/Button';
import { LoadingState } from '../components/Feedback';
import { TextField } from '../components/TextField';
import { colors, fonts, spacing, typeScale } from '../theme/tokens';

export function ServerPatientsSection({ service }: { service: ServerPatientService }) {
  const [patients, setPatients] = useState<ApiPatientRecord[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

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

  const shown = filterServerPatients(patients, query);
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>Pasien terkait layanan saya</Text>
    <TextField label="Cari pasien" value={query} onChangeText={setQuery} placeholder="Nama, kode, jenis, atau Peternak" />
    {loading ? <LoadingState label="Memuat pasien…" /> : null}
    {!loading && error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    {!loading && !error && patients.length === 0 ? <Text style={styles.body}>Belum ada pasien dari layanan yang ditugaskan.</Text> : null}
    {!loading && !error && patients.length > 0 && shown.length === 0 ? <Text style={styles.body}>Tidak ada pasien yang cocok.</Text> : null}
    {!loading && !error && shown.map((patient) => <View key={patient.id} style={styles.card}>
      <Text style={styles.cardTitle}>{patient.name} · {patient.displayCode}</Text>
      <Text style={styles.body}>{patient.species}{patient.breed ? ` · ${patient.breed}` : ''} · Peternak: {patient.ownerName}</Text>
      <Text style={styles.body}>{patient.serviceCount} layanan · terakhir {formatDate(patient.lastServiceAt)}</Text>
      <Text style={styles.body}>{patient.latestServiceType === 'chat' ? 'Chat' : 'Kunjungan'} · {statusLabel(patient.latestServiceStatus)}</Text>
    </View>)}
    <Button label="Muat ulang pasien" role="vet" variant="secondary" disabled={loading} onPress={() => { setLoading(true); setError(''); setRevision((value) => value + 1); }} />
  </View>;
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

const styles = StyleSheet.create({
  section: { gap: spacing[4] },
  heading: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.section },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21 },
  card: { backgroundColor: colors.white, borderRadius: 14, padding: spacing[4], gap: spacing[2] },
  cardTitle: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.body },
  error: { color: colors.orange, fontFamily: fonts.medium, fontSize: typeScale.body },
});
