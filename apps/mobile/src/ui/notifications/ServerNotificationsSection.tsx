import { useCallback, useEffect, useRef, useState } from 'react';
import { Switch, StyleSheet, Text, View } from 'react-native';
import type { ApiNotification, ApiNotificationCategory, ApiNotificationContext, ApiNotificationPreferences } from '../../application/ports/ApiNotificationsRepository';
import type { ServerNotificationContext, ServerNotificationContextService } from '../../application/ServerNotificationContextService';
import type { ServerNotificationsService } from '../../application/ServerNotificationsService';
import type { AccountRole } from '../../domain/auth';
import { DomainError } from '../../domain/errors';
import { Button } from '../components/Button';
import { LoadingState } from '../components/Feedback';
import { colors, fonts, roleTokens, spacing, typeScale } from '../theme/tokens';

type Page = 'inbox' | 'preferences';
type Props = {
  service: ServerNotificationsService;
  contextService: ServerNotificationContextService;
  role: AccountRole;
  onExit: () => void;
  backHandlerRef: { current: (() => boolean) | null };
};

const categories: { id: ApiNotificationCategory; title: string; description: string }[] = [
  { id: 'consultations', title: 'Konsultasi dan jadwal', description: 'Permintaan, perubahan jadwal, dan pesan layanan.' },
  { id: 'reminders', title: 'Pengingat perawatan', description: 'Pengingat terjadwal dan pembaruan tindak lanjut.' },
  { id: 'commerce', title: 'Pesanan dan pembayaran', description: 'Perubahan status pesanan serta pembayaran.' },
];

const contextLabels: Record<ApiNotificationContext, string> = {
  follow_up: 'Tindak lanjut', progress_report: 'Laporan perkembangan', reminder: 'Pengingat',
};

