import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { DirectoryServiceType } from '../../domain/directory';
import type { ApiVetDirectoryDetail, ApiVetDirectoryRecord, ApiVetSlot } from '../../application/ports/VetDirectoryReadRepository';
import type { ApiFarmRecord } from '../../application/ports/FarmReadRepository';
import type { ApiLivestockRecord } from '../../application/ports/LivestockReadRepository';
import type { ApiConsultationQuote } from '../../application/ports/ApiConsultationRepository';
import { filterServerVets, type ServerVetDirectoryService } from '../../application/ServerVetDirectoryService';
import type { ServerLivestockService } from '../../application/ServerLivestockService';
import type { ServerBookingService, PendingServerBooking } from '../../application/ServerBookingService';
import { Button } from '../components/Button';
import { LoadingState } from '../components/Feedback';
import { TextArea, TextField } from '../components/TextField';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { colors, fonts, spacing, typeScale } from '../theme/tokens';

export function ServerVetDirectorySection({ service, bookingService, livestockService, farms, userId, backHandlerRef }: {
  service: ServerVetDirectoryService;
  bookingService: ServerBookingService;
  livestockService: ServerLivestockService;
  farms: ApiFarmRecord[];
  userId: string;
  backHandlerRef: { current: (() => boolean) | null };
}) {
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
  const [selectedSlot, setSelectedSlot] = useState<ApiVetSlot | null>(null);
  const [bookingFarmId, setBookingFarmId] = useState<string | null>(null);
  const [animals, setAnimals] = useState<ApiLivestockRecord[]>([]);
  const [animalsLoading, setAnimalsLoading] = useState(false);
  const [animalError, setAnimalError] = useState('');
  const [animalId, setAnimalId] = useState<string | null>(null);
  const [complaint, setComplaint] = useState('');
  const [quote, setQuote] = useState<ApiConsultationQuote | null>(null);
  const [quoteKey, setQuoteKey] = useState(() => `quote:${Crypto.randomUUID()}`);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [bookingNotice, setBookingNotice] = useState('');
  const [pendingBooking, setPendingBooking] = useState<PendingServerBooking | null>(null);
  const [pendingBusy, setPendingBusy] = useState(false);
  const [discardBookingVisible, setDiscardBookingVisible] = useState(false);
  const selectedFarm = farms.find((farm) => farm.id === bookingFarmId) ?? null;
  const selectedAnimal = animals.find((animal) => animal.id === animalId) ?? null;
  const invalidateQuote = useCallback(() => {
    setQuote(null);
    setQuoteKey(`quote:${Crypto.randomUUID()}`);
  }, []);
  const resetBookingDraft = useCallback(() => {
    invalidateQuote();
    setSelectedSlot(null);
    setBookingFarmId(null);
    setAnimals([]);
    setAnimalId(null);
    setComplaint('');
  }, [invalidateQuote]);

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

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      bookingService.getPendingBooking('farmer', userId).then(
        (pending) => { if (active) setPendingBooking(pending); },
        (cause) => { if (active) setBookingError(cause instanceof Error ? cause.message : 'Status permintaan belum dapat diperiksa.'); },
      );
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [bookingService, userId]);

  useEffect(() => {
    if (!bookingFarmId) return undefined;
    let active = true;
    const timer = setTimeout(() => {
      setAnimalsLoading(true);
      setAnimalError('');
      livestockService.listForFarm('farmer', userId, bookingFarmId).then(
        (records) => { if (active) { setAnimals(records); setAnimalId(null); } },
        (cause) => { if (active) { setAnimals([]); setAnimalError(cause instanceof Error ? cause.message : 'Ternak belum dapat dimuat.'); } },
      ).finally(() => { if (active) setAnimalsLoading(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [bookingFarmId, livestockService, userId]);

  useEffect(() => {
    backHandlerRef.current = () => {
      if (discardBookingVisible) { setDiscardBookingVisible(false); return true; }
      if (bookingBusy || detailLoading || pendingBusy) return true;
      if (!selectedId) return false;
      if (complaint.trim() || quote || selectedFarm || selectedAnimal || selectedSlot) setDiscardBookingVisible(true);
      else { setSelectedId(null); setDetail(null); resetBookingDraft(); }
      return true;
    };
    return () => { if (backHandlerRef.current) backHandlerRef.current = null; };
  }, [backHandlerRef, bookingBusy, complaint, detailLoading, discardBookingVisible, pendingBusy, quote, resetBookingDraft, selectedAnimal, selectedFarm, selectedId, selectedSlot]);

  const loadDetail = async (vetId: string, nextService: DirectoryServiceType) => {
    setDetailLoading(true);
    setDetailError('');
    setDetail(null);
    setSlots([]);
    setSelectedSlot(null);
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
    setSelectedSlot(null);
    invalidateQuote();
    void loadDetail(selectedId, next);
  };

  const leaveDetail = () => {
    setDiscardBookingVisible(false);
    setSelectedId(null);
    setDetail(null);
    setDetailError('');
    resetBookingDraft();
  };

  const createQuote = async () => {
    if (!detail || !selectedFarm || !selectedAnimal || !selectedSlot || !complaint.trim() || bookingBusy || pendingBooking) return;
    setBookingBusy(true);
    setBookingError('');
    setBookingNotice('');
    try {
      const nextQuote = await bookingService.createQuote('farmer', userId, selectedFarm.id, {
        vetId: detail.id,
        animalId: selectedAnimal.id,
        serviceType,
        startsAt: selectedSlot.startsAt,
        complaint,
      }, quoteKey);
      setQuote(nextQuote);
      setQuoteKey(`quote:${Crypto.randomUUID()}`);
    } catch (cause) {
      setBookingError(cause instanceof Error ? cause.message : 'Estimasi biaya belum berhasil dimuat.');
    } finally {
      setBookingBusy(false);
    }
  };

  const createBooking = async () => {
    if (!quote || bookingBusy || pendingBooking) return;
    setBookingBusy(true);
    setBookingError('');
    try {
      await bookingService.createBooking('farmer', userId, quote);
      setQuote(null);
      setPendingBooking(null);
      setBookingNotice('Permintaan konsultasi tersimpan dan menunggu pembayaran. Belum ada pembayaran yang dilakukan.');
    } catch (cause) {
      setBookingError(cause instanceof Error ? cause.message : 'Status permintaan belum pasti. Gunakan pemulihan dengan kunci yang tersimpan.');
      try { setPendingBooking(await bookingService.getPendingBooking('farmer', userId)); } catch { /* retain visible error */ }
    } finally {
      setBookingBusy(false);
    }
  };

  const retryBooking = async () => {
    if (pendingBusy || !pendingBooking) return;
    setPendingBusy(true);
    setBookingError('');
    try {
      await bookingService.retryPendingBooking('farmer', userId);
      setPendingBooking(null);
      setBookingNotice('Permintaan konsultasi tersimpan dan menunggu pembayaran. Belum ada pembayaran yang dilakukan.');
    } catch (cause) {
      setBookingError(cause instanceof Error ? cause.message : 'Permintaan belum dapat dipulihkan.');
    } finally {
      setPendingBusy(false);
    }
  };

  const shown = filterServerVets(vets, query);
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>Dokter Hewan Terverifikasi</Text>
    {pendingBooking ? <View style={styles.card}>
      <Text style={styles.cardTitle}>Permintaan konsultasi menunggu kepastian</Text>
      <Text style={styles.body}>Simpan ulang menggunakan kunci server yang sama untuk memastikan hasilnya.</Text>
      <Button label="Pulihkan permintaan konsultasi" role="farmer" onPress={retryBooking} loading={pendingBusy} />
    </View> : null}
    {bookingNotice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{bookingNotice}</Text> : null}
    {bookingError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{bookingError}</Text> : null}
    {selectedId ? <>
      <Button label="Kembali ke direktori" role="farmer" variant="secondary" disabled={detailLoading || bookingBusy} onPress={() => {
        if (complaint.trim() || quote || selectedFarm || selectedAnimal || selectedSlot) setDiscardBookingVisible(true);
        else leaveDetail();
      }} />
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
        {slots.map((slot) => <Button key={slot.startsAt} label={`${formatDate(slot.startsAt, detail.timezone)} · ${formatTime(slot.startsAt, detail.timezone)}–${formatTime(slot.endsAt, detail.timezone)}`} role="farmer" variant="secondary" selected={selectedSlot?.startsAt === slot.startsAt} disabled={bookingBusy || !!pendingBooking} onPress={() => { setSelectedSlot(slot); invalidateQuote(); }} />)}
        <Text style={styles.body}>Tarif: {formatRupiah(detail.rates[serviceType])}</Text>
        <Text style={styles.heading}>Buat Permintaan</Text>
        <Text style={styles.body}>Peternakan</Text>
        <View style={styles.choices}>{farms.map((farm) => <Button key={farm.id} label={farm.name} role="farmer" variant="secondary" selected={bookingFarmId === farm.id} disabled={bookingBusy || !!pendingBooking} onPress={() => { setAnimals([]); setAnimalId(null); setBookingFarmId(farm.id); invalidateQuote(); }} style={styles.choice} />)}</View>
        {bookingFarmId && !selectedFarm ? <Text style={styles.error}>Peternakan yang dipilih tidak tersedia. Muat ulang akun.</Text> : null}
        {selectedFarm?.visitAddressId === null && serviceType === 'visit' ? <Text style={styles.error}>Tambahkan alamat kunjungan pada Peternakan ini sebelum meminta kunjungan.</Text> : null}
        {animalsLoading ? <LoadingState label="Memuat ternak peternakan…" /> : null}
        {animalError ? <Text style={styles.error}>{animalError}</Text> : null}
        {selectedFarm && animals.filter((animal) => detail.species.includes(animal.species)).map((animal) => <Button key={animal.id} label={`${animal.name} · ${animal.displayCode}`} role="farmer" variant="secondary" selected={animalId === animal.id} disabled={bookingBusy || !!pendingBooking} onPress={() => { setAnimalId(animal.id); invalidateQuote(); }} />)}
        {selectedFarm && !animalsLoading && !animalError && animals.filter((animal) => detail.species.includes(animal.species)).length === 0 ? <Text style={styles.body}>Belum ada ternak yang cocok pada Peternakan ini.</Text> : null}
        <TextArea label="Keluhan" value={complaint} onChangeText={(value) => { setComplaint(value); invalidateQuote(); }} maxLength={4000} />
        <Button label="Minta estimasi dari server" role="farmer" onPress={createQuote} loading={bookingBusy} disabled={!!quote || !selectedFarm || !selectedAnimal || !selectedSlot || !complaint.trim() || (serviceType === 'visit' && !selectedFarm?.visitAddressId) || !!pendingBooking} />
        {quote ? <View style={styles.card}>
          <Text style={styles.cardTitle}>Estimasi biaya dari server</Text>
          <Text style={styles.body}>{formatRupiah(quote.amountIdr)} · IDR</Text>
          <Text style={styles.body}>Permintaan belum menjadi jadwal diterima. Setelah dikirim, status menunggu pembayaran.</Text>
          <Button label="Kirim permintaan konsultasi" role="farmer" onPress={createBooking} loading={bookingBusy} disabled={!!pendingBooking} />
        </View> : null}
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
        <Button label={`Lihat profil ${vet.professionalName}`} role="farmer" variant="secondary" onPress={() => { resetBookingDraft(); setSelectedId(vet.id); setServiceType(vet.services[0]); void loadDetail(vet.id, vet.services[0]); }} />
      </View>)}
      <Button label="Muat ulang direktori" role="farmer" variant="secondary" disabled={loading} onPress={() => { setLoading(true); setError(''); setRevision((value) => value + 1); }} />
    </>}
    <ConfirmationDialog visible={discardBookingVisible} title="Buang permintaan yang belum dikirim?" message="Pilihan ternak, slot, dan keluhan yang belum dikirim akan hilang." role="farmer" confirmLabel="Buang" cancelLabel="Tetap Mengedit" onConfirm={leaveDetail} onCancel={() => setDiscardBookingVisible(false)} destructive />
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
