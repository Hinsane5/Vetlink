import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Image, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { BookingAttachment, BookingDraft, BookingInput, BookingReview } from '../../domain/booking';
import type { DirectorySchedule, DirectoryVet } from '../../domain/directory';
import type { LivestockSnapshot } from '../../domain/livestock';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, InlineFeedback, LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { colors, fonts, layout, radii, spacing, typeScale } from '../theme/tokens';

type Props = { store: LocalStore; userId: string; vetId: string; onBack: () => void; onComplete: (id: string) => void };
type Context = { vet: DirectoryVet; animals: LivestockSnapshot[]; draft: BookingDraft; attachments: BookingAttachment[] };
const money = (value: number) => `Rp${value.toLocaleString('id-ID')}`;
const serviceName = (service: string) => service === 'chat' ? 'Konsultasi chat' : 'Kunjungan dokter';
const date = (instant: string, timezone: string) => new Intl.DateTimeFormat('id-ID', { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(instant));
const dayKey = (instant: string, timezone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
const time = (instant: string, timezone: string) => new Intl.DateTimeFormat('id-ID', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant));

export function BookingFlow({ store, userId, vetId, onBack, onComplete }: Props) {
  const [context, setContext] = useState<Context | null>(null);
  const [input, setInput] = useState<BookingInput | null>(null);
  const selectedDayRef = useRef('');
  const selectedStartRef = useRef('');
  const [schedule, setSchedule] = useState<DirectorySchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleRevision, setScheduleRevision] = useState(0);
  const [completedId, setCompletedId] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState('');
  const [day, setDay] = useState('');
  const [review, setReview] = useState<BookingReview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [revision, setRevision] = useState(0);
  const [confirmBack, setConfirmBack] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = !!context && !!input && JSON.stringify(context.draft.input) !== JSON.stringify(input);

  useEffect(() => {
    selectedDayRef.current = input?.selectedDay ?? '';
    selectedStartRef.current = input?.startsAt ?? '';
  }, [input?.selectedDay, input?.startsAt]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true); setError('');
      store.booking.open(userId, vetId).then((next) => {
        if (!active) return;
        setContext(next); setInput(next.draft.input); setReview(null); setScheduleRevision((value) => value + 1);
        setNotice(next.draft.version > 1 ? 'Draft tersimpan dimuat kembali.' : '');
      }).catch((cause: unknown) => { if (active) setError(message(cause)); }).finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [revision, store, userId, vetId]);

  const service = input?.service;
  useEffect(() => {
    if (!service) return;
    let active = true;
    const timer = setTimeout(() => {
      setScheduleLoading(true); setScheduleError('');
      store.vetDirectory.slots(vetId, service).then((next) => {
        if (!active) return;
        setSchedule(next);
        const chosen = next.slots.find((slot) => slot.startsAt === selectedStartRef.current) ?? next.slots[0];
        const savedDay = selectedDayRef.current;
        setDay(next.slots.some((slot) => dayKey(slot.startsAt, next.timezone) === savedDay) ? savedDay : chosen ? dayKey(chosen.startsAt, next.timezone) : '');
      }).catch((cause: unknown) => { if (active) setScheduleError(message(cause)); }).finally(() => { if (active) setScheduleLoading(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [scheduleRevision, service, store, vetId]);

  const back = useCallback(() => {
    Keyboard.dismiss();
    if (busyRef.current) return;
    if (completedId) { onComplete(completedId); return; }
    if (review) { setReview(null); return; }
    if (dirty) setConfirmBack(true); else onBack();
  }, [completedId, dirty, onBack, onComplete, review]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [back]);

  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice(''); Keyboard.dismiss();
    try { await action(); } catch (cause) { setError(message(cause)); if (review) { setReview(null); setScheduleRevision((value) => value + 1); } }
    finally { busyRef.current = false; setBusy(false); }
  };
  const save = async () => {
    if (!context || !input) throw new Error('Draft belum dimuat.');
    const draft = await store.booking.save(userId, context.draft, input);
    setContext({ ...context, draft }); setInput(draft.input); setNotice('Draft tersimpan. Anda dapat melanjutkannya dari profil dokter ini.');
    return draft;
  };
  const change = (patch: Partial<BookingInput>) => { if (busyRef.current || !input) return; setInput({ ...input, ...patch }); setError(''); setNotice(''); };
  const reloadDraft = () => {
    if (busyRef.current) return;
    Alert.alert('Muat ulang draft?', 'Perubahan yang belum disimpan akan diganti dengan draft terakhir yang tersimpan.', [
      { text: 'Tetap mengedit', style: 'cancel' },
      { text: 'Muat ulang', onPress: () => { setConfirmBack(false); setConfirmDiscard(false); setRevision((value) => value + 1); } },
    ]);
  };
  const discard = () => void run(async () => {
    if (!context) return;
    await store.booking.discard(userId, context.draft); setConfirmBack(false); setConfirmDiscard(false); onBack();
  });
  const days = schedule ? [...new Map(schedule.slots.map((slot) => [dayKey(slot.startsAt, schedule.timezone), slot.startsAt])).entries()] : [];
  const slots = schedule?.slots.filter((slot) => dayKey(slot.startsAt, schedule.timezone) === day) ?? [];
  const attachments = context?.attachments.filter((attachment) => input?.attachmentIds.includes(attachment.id)) ?? [];
  const ready = !!context?.vet.verified && !!context?.vet.accepting && !!context?.animals.length;

  return <View style={styles.flex}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
      <View style={styles.page}>
        <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Kembali" disabled={busy} onPress={back} style={styles.iconButton}><Icon name="arrow-left" /></Pressable><Text accessibilityRole="header" style={styles.title}>{completedId ? 'Booking tersimpan' : review ? 'Tinjau booking' : 'Booking konsultasi'}</Text><View style={styles.iconButton} /></View>
        {loading ? <LoadingState label="Memuat booking…" /> : !context || !input ? <ErrorState role="farmer" message={error || 'Booking belum dapat dimuat.'} onRetry={() => setRevision((value) => value + 1)} /> : <>
          <View style={styles.card}><Text style={styles.heading}>{context.vet.name}</Text><Text style={styles.body}>{context.vet.verified ? 'Dokter terverifikasi' : 'Dokter belum terverifikasi'}</Text><Text style={styles.muted}>{context.vet.location}</Text></View>
          {error ? <><InlineFeedback tone="error" message={error} /><Button role="farmer" label="Muat ulang draft" variant="secondary" disabled={busy} onPress={reloadDraft} /></> : null}
          {notice ? <InlineFeedback message={notice} /> : null}
          {completedId ? <>
            <View style={styles.card}><Text style={styles.heading}>Menunggu pembayaran</Text><Text style={styles.body}>Booking telah tersimpan. Dokter belum menerima permintaan dan chat belum dibuka.</Text><Text style={styles.muted}>Pembayaran belum tersedia. Booking dapat dilihat dalam daftar konsultasi Anda.</Text></View>
            <Button role="farmer" label="Lihat detail booking" onPress={() => onComplete(completedId)} />
          </> : review ? <>
            <View style={styles.card}>
              <Text style={styles.heading}>Detail konsultasi</Text>
              <Text style={styles.body}>{serviceName(review.input.service)} · {review.animalName}</Text>
              <Text style={styles.body}>{date(review.input.startsAt, review.timezone)} · {time(review.input.startsAt, review.timezone)}–{time(review.input.endsAt, review.timezone)}</Text>
              <Text style={styles.muted}>{review.timezone}</Text>
              {review.input.service === 'visit' ? <><Text style={styles.label}>Alamat kunjungan</Text><Text style={styles.body}>{review.input.visitAddress}</Text></> : null}
              <Text style={styles.label}>Keluhan</Text><Text style={styles.body}>{review.input.complaint}</Text>
              <Text style={styles.muted}>{review.input.attachmentIds.length} lampiran</Text>
            </View>
            <View style={styles.card}><Text style={styles.heading}>Ringkasan biaya</Text><Text style={styles.body}>{serviceName(review.input.service)}: {money(review.total)}</Text><Text style={styles.price}>Total {money(review.total)}</Text><Text style={styles.muted}>Belum ada pembayaran yang dilakukan.</Text></View>
            <InlineFeedback message="Booking tersimpan dengan status menunggu pembayaran. Layanan baru dapat diajukan ke dokter setelah pembayaran berhasil; jadwal belum menjadi janji yang diterima." />
            <Button role="farmer" label="Konfirmasi booking" loading={busy} loadingLabel="Menyimpan booking…" onPress={() => void run(async () => { const id = await store.booking.submit(userId, review); setCompletedId(id); })} />
            <Button role="farmer" label="Ubah detail" variant="secondary" disabled={busy} onPress={() => setReview(null)} />
          </> : <>
            {!ready ? <InlineFeedback tone="error" message={!context.vet.verified ? 'Dokter belum terverifikasi. Pilih dokter lain untuk membuat booking.' : !context.vet.accepting ? 'Dokter belum menerima permintaan baru.' : 'Belum ada ternak Anda yang sesuai dengan jenis ternak yang dilayani dokter ini.'} /> : null}
            <View style={styles.card}>
              <Text style={styles.heading}>Layanan</Text><View style={styles.choices}>{context.vet.services.map((value) => <Choice key={value} label={serviceName(value)} selected={input.service === value} disabled={busy} onPress={() => { change({ service: value, startsAt: '', endsAt: '', selectedDay: '' }); setDay(''); }} />)}</View>
              <Text style={styles.label}>Ternak yang diperiksa *</Text>
              {context.animals.length ? <View style={styles.choices}>{context.animals.map((animal) => <Choice key={animal.id} label={`${animal.name} · ${animal.displayCode}`} selected={input.animalId === animal.id} disabled={busy} onPress={() => change({ animalId: animal.id })} />)}</View> : <EmptyState title="Ternak belum tersedia" description="Tambahkan ternak yang sesuai melalui menu Ternak, atau pilih dokter lain." role="farmer" />}
            </View>
            <View style={styles.card}>
              <Text style={styles.heading}>Tanggal dan waktu *</Text><Text style={styles.muted}>7 hari ke depan · {schedule?.timezone || 'Waktu dokter'}</Text>
              {scheduleLoading ? <LoadingState label="Memuat jadwal…" /> : scheduleError ? <ErrorState role="farmer" message={scheduleError} onRetry={() => setScheduleRevision((value) => value + 1)} /> : !schedule?.slots.length ? <Text style={styles.body}>Tidak ada waktu tersedia untuk layanan ini. Pilih layanan atau dokter lain.</Text> : <>
                <View style={styles.choices}>{days.map(([key, instant]) => <Choice key={key} label={date(instant, schedule.timezone)} selected={day === key} disabled={busy} onPress={() => { setDay(key); change({ selectedDay: key, ...(input.startsAt && dayKey(input.startsAt, schedule.timezone) !== key ? { startsAt: '', endsAt: '' } : {}) }); }} />)}</View>
                <View style={styles.choices}>{slots.map((slot) => <Choice key={slot.id} label={`${time(slot.startsAt, schedule.timezone)}–${time(slot.endsAt, schedule.timezone)}`} selected={input.startsAt === slot.startsAt} disabled={busy} onPress={() => change({ startsAt: slot.startsAt, endsAt: slot.endsAt, selectedDay: day })} />)}</View>
              </>}
              <Button role="farmer" label="Muat ulang jadwal" variant="secondary" disabled={busy || scheduleLoading} onPress={() => setScheduleRevision((value) => value + 1)} />
              {input.startsAt && schedule && !schedule.slots.some((slot) => slot.startsAt === input.startsAt && slot.endsAt === input.endsAt) && !scheduleLoading ? <InlineFeedback tone="error" message="Jadwal dalam draft sudah tidak tersedia. Pilih waktu baru." /> : null}
            </View>
            {input.service === 'visit' ? <View style={styles.card}><Text style={styles.heading}>Alamat kunjungan *</Text><Text style={styles.muted}>Wilayah dokter: {context.vet.visitRegions.join(', ') || 'Hubungi dokter untuk cakupan wilayah'}. Cantumkan alamat lengkap dan petunjuk kandang.</Text><TextInput accessibilityLabel="Alamat kunjungan" value={input.visitAddress} onChangeText={(visitAddress) => change({ visitAddress })} editable={!busy} multiline maxLength={1000} placeholder="Jalan, nomor, desa, kota, dan petunjuk lokasi" placeholderTextColor={colors.muted} style={[styles.input, styles.multiline]} /></View> : null}
            <View style={styles.card}><Text style={styles.heading}>Keluhan ternak *</Text><TextInput accessibilityLabel="Keluhan ternak" value={input.complaint} onChangeText={(complaint) => change({ complaint })} editable={!busy} multiline maxLength={2000} placeholder="Jelaskan kondisi dan sejak kapan keluhan muncul" placeholderTextColor={colors.muted} style={[styles.input, styles.multiline]} /><Text style={styles.muted}>{input.complaint.length} / 2.000 karakter · minimal 5 karakter</Text></View>
            <View style={styles.card}><Text style={styles.heading}>Foto atau video</Text><Text style={styles.muted}>Opsional. Pilih berkas yang membantu dokter memahami kondisi ternak.</Text>
              {attachments.map((attachment) => <View key={attachment.id} style={styles.attachment}>
                {attachment.kind === 'image' ? <Image source={{ uri: attachment.localUri }} accessibilityLabel={attachment.filename} style={styles.thumbnail} /> : <Icon name="file-text" />}
                <View style={styles.attachmentText}><Text style={styles.body}>{attachment.filename}</Text><Text style={styles.muted}>{attachment.kind === 'video' ? 'Video' : 'Foto'} · {Math.ceil(attachment.byteSize / 1024)} KB</Text></View>
                <Pressable accessibilityRole="button" accessibilityLabel={`Hapus ${attachment.filename}`} disabled={busy} onPress={() => change({ attachmentIds: input.attachmentIds.filter((id) => id !== attachment.id) })} style={styles.iconButton}><Icon name="x" /></Pressable>
              </View>)}
              <Button role="farmer" label="Pilih foto atau video" variant="secondary" disabled={busy} onPress={() => void run(async () => {
                const draft = await store.booking.pickMedia(userId, context.draft, input);
                if (!draft) return;
                setContext({ ...context, draft }); setInput(draft.input);
                const nextAttachments = await store.booking.attachments(userId, draft.id);
                setContext({ ...context, draft, attachments: nextAttachments }); setInput(draft.input); setNotice('Lampiran dan draft tersimpan.');
              })} />
            </View>
            <Text style={styles.muted}>* Wajib diisi. Simpan draft sebelum menutup aplikasi agar perubahan dapat dilanjutkan nanti.</Text>
            <Button role="farmer" label="Tinjau biaya" loading={busy} disabled={!ready || scheduleLoading} onPress={() => void run(async () => { const draft = await save(); const next = await store.booking.review(userId, draft); setReview(next); setNotice(''); })} />
            <Button role="farmer" label="Simpan draft" variant="secondary" disabled={busy} onPress={() => void run(async () => { await save(); })} />
            <Button role="farmer" label="Buang draft" variant="secondary" disabled={busy} onPress={() => setConfirmDiscard(true)} />
          </>}
        </>}
      </View>
    </ScrollView>
    {confirmBack || confirmDiscard ? <Modal transparent visible animationType="fade" onRequestClose={() => { if (!busy) { setConfirmBack(false); setConfirmDiscard(false); } }}>
      <SafeAreaProvider><SafeAreaView style={styles.overlay}><ScrollView contentContainerStyle={styles.dialogScroll}><View accessibilityViewIsModal style={styles.dialog}>
        <Text accessibilityRole="header" style={styles.heading}>{confirmDiscard ? 'Buang draft booking?' : 'Simpan perubahan booking?'}</Text><Text style={styles.body}>{confirmDiscard ? 'Detail dan lampiran dalam draft ini akan dibuang.' : 'Simpan draft untuk melanjutkan booking nanti.'}</Text>
        {error ? <InlineFeedback tone="error" message={error} /> : null}
        {!confirmDiscard ? <Button role="farmer" label="Simpan draft" loading={busy} onPress={() => void run(async () => { await save(); setConfirmBack(false); onBack(); })} /> : null}
        <Button role="farmer" label="Buang" variant="secondary" disabled={busy} onPress={discard} />
        <Button role="farmer" label="Tetap mengedit" variant="secondary" disabled={busy} onPress={() => { setConfirmBack(false); setConfirmDiscard(false); }} />
      </View></ScrollView></SafeAreaView></SafeAreaProvider>
    </Modal> : null}
  </View>;
}
function Choice({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={[styles.choice, selected && styles.selected]}><Text style={[styles.body, selected && styles.selectedText]}>{label}</Text></Pressable>;
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Booking belum dapat disimpan. Coba lagi.'; }
const styles = StyleSheet.create({
  flex: { flex: 1 }, scroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: layout.contentHorizontal, paddingTop: spacing[3], paddingBottom: spacing[6] }, page: { width: '100%', maxWidth: 430, gap: spacing[3] },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] }, title: { flex: 1, fontFamily: fonts.bold, fontSize: typeScale.heading, color: colors.dark, textAlign: 'center' }, iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  card: { padding: spacing[4], borderRadius: radii.cardFarmer, backgroundColor: colors.white, gap: spacing[3] }, heading: { fontFamily: fonts.semiBold, fontSize: typeScale.section, color: colors.dark }, label: { fontFamily: fonts.semiBold, fontSize: typeScale.body, color: colors.dark },
  body: { fontFamily: fonts.regular, fontSize: typeScale.body, color: colors.dark, lineHeight: 22 }, muted: { fontFamily: fonts.regular, fontSize: typeScale.small, color: colors.muted, lineHeight: 19 }, price: { fontFamily: fonts.bold, color: colors.brown, fontSize: typeScale.heading },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] }, choice: { minHeight: 44, justifyContent: 'center', padding: spacing[3], borderWidth: 1, borderColor: colors.gold, borderRadius: radii.button }, selected: { backgroundColor: colors.brown, borderColor: colors.brown }, selectedText: { color: colors.white },
  input: { minHeight: 52, padding: spacing[3], borderWidth: 1, borderColor: colors.gold, borderRadius: radii.button, fontFamily: fonts.regular, fontSize: typeScale.body, color: colors.dark }, multiline: { minHeight: 112, textAlignVertical: 'top' },
  attachment: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] }, attachmentText: { flex: 1, minWidth: 0 }, thumbnail: { width: 56, height: 56, borderRadius: radii.button },
  overlay: { flex: 1, backgroundColor: 'rgba(58,23,13,0.45)' }, dialogScroll: { flexGrow: 1, justifyContent: 'center', padding: spacing[4] }, dialog: { width: '100%', maxWidth: 430, alignSelf: 'center', padding: spacing[4], borderRadius: radii.cardFarmer, backgroundColor: colors.cream, gap: spacing[3] },
});
