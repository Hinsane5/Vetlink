import { useEffect, useState } from 'react';
import { Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import { emptyVetFilters, filterVets, type DirectorySchedule, type DirectoryServiceType, type DirectoryVet, type VetFilters } from '../../domain/directory';
import { livestockSpecies, type LivestockSpecies } from '../../domain/profiles';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, InlineFeedback, LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { colors, fonts, layout, radii, spacing, typeScale } from '../theme/tokens';

const speciesNames: Record<LivestockSpecies, string> = { cattle: 'Sapi', goat: 'Kambing', sheep: 'Domba', poultry: 'Unggas', duck: 'Bebek', pig: 'Babi', horse: 'Kuda' };
const serviceNames: Record<DirectoryServiceType, string> = { chat: 'Chat', visit: 'Kunjungan' };
const money = (value: number) => `Rp${value.toLocaleString('id-ID')}`;
type Props = { store: LocalStore; vetId?: string; onOpenVet: (id: string) => void; onBack: () => void; onBook: (vetId: string) => void };

export function VetDirectoryFlow({ store, vetId, onOpenVet, onBack, onBook }: Props) {
  const [vets, setVets] = useState<DirectoryVet[]>([]);
  const [filters, setFilters] = useState<VetFilters>(emptyVetFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (vetId) return;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      store.vetDirectory.list().then((items) => { if (active) setVets(items); })
        .catch((cause: unknown) => { if (active) setError(messageFor(cause)); })
        .finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [revision, store, vetId]);

  const visible = filterVets(vets, filters);
  const applied = filterLabels(filters);
  return (
    <View style={styles.flex}>
      {vetId ? <VetDetail key={vetId} store={store} vetId={vetId} onBack={onBack} onBook={onBook} /> : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent}>
          <View style={styles.page}>
            <Header title="Cari dokter" onBack={onBack} onRefresh={() => setRevision((value) => value + 1)} />
            <Text style={styles.muted}>Temukan dokter hewan yang sesuai dengan kebutuhan ternak Anda.</Text>
            <View style={styles.searchRow}>
              <View style={styles.searchFrame}>
                <Icon name="search" size={20} />
                <TextInput accessibilityLabel="Cari nama dokter" placeholder="Cari nama dokter" placeholderTextColor={colors.muted} value={filters.query} onChangeText={(query) => setFilters({ ...filters, query })} autoCapitalize="none" returnKeyType="search" onSubmitEditing={Keyboard.dismiss} style={styles.search} />
                {filters.query ? <Pressable accessibilityRole="button" accessibilityLabel="Hapus pencarian" onPress={() => setFilters({ ...filters, query: '' })} style={styles.iconButton}><Icon name="x" size={18} /></Pressable> : null}
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Filter dokter${applied.length ? `, ${applied.length} aktif` : ''}`} onPress={() => { Keyboard.dismiss(); setFilterOpen(true); }} style={styles.filterButton}><Icon name="sliders-horizontal" color={colors.white} /></Pressable>
            </View>
            {applied.length ? <View style={styles.chips}>{applied.map((label, index) => <View key={`${index}:${label}`} style={styles.appliedChip}><Text style={styles.small}>{label}</Text></View>)}<Pressable accessibilityRole="button" onPress={() => setFilters({ ...emptyVetFilters, query: filters.query })} style={styles.clearButton}><Text style={styles.link}>Hapus filter</Text></Pressable></View> : null}
            {loading ? <LoadingState label="Memuat dokter…" /> : error ? <ErrorState message={error} role="farmer" onRetry={() => setRevision((value) => value + 1)} /> : <>
              <Text accessibilityLiveRegion="polite" style={styles.count}>{visible.length} dokter ditemukan</Text>
              {visible.length ? visible.map((vet) => <VetRow key={vet.id} vet={vet} onPress={() => { Keyboard.dismiss(); onOpenVet(vet.id); }} />) : <EmptyState title="Tidak ada dokter yang cocok" description="Ubah kata pencarian atau filter untuk melihat dokter lain." role="farmer" actionLabel="Tampilkan semua dokter" onAction={() => setFilters(emptyVetFilters)} />}
            </>}
          </View>
        </ScrollView>
      )}
      {filterOpen ? <FilterSheet filters={filters} resultCount={(next) => filterVets(vets, next).length} onClose={() => setFilterOpen(false)} onApply={(next) => { setFilters(next); setFilterOpen(false); }} /> : null}
    </View>
  );
}

function FilterSheet({ filters, resultCount, onClose, onApply }: { filters: VetFilters; resultCount: (next: VetFilters) => number; onClose: () => void; onApply: (next: VetFilters) => void }) {
  const [draft, setDraft] = useState(filters);
  const [feeText, setFeeText] = useState(filters.maxFee === null ? '' : String(filters.maxFee));
  const parsedFee = feeText.trim() ? Number(feeText.trim()) : null;
  const validFee = parsedFee === null || (/^\d+$/.test(feeText.trim()) && Number.isSafeInteger(parsedFee) && parsedFee >= 0);
  const next = { ...draft, maxFee: validFee ? parsedFee : null };
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <SafeAreaProvider>
    <SafeAreaView style={styles.modalSafe}>
      <KeyboardAvoidingView style={styles.modalAvoiding} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable accessibilityRole="button" accessibilityLabel="Tutup filter" style={styles.modalDismiss} onPress={onClose} />
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.sheetHeader}><Text accessibilityRole="header" style={styles.sectionTitle}>Filter dokter</Text><Pressable accessibilityRole="button" accessibilityLabel="Tutup filter" onPress={onClose} style={styles.iconButton}><Icon name="x" /></Pressable></View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.filterContent}>
            <Text style={styles.label}>Layanan</Text><View style={styles.chips}>{(['all', 'chat', 'visit'] as const).map((value) => <Chip key={value} label={value === 'all' ? 'Semua' : serviceNames[value]} selected={draft.service === value} onPress={() => setDraft({ ...draft, service: value })} />)}</View>
            <Text style={styles.label}>Jenis ternak</Text><View style={styles.chips}><Chip label="Semua" selected={draft.species === 'all'} onPress={() => setDraft({ ...draft, species: 'all' })} />{livestockSpecies.map((value) => <Chip key={value} label={speciesNames[value]} selected={draft.species === value} onPress={() => setDraft({ ...draft, species: value })} />)}</View>
            <Text style={styles.label}>Lokasi praktik atau wilayah kunjungan</Text><TextInput accessibilityLabel="Lokasi dokter" value={draft.location} onChangeText={(location) => setDraft({ ...draft, location })} placeholder="Ketik kota atau wilayah" placeholderTextColor={colors.muted} maxLength={120} style={styles.input} />
            <Text style={styles.label}>Tarif maksimum (rupiah)</Text><TextInput accessibilityLabel="Tarif maksimum" accessibilityHint="Kosongkan untuk semua tarif" value={feeText} onChangeText={setFeeText} keyboardType="number-pad" placeholder="Tanpa batas" placeholderTextColor={colors.muted} maxLength={16} style={styles.input} />
            {!validFee ? <InlineFeedback tone="error" message="Masukkan tarif berupa angka rupiah utuh, minimal 0." /> : <Text style={styles.small}>Tarif mengikuti layanan yang dipilih.</Text>}
            <View style={styles.switchRow}><Text style={[styles.label, styles.switchLabel]}>Hanya dokter yang menerima permintaan</Text><Switch accessibilityLabel="Hanya dokter yang menerima permintaan" value={draft.availableOnly} onValueChange={(availableOnly) => setDraft({ ...draft, availableOnly })} trackColor={{ true: colors.brown }} /></View>
          </ScrollView>
          <View style={styles.actions}><Button label="Reset" role="farmer" variant="secondary" onPress={() => { setDraft({ ...emptyVetFilters, query: filters.query }); setFeeText(''); }} style={styles.action} /><Button label={`Tampilkan ${resultCount(next)} dokter`} role="farmer" disabled={!validFee} onPress={() => { Keyboard.dismiss(); onApply(next); }} style={styles.action} /></View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}

function VetRow({ vet, onPress }: { vet: DirectoryVet; onPress: () => void }) {
  const lowest = vet.rates.length ? Math.min(...vet.rates.map((rate) => rate.amount)) : null;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Lihat profil ${vet.name}`} onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
    <View style={styles.row}><Avatar key={vet.photoUri} vet={vet} /><View style={styles.cardMain}><Text style={styles.cardTitle}>{vet.name}</Text><Verification verified={vet.verified} /><Text style={styles.small}>{vet.location || 'Lokasi belum dicantumkan'}</Text></View><Icon name="chevron-right" size={20} /></View>
    <Text style={styles.body}>{vet.species.map((value) => speciesNames[value]).join(' · ') || 'Jenis ternak belum dicantumkan'}</Text>
    <View style={styles.chips}>{vet.services.map((service) => <View key={service} style={styles.appliedChip}><Text style={styles.small}>{serviceNames[service]}</Text></View>)}</View>
    <View style={styles.cardFooter}><Text style={styles.price}>{lowest === null ? 'Tarif belum tersedia' : `Mulai ${money(lowest)}`}</Text><Text style={styles.small}>{vet.accepting ? 'Menerima permintaan' : 'Belum tersedia'}</Text></View>
    <Text style={styles.small}>{ratingLabel(vet)}</Text>
  </Pressable>;
}

function VetDetail({ store, vetId, onBack, onBook }: { store: LocalStore; vetId: string; onBack: () => void; onBook: (vetId: string) => void }) {
  const [vet, setVet] = useState<DirectoryVet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true); setError(''); setVet(null);
      store.vetDirectory.get(vetId).then((next) => { if (active) setVet(next); })
        .catch((cause: unknown) => { if (active) setError(messageFor(cause)); })
        .finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [revision, store, vetId]);
  return <ScrollView contentContainerStyle={styles.scrollContent}><View style={styles.page}>
    <Header title="Profil dokter" onBack={onBack} onRefresh={() => setRevision((value) => value + 1)} />
    {loading ? <LoadingState label="Memuat profil dokter…" /> : error || !vet ? <ErrorState message={error || 'Profil belum tersedia.'} role="farmer" onRetry={() => setRevision((value) => value + 1)} /> : <>
      <View style={styles.card}><Avatar vet={vet} large /><Text accessibilityRole="header" style={styles.detailName}>{vet.name}</Text><Verification verified={vet.verified} /><Text style={styles.body}>{ratingLabel(vet)}</Text><Text style={styles.availability}>{vet.accepting ? 'Menerima permintaan baru' : 'Belum menerima permintaan baru'}</Text></View>
      <View style={styles.card}><Text style={styles.sectionTitle}>Tentang dokter</Text><Text style={styles.body}>{vet.experienceYears > 0 ? `${vet.experienceYears} tahun pengalaman` : 'Pengalaman belum dicantumkan'}</Text><Text style={styles.body}>Lokasi praktik: {vet.location || 'Belum dicantumkan'}</Text><Text style={styles.body}>Jenis ternak: {vet.species.map((value) => speciesNames[value]).join(', ') || 'Belum dicantumkan'}</Text><Text style={styles.body}>Wilayah kunjungan: {vet.visitRegions.join(', ') || 'Belum dicantumkan'}</Text></View>
      <View style={styles.card}><Text style={styles.sectionTitle}>Layanan dan tarif</Text>{vet.services.length ? vet.services.map((service) => { const rate = vet.rates.find((item) => item.service === service); return <View key={service} style={styles.rateRow}><Text style={styles.body}>{service === 'chat' ? 'Konsultasi chat' : 'Kunjungan ke peternakan'}</Text><Text style={styles.price}>{rate ? money(rate.amount) : 'Tarif belum tersedia'}</Text></View>; }) : <Text style={styles.muted}>Layanan belum dicantumkan.</Text>}</View>
      <Button role="farmer" label="Booking konsultasi" disabled={!vet.verified || !vet.accepting || !vet.rates.length} onPress={() => onBook(vet.id)} />
      <ScheduleCard store={store} vet={vet} key={`${vet.id}:${revision}`} />
      <View style={styles.card}><Text style={styles.sectionTitle}>Ulasan peternak</Text>{vet.reviews.length ? vet.reviews.map((review) => <View key={review.id} style={styles.review}><View style={styles.row}><Icon name="star" size={16} /><Text style={styles.price}>{review.stars} / 5</Text></View><Text style={styles.body}>{review.text || 'Tanpa komentar'}</Text><Text style={styles.small}>{formatDate(review.submittedAt, 'Asia/Jakarta')}</Text></View>) : <Text style={styles.muted}>Belum ada ulasan dari konsultasi yang selesai.</Text>}</View>
    </>}
  </View></ScrollView>;
}

