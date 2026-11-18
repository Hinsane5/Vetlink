import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { filterServerLivestock, type ServerLivestockService } from '../../application/ServerLivestockService';
import type { ServerLivestockHealthService } from '../../application/ServerLivestockHealthService';
import type { ApiFarmRecord } from '../../application/ports/FarmReadRepository';
import type { ApiHealthEvent } from '../../application/ports/LivestockHealthRepository';
import type { ApiCareEventInput } from '../../application/ports/LivestockHealthRepository';
import type { ApiLivestockRecord } from '../../application/ports/LivestockReadRepository';
import type { LivestockSex } from '../../domain/livestock';
import type { FarmerReportKind } from '../../domain/health';
import { DomainError } from '../../domain/errors';
import { livestockSpecies, type LivestockSpecies } from '../../domain/profiles';
import { Button } from '../components/Button';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { LoadingState } from '../components/Feedback';
import { TextArea, TextField } from '../components/TextField';
import { colors, fonts, spacing, typeScale } from '../theme/tokens';

const speciesLabels: Record<LivestockSpecies, string> = {
  cattle: 'Sapi', goat: 'Kambing', sheep: 'Domba', poultry: 'Unggas', duck: 'Bebek', pig: 'Babi', horse: 'Kuda',
};
const sexLabels: Record<LivestockSex, string> = { female: 'Betina', male: 'Jantan', unknown: 'Belum diketahui' };
const healthLabels = { examination: 'Pemeriksaan', disease: 'Penyakit', vaccine: 'Vaksin', medication: 'Obat', care: 'Perawatan' } as const;
const sourceLabels = { farmer_report: 'Laporan Peternak', clinical_note: 'Catatan klinis final', reminder: 'Pengingat' } as const;

