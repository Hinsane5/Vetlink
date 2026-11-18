import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { filterServerLivestock, type ServerLivestockService } from '../../application/ServerLivestockService';
import type { ApiFarmRecord } from '../../application/ports/FarmReadRepository';
import type { ApiLivestockRecord } from '../../application/ports/LivestockReadRepository';
import type { LivestockSex } from '../../domain/livestock';
import { DomainError } from '../../domain/errors';
import { livestockSpecies, type LivestockSpecies } from '../../domain/profiles';
import { Button } from '../components/Button';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { LoadingState } from '../components/Feedback';
import { TextField } from '../components/TextField';
import { colors, fonts, spacing, typeScale } from '../theme/tokens';

const speciesLabels: Record<LivestockSpecies, string> = {
  cattle: 'Sapi', goat: 'Kambing', sheep: 'Domba', poultry: 'Unggas', duck: 'Bebek', pig: 'Babi', horse: 'Kuda',
};
const sexLabels: Record<LivestockSex, string> = { female: 'Betina', male: 'Jantan', unknown: 'Belum diketahui' };

export function ServerLivestockSection({ service, farm, userId, backHandlerRef }: {
  service: ServerLivestockService;
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
  const operationInFlight = useRef(false);
  const dirty = !!(code || name || breed || age || weight || species || sex !== 'unknown');

  useEffect(() => {
    backHandlerRef.current = () => {
      if (discardVisible) { setDiscardVisible(false); return true; }
      if (busy) return true;
      if (!formOpen) return true;
      if (dirty) setDiscardVisible(true);
      else setFormOpen(false);
      return true;
    };
    return () => { backHandlerRef.current = null; };
  }, [backHandlerRef, busy, dirty, discardVisible, formOpen]);

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