export function ServerNotificationsSection({ service, contextService, role, onExit, backHandlerRef }: Props) {
  const [page, setPage] = useState<Page>('inbox');
  const [items, setItems] = useState<ApiNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [preferences, setPreferences] = useState<ApiNotificationPreferences | null>(null);
  const [openedContext, setOpenedContext] = useState<{ id: string; type: ApiNotificationContext } | null>(null);
  const [contextResource, setContextResource] = useState<ServerNotificationContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const contextRequest = useRef(0);

  const loadContext = async (context: { id: string; type: ApiNotificationContext }) => {
    const request = ++contextRequest.current;
    setContextLoading(true);
    setContextResource(null);
    setError('');
    try {
      const resource = await contextService.get(role, context.type, context.id);
      if (contextRequest.current === request) setContextResource(resource);
    } catch (cause) {
      if (contextRequest.current === request) setError(messageFor(cause, 'Konteks pembaruan belum dapat dimuat.'));
    } finally {
      if (contextRequest.current === request) setContextLoading(false);
    }
  };

  const closeContext = useCallback(() => {
    contextRequest.current++;
    setOpenedContext(null);
    setContextResource(null);
    setContextLoading(false);
  }, []);

  const reloadInbox = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await service.list(role);
      setItems(result.items);
      setUnreadCount(result.unreadCount);
      setUncertain(false);
    } catch (cause) {
      setError(messageFor(cause, 'Kotak masuk belum dapat dimuat.'));
    } finally { setLoading(false); }
  }, [role, service]);

  const reloadPreferences = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPreferences(await service.getPreferences(role));
      setUncertain(false);
    } catch (cause) {
      setError(messageFor(cause, 'Preferensi belum dapat dimuat.'));
    } finally { setLoading(false); }
  }, [role, service]);

  useEffect(() => {
    const request = setTimeout(() => { void (page === 'inbox' ? reloadInbox() : reloadPreferences()); }, 0);
    return () => clearTimeout(request);
  }, [page, reloadInbox, reloadPreferences]);

  const back = useCallback(() => {
    if (busy && !(openedContext && contextLoading)) return true;
    if (openedContext) { closeContext(); return true; }
    if (page === 'preferences') { setPage('inbox'); setError(''); setNotice(''); return true; }
    onExit();
    return true;
  }, [busy, closeContext, contextLoading, onExit, openedContext, page]);

  useEffect(() => {
    backHandlerRef.current = back;
    return () => { backHandlerRef.current = null; };
  }, [back, backHandlerRef]);

  const openItem = async (item: ApiNotification) => {
    if (busy || uncertain) return;
    setError(''); setNotice('');
    if (!item.contextId || !item.contextType) {
      setNotice('Pembaruan ini belum memiliki konteks yang dapat dibuka.');
      return;
    }
    setBusy(true);
    try {
      const context = item.readAt
        ? { id: item.contextId, type: item.contextType }
        : await service.markRead(role, item.id).then((result) => {
          setItems((current) => current.map((row) => row.id === result.notification.id ? result.notification : row));
          setUnreadCount((count) => Math.max(0, count - 1));
          return { id: result.contextId, type: result.contextType };
        });
      setOpenedContext(context);
      await loadContext(context);
    } catch (cause) {
      setError(messageFor(cause, 'Status baca belum tersimpan. Muat ulang sebelum mencoba lagi.'));
      if (cause instanceof DomainError && cause.code === 'SERVICE_UNAVAILABLE') setUncertain(true);
    } finally { setBusy(false); }
  };

  const updatePreference = async (patch: {
    enabled?: boolean;
    notifications?: Partial<Record<ApiNotificationCategory, boolean>>;
  }) => {
    if (busy || uncertain) return;
    setBusy(true); setError(''); setNotice('');
    try {
      setPreferences(await service.updatePreferences(role, patch));
      setNotice('Preferensi tersimpan di akun server.');
    } catch (cause) {
      setError(messageFor(cause, 'Preferensi belum tersimpan. Muat ulang sebelum mencoba lagi.'));
      if (cause instanceof DomainError && cause.code === 'SERVICE_UNAVAILABLE') setUncertain(true);
    } finally { setBusy(false); }
  };

  const title = page === 'inbox' ? 'Kotak Masuk' : 'Preferensi notifikasi';
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>{title}</Text>
    <View style={styles.actions}>
      <Button label="Kotak Masuk" role={role} variant={page === 'inbox' ? 'primary' : 'secondary'} selected={page === 'inbox'} onPress={() => { closeContext(); setPage('inbox'); setError(''); setNotice(''); }} />
      <Button label="Preferensi" role={role} variant={page === 'preferences' ? 'primary' : 'secondary'} selected={page === 'preferences'} onPress={() => { closeContext(); setPage('preferences'); setError(''); setNotice(''); }} />
      <Button label="Kembali" role={role} variant="secondary" onPress={back} />
    </View>
    {page === 'inbox' ? <Text style={styles.body}>{unreadCount ? `${unreadCount} belum dibaca` : 'Semua pembaruan sudah dibaca'}</Text> : null}
    <Text style={styles.helper}>Preferensi mengatur pengiriman berikutnya; pembaruan yang tersimpan tetap ada di kotak masuk.</Text>
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {loading ? <LoadingState label={page === 'inbox' ? 'Memuat kotak masuk…' : 'Memuat preferensi…'} /> : null}
    {!loading && error && !openedContext ? <Button label={uncertain ? 'Muat ulang sebelum mencoba lagi' : 'Muat ulang'} role={role} variant="secondary" onPress={() => void (page === 'inbox' ? reloadInbox() : reloadPreferences())} /> : null}
    {!loading && page === 'inbox' && !error && items.length === 0 ? <Text style={styles.body}>Belum ada pembaruan untuk akun ini.</Text> : null}
    {!loading && page === 'inbox' && !openedContext && !error ? items.map((item) => <View key={item.id} style={[styles.card, item.readAt === null && styles.unread]}>
      <Text style={styles.cardTitle}>{item.title}</Text>
      <Text style={styles.body}>{item.body}</Text>
      <Text style={styles.meta}>{formatDate(item.createdAt)} · {item.readAt ? 'Sudah dibaca' : 'Belum dibaca'}</Text>
      {item.contextId && item.contextType ? <Button label={busy ? 'Membuka…' : item.readAt ? 'Buka pembaruan' : 'Tandai dibaca dan buka'} role={role} variant="secondary" disabled={busy || uncertain} onPress={() => void openItem(item)} /> : <Text style={styles.meta}>Konteks pembaruan tidak tersedia.</Text>}
    </View>) : null}
    {!loading && page === 'inbox' && openedContext ? <View style={styles.card}>
      <Text style={styles.cardTitle}>{contextLabels[openedContext.type]}</Text>
      {contextLoading ? <LoadingState label="Memuat detail server…" /> : null}
      {!contextLoading && contextResource ? <ContextDetails context={contextResource} /> : null}
      {!contextLoading && error ? <Button label="Muat ulang detail" role={role} variant="secondary" disabled={busy || contextLoading} onPress={() => { void loadContext(openedContext); }} /> : null}
      <Button label="Kembali ke kotak masuk" role={role} variant="secondary" disabled={busy} onPress={closeContext} />
    </View> : null}
    {!loading && page === 'preferences' && !error && preferences ? <>
      <PreferenceRow role={role} title="Semua notifikasi" description="Aktifkan atau nonaktifkan seluruh kategori." value={preferences.enabled} disabled={busy || uncertain} onChange={(enabled) => void updatePreference({ enabled })} />
      {categories.map((category) => <PreferenceRow key={category.id} role={role} title={category.title} description={category.description} value={preferences.notifications[category.id]} disabled={busy || uncertain} onChange={(enabled) => void updatePreference({ notifications: { [category.id]: enabled } })} />)}
    </> : null}
  </View>;
}

