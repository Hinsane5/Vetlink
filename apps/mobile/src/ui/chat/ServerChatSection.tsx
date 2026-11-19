import { useCallback, useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ApiChatMessage, ApiChatMessagePage } from '../../application/ports/ApiChatRepository';
import type { ApiConsultationDetail } from '../../application/ports/ApiConsultationRepository';
import type { PendingServerChatMessage, ServerChatService } from '../../application/ServerChatService';
import type { AccountRole } from '../../domain/auth';
import type { SelectedAsset } from '../../domain/profiles';
import { Button } from '../components/Button';
import { LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
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
  const [pending, setPending] = useState<PendingServerChatMessage | null>(null);
  const [text, setText] = useState('');
  const [assets, setAssets] = useState<SelectedAsset[]>([]);
  const [savedDraft, setSavedDraft] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [busyMessageId, setBusyMessageId] = useState('');
  const [viewer, setViewer] = useState<{ filename: string; kind: 'image' | 'video'; localUri: string } | null>(null);
  const [viewerBusy, setViewerBusy] = useState(false);
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
        setAssets(savedPending ? savedPending.attachments?.map(({ file }) => ({
          ...file,
          kind: file.mimeType === 'video/mp4' ? 'video' : 'image',
        })) ?? [] : []);
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
    if (busy || loading || (!text.trim() && !assets.length) || text.length > 4000) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const sent = await service.sendWithMedia(role, userId, consultation, text, pending ? [] : assets);
      setMessages((current) => mergeMessages(current, [sent]));
      setText(''); setAssets([]); setSavedDraft(''); setPending(null);
      setNotice(sent.deliveryStatus === 'failed' ? 'Pesan tersimpan, tetapi pengiriman gagal. Coba ulang dari pesan.' : 'Pesan tersimpan di server.');
      void reload(false);
    } catch (cause) {
      setError(messageFor(cause, 'Pesan belum terkirim. Pertahankan isi pesan dan muat ulang sebelum mencoba lagi.'));
      try {
        const next = await service.getPending(role, userId, consultation);
        setPending(next);
        if (next) {
          setText(next.text);
          setAssets(next.attachments?.map(({ file }) => ({
            ...file,
            kind: file.mimeType === 'video/mp4' ? 'video' : 'image',
          })) ?? []);
        }
      }
      catch { /* Keep the composer text visible if secure storage cannot be read. */ }
    } finally { setBusy(false); }
  };

  const chooseMedia = async () => {
    if (busy || loading || pending || assets.length >= 5) return;
    setPickerBusy(true); setError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        selectionLimit: 5 - assets.length,
        quality: 1,
      });
      if (result.canceled) return;
      const selected: SelectedAsset[] = result.assets.map((asset) => {
        const kind = asset.type === 'video' ? 'video' : 'image';
        return {
          uri: asset.uri,
          filename: asset.fileName ?? (kind === 'video' ? 'video.mp4' : 'foto.jpg'),
          mimeType: asset.mimeType ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
          byteSize: asset.fileSize ?? null,
          kind,
        };
      });
      setAssets((current) => [...current, ...selected].slice(0, 5));
    } catch (cause) { setError(messageFor(cause, 'Foto atau video belum dapat dipilih.')); }
    finally { setPickerBusy(false); }
  };

  const openAttachment = async (message: ApiChatMessage, attachment: ApiChatMessage['attachments'][number]) => {
    if (viewerBusy || busy) return;
    setViewerBusy(true); setError('');
    try {
      const opened = await service.downloadAttachment(role, userId, consultation, message, attachment);
      setViewer({ filename: opened.attachment.filename, kind: opened.attachment.kind, localUri: opened.localUri });
    } catch (cause) { setError(messageFor(cause, 'Lampiran belum dapat dibuka.')); }
    finally { setViewerBusy(false); }
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
    if (busy || loading || pickerBusy || viewerBusy || busyMessageId) return true;
    if (viewer) { setViewer(null); return true; }
    if (leaveVisible) { setLeaveVisible(false); return true; }
    if (pending) { onExit(); return true; }
    if ((text.trim() && text !== savedDraft) || assets.length > 0) { setLeaveVisible(true); return true; }
    onExit(); return true;
  }, [assets.length, busy, busyMessageId, leaveVisible, loading, onExit, pending, pickerBusy, savedDraft, text, viewer, viewerBusy]);

  useEffect(() => {
    backHandlerRef.current = requestExit;
    return () => { backHandlerRef.current = null; };
  }, [backHandlerRef, requestExit]);

  const saveDraftAndExit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await service.saveDraft(role, userId, consultation, text);
      setAssets([]); setLeaveVisible(false); onExit();
    } catch (cause) { setError(messageFor(cause, 'Draft pesan belum tersimpan.')); }
    finally { setBusy(false); }
  };

  const discardAndExit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await service.saveDraft(role, userId, consultation, '');
      setText(''); setAssets([]); setSavedDraft(''); setLeaveVisible(false); onExit();
    } catch (cause) { setError(messageFor(cause, 'Draft pesan belum dapat dibuang.')); }
    finally { setBusy(false); }
  };

  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>Chat server · {consultation.displayCode}</Text>
    <Button label="Kembali ke konsultasi" role={role} variant="secondary" disabled={busy || loading} onPress={requestExit} />
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    <View style={styles.toolbar}>
      <Text style={styles.helper}>Pesan disegarkan dari server. Foto dan video dikirim sebagai lampiran privat konsultasi ini.</Text>
      <Button label="Muat ulang pesan" role={role} variant="secondary" disabled={busy || loading} onPress={() => void reload(true)} />
    </View>
    {hasMore && cursor ? <Button label="Muat pesan sebelumnya" role={role} variant="secondary" disabled={busy || loading} onPress={() => void loadOlder()} /> : null}
    {loading ? <LoadingState label="Memuat pesan…" /> : null}
    {!loading && messages.length === 0 ? <Text style={styles.helper}>Belum ada pesan pada konsultasi ini.</Text> : null}
    {messages.map((message) => <View key={message.id} style={[styles.message, message.senderId === userId ? styles.ownMessage : styles.otherMessage]}>
      <Text style={styles.messageSender}>{message.senderId === userId ? 'Anda' : role === 'farmer' ? 'Dokter Hewan' : 'Peternak'}</Text>
      {message.text ? <Text style={styles.messageText}>{message.text}</Text> : null}
      {message.attachments.map((attachment) => <View key={attachment.id} style={styles.attachment}>
        <Text style={styles.attachmentName}>{attachment.filename}</Text>
        <Text style={styles.helper}>{formatBytes(attachment.byteSize)} · {attachment.kind === 'image' ? 'Foto' : 'Video'}</Text>
        {message.deliveryStatus === 'sent' || message.senderId === userId
          ? <Button label={viewerBusy ? 'Mengunduh…' : 'Unduh dan buka lampiran'} role={role} variant="secondary" disabled={busy || viewerBusy} onPress={() => void openAttachment(message, attachment)} />
          : <Text style={styles.helper}>Lampiran tersedia setelah pesan terkirim.</Text>}
      </View>)}
      <Text style={styles.messageMeta}>{formatDate(message.createdAt)} · {deliveryLabel(message.deliveryStatus)}</Text>
      {message.deliveryStatus === 'failed' && message.senderId === userId ? <Button label={busyMessageId === message.id ? 'Mencoba ulang…' : 'Coba kirim lagi'} role={role} variant="secondary" disabled={busy || loading || !!busyMessageId} onPress={() => void retryFailed(message)} /> : null}
    </View>)}
    {pending ? <Text style={styles.helper}>Hasil belum pasti. ID pesan, isi, file, dan kunci upload tersimpan agar retry memakai operasi yang sama.</Text> : null}
    {assets.length ? <View style={styles.selectedMedia}>
      <Text style={styles.helper}>{pending ? 'Lampiran dari operasi tertunda' : `${assets.length}/5 lampiran dipilih`}</Text>
      {assets.map((asset, index) => <View key={`${asset.uri}-${index}`} style={styles.selectedItem}>
        {asset.kind === 'image' ? <Image source={{ uri: asset.uri }} style={styles.selectedImage} resizeMode="cover" /> : <View style={styles.selectedVideo}><Icon name="video" size={22} color={colors.brown} /></View>}
        <Text numberOfLines={2} style={styles.attachmentName}>{asset.filename}</Text>
        {!pending ? <Pressable accessibilityRole="button" accessibilityLabel={`Hapus ${asset.filename}`} disabled={busy} onPress={() => setAssets((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={styles.removeAttachment}><Icon name="x" size={18} color={colors.brown} /></Pressable> : null}
      </View>)}
    </View> : null}
    <TextArea label="Pesan" value={text} onChangeText={setText} placeholder="Tulis pesan untuk konsultasi ini" editable={!busy && !pending} maxLength={4000} helperText={`${text.length}/4000`} />
    <Button label={pickerBusy ? 'Membuka galeri…' : 'Pilih foto atau video'} role={role} variant="secondary" disabled={loading || busy || pickerBusy || !!pending || assets.length >= 5} onPress={() => void chooseMedia()} />
    <Text style={styles.helper}>JPG/PNG/WebP hingga 10 MiB atau MP4 hingga 50 MiB; maksimal lima file per pesan.</Text>
    <Button label={pending ? 'Coba ulang pesan tertunda' : 'Kirim pesan'} role={role} loading={busy} disabled={loading || (!text.trim() && !assets.length) || text.length > 4000 || (!!pending && text !== pending.text)} onPress={() => void send()} />
    <Modal transparent visible={leaveVisible} animationType="fade" onRequestClose={() => setLeaveVisible(false)}>
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.dialogTitle}>Pesan belum dikirim</Text>
          <Text style={styles.messageText}>Simpan teks sebagai draft, buang teks dan pilihan media, atau lanjutkan menulis?</Text>
          <Button label="Simpan Draft" role={role} loading={busy} onPress={() => void saveDraftAndExit()} />
          <Button label="Buang" role={role} variant="secondary" disabled={busy} onPress={() => void discardAndExit()} />
          <Button label="Tetap Mengedit" role={role} variant="secondary" disabled={busy} onPress={() => setLeaveVisible(false)} />
        </View>
      </View>
    </Modal>
    <Modal transparent visible={!!viewer} animationType="fade" onRequestClose={() => setViewer(null)}>
      <View style={styles.viewerBackdrop}>
        <View accessibilityViewIsModal style={styles.viewer}>
          <Text accessibilityRole="header" style={styles.dialogTitle}>{viewer?.filename ?? 'Lampiran'}</Text>
          {viewer?.kind === 'image'
            ? <Image accessibilityLabel={`Lampiran ${viewer.filename}`} source={{ uri: viewer.localUri }} resizeMode="contain" style={styles.viewerImage} />
            : viewer ? <View style={styles.videoPreview}><Icon name="video" size={42} color={colors.brown} /><Text style={styles.messageText}>Video sudah diunduh ke ruang privat aplikasi.</Text><Text selectable style={styles.helper}>{viewer.filename}</Text></View> : null}
          <Button label="Tutup lampiran" role={role} variant="secondary" onPress={() => setViewer(null)} />
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
function formatBytes(value: number): string { return value < 1_000_000 ? `${Math.max(1, Math.round(value / 1000))} KB` : `${(value / 1_000_000).toFixed(1)} MB`; }

const styles = StyleSheet.create({
  section: { gap: spacing[3] },
  heading: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.section },
  toolbar: { gap: spacing[2] },
  selectedMedia: { gap: spacing[2], padding: spacing[3], borderRadius: 12, backgroundColor: colors.white },
  selectedItem: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing[2], padding: spacing[2], borderRadius: 10, backgroundColor: colors.cream },
  selectedImage: { width: 48, height: 48, borderRadius: 8, backgroundColor: colors.white },
  selectedVideo: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.white },
  removeAttachment: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  attachment: { gap: spacing[1], paddingTop: spacing[2] },
  attachmentName: { flex: 1, color: colors.dark, fontFamily: fonts.medium, fontSize: typeScale.small, lineHeight: 18 },
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
  viewerBackdrop: { flex: 1, justifyContent: 'center', padding: spacing[4], backgroundColor: 'rgba(58, 23, 13, 0.68)' },
  viewer: { minHeight: 240, maxHeight: '90%', padding: spacing[4], gap: spacing[3], borderRadius: 16, backgroundColor: colors.white },
  viewerImage: { width: '100%', height: 360, backgroundColor: colors.dark },
  videoPreview: { minHeight: 240, alignItems: 'center', justifyContent: 'center', gap: spacing[3], padding: spacing[4], backgroundColor: colors.cream },
});