function ScheduleCard({ store, vet }: { store: LocalStore; vet: DirectoryVet }) {
  const [service, setService] = useState<DirectoryServiceType>(vet.services[0] ?? 'chat');
  const [schedule, setSchedule] = useState<DirectorySchedule | null>(null);
  const [day, setDay] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true); setError(''); setSchedule(null);
      store.vetDirectory.slots(vet.id, service).then((next) => {
        if (!active) return;
        setSchedule(next); setDay(next.slots[0] ? dateKey(next.slots[0].startsAt, next.timezone) : '');
      }).catch((cause: unknown) => { if (active) setError(messageFor(cause)); })
        .finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [revision, service, store, vet.id]);
  const days = schedule ? [...new Map(schedule.slots.map((slot) => [dateKey(slot.startsAt, schedule.timezone), slot.startsAt])).entries()] : [];
  const slots = schedule?.slots.filter((slot) => dateKey(slot.startsAt, schedule.timezone) === day) ?? [];
  return <View style={styles.card}><Text style={styles.sectionTitle}>Jadwal tersedia</Text><Text style={styles.small}>7 hari ke depan · {schedule?.timezone || 'Waktu setempat dokter'}</Text>
    <View style={styles.chips}>{vet.services.map((value) => <Chip key={value} label={serviceNames[value]} selected={service === value} onPress={() => setService(value)} />)}</View>
    {loading ? <LoadingState label="Memuat jadwal…" /> : error ? <ErrorState message={error} role="farmer" onRetry={() => setRevision((value) => value + 1)} /> : !schedule?.slots.length ? <Text style={styles.muted}>{!vet.verified ? 'Jadwal belum tersedia karena verifikasi dokter belum selesai.' : !vet.accepting ? 'Dokter belum menerima permintaan baru.' : 'Belum ada slot tersedia untuk layanan ini dalam 7 hari ke depan.'}</Text> : <>
      <View style={styles.chips}>{days.map(([key, instant]) => <Chip key={key} label={formatDate(instant, schedule.timezone)} selected={day === key} onPress={() => setDay(key)} />)}</View>
      <View style={styles.chips}>{slots.map((slot) => <View key={slot.id} style={styles.slot}><Icon name="clock-3" size={16} /><Text style={styles.body}>{formatTime(slot.startsAt, schedule.timezone)}–{formatTime(slot.endsAt, schedule.timezone)}</Text></View>)}</View>
      <Text style={styles.small}>Jadwal dapat berubah sesuai ketersediaan dokter.</Text>
    </>}
  </View>;
}