function PreferenceRow({ role, title, description, value, disabled, onChange }: { role: AccountRole; title: string; description: string; value: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <View style={styles.preference}>
    <View style={styles.preferenceCopy}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.helper}>{description}</Text>
    </View>
    <Switch accessibilityLabel={title} accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} value={value} disabled={disabled} onValueChange={onChange} trackColor={{ false: colors.muted, true: roleTokens[role].accent }} />
  </View>;
}

function ContextDetails({ context }: { context: ServerNotificationContext }) {
  if (context.type === 'follow_up') {
    const item = context.resource;
    return <>
      <Text style={styles.meta}>Status: {item.status === 'scheduled' ? 'Terjadwal' : item.status === 'completed' ? 'Selesai' : 'Dibatalkan'}</Text>
      <Text style={styles.body}>{formatContextDate(item.startsAt, item.timezone)} – {formatContextDate(item.endsAt, item.timezone)}</Text>
      <Text style={styles.body}>{item.reason}</Text>
      <Text selectable style={styles.meta}>ID layanan: {item.consultationId} · ID ternak: {item.animalId}</Text>
    </>;
  }
  if (context.type === 'progress_report') {
    const item = context.resource;
    return <>
      <Text style={styles.meta}>Dikirim {formatDate(item.submittedAt)}{item.viewedAt ? ' · sudah dibaca Dokter' : ' · menunggu dibaca Dokter'}</Text>
      <Text style={styles.body}>{item.text}</Text>
      {item.attachmentIds.length ? <Text style={styles.helper}>{item.attachmentIds.length} lampiran terkait. File tetap dilindungi akses layanan.</Text> : null}
      <Text selectable style={styles.meta}>ID tindak lanjut: {item.followUpId} · ID ternak: {item.animalId}</Text>
    </>;
  }
  const item = context.resource;
  return <>
    <Text style={styles.meta}>Jatuh tempo: {formatDate(item.dueAt)}</Text>
    <Text style={styles.body}>{item.instructions}</Text>
    <Text style={styles.meta}>Perawatan: {item.careStatus === 'done' ? 'Selesai' : 'Belum dikonfirmasi'} · Pengiriman: {item.deliveryStatus === 'sent' ? 'Terkirim' : item.deliveryStatus === 'failed' ? 'Gagal' : 'Menunggu'}</Text>
    <Text selectable style={styles.meta}>ID ternak: {item.animalId}</Text>
  </>;
}

function messageFor(cause: unknown, fallback: string): string { return cause instanceof Error ? cause.message : fallback; }
function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(date);
}
function formatContextDate(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(date);
  } catch {
    return value;
  }
}

const styles = StyleSheet.create({
  section: { gap: spacing[3] },
  heading: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.section },
  actions: { gap: spacing[2] },
  card: { gap: spacing[2], padding: spacing[4], backgroundColor: colors.white, borderRadius: 14 },
  unread: { borderWidth: 1, borderColor: colors.gold },
  cardTitle: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.body, lineHeight: 22 },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21 },
  helper: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 19 },
  meta: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 19 },
  error: { color: colors.orange, fontFamily: fonts.medium, fontSize: typeScale.body },
  notice: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.body },
  preference: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[3], backgroundColor: colors.white, borderRadius: 14 },
  preferenceCopy: { flex: 1, gap: spacing[1] },
});
