import { useCallback, useEffect, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { LivestockSpecies } from '../../domain/profiles';
import type { FarmInput, FarmSnapshot } from '../../domain/farms';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, InlineFeedback, LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { TextField } from '../components/TextField';
import { colors, fonts, layout, radii, spacing, typeScale } from '../theme/tokens';

type Route = { screen: 'list' } | { screen: 'detail'; farmId: string } | { screen: 'form'; mode: 'create' } | { screen: 'form'; mode: 'edit'; farmId: string };
type Props = { store: LocalStore; userId: string; onExit: () => void; onChanged: () => void };

const speciesLabels: Record<LivestockSpecies, string> = {
  cattle: 'Sapi', goat: 'Kambing', sheep: 'Domba', poultry: 'Unggas', duck: 'Bebek', pig: 'Babi', horse: 'Kuda',
};
const emptyForm: FarmInput = {
  name: '', species: [], location: '', addressLabel: 'Alamat peternakan', recipient: '', phone: '', address: '', city: '', province: '', postalCode: '',
};

export function FarmFlow({ store, userId, onExit, onChanged }: Props) {
  const [route, setRoute] = useState<Route>({ screen: 'list' });
  const [farms, setFarms] = useState<FarmSnapshot[]>([]);
  const [detail, setDetail] = useState<FarmSnapshot | null>(null);
  const [form, setForm] = useState<FarmInput>(emptyForm);
  const [initialForm, setInitialForm] = useState<FarmInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [revision, setRevision] = useState(0);

  const reload = useCallback(async () => {
    await Promise.resolve();
    setLoading(true);
    setError('');
    try {
      setFarms(await store.farms.list(userId));
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setLoading(false);
    }
  }, [store, userId]);

  useEffect(() => {
    const timer = setTimeout(() => { void reload(); }, 0);
    return () => clearTimeout(timer);
  }, [reload, revision]);

  useEffect(() => {
    if (route.screen === 'list' || route.screen === 'form') return;
    let active = true;
    void Promise.resolve().then(() => store.farms.get(userId, route.farmId))
      .then((next) => { if (active) { setDetail(next); setError(''); setLoading(false); } })
      .catch((cause: unknown) => { if (active) { setError(messageFor(cause)); setLoading(false); } });
    return () => { active = false; };
  }, [route, store, userId]);

  useEffect(() => {
    if (route.screen !== 'form' || route.mode !== 'edit') return;
    let active = true;
    void Promise.resolve().then(() => store.farms.get(userId, route.farmId)).then((farm) => {
      if (!active) return;
      const next = toInput(farm);
      setForm(next);
      setInitialForm(next);
      setError('');
    }).catch((cause: unknown) => { if (active) setError(messageFor(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [route, store, userId]);

  const dirty = route.screen === 'form' && !!initialForm && JSON.stringify(form) !== JSON.stringify(initialForm);
  const leaveForm = useCallback(() => {
    setLeaveDialog(false);
    setRoute(route.screen === 'form' && route.mode === 'edit' ? { screen: 'detail', farmId: route.farmId } : { screen: 'list' });
  }, [route]);
  const back = useCallback(() => {
    if (leaveDialog) { setLeaveDialog(false); return true; }
    if (route.screen === 'form') {
      if (dirty) setLeaveDialog(true); else leaveForm();
      return true;
    }
    if (route.screen === 'detail') { setError(''); setRoute({ screen: 'list' }); return true; }
    onExit();
    return true;
  }, [dirty, leaveDialog, leaveForm, onExit, route]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', back);
    return () => subscription.remove();
  }, [back]);

  const selectFarm = async (farmId: string) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await store.farms.select(userId, farmId);
      if (route.screen === 'detail' && route.farmId === farmId) setDetail(await store.farms.get(userId, farmId));
      await reload();
      setNotice('Peternakan aktif telah diperbarui.');
      onChanged();
    } catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  };

  const saveFarm = async () => {
    if (route.screen !== 'form') return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = route.mode === 'create'
        ? await store.farms.create(userId, form)
        : await store.farms.update(userId, route.farmId, form);
      setInitialForm(toInput(saved));
      setForm(toInput(saved));
      setDetail(saved);
      await reload();
      setRoute({ screen: 'detail', farmId: saved.id });
      setNotice(route.mode === 'create' ? 'Peternakan berhasil dibuat dan dipilih.' : 'Perubahan peternakan tersimpan.');
      onChanged();
    } catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  };

  return (
      <View style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" accessibilityLabel="Kembali" onPress={back} style={styles.backButton}><Icon name="arrow-left" size={22} color={colors.brown} /></Pressable>
            <Text accessibilityRole="header" style={styles.title}>{route.screen === 'list' ? 'Peternakan' : route.screen === 'detail' ? 'Detail Peternakan' : route.mode === 'create' ? 'Tambah Peternakan' : 'Edit Peternakan'}</Text>
            <View style={styles.backButton} />
          </View>
          {error ? <InlineFeedback message={error} tone="error" /> : null}
          {notice ? <InlineFeedback message={notice} /> : null}

          {route.screen === 'list' ? (
            <>
              <Text style={styles.intro}>Kelola peternakan dan alamat kunjungan secara terpisah. Ternak lama tetap tampil di daftar ternak akun ini.</Text>
              <Button label="Tambah Peternakan" role="farmer" variant="accent" onPress={() => { setForm(emptyForm); setInitialForm(emptyForm); setLoading(false); setError(''); setRoute({ screen: 'form', mode: 'create' }); }} />
              {loading ? <LoadingState label="Memuat peternakan…" /> : farms.length === 0 ? (
                <EmptyState title="Belum ada peternakan" description="Tambahkan peternakan beserta alamat kunjungannya untuk mulai mengelola ternak." role="farmer" />
              ) : farms.map((farm) => (
                <View key={farm.id} style={styles.card}>
                  <View style={styles.cardHeadingRow}>
                    <Text accessibilityRole="header" style={styles.cardTitle}>{farm.name}</Text>
                    {farm.selected ? <Text style={styles.activeBadge}>Aktif</Text> : null}
                  </View>
                  <Text style={styles.cardBody}>{farm.location} · {farm.species.map((item) => speciesLabels[item]).join(', ')}</Text>
                  <Text style={styles.cardMuted}>{farm.visitAddress}</Text>
                  <View style={styles.buttonRow}>
                    <Button label="Lihat" role="farmer" variant="secondary" onPress={() => { setDetail(null); setLoading(true); setError(''); setRoute({ screen: 'detail', farmId: farm.id }); }} style={styles.halfButton} />
                    <Button label={farm.selected ? 'Terpilih' : 'Pilih'} role="farmer" disabled={busy || farm.selected} selected={farm.selected} onPress={() => void selectFarm(farm.id)} style={styles.halfButton} />
                  </View>
                </View>
              ))}
            </>
          ) : null}

          {route.screen === 'detail' ? detail?.id !== route.farmId ? error ? <ErrorState message={error} role="farmer" onRetry={() => { setLoading(true); setRevision((value) => value + 1); }} /> : <LoadingState label="Memuat peternakan…" /> : detail ? (
            <>
              <View style={styles.card}>
                <View style={styles.cardHeadingRow}><Text accessibilityRole="header" style={styles.cardTitle}>{detail.name}</Text>{detail.selected ? <Text style={styles.activeBadge}>Peternakan aktif</Text> : null}</View>
                <DetailLine label="Wilayah" value={detail.location} />
                <DetailLine label="Jenis ternak" value={detail.species.map((item) => speciesLabels[item]).join(', ')} />
                <DetailLine label="Label alamat" value={detail.addressLabel} />
                <DetailLine label="Penerima" value={`${detail.recipient} · ${detail.phone}`} />
                <DetailLine label="Alamat kunjungan" value={detail.visitAddress} />
              </View>
              <Button label="Edit Peternakan" role="farmer" variant="secondary" onPress={() => { setLoading(true); setError(''); setInitialForm(null); setRoute({ screen: 'form', mode: 'edit', farmId: detail.id }); }} />
              {!detail.selected ? <Button label="Pilih Peternakan Ini" role="farmer" onPress={() => void selectFarm(detail.id)} loading={busy} /> : null}
              <Button label="Kembali ke daftar" role="farmer" variant="secondary" onPress={() => setRoute({ screen: 'list' })} />
            </>
          ) : <ErrorState message={error || 'Peternakan belum dapat dimuat.'} role="farmer" onRetry={() => setRevision((value) => value + 1)} /> : null}

          {route.screen === 'form' ? (
            <>
              {loading ? <LoadingState label="Memuat formulir…" /> : null}
              <Text style={styles.intro}>Setiap peternakan memiliki alamat kunjungan dan jenis ternak sendiri.</Text>
              <TextField label="Nama peternakan" value={form.name} onChangeText={(name) => setForm((current) => ({ ...current, name }))} maxLength={100} placeholder="Contoh: Kandang Utama" returnKeyType="next" />
              <Text style={styles.fieldLabel}>Jenis ternak *</Text>
              <View style={styles.choices}>{(Object.keys(speciesLabels) as LivestockSpecies[]).map((species) => {
                const selected = form.species.includes(species);
                return <Pressable key={species} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => setForm((current) => ({ ...current, species: selected ? current.species.filter((item) => item !== species) : [...current.species, species] }))} style={[styles.choice, selected && styles.choiceSelected]}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{speciesLabels[species]}</Text></Pressable>;
              })}</View>
              <TextField label="Wilayah peternakan" value={form.location} onChangeText={(location) => setForm((current) => ({ ...current, location }))} maxLength={120} placeholder="Kecamatan atau wilayah" returnKeyType="next" />
              <TextField label="Label alamat" value={form.addressLabel} onChangeText={(addressLabel) => setForm((current) => ({ ...current, addressLabel }))} maxLength={80} placeholder="Alamat peternakan" returnKeyType="next" />
              <TextField label="Nama penerima" value={form.recipient} onChangeText={(recipient) => setForm((current) => ({ ...current, recipient }))} maxLength={80} placeholder="Nama kontak di peternakan" returnKeyType="next" />
              <TextField label="Nomor telepon" value={form.phone} onChangeText={(phone) => setForm((current) => ({ ...current, phone }))} maxLength={24} keyboardType="phone-pad" placeholder="08…" returnKeyType="next" />
              <TextField label="Alamat lengkap" value={form.address} onChangeText={(address) => setForm((current) => ({ ...current, address }))} multiline maxLength={240} placeholder="Jalan, nomor, desa, dan petunjuk lokasi" />
              <TextField label="Kota atau kabupaten" value={form.city} onChangeText={(city) => setForm((current) => ({ ...current, city }))} maxLength={80} placeholder="Kota atau kabupaten" returnKeyType="next" />
              <TextField label="Provinsi" value={form.province} onChangeText={(province) => setForm((current) => ({ ...current, province }))} maxLength={80} placeholder="Provinsi" returnKeyType="next" />
              <TextField label="Kode pos" value={form.postalCode} onChangeText={(postalCode) => setForm((current) => ({ ...current, postalCode }))} maxLength={12} keyboardType="number-pad" placeholder="Kode pos" returnKeyType="done" />
              <Button label={route.mode === 'create' ? 'Simpan Peternakan' : 'Simpan Perubahan'} role="farmer" onPress={() => void saveFarm()} loading={busy} disabled={loading} />
              <Button label="Batal" role="farmer" variant="secondary" onPress={back} disabled={busy} />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      <Modal animationType="fade" transparent visible={leaveDialog} onRequestClose={() => setLeaveDialog(false)} statusBarTranslucent>
        <View style={styles.backdrop}>
          <Pressable accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onPress={() => setLeaveDialog(false)} style={StyleSheet.absoluteFill} />
          <View accessibilityViewIsModal style={styles.dialog}>
            <Text accessibilityRole="header" style={styles.dialogTitle}>Perubahan belum disimpan</Text>
            <Text style={styles.cardBody}>Buang perubahan pada formulir peternakan ini?</Text>
            <Button label="Tetap mengedit" role="farmer" variant="secondary" onPress={() => setLeaveDialog(false)} />
            <Button label="Buang perubahan" role="farmer" variant="accent" onPress={leaveForm} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return <View style={styles.detailLine}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value || '—'}</Text></View>;
}

function toInput(farm: FarmSnapshot): FarmInput {
  return { name: farm.name, species: [...farm.species], location: farm.location, addressLabel: farm.addressLabel, recipient: farm.recipient, phone: farm.phone, address: farm.address, city: farm.city, province: farm.province, postalCode: farm.postalCode };
}

function messageFor(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string') return cause.message;
  return 'Data peternakan belum dapat diproses. Periksa penyimpanan lokal lalu coba lagi.';
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.cream },
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', padding: layout.contentHorizontal, paddingBottom: spacing[12], gap: spacing[4] },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  backButton: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: colors.dark, fontFamily: fonts.bold, fontSize: typeScale.title, lineHeight: 30, textAlign: 'center' },
  intro: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21 },
  card: { padding: spacing[4], borderRadius: radii.cardFarmer, backgroundColor: colors.white, gap: spacing[3] },
  cardHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  cardTitle: { flex: 1, color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.heading, lineHeight: 26 },
  cardBody: { color: colors.dark, fontFamily: fonts.medium, fontSize: typeScale.body, lineHeight: 21 },
  cardMuted: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 19 },
  activeBadge: { color: colors.brown, backgroundColor: colors.cream, borderRadius: radii.pill, overflow: 'hidden', paddingHorizontal: spacing[3], paddingVertical: spacing[2], fontFamily: fonts.semiBold, fontSize: typeScale.small },
  buttonRow: { flexDirection: 'row', gap: spacing[3] },
  halfButton: { flex: 1 },
  detailLine: { gap: 4, paddingTop: spacing[2], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.gold },
  detailLabel: { color: colors.muted, fontFamily: fonts.medium, fontSize: typeScale.small, lineHeight: 18 },
  detailValue: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21 },
  fieldLabel: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.label, lineHeight: 19 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  choice: { minHeight: 44, minWidth: 72, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing[3], borderWidth: 1, borderColor: colors.gold, borderRadius: radii.pill, backgroundColor: colors.white },
  choiceSelected: { backgroundColor: colors.brown, borderColor: colors.brown },
  choiceText: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.small },
  choiceTextSelected: { color: colors.white },
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing[6], backgroundColor: 'rgba(58, 23, 13, 0.48)' },
  dialog: { gap: spacing[3], padding: spacing[5], borderRadius: radii.cardFarmer, backgroundColor: colors.cream },
  dialogTitle: { color: colors.dark, fontFamily: fonts.bold, fontSize: typeScale.heading },
});
