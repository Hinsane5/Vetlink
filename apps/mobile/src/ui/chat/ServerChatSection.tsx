import { useCallback, useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import type { ApiChatMessage, ApiChatMessagePage } from '../../application/ports/ApiChatRepository';
import type { ApiConsultationDetail } from '../../application/ports/ApiConsultationRepository';
import type { ServerChatService } from '../../application/ServerChatService';
import type { AccountRole } from '../../domain/auth';
import { Button } from '../components/Button';
import { LoadingState } from '../components/Feedback';
import { TextArea } from '../components/TextField';
import { colors, fonts, spacing, typeScale } from '../theme/tokens';

type Props = {
  service: ServerChatService;
  role: AccountRole;
  userId: string;
  consultation: ApiConsultationDetail;
  onExit: () => void;
  backHandlerRef: { current: (() => boolean) | null };
};

export function ServerChatSection({ service, role, userId, consultation, onExit, backHandlerRef }: Props) {
  const [messages, setMessages] = useState<ApiChatMessage[]>([]);
  const [pending, setPending] = useState<{ clientMessageId: string; text: string } | null>(null);
  const [text, setText] = useState('');
  const [savedDraft, setSavedDraft] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyMessageId, setBusyMessageId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [leaveVisible, setLeaveVisible] = useState(false);

  const reload = useCallback(async (preserveComposer = true) => {
    setLoading(true); setError('');
    try {
      const page = await service.list(role, userId, consultation);
      const savedPending = await service.getPending(role, userId, consultation);
      const draft = await service.readDraft(role, userId, consultation);
      setMessages(page.items); setCursor(page.nextCursor); setHasMore(page.hasMore); setPending(savedPending);
      if (!preserveComposer || savedPending) {
        const nextText = savedPending?.text ?? draft ?? '';
        setText(nextText); setSavedDraft(savedPending ? '' : draft ?? '');
      } else {
        setSavedDraft(draft ?? '');
      }
    } catch (cause) { setError(messageFor(cause, 'Pesan belum dapat dimuat.')); }
    finally { setLoading(false); }
  }, [consultation, role, service, userId]);

  useEffect(() => {
    const request = setTimeout(() => { void reload(false); }, 0);
    return () => clearTimeout(request);
  }, [reload]);

  const loadOlder = async () => {
    if (!cursor || loading || busy) return;
    setLoading(true); setError('');
    try {
      const page: ApiChatMessagePage = await service.list(role, userId, consultation, cursor);
      setMessages((current) => mergeMessages(page.items, current));
      setCursor(page.nextCursor); setHasMore(page.hasMore);
    } catch (cause) { setError(messageFor(cause, 'Pesan sebelumnya belum dapat dimuat.')); }
    finally { setLoading(false); }
  };

  const send = async () => {
    if (busy || loading || !text.trim() || text.length > 4000) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const sent = await service.send(role, userId, consultation, text);
      setMessages((current) => mergeMessages(current, [sent]));
      setText(''); setSavedDraft(''); setPending(null);
      setNotice(sent.deliveryStatus === 'failed' ? 'Pesan tersimpan, tetapi pengiriman gagal. Coba ulang dari pesan.' : 'Pesan tersimpan di server.');
      void reload(false);
    } catch (cause) {
      setError(messageFor(cause, 'Pesan belum terkirim. Pertahankan isi pesan dan muat ulang sebelum mencoba lagi.'));
      try { const next = await service.getPending(role, userId, consultation); setPending(next); if (next) setText(next.text); }
      catch { /* Keep the composer text visible if secure storage cannot be read. */ }
    } finally { setBusy(false); }
  };

  const retryFailed = async (message: ApiChatMessage) => {
    if (busy || loading || busyMessageId) return;
    setBusyMessageId(message.id); setError(''); setNotice('');
    try {
      const retried = await service.retryFailed(role, userId, consultation, message);
      setMessages((current) => current.map((row) => row.id === retried.id ? retried : row));
      setNotice(retried.deliveryStatus === 'sent' ? 'Pesan berhasil dikirim.' : 'Percobaan ulang belum terkirim.');
    } catch (cause) { setError(messageFor(cause, 'Pesan gagal dicoba ulang. Muat ulang sebelum mencoba lagi.')); }
    finally { setBusyMessageId(''); }
  };

  const requestExit = useCallback(() => {
    if (busy || loading || busyMessageId) return true;
    if (leaveVisible) { setLeaveVisible(false); return true; }
    if (pending) { onExit(); return true; }
    if (text.trim() && text !== savedDraft) { setLeaveVisible(true); return true; }
    onExit(); return true;
  }, [busy, busyMessageId, leaveVisible, loading, onExit, pending, savedDraft, text]);

  useEffect(() => {
    backHandlerRef.current = requestExit;
    return () => { backHandlerRef.current = null; };
  }, [backHandlerRef, requestExit]);

  const saveDraftAndExit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await service.saveDraft(role, userId, consultation, text);
      setLeaveVisible(false); onExit();
    } catch (cause) { setError(messageFor(cause, 'Draft pesan belum tersimpan.')); }
    finally { setBusy(false); }
  };

  const discardAndExit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await service.saveDraft(role, userId, consultation, '');
      setText(''); setSavedDraft(''); setLeaveVisible(false); onExit();
    } catch (cause) { setError(messageFor(cause, 'Draft pesan belum dapat dibuang.')); }
    finally { setBusy(false); }
  };

  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>Chat server · {consultation.displayCode}</Text>
    <Button label="Kembali ke konsultasi" role={role} variant="secondary" disabled={busy || loading} onPress={requestExit} />
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    <View style={styles.toolbar}>
      <Text style={styles.helper}>Pesan disegarkan dari server. Mode ini mengirim teks; lampiran belum tersedia.</Text>
      <Button label="Muat ulang pesan" role={role} variant="secondary" disabled={busy || loading} onPress={() => void reload(true)} />
    </View>
    {hasMore && cursor ? <Button label="Muat pesan sebelumnya" role={role} variant="secondary" disabled={busy || loading} onPress={() => void loadOlder()} /> : null}
    {loading ? <LoadingState label="Memuat pesan…" /> : null}
    {!loading && messages.length === 0 ? <Text style={styles.helper}>Belum ada pesan pada konsultasi ini.</Text> : null}
    {messages.map((message) => <View key={message.id} style={[styles.message, message.senderId === userId ? styles.ownMessage : styles.otherMessage]}>
      <Text style={styles.messageSender}>{message.senderId === userId ? 'Anda' : role === 'farmer' ? 'Dokter Hewan' : 'Peternak'}</Text>
      {message.text ? <Text style={styles.messageText}>{message.text}</Text> : null}
      {message.attachments.length ? <Text style={styles.helper}>Lampiran: {message.attachments.map((item) => item.filename).join(', ')}. Lihat file belum tersedia di layar ini.</Text> : null}
      <Text style={styles.messageMeta}>{formatDate(message.createdAt)} · {deliveryLabel(message.deliveryStatus)}</Text>
      {message.deliveryStatus === 'failed' && message.senderId === userId ? <Button label={busyMessageId === message.id ? 'Mencoba ulang…' : 'Coba kirim lagi'} role={role} variant="secondary" disabled={busy || loading || !!busyMessageId} onPress={() => void retryFailed(message)} /> : null}
    </View>)}
    {pending ? <Text style={styles.helper}>Pengiriman belum pasti. Simpanan lokal menjaga ID pesan dan teks yang sama; retry akan memakai operasi itu.</Text> : null}
    <TextArea label="Pesan" value={text} onChangeText={setText} placeholder="Tulis pesan untuk konsultasi ini" editable={!busy && !pending} maxLength={4000} helperText={`${text.length}/4000`} />
    <Button label={pending ? 'Coba ulang pesan tertunda' : 'Kirim pesan'} role={role} loading={busy} disabled={loading || !text.trim() || text.length > 4000 || (!!pending && text !== pending.text)} onPress={() => void send()} />
    <Modal transparent visible={leaveVisible} animationType="fade" onRequestClose={() => setLeaveVisible(false)}>
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.dialogTitle}>Pesan belum dikirim</Text>
          <Text style={styles.messageText}>Simpan sebagai draft, buang, atau lanjutkan menulis?</Text>
          <Button label="Simpan Draft" role={role} loading={busy} onPress={() => void saveDraftAndExit()} />
          <Button label="Buang" role={role} variant="secondary" disabled={busy} onPress={() => void discardAndExit()} />
          <Button label="Tetap Mengedit" role={role} variant="secondary" disabled={busy} onPress={() => setLeaveVisible(false)} />
        </View>
      </View>
    </Modal>
  </View>;
}