function Header({ title, onBack, onRefresh }: { title: string; onBack: () => void; onRefresh: () => void }) {
  return <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Kembali" onPress={onBack} style={styles.iconButton}><Icon name="arrow-left" /></Pressable><Text accessibilityRole="header" style={styles.title}>{title}</Text><Pressable accessibilityRole="button" accessibilityLabel="Muat ulang" onPress={onRefresh} style={styles.iconButton}><Icon name="refresh-cw" size={20} /></Pressable></View>;
}
function Avatar({ vet, large = false }: { vet: DirectoryVet; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <View style={[styles.avatar, large && styles.avatarLarge]}>{vet.photoUri && !failed ? <Image accessibilityLabel={`Foto ${vet.name}`} source={{ uri: vet.photoUri }} onError={() => setFailed(true)} style={styles.avatarImage} /> : <Icon name="stethoscope" size={large ? 34 : 24} />}</View>;
}
function Verification({ verified }: { verified: boolean }) {
  return <View style={styles.verification}><Icon name={verified ? 'badge-check' : 'circle-help'} size={16} /><Text style={styles.small}>{verified ? 'Terverifikasi' : 'Belum terverifikasi'}</Text></View>;
}
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>;
}
function filterLabels(filters: VetFilters): string[] {
  return [filters.service !== 'all' ? serviceNames[filters.service] : '', filters.species !== 'all' ? speciesNames[filters.species] : '', filters.location.trim(), filters.maxFee !== null ? `≤ ${money(filters.maxFee)}` : '', filters.availableOnly ? 'Menerima permintaan' : ''].filter(Boolean);
}
function ratingLabel(vet: DirectoryVet): string {
  return vet.ratingAverage !== null && vet.reviewCount > 0 ? `${vet.ratingAverage.toFixed(1)} / 5 · ${vet.reviewCount} ulasan` : 'Belum ada ulasan';
}
function dateKey(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
}
function formatDate(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat('id-ID', { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(instant));
}
function formatTime(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat('id-ID', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant));
}
function messageFor(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Data dokter belum dapat dimuat. Coba lagi.';
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, scrollContent: { flexGrow: 1, paddingHorizontal: layout.contentHorizontal, paddingTop: spacing[3], paddingBottom: spacing[6], alignItems: 'center' },
  page: { width: '100%', maxWidth: 430, gap: spacing[3] }, header: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] }, iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: typeScale.heading, color: colors.dark, textAlign: 'center' }, sectionTitle: { fontFamily: fonts.semiBold, fontSize: typeScale.section, color: colors.dark },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] }, searchFrame: { flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingLeft: spacing[3], backgroundColor: colors.white, borderRadius: radii.button }, search: { flex: 1, minWidth: 0, minHeight: 48, paddingVertical: spacing[3], fontFamily: fonts.regular, fontSize: typeScale.body, color: colors.dark }, filterButton: { minWidth: 52, minHeight: 52, backgroundColor: colors.brown, borderRadius: radii.button, alignItems: 'center', justifyContent: 'center' },
  count: { fontFamily: fonts.medium, color: colors.muted, fontSize: typeScale.label }, card: { backgroundColor: colors.white, borderRadius: radii.cardFarmer, padding: spacing[4], gap: spacing[3] }, row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] }, cardMain: { flex: 1, gap: spacing[1], minWidth: 0 }, cardTitle: { fontFamily: fonts.semiBold, fontSize: typeScale.section, color: colors.dark }, cardFooter: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing[2] },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, avatarLarge: { width: 76, height: 76, borderRadius: 38 }, avatarImage: { width: '100%', height: '100%' }, verification: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  muted: { fontFamily: fonts.regular, color: colors.muted, fontSize: typeScale.body, lineHeight: 21 }, small: { fontFamily: fonts.regular, color: colors.muted, fontSize: typeScale.small, lineHeight: 18 }, body: { fontFamily: fonts.regular, color: colors.dark, fontSize: typeScale.body, lineHeight: 21 }, price: { fontFamily: fonts.semiBold, color: colors.brown, fontSize: typeScale.body, lineHeight: 21 }, detailName: { fontFamily: fonts.bold, color: colors.dark, fontSize: typeScale.title }, availability: { fontFamily: fonts.medium, color: colors.brown, fontSize: typeScale.body }, rateRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing[3] }, review: { backgroundColor: colors.cream, borderRadius: radii.button, padding: spacing[3], gap: spacing[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] }, appliedChip: { paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: radii.pill, backgroundColor: colors.cream }, clearButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing[2] }, link: { fontFamily: fonts.semiBold, color: colors.brown, fontSize: typeScale.small }, chip: { minHeight: 44, paddingVertical: spacing[2], paddingHorizontal: spacing[3], borderRadius: radii.pill, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gold, justifyContent: 'center' }, chipSelected: { backgroundColor: colors.brown, borderColor: colors.brown }, chipText: { fontFamily: fonts.medium, color: colors.dark, fontSize: typeScale.body }, chipTextSelected: { color: colors.white }, slot: { minHeight: 44, padding: spacing[3], borderRadius: radii.button, backgroundColor: colors.cream, flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  modalSafe: { flex: 1, backgroundColor: 'rgba(58, 23, 13, 0.45)' }, modalAvoiding: { flex: 1, justifyContent: 'flex-end' }, modalDismiss: { flex: 1 }, sheet: { backgroundColor: colors.cream, maxHeight: '88%', paddingHorizontal: layout.contentHorizontal, paddingTop: spacing[3], paddingBottom: spacing[6], borderTopLeftRadius: 24, borderTopRightRadius: 24 }, sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing[2] }, filterContent: { paddingBottom: spacing[3], gap: spacing[2] }, label: { fontFamily: fonts.semiBold, fontSize: typeScale.body, color: colors.dark, marginTop: spacing[3] }, input: { minHeight: 52, paddingVertical: spacing[3], backgroundColor: colors.white, borderRadius: radii.button, paddingHorizontal: spacing[3], fontFamily: fonts.regular, fontSize: typeScale.body, color: colors.dark }, switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] }, switchLabel: { flex: 1, marginTop: 0 }, actions: { flexDirection: 'row', gap: spacing[2], paddingTop: spacing[3] }, action: { flex: 1 }, pressed: { opacity: 0.85 },
});
