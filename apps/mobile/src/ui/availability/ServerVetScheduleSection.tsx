import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import type { ServerVetScheduleService } from '../../application/ServerVetScheduleService';
import type { ApiVetAvailability, ApiVetBlockedTime, ApiVetSchedule } from '../../application/ports/ApiVetScheduleRepository';
import { calendarDays, entriesOnDate, localDisplay, localTimestamp, shiftDate, validateAvailability, weekdays, type AvailabilityInput, type CalendarEntry } from '../../domain/availability';
import { Button } from '../components/Button';
import { EmptyState, LoadingState } from '../components/Feedback';
import { TextField } from '../components/TextField';
import { colors, fonts, spacing, typeScale } from '../theme/tokens';

type Props = {
  service: ServerVetScheduleService;
  userId: string;
  onExit: () => void;
  backHandlerRef: { current: (() => boolean) | null };
};

const timezones = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'];
const blankAvailability = (): AvailabilityInput => ({ accepting: false, timezone: 'Asia/Jakarta', services: [], rules: [], chatDuration: '30', visitDuration: '60', chatFee: '0', visitFee: '0', blocks: [] });

/** API backed schedule/calendar. It never reads the local SQLite availability store. */
export function ServerVetScheduleSection({ service, userId, onExit, backHandlerRef }: Props) {
  const [availability, setAvailability] = useState<ApiVetAvailability | null>(null);
  const [blocks, setBlocks] = useState<ApiVetBlockedTime[]>([]);
  const [schedule, setSchedule] = useState<ApiVetSchedule | null>(null);
  const [value, setValue] = useState<AvailabilityInput>(blankAvailability);
  const [saved, setSaved] = useState<AvailabilityInput>(blankAvailability);
  const [date, setDate] = useState(() => localDisplay(new Date().toISOString(), 'Asia/Jakarta').slice(0, 10));
  const [mode, setMode] = useState<'day' | 'week'>('week');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [leavePrompt, setLeavePrompt] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  const days = useMemo(() => calendarDays(date, mode), [date, mode]);
  const shownEntries = useMemo(() => entriesOnDate(toCalendarEntries(schedule), date, availability?.timezone ?? value.timezone), [availability?.timezone, date, schedule, value.timezone]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const current = await service.ownAvailability('vet', userId);
      const currentBlocks = await service.ownBlockedTimes('vet', userId);
      const timezone = current?.timezone ?? 'Asia/Jakarta';
      const nextValue = current ? formFromApi(current, currentBlocks) : blankAvailability();
      nextValue.timezone = timezone;
      const week = calendarDays(date, mode);
      const from = localTimestamp(`${week[0]} 00:00`, timezone);
      const to = localTimestamp(`${shiftDate(week[week.length - 1], 1)} 00:00`, timezone);
      const nextSchedule = current ? await service.ownSchedule('vet', userId, from, to) : null;
      setAvailability(current); setBlocks(currentBlocks); setSchedule(nextSchedule);
      setValue(nextValue); setSaved(nextValue); setUncertain(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Jadwal belum dapat dimuat.');
      setSchedule(null);
    } finally { setLoading(false); }
  }, [date, mode, service, userId]);

  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);

  const leave = useCallback(() => {
    if (busy) return true;
    if (editing && dirty) { setLeavePrompt(true); return true; }
    if (editing) { setEditing(false); return true; }
    onExit(); return true;
  }, [busy, dirty, editing, onExit]);
  useEffect(() => { backHandlerRef.current = leave; return () => { backHandlerRef.current = null; }; }, [backHandlerRef, leave]);

  const setField = <K extends keyof AvailabilityInput>(key: K, next: AvailabilityInput[K]) => setValue((current) => ({ ...current, [key]: next }));
  const refresh = async () => { if (busy) return; await load(); };

  const save = async () => {
    if (busy || uncertain) return;
    setBusy(true); setError(''); setNotice('');
    let mutationStarted = false;
    try {
      const parsed = validateAvailability(value, ['chat', 'visit']);
      const previous = formAvailabilityOnly(saved);
      const next = formAvailabilityOnly(value);
      let updated = availability;
      if (JSON.stringify(previous) !== JSON.stringify(next) || !availability) {
        mutationStarted = true;
        const result = await service.saveOwnAvailability('vet', userId, {
          expectedVersion: availability?.version ?? 1,
          acceptingNewRequests: parsed.acceptingNewRequests,
          services: parsed.services,
          timezone: value.timezone,
          weekdayRules: parsed.weekdayRules,
          chatDurationMinutes: Number(value.chatDuration),
          visitDurationMinutes: Number(value.visitDuration),
          rates: { chat: parsed.chatFee, visit: parsed.visitFee },
          experienceYears: availability?.experienceYears ?? 0,
          specialties: availability?.specialties ?? [],
          species: availability?.species ?? [],
          practiceLocation: availability?.practiceLocation ?? '',
          serviceAreas: availability?.serviceAreas ?? [],
        });
        updated = result.value;
      }

      const byId = new Map(blocks.map((block) => [block.id, block]));
      const keptIds = new Set<string>();
      for (const block of parsed.blocks) {
        const startsAt = block.startsAt; const endsAt = block.endsAt;
        if (!block.id) {
          mutationStarted = true;
          await service.createOwnBlockedTime('vet', userId, { startsAt, endsAt, reason: block.reason });
          continue;
        }
        const existing = byId.get(block.id);
        if (!existing || existing.status !== 'active') continue;
        keptIds.add(existing.id);
        if (existing.startsAt !== startsAt || existing.endsAt !== endsAt || existing.reason !== block.reason) {
          mutationStarted = true;
          await service.updateOwnBlockedTime('vet', userId, existing.id, { startsAt, endsAt, reason: block.reason, expectedVersion: existing.version });
        }
      }
      for (const existing of blocks) {
        if (existing.status === 'active' && !keptIds.has(existing.id)) {
          mutationStarted = true;
          await service.cancelOwnBlockedTime('vet', userId, existing.id, existing.version);
        }
      }

      setAvailability(updated); setEditing(false); setNotice('Jadwal tersimpan di server.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Perubahan jadwal belum dapat dipastikan.');
      setUncertain(mutationStarted);
    } finally { setBusy(false); }
  };

  if (loading) return <View style={styles.section}><Button label="Kembali ke akun" role="vet" variant="secondary" onPress={onExit} /><LoadingState label="Memuat jadwal server…" /></View>;

  return <View style={styles.section}>
    <Button label="Kembali ke akun" role="vet" variant="secondary" onPress={leave} disabled={busy} />
    <Text accessibilityRole="header" style={styles.heading}>Jadwal Dokter</Text>
    {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    {error && !uncertain ? <Button label="Muat ulang jadwal" role="vet" variant="secondary" disabled={busy} onPress={() => void refresh()} /> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {uncertain ? <Text style={styles.body}>Hasil simpan belum pasti. Muat ulang jadwal sebelum mencoba perubahan lagi.</Text> : null}
    {uncertain ? <Button label="Muat ulang jadwal" role="vet" variant="secondary" disabled={busy} onPress={() => void refresh()} /> : null}
    {!availability ? <EmptyState role="vet" title="Jadwal belum disiapkan" description="Atur layanan, jam kerja, tarif, dan zona waktu agar slot dapat dibaca dari server." actionLabel="Atur ketersediaan" onAction={() => { setEditing(true); setError(''); }} /> : null}

    {availability && !editing ? <>
      <View style={styles.card}>
        <Text style={styles.body}>Zona waktu: {availability.timezone.replace('Asia/', '')}</Text>
        <Text style={styles.body}>Permintaan baru: {availability.acceptingNewRequests ? 'Diterima' : 'Tidak diterima'}</Text>
        <View style={styles.row}>
          <Button label="Minggu" role="vet" variant={mode === 'week' ? 'primary' : 'secondary'} selected={mode === 'week'} onPress={() => setMode('week')} />
          <Button label="Hari" role="vet" variant={mode === 'day' ? 'primary' : 'secondary'} selected={mode === 'day'} onPress={() => setMode('day')} />
          <Button label="Hari ini" role="vet" variant="secondary" onPress={() => setDate(localDisplay(new Date().toISOString(), availability.timezone).slice(0, 10))} />
        </View>
        <View style={styles.row}>
          <Button label="‹ Sebelumnya" role="vet" variant="secondary" onPress={() => setDate(shiftDate(date, mode === 'week' ? -7 : -1))} />
          <Button label="Berikutnya ›" role="vet" variant="secondary" onPress={() => setDate(shiftDate(date, mode === 'week' ? 7 : 1))} />
        </View>
        {mode === 'week' ? <View style={styles.row}>{days.map((day) => <Button key={day} label={`${weekdays[new Date(`${day}T00:00:00Z`).getUTCDay()].slice(0, 3)} ${day.slice(-2)}`} role="vet" variant={day === date ? 'primary' : 'secondary'} selected={day === date} onPress={() => setDate(day)} />)}</View> : null}
      </View>
      {shownEntries.map((entry) => <View key={`${entry.kind}-${entry.id}`} style={styles.card}>
        <Text style={styles.cardTitle}>{entry.title}</Text>
        <Text style={styles.body}>{formatRange(entry.startsAt, entry.endsAt, availability.timezone)}</Text>
        <Text style={styles.body}>{entry.description}</Text>
      </View>)}
      {!shownEntries.length ? <EmptyState title="Tidak ada agenda" description="Janji, tindak lanjut, dan blok waktu server akan tampil di sini." /> : null}
      <Button label="Atur ketersediaan dan tarif" role="vet" variant="secondary" disabled={uncertain} onPress={() => { setValue(saved); setEditing(true); setError(''); setNotice(''); }} />
    </> : null}

    {editing ? <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Ketersediaan dan zona waktu</Text>
        <Button label={value.accepting ? 'Menerima permintaan baru' : 'Tidak menerima permintaan baru'} role="vet" variant={value.accepting ? 'primary' : 'secondary'} selected={value.accepting} disabled={busy} onPress={() => setField('accepting', !value.accepting)} />
        <View style={styles.row}>{[...new Set([...timezones, value.timezone])].map((zone) => <Button key={zone} label={zone.replace('Asia/', '')} role="vet" variant={value.timezone === zone ? 'primary' : 'secondary'} selected={value.timezone === zone} disabled={busy} onPress={() => setField('timezone', zone)} />)}</View>
        <View style={styles.row}>
          {(['chat', 'visit'] as const).map((kind) => <Button key={kind} label={`${value.services.includes(kind) ? 'Aktif' : 'Nonaktif'} · ${kind === 'chat' ? 'Chat' : 'Kunjungan'}`} role="vet" variant={value.services.includes(kind) ? 'primary' : 'secondary'} selected={value.services.includes(kind)} disabled={busy} onPress={() => setField('services', value.services.includes(kind) ? value.services.filter((serviceKind) => serviceKind !== kind) : [...value.services, kind])} />)}
        </View>
        <TextField label="Durasi chat · menit" value={value.chatDuration} keyboardType="number-pad" editable={!busy} onChangeText={(text) => setField('chatDuration', text)} />
        <TextField label="Tarif chat · rupiah" value={value.chatFee} keyboardType="number-pad" editable={!busy} onChangeText={(text) => setField('chatFee', text)} />
        <TextField label="Durasi kunjungan · menit" value={value.visitDuration} keyboardType="number-pad" editable={!busy} onChangeText={(text) => setField('visitDuration', text)} />
        <TextField label="Tarif kunjungan · rupiah" value={value.visitFee} keyboardType="number-pad" editable={!busy} onChangeText={(text) => setField('visitFee', text)} />
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Jam kerja mingguan</Text>
        {weekdays.map((weekdayName, weekday) => <View key={weekday} style={styles.group}>
          <Text style={styles.body}>{weekdayName}</Text>
          {value.rules.filter((rule) => rule.weekday === weekday).map((rule) => {
            const index = value.rules.indexOf(rule);
            return <View key={`${weekday}-${index}`} style={styles.block}>
              <TextField label="Mulai · HH:mm" value={rule.start} editable={!busy} onChangeText={(start) => setField('rules', value.rules.map((item, i) => i === index ? { ...item, start } : item))} />
              <TextField label="Selesai · HH:mm" value={rule.end} editable={!busy} onChangeText={(end) => setField('rules', value.rules.map((item, i) => i === index ? { ...item, end } : item))} />
              <Button label="Hapus jam" role="vet" variant="secondary" disabled={busy} onPress={() => setField('rules', value.rules.filter((_, i) => i !== index))} />
            </View>;
          })}
          {!value.rules.some((rule) => rule.weekday === weekday) ? <Button label={`Tambah jam · ${weekdayName}`} role="vet" variant="secondary" disabled={busy} onPress={() => setField('rules', [...value.rules, { weekday, start: '09:00', end: '17:00' }])} /> : null}
        </View>)}
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Blok waktu</Text>
        <Text style={styles.body}>Isi waktu lokal sesuai zona waktu. Blok yang bertabrakan dengan layanan atau tindak lanjut akan ditolak server.</Text>
        {value.blocks.map((block, index) => <View key={block.id || `new-${index}`} style={styles.block}>
          <TextField label="Mulai · YYYY-MM-DD HH:mm" value={block.start} editable={!busy} onChangeText={(start) => setField('blocks', value.blocks.map((item, i) => i === index ? { ...item, start } : item))} />
          <TextField label="Selesai · YYYY-MM-DD HH:mm" value={block.end} editable={!busy} onChangeText={(end) => setField('blocks', value.blocks.map((item, i) => i === index ? { ...item, end } : item))} />
          <TextField label="Alasan" value={block.reason} maxLength={500} editable={!busy} onChangeText={(reason) => setField('blocks', value.blocks.map((item, i) => i === index ? { ...item, reason } : item))} />
          <Button label="Hapus blok" role="vet" variant="secondary" disabled={busy} onPress={() => setField('blocks', value.blocks.filter((_, i) => i !== index))} />
        </View>)}
        <Button label="Tambah blok waktu" role="vet" variant="secondary" disabled={busy || value.blocks.length >= 50} onPress={() => setField('blocks', [...value.blocks, { id: '', version: 0, start: '', end: '', reason: '' }])} />
      </View>
      <Button label="Simpan jadwal" role="vet" loading={busy} disabled={uncertain} onPress={() => void save()} />
      <Button label="Batal" role="vet" variant="secondary" disabled={busy} onPress={() => dirty ? setLeavePrompt(true) : setEditing(false)} />
    </> : null}

    <Modal visible={leavePrompt} transparent animationType="fade" onRequestClose={() => { if (!busy) setLeavePrompt(false); }}>
      <View style={styles.backdrop}><View style={styles.dialog}>
        <Text style={styles.cardTitle}>Perubahan belum disimpan</Text>
        <Text style={styles.body}>Simpan perubahan, buang, atau tetap mengedit jadwal.</Text>
        <Button label="Tetap mengedit" role="vet" variant="secondary" disabled={busy} onPress={() => setLeavePrompt(false)} />
        <Button label="Buang perubahan" role="vet" variant="secondary" disabled={busy} onPress={() => { setValue(saved); setLeavePrompt(false); setEditing(false); }} />
        <Button label="Simpan perubahan" role="vet" loading={busy} onPress={() => { setLeavePrompt(false); void save(); }} />
      </View></View>
    </Modal>
  </View>;
}

function formFromApi(value: ApiVetAvailability, blocks: ApiVetBlockedTime[]): AvailabilityInput {
  return {
    accepting: value.acceptingNewRequests, timezone: value.timezone, services: [...value.services],
    rules: value.weekdayRules.map((rule) => ({ ...rule })), chatDuration: String(value.chatDurationMinutes), visitDuration: String(value.visitDurationMinutes),
    chatFee: String(value.rates.chat ?? 0), visitFee: String(value.rates.visit ?? 0),
    blocks: blocks.filter((block) => block.status === 'active').map((block) => ({ id: block.id, version: block.version,
      start: localDisplay(block.startsAt, value.timezone), end: localDisplay(block.endsAt, value.timezone), reason: block.reason })),
  };
}

function formAvailabilityOnly(value: AvailabilityInput) {
  const { blocks: _blocks, ...availability } = value;
  return availability;
}

function toCalendarEntries(schedule: ApiVetSchedule | null): CalendarEntry[] {
  if (!schedule) return [];
  return [
    ...schedule.appointments.map((item) => ({ id: item.id, kind: 'consultation' as const, title: `${item.displayCode} · ${item.service === 'chat' ? 'Konsultasi chat' : 'Kunjungan'}`,
      description: `Status: ${item.status}`, status: item.status, startsAt: item.startsAt, endsAt: item.endsAt, consultationId: item.id })),
    ...schedule.followUps.map((item) => ({ id: item.id, kind: 'followUp' as const, title: 'Tindak lanjut', description: item.reason,
      status: item.status, startsAt: item.startsAt, endsAt: item.endsAt, consultationId: item.consultationId, animalId: item.animalId })),
    ...schedule.blockedTimes.map((item) => ({ id: item.id, kind: 'blockedTime' as const, title: 'Waktu diblokir', description: item.reason,
      status: item.status, startsAt: item.startsAt, endsAt: item.endsAt })),
  ];
}

function formatRange(start: string, end: string, timezone: string) {
  const options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: timezone };
  const endOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', timeZone: timezone };
  return `${new Intl.DateTimeFormat('id-ID', options).format(new Date(start))} – ${new Intl.DateTimeFormat('id-ID', endOptions).format(new Date(end))}`;
}

const styles = StyleSheet.create({
  section: { gap: spacing[4] },
  heading: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.section },
  cardTitle: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.body },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21 },
  error: { color: colors.orange, fontFamily: fonts.medium, fontSize: typeScale.body },
  notice: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.body },
  card: { gap: spacing[3], padding: spacing[4], borderRadius: 14, backgroundColor: colors.white },
  group: { gap: spacing[2], paddingTop: spacing[2] },
  block: { gap: spacing[2], paddingTop: spacing[3], borderTopWidth: 1, borderTopColor: colors.cream },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing[5], backgroundColor: 'rgba(58,23,13,.5)' },
  dialog: { gap: spacing[3], padding: spacing[5], borderRadius: 18, backgroundColor: colors.white },
});