export function ServerLivestockSection({ service, healthService, farm, userId, backHandlerRef }: {
  service: ServerLivestockService;
  healthService: ServerLivestockHealthService;
  farm: ApiFarmRecord;
  userId: string;
  backHandlerRef: { current: (() => boolean) | null };
}) {
  const [animals, setAnimals] = useState<ApiLivestockRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [writeUncertain, setWriteUncertain] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [discardVisible, setDiscardVisible] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [breed, setBreed] = useState('');
  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [species, setSpecies] = useState<LivestockSpecies | null>(null);
  const [sex, setSex] = useState<LivestockSex>('unknown');
  const [query, setQuery] = useState('');
  const [speciesFilter, setSpeciesFilter] = useState<LivestockSpecies | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailAnimal, setDetailAnimal] = useState<ApiLivestockRecord | null>(null);
  const [healthEvents, setHealthEvents] = useState<ApiHealthEvent[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [pendingReport, setPendingReport] = useState<ApiCareEventInput | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportKind, setReportKind] = useState<FarmerReportKind>('disease');
  const [reportDescription, setReportDescription] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState('');
  const [reportNotice, setReportNotice] = useState('');
  const [reportDiscardVisible, setReportDiscardVisible] = useState(false);
  const operationInFlight = useRef(false);
  const detailRequest = useRef(0);
  const dirty = !!(code || name || breed || age || weight || species || sex !== 'unknown');

  useEffect(() => {
    backHandlerRef.current = () => {
      if (discardVisible) { setDiscardVisible(false); return true; }
      if (reportDiscardVisible) { setReportDiscardVisible(false); return true; }
      if (reportBusy) return true;
      if (reportOpen) {
        if (reportDescription.trim() || reportKind !== 'disease') setReportDiscardVisible(true);
        else setReportOpen(false);
        return true;
      }
      if (detailId) { detailRequest.current++; setDetailId(null); setDetailError(''); return true; }
      if (busy) return true;
      if (!formOpen) return true;
      if (dirty) setDiscardVisible(true);
      else setFormOpen(false);
      return true;
    };
    return () => { backHandlerRef.current = null; };
  }, [backHandlerRef, busy, detailId, dirty, discardVisible, formOpen, reportBusy, reportDescription, reportDiscardVisible, reportKind, reportOpen]);

  const closeReport = () => {
    setReportOpen(false);
    setReportDescription('');
    setReportKind('disease');
    setReportError('');
    setReportDiscardVisible(false);
  };

  const loadDetail = async (livestockId: string) => {
    const request = ++detailRequest.current;
    setDetailLoading(true);
    setDetailError('');
    try {
      const [detail, pending] = await Promise.all([
        healthService.getDetail('farmer', userId, farm.id, livestockId),
        healthService.getPendingReport('farmer', userId, farm.id, livestockId),
      ]);
      if (request !== detailRequest.current) return;
      setDetailAnimal(detail.animal);
      setHealthEvents(detail.events);
      setPendingReport(pending);
    } catch (cause) {
      if (request !== detailRequest.current) return;
      setDetailAnimal(null);
      setHealthEvents([]);
      setDetailError(messageFor(cause));
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  };

  const saveReport = async () => {
    if (!detailId || reportBusy || pendingReport || operationInFlight.current) return;
    operationInFlight.current = true;
    setReportBusy(true);
    setReportError('');
    try {
      await healthService.createReport('farmer', userId, farm.id, detailId, reportKind, reportDescription);
      closeReport();
      setReportNotice('Laporan Peternak tersimpan.');
      await loadDetail(detailId);
    } catch (cause) {
      setReportError(messageFor(cause));
      try {
        setPendingReport(await healthService.getPendingReport('farmer', userId, farm.id, detailId));
      } catch (readCause) {
        setReportError(messageFor(readCause));
      }
    } finally {
      operationInFlight.current = false;
      setReportBusy(false);
    }
  };

  const retryReport = async () => {
    if (!detailId || reportBusy || !pendingReport || operationInFlight.current) return;
    operationInFlight.current = true;
    setReportBusy(true);
    setReportError('');
    try {
      await healthService.retryPendingReport('farmer', userId, farm.id, detailId);
      closeReport();
      setReportNotice('Laporan Peternak tersimpan.');
      await loadDetail(detailId);
    } catch (cause) {
      setReportError(messageFor(cause));
    } finally {
      operationInFlight.current = false;
      setReportBusy(false);
    }
  };

  const discardForm = () => {
    setCode(''); setName(''); setBreed(''); setAge(''); setWeight(''); setSpecies(null); setSex('unknown');
    setDiscardVisible(false);
    setFormOpen(false);
    setError('');
  };

  useEffect(() => {
    let mounted = true;
    service.listForFarm('farmer', userId, farm.id).then(
      (records) => { if (mounted) { setAnimals(records); setLoaded(true); setLoadFailed(false); } },
      (cause) => { if (mounted) { setError(messageFor(cause)); setLoaded(true); setLoadFailed(true); } },
    );
    return () => { mounted = false; };
  }, [farm.id, service, userId]);

  const refresh = async () => {
    if (operationInFlight.current || !loaded) return;
    operationInFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const records = await service.listForFarm('farmer', userId, farm.id);
      setAnimals(records);
      setLoaded(true);
      setLoadFailed(false);
      if (writeUncertain) {
        if (records.some((animal) => animal.displayCode === code.trim().toUpperCase())) {
          setFormOpen(false);
          setCode(''); setName(''); setBreed(''); setAge(''); setWeight(''); setSpecies(null); setSex('unknown');
        }
        setWriteUncertain(false);
      }
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  };

  const create = async () => {
    if (operationInFlight.current || !loaded || loadFailed || writeUncertain) return;
    if (!species) { setError('Pilih jenis ternak.'); return; }
    operationInFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const parsedAge = age.trim() === '' ? undefined : Number(age);
      const parsedWeight = weight.trim() === '' ? undefined : Number(weight.replace(',', '.'));
      const created = await service.create('farmer', farm.id, {
        displayCode: code,
        name,
        species,
        sex,
        ...(breed.trim() ? { breed: breed.trim() } : {}),
        ...(parsedAge !== undefined ? { estimatedAgeMonths: parsedAge } : {}),
        ...(parsedWeight !== undefined ? { weightKg: parsedWeight } : {}),
      });
      setAnimals((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setLoaded(true);
      setCode(''); setName(''); setBreed(''); setAge(''); setWeight(''); setSpecies(null); setSex('unknown');
      setFormOpen(false);
    } catch (cause) {
      setError(messageFor(cause));
      if (cause instanceof DomainError && cause.code === 'SERVICE_UNAVAILABLE') setWriteUncertain(true);
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  };

  const availableSpecies = farm.species.length ? farm.species : livestockSpecies;
  const shownAnimals = filterServerLivestock(animals, { query, species: speciesFilter });

  if (detailId) return <View style={styles.section}>
    <Button label={reportOpen ? 'Kembali ke riwayat' : 'Kembali ke daftar ternak'} role="farmer" variant="secondary" disabled={reportBusy} onPress={() => {
      if (reportOpen) {
        if (reportDescription.trim() || reportKind !== 'disease') setReportDiscardVisible(true);
        else closeReport();
      } else { detailRequest.current++; setDetailId(null); setDetailError(''); }
    }} />
    <Text accessibilityRole="header" style={styles.heading}>Detail Ternak</Text>
    {detailLoading ? <LoadingState label="Memuat detail dan riwayat…" /> : null}
    {detailError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{detailError}</Text> : null}
    {!detailLoading && detailError ? <Button label="Coba muat ulang" role="farmer" variant="secondary" onPress={() => loadDetail(detailId)} /> : null}
    {!detailLoading && detailAnimal && reportOpen ? <>
      <Text style={styles.body}>Laporan ini berasal dari Peternak dan terpisah dari catatan klinis final Dokter.</Text>
      <Text style={styles.body}>Jenis laporan</Text>
      <View style={styles.choices}>{(['disease', 'vaccine', 'medication', 'care'] as const).map((kind) => <Button key={kind} label={healthLabels[kind]} role="farmer" variant="secondary" selected={reportKind === kind} disabled={reportBusy} onPress={() => setReportKind(kind)} style={styles.choice} />)}</View>
      <TextArea label="Keterangan" value={reportDescription} onChangeText={setReportDescription} maxLength={2000} />
      {reportError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{reportError}</Text> : null}
      {pendingReport ? <Text style={styles.body}>Penyimpanan sebelumnya belum pasti. Coba ulang payload yang sama dari penyimpanan perangkat.</Text> : null}
      {pendingReport ? <Button label="Coba ulang laporan" role="farmer" onPress={retryReport} loading={reportBusy} /> : null}
      <Button label="Simpan laporan" role="farmer" onPress={saveReport} loading={reportBusy} disabled={!!pendingReport || !reportDescription.trim()} />
    </> : null}
    {!detailLoading && detailAnimal && !reportOpen ? <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{detailAnimal.name} · {detailAnimal.displayCode}</Text>
        <Text style={styles.body}>{speciesLabels[detailAnimal.species]} · {sexLabels[detailAnimal.sex]}{detailAnimal.breed ? ` · ${detailAnimal.breed}` : ''}</Text>
        {detailAnimal.estimatedAgeMonths !== null ? <Text style={styles.body}>Umur perkiraan: {detailAnimal.estimatedAgeMonths} bulan</Text> : null}
        {detailAnimal.weightKg !== null ? <Text style={styles.body}>Berat: {detailAnimal.weightKg} kg</Text> : null}
      </View>
      <Text style={styles.heading}>Riwayat Kesehatan</Text>
      {reportNotice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{reportNotice}</Text> : null}
      {reportError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{reportError}</Text> : null}
      {pendingReport ? <View style={styles.card}>
        <Text style={styles.cardTitle}>Laporan menunggu kepastian</Text>
        <Text style={styles.body}>{healthLabels[pendingReport.kind]} · {pendingReport.description}</Text>
        <Text style={styles.body}>Coba ulang dengan kunci yang sama. Server tidak membuat laporan ganda.</Text>
        <Button label="Coba ulang laporan" role="farmer" onPress={retryReport} loading={reportBusy} />
      </View> : <Button label="Tambah laporan Peternak" role="farmer" disabled={reportBusy} onPress={() => { setReportNotice(''); setReportError(''); setReportOpen(true); }} />}
      {healthEvents.length === 0 ? <Text style={styles.body}>Belum ada catatan kesehatan.</Text> : healthEvents.map((event) => <View key={event.id} style={styles.card}>
        <Text style={styles.cardTitle}>{healthLabels[event.kind]} · {formatDate(event.occurredAt)}</Text>
        <Text style={styles.body}>{sourceLabels[event.provenance]}</Text>
        <Text style={styles.body}>{event.description}</Text>
      </View>)}
      <Button label="Muat ulang riwayat" role="farmer" variant="secondary" onPress={() => loadDetail(detailId)} />
    </> : null}
    <ConfirmationDialog visible={reportDiscardVisible} title="Buang laporan yang belum disimpan?" message="Keterangan yang belum dikirim akan hilang." role="farmer" confirmLabel="Buang" cancelLabel="Tetap Mengedit" onConfirm={closeReport} onCancel={() => setReportDiscardVisible(false)} destructive />
  </View>;

  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>Ternak di {farm.name}</Text>
    <TextField label="Cari ternak" value={query} onChangeText={setQuery} placeholder="Nama, kode, ras, atau jenis" />
    <View style={styles.choices}>
      <Button label="Semua jenis" role="farmer" variant="secondary" selected={speciesFilter === null} onPress={() => setSpeciesFilter(null)} style={styles.choice} />
      {availableSpecies.map((value) => <Button key={value} label={speciesLabels[value]} role="farmer" variant="secondary" selected={speciesFilter === value} onPress={() => setSpeciesFilter(value)} style={styles.choice} />)}
    </View>
    {!loaded || busy ? <LoadingState label="Memuat ternak…" /> : null}
    {loaded && !busy && !loadFailed && animals.length === 0 ? <Text style={styles.body}>Belum ada ternak di peternakan ini.</Text> : null}
    {loaded && !busy && !loadFailed && animals.length > 0 && shownAnimals.length === 0 ? <Text style={styles.body}>Tidak ada ternak yang cocok dengan pencarian dan filter.</Text> : null}
    {shownAnimals.map((animal) => <View key={animal.id} style={styles.card}>
      <Text style={styles.cardTitle}>{animal.name} · {animal.displayCode}</Text>
      <Text style={styles.body}>{speciesLabels[animal.species]} · {sexLabels[animal.sex]}{animal.breed ? ` · ${animal.breed}` : ''}</Text>
      {animal.estimatedAgeMonths !== null ? <Text style={styles.body}>Umur perkiraan: {animal.estimatedAgeMonths} bulan</Text> : null}
      {animal.weightKg !== null ? <Text style={styles.body}>Berat: {animal.weightKg} kg</Text> : null}
      <Button label={`Lihat riwayat ${animal.name}`} role="farmer" variant="secondary" onPress={() => { setDetailId(animal.id); setDetailAnimal(null); setHealthEvents([]); void loadDetail(animal.id); }} />
    </View>)}
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    {writeUncertain ? <Text style={styles.body}>Muat ulang daftar sebelum mencoba menyimpan lagi.</Text> : null}
    <Button label="Muat ulang ternak" role="farmer" variant="secondary" disabled={!loaded || busy} onPress={refresh} />
    {formOpen ? <>
      <Text style={styles.heading}>Tambah Ternak</Text>
      <TextField label="Kode ternak" value={code} onChangeText={setCode} autoCapitalize="characters" />
      <TextField label="Nama ternak" value={name} onChangeText={setName} />
      <Text style={styles.body}>Jenis ternak</Text>
      <View style={styles.choices}>{availableSpecies.map((value) => <Button key={value} label={speciesLabels[value]} role="farmer" variant="secondary" selected={species === value} disabled={busy} onPress={() => setSpecies(value)} style={styles.choice} />)}</View>
      <Text style={styles.body}>Jenis kelamin</Text>
      <View style={styles.choices}>{(['female', 'male', 'unknown'] as const).map((value) => <Button key={value} label={sexLabels[value]} role="farmer" variant="secondary" selected={sex === value} disabled={busy} onPress={() => setSex(value)} style={styles.choice} />)}</View>
      <TextField label="Ras (opsional)" value={breed} onChangeText={setBreed} />
      <TextField label="Perkiraan umur dalam bulan (opsional)" value={age} onChangeText={setAge} keyboardType="number-pad" />
      <TextField label="Berat dalam kg (opsional)" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
      <Button label="Simpan ternak" role="farmer" onPress={create} loading={busy} disabled={!loaded || loadFailed || writeUncertain} />
      <Button label="Batal" role="farmer" variant="secondary" disabled={busy} onPress={() => dirty ? setDiscardVisible(true) : discardForm()} />
    </> : <Button label="Tambah ternak" role="farmer" disabled={!loaded || loadFailed} onPress={() => { setError(''); setFormOpen(true); }} />}
    <ConfirmationDialog visible={discardVisible} title="Buang perubahan ternak?" message="Data yang belum disimpan akan hilang." role="farmer" confirmLabel="Buang" cancelLabel="Tetap Mengedit" onConfirm={discardForm} onCancel={() => setDiscardVisible(false)} destructive />
  </View>;
}

function messageFor(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Data ternak belum dapat dimuat. Coba lagi.';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value));
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