function mergeMessages(left: ApiChatMessage[], right: ApiChatMessage[]): ApiChatMessage[] {
  const messages = new Map<string, ApiChatMessage>();
  for (const item of [...left, ...right]) messages.set(item.id, item);
  return [...messages.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
function deliveryLabel(status: ApiChatMessage['deliveryStatus']): string { return status === 'sent' ? 'Terkirim' : status === 'failed' ? 'Gagal' : 'Menunggu'; }
function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(date);
}
function messageFor(cause: unknown, fallback: string): string { return cause instanceof Error ? cause.message : fallback; }

const styles = StyleSheet.create({
  section: { gap: spacing[3] },
  heading: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.section },
  toolbar: { gap: spacing[2] },
  message: { maxWidth: '92%', gap: spacing[2], padding: spacing[3], borderRadius: 14 },
  ownMessage: { alignSelf: 'flex-end', backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.gold },
  otherMessage: { alignSelf: 'flex-start', backgroundColor: colors.white },
  messageSender: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.small },
  messageText: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21 },
  messageMeta: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small },
  helper: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 19 },
  error: { color: colors.orange, fontFamily: fonts.medium, fontSize: typeScale.body },
  notice: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.body },
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing[5], backgroundColor: 'rgba(58, 23, 13, 0.48)' },
  dialog: { alignSelf: 'center', width: '100%', maxWidth: 360, padding: spacing[5], gap: spacing[3], borderRadius: 16, backgroundColor: colors.white },
  dialogTitle: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.heading },
});
