import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { DirectoryServiceType } from '../../domain/directory';
import type { ApiVetDirectoryDetail, ApiVetDirectoryRecord, ApiVetSlot } from '../../application/ports/VetDirectoryReadRepository';
import { filterServerVets, type ServerVetDirectoryService } from '../../application/ServerVetDirectoryService';
import { Button } from '../components/Button';
import { LoadingState } from '../components/Feedback';
import { TextField } from '../components/TextField';
import { colors, fonts, spacing, typeScale } from '../theme/tokens';

export function ServerVetDirectorySection({ service }: { service: ServerVetDirectoryService }) {
  const [vets, setVets] = useState<ApiVetDirectoryRecord[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApiVetDirectoryDetail | null>(null);
  const [serviceType, setServiceType] = useState<DirectoryServiceType>('chat');
  const [slots, setSlots] = useState<ApiVetSlot[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      service.listVerified('farmer').then(
        (records) => { if (active) setVets(records); },
        (cause) => { if (active) { setVets([]); setError(cause instanceof Error ? cause.message : 'Direktori Dokter belum dapat dimuat.'); } },
      ).finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [revision, service]);

  const loadDetail = async (vetId: string, nextService: DirectoryServiceType) => {
    setDetailLoading(true);
    setDetailError('');
    setDetail(null);
    setSlots([]);
    try {
      const nextDetail = await service.getDetail('farmer', vetId);
      if (!nextDetail.services.includes(nextService)) {
        nextService = nextDetail.services[0];
        setServiceType(nextService);
      }
      const from = new Date().toISOString().slice(0, 10);
      const endDate = new Date(`${from}T00:00:00.000Z`);
      endDate.setUTCDate(endDate.getUTCDate() + 13);
      const to = endDate.toISOString().slice(0, 10);
      const nextSlots = await service.getSlots('farmer', vetId, nextService, from, to);
      setDetail(nextDetail);
      setSlots(nextSlots);
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : 'Detail Dokter belum dapat dimuat.');
    } finally {
      setDetailLoading(false);
    }
  };

  const chooseService = (next: DirectoryServiceType) => {
    if (!detail || !selectedId || detailLoading) return;
    setServiceType(next);
    void loadDetail(selectedId, next);
  };

  const shown = filterServerVets(vets, query);
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>Dokter Hewan Terverifikasi</Text>
    {selectedId ? <>
      <Button label="Kembali ke direktori" role="farmer" variant="secondary" disabled={detailLoading} onPress={() => { setSelectedId(null); setDetail(null); setDetailError(''); }} />
      {detailLoading ? <LoadingState label="Memuat profil dan slot…" /> : null}
      {detailError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{detailError}</Text> : null}
      {!detailLoading && detailError ? <Button label="Coba lagi" role="farmer" variant="secondary" onPress={() => loadDetail(selectedId, serviceType)} /> : null}
      {detail ? <>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{detail.professionalName}</Text>
          <Text style={styles.body}>{detail.experienceYears} tahun pengalaman · {detail.ratingCount ? `${detail.ratingAverage.toFixed(1)} dari ${detail.ratingCount} ulasan` : 'Belum ada ulasan'}</Text>
          <Text style={styles.body}>{detail.specialties.join(', ') || 'Spesialisasi belum dicantumkan'}</Text>
          <Text style={styles.body}>{detail.practiceLocation}</Text>
          {detail.serviceAreas.length ? <Text style={styles.body}>Wilayah kunjungan: {detail.serviceAreas.join(', ')}</Text> : null}
          <Text style={styles.body}>{detail.acceptingNewRequests ? 'Menerima permintaan baru' : 'Belum menerima permintaan baru'}</Text>
        </View>
        <Text style={styles.body}>Layanan</Text>
        <View style={styles.choices}>{detail.services.map((kind) => <Button key={kind} label={kind === 'chat' ? 'Chat' : 'Kunjungan'} role="farmer" variant="secondary" selected={serviceType === kind} disabled={detailLoading} onPress={() => chooseService(kind)} style={styles.choice} />)}</View>
        <Text style={styles.heading}>Slot Tersedia</Text>
        {!detail.acceptingNewRequests ? <Text style={styles.body}>Dokter belum menerima permintaan baru.</Text> : null}
        {detail.acceptingNewRequests && slots.length === 0 ? <Text style={styles.body}>Belum ada slot pada 14 hari mendatang.</Text> : null}
        {slots.map((slot) => <View key={slot.startsAt} style={styles.card}>
          <Text style={styles.body}>{formatDate(slot.startsAt, detail.timezone)} · {formatTime(slot.startsAt, detail.timezone)}–{formatTime(slot.endsAt, detail.timezone)}</Text>
        </View>)}
        <Text style={styles.body}>Tarif: {formatRupiah(detail.rates[serviceType])}</Text>
      </> : null}
    </> : <>
      <TextField label="Cari Dokter" value={query} onChangeText={setQuery} placeholder="Nama atau lokasi praktik" />
      {loading ? <LoadingState label="Memuat direktori…" /> : null}
      {!loading && error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      {!loading && !error && vets.length === 0 ? <Text style={styles.body}>Belum ada Dokter terverifikasi di direktori.</Text> : null}
      {!loading && !error && vets.length > 0 && shown.length === 0 ? <Text style={styles.body}>Tidak ada Dokter yang cocok.</Text> : null}
      {!loading && !error && shown.map((vet) => <View key={vet.id} style={styles.card}>
        <Text style={styles.cardTitle}>{vet.professionalName}</Text>
        <Text style={styles.body}>{vet.experienceYears} tahun pengalaman · {vet.ratingCount ? `${vet.ratingAverage.toFixed(1)} dari ${vet.ratingCount} ulasan` : 'Belum ada ulasan'}</Text>
        <Text style={styles.body}>{vet.practiceLocation}</Text>
        <Text style={styles.body}>{vet.acceptingNewRequests ? 'Menerima permintaan baru' : 'Belum menerima permintaan baru'} · {vet.services.map((item) => item === 'chat' ? 'Chat' : 'Kunjungan').join(', ')}</Text>
        <Button label={`Lihat profil ${vet.professionalName}`} role="farmer" variant="secondary" onPress={() => { setSelectedId(vet.id); setServiceType(vet.services[0]); void loadDetail(vet.id, vet.services[0]); }} />
      </View>)}
      <Button label="Muat ulang direktori" role="farmer" variant="secondary" disabled={loading} onPress={() => { setLoading(true); setError(''); setRevision((value) => value + 1); }} />
    </>}
  </View>;
}

function formatDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('id-ID', { weekday: 'short', dateStyle: 'medium', timeZone: timezone }).format(new Date(value));
}

function formatTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(value));
}

function formatRupiah(value: number | undefined): string {
  return typeof value === 'number' ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value) : 'Tarif belum tersedia';
}

const styles = StyleSheet.create({
  section: { gap: spacing[4] },
  heading: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.section },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21 },
  card: { backgroundColor: colors.white, borderRadius: 14, padding: spacing[4], gap: spacing[2] },
  cardTitle: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.body },
  error: { color: colors.orange, fontFamily: fonts.medium, fontSize: typeScale.body },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  choice: { alignSelf: 'flex-start' },
});
