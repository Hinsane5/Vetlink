import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { SessionSnapshot } from '../../domain/auth';
import type { ChatAttachment, ChatConversation } from '../../domain/chat';
import { consultationLabel } from '../../domain/consultations';
import { DomainError } from '../../domain/errors';
import type { SelectedAsset } from '../../domain/profiles';
import { Button } from '../components/Button';
import { ChatBubble } from '../components/ChatBubble';
import { EmptyState, ErrorState, InlineFeedback, LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';
import { colors, fonts, radii, roleTokens, spacing, typeScale } from '../theme/tokens';

type Viewer = { messageId: string; attachment: ChatAttachment };

export function ChatFlow({ store, session, consultationId, onExit }: { store: LocalStore; session: SessionSnapshot; consultationId: string; onExit: () => void }) {
  const role = session.activeRole;
  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [viewerBusy, setViewerBusy] = useState(false);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  const [text, setText] = useState('');
  const [assets, setAssets] = useState<SelectedAsset[]>([]);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [leave, setLeave] = useState(false);
  const messagesRef = useRef<ScrollView>(null);
  const lock = useRef(false);
  const draftIdentity = useRef<{ fingerprint: string; clientMessageId: string } | null>(null);

  const reload = useCallback(async () => {
    setError('');
    setLoading(true);
    try { setConversation(await store.chat.conversation(session.userId, role, consultationId)); }
    catch (cause) { setConversation(null); setError(messageFor(cause)); }
    finally { setLoading(false); }
  }, [consultationId, role, session.userId, store]);

  useEffect(() => { const timer = setTimeout(() => { void reload(); }, 0); return () => clearTimeout(timer); }, [reload]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 15_000); return () => clearInterval(timer); }, []);

  const back = useCallback(() => {
    if (viewer) { setViewer(null); return; }
    if (busy || pickerBusy || viewerBusy) return;
    if (text.trim() || assets.length) { setLeave(true); return; }
    onExit();
  }, [assets.length, busy, onExit, pickerBusy, text, viewer, viewerBusy]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [back]);

  const openViewer = async (messageId: string, attachmentId: string) => {
    setViewerBusy(true); setError('');
    try {
      const attachment = await store.chat.attachment(session.userId, role, consultationId, messageId, attachmentId);
      setViewer({ messageId, attachment });
    } catch (cause) { setError(messageFor(cause)); }
    finally { setViewerBusy(false); }
  };

  const chooseMedia = async () => {
    setPickerBusy(true); setError('');
    try {
      const picked = await store.chat.pickMedia(session.userId, role, consultationId);
      if (!picked.length) return;
      const remaining = Math.max(0, 5 - assets.length);
      const accepted = picked.slice(0, remaining);
      setAssets((current) => [...current, ...accepted]);
      if (accepted.length < picked.length) setError('Maksimal 5 foto atau video per pesan. Sebagian pilihan tidak ditambahkan.');
    } catch (cause) { setError(messageFor(cause)); }
    finally { setPickerBusy(false); }
  };

  const send = async () => {
    if (lock.current || (!text.trim() && !assets.length) || conversation?.readOnly) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const fingerprint = JSON.stringify({ text: text.trim(), assets: assets.map(({ uri, filename, mimeType, byteSize, kind }) => ({ uri, filename, mimeType, byteSize, kind })) });
      const clientMessageId = draftIdentity.current?.fingerprint === fingerprint ? draftIdentity.current.clientMessageId : store.chat.newClientMessageId();
      draftIdentity.current = { fingerprint, clientMessageId };
      const next = await store.chat.send(session.userId, role, consultationId, { clientMessageId, text, assets });
      setConversation(next); setText(''); setAssets([]); draftIdentity.current = null;
      requestAnimationFrame(() => messagesRef.current?.scrollToEnd({ animated: true }));
    } catch (cause) { setError(messageFor(cause)); }
    finally { lock.current = false; setBusy(false); }
  };

  const retry = async (messageId: string) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { setConversation(await store.chat.retry(session.userId, role, consultationId, messageId)); }
    catch (cause) { setError(messageFor(cause)); }
    finally { lock.current = false; setBusy(false); }
  };

  const discardAndExit = () => { setLeave(false); setText(''); setAssets([]); draftIdentity.current = null; onExit(); };
  const status = String(conversation?.consultation.payload.status ?? '');
  const displayCode = String(conversation?.consultation.payload.displayCode ?? '');

  return <SafeAreaProvider><SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Kembali ke detail konsultasi" onPress={back} disabled={busy || pickerBusy} style={styles.backButton}><Icon name="arrow-left" size={22} color={colors.brown} /></Pressable>
        <View style={styles.headerText}><Text accessibilityRole="header" numberOfLines={2} style={styles.headerTitle}>{conversation?.otherPartyName ?? 'Percakapan'}</Text><Text style={styles.subtitle}>{conversation?.animalName ?? 'Memuat konteks layanan'}</Text></View>
        {conversation ? <StatusBadge role={role} label={consultationLabel(status)} /> : null}
      </View>
      {loading && !conversation ? <LoadingState label="Memuat percakapan…" /> : error && !conversation ? <ErrorState role={role} message={error} onRetry={() => { void reload(); }} /> : conversation ? <>
        <ScrollView
          ref={messagesRef}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => messagesRef.current?.scrollToEnd({ animated: false })}
        >
          <View style={[styles.contextCard, { borderRadius: roleTokens[role].cardRadius }]}>
            <View style={styles.contextTitleRow}><Text style={styles.contextTitle}>Konteks layanan</Text><Icon name="stethoscope" size={20} color={colors.brown} /></View>
            <Text selectable style={styles.contextCode}>{displayCode}</Text>
            <ContextLine label="Ternak" value={conversation.animalName} />
            <ContextLine label="Waktu layanan" value={formatDate(String(conversation.consultation.payload.startsAt), conversation.timezone)} />
            <ContextLine label="Keluhan" value={String(conversation.consultation.payload.complaint || 'Tidak ada keterangan.')} />
          </View>
          {error ? <InlineFeedback message={error} tone="error" /> : null}
          {conversation.readOnly ? <InlineFeedback message="Layanan sudah ditutup. Riwayat chat dapat dibaca." /> : null}
          {conversation.messages.length ? conversation.messages.map((message) => {
            const outgoing = message.record.payload.senderId === session.userId;
            const deliveryState = ['pending', 'failed'].includes(String(message.record.payload.deliveryStatus)) ? String(message.record.payload.deliveryStatus) as 'pending' | 'failed' : 'sent';
            const pendingAt = Date.parse(String(message.record.payload.deliveryAttemptAt ?? message.record.updatedAt));
            const canRetry = outgoing && !conversation.readOnly && (deliveryState === 'failed' || (deliveryState === 'pending' && Number.isFinite(pendingAt) && clock - pendingAt >= 30_000));
            const timeLabel = formatTime(String(message.record.payload.sentAt ?? message.record.createdAt), conversation.timezone);
            return <View key={message.record.id} style={[styles.messageGroup, outgoing ? styles.outgoing : styles.incoming]}>
              <ChatBubble
                author={outgoing ? 'Anda' : conversation.otherPartyName}
                direction={outgoing ? 'outgoing' : 'incoming'}
                message={String(message.record.payload.text || (message.attachments.length ? `Lampiran (${message.attachments.length})` : 'Pesan'))}
                timeLabel={timeLabel}
                deliveryState={deliveryState}
                onRetry={canRetry ? () => { void retry(message.record.id); } : undefined}
              />
              {message.attachments.map((attachment) => <MediaTile key={attachment.id} attachment={attachment} outgoing={outgoing} onPress={() => { void openViewer(message.record.id, attachment.id); }} disabled={viewerBusy} />)}
            </View>;
          }) : <EmptyState role={role} title="Belum ada pesan" description="Kirim pesan atau foto yang terkait dengan layanan ini." />}
        </ScrollView>
        {!conversation.readOnly ? <View style={styles.composer}>
          {assets.length ? <ScrollView horizontal contentContainerStyle={styles.selectedRow} keyboardShouldPersistTaps="handled">
            {assets.map((asset, index) => <View key={`${asset.uri}-${index}`} style={styles.selectedAsset}>
              {asset.kind === 'image' ? <Image source={{ uri: asset.uri }} style={styles.selectedImage} resizeMode="cover" /> : <View style={styles.selectedVideo}><Icon name="video" color={colors.brown} size={24} /></View>}
              <Text numberOfLines={1} style={styles.fileName}>{asset.filename}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Hapus ${asset.filename}`} onPress={() => setAssets((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={styles.removeAsset}><Icon name="x" color={colors.brown} size={16} /></Pressable>
            </View>)}
          </ScrollView> : null}
          <View style={styles.inputRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Pilih foto atau video" accessibilityHint="Tambahkan maksimal lima media pada satu pesan." disabled={busy || pickerBusy || assets.length >= 5} onPress={() => { void chooseMedia(); }} style={[styles.actionButton, (assets.length >= 5 || busy || pickerBusy) && styles.disabled]}><Icon name="paperclip" color={colors.brown} size={22} /></Pressable>
            <TextInput
              accessibilityLabel="Tulis pesan"
              accessibilityHint="Tulis pesan maksimal 4.000 karakter."
              allowFontScaling
              editable={!busy && !pickerBusy}
              maxLength={4000}
              multiline
              onChangeText={setText}
              onFocus={() => requestAnimationFrame(() => messagesRef.current?.scrollToEnd({ animated: true }))}
              placeholder="Tulis pesan…"
              placeholderTextColor={colors.muted}
              style={styles.input}
              textAlignVertical="center"
              value={text}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Kirim pesan" disabled={busy || pickerBusy || (!text.trim() && !assets.length)} onPress={() => { void send(); }} style={[styles.sendButton, (!text.trim() && !assets.length || busy || pickerBusy) && styles.sendDisabled]}><Icon name="send" color={colors.white} size={19} /></Pressable>
          </View>
          <Text style={styles.counter}>{text.length}/4.000</Text>
        </View> : null}
      </> : null}
    </KeyboardAvoidingView>

    <Modal visible={!!viewer} animationType="fade" onRequestClose={() => setViewer(null)}>
      <SafeAreaProvider><SafeAreaView style={styles.viewerSafe} edges={['top', 'bottom']}>
        <View style={styles.viewerHeader}><Text style={styles.viewerTitle} numberOfLines={2}>{viewer?.attachment.filename ?? 'Lampiran'}</Text><Pressable accessibilityRole="button" accessibilityLabel="Tutup lampiran" onPress={() => setViewer(null)} style={styles.closeViewer}><Icon name="x" size={24} color={colors.brown} /></Pressable></View>
        {viewer?.attachment.kind === 'image' ? <Image source={{ uri: viewer.attachment.localUri }} style={styles.fullImage} resizeMode="contain" onError={() => setError('Foto lokal tidak dapat dibuka.')} /> : viewer ? <View style={styles.videoViewer}><Icon name="video" color={colors.brown} size={52} /><Text style={styles.contextTitle}>Video tersimpan</Text><Text style={styles.viewerBody}>{viewer.attachment.filename}</Text><Text style={styles.viewerBody}>Video dapat dibuka kembali dari percakapan ini.</Text></View> : null}
      </SafeAreaView></SafeAreaProvider>
    </Modal>

    <Modal visible={leave} transparent animationType="fade" onRequestClose={() => setLeave(false)}>
      <SafeAreaProvider><SafeAreaView style={styles.backdrop}><View style={styles.leaveCard}><Text style={styles.contextTitle}>Pesan belum dikirim</Text><Text style={styles.viewerBody}>Teks dan media pilihan akan dibuang jika Anda keluar sekarang.</Text><Button role={role} label="Buang dan keluar" onPress={discardAndExit} /><Button role={role} variant="secondary" label="Tetap mengetik" onPress={() => setLeave(false)} /></View></SafeAreaView></SafeAreaProvider>
    </Modal>
  </SafeAreaView></SafeAreaProvider>;
}

function ContextLine({ label, value }: { label: string; value: string }) { return <View style={styles.contextLine}><Text style={styles.label}>{label}</Text><Text selectable style={styles.contextValue}>{value}</Text></View>; }

function MediaTile({ attachment, outgoing, onPress, disabled }: { attachment: ChatAttachment; outgoing: boolean; onPress: () => void; disabled: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${attachment.kind === 'image' ? 'Buka foto' : 'Buka video'}, ${attachment.filename}`} disabled={disabled} onPress={onPress} style={[styles.mediaTile, outgoing ? styles.outgoingMedia : styles.incomingMedia]}>
    {attachment.kind === 'image' ? <Image source={{ uri: attachment.localUri }} style={styles.mediaImage} resizeMode="cover" /> : <View style={styles.videoPoster}><Icon name="play" size={28} color={colors.brown} /><Icon name="video" size={22} color={colors.brown} /></View>}
    <View style={styles.mediaCaption}><Text numberOfLines={2} style={styles.fileName}>{attachment.filename}</Text><Text style={styles.fileSize}>{formatBytes(attachment.byteSize)} · {attachment.kind === 'image' ? 'Foto' : 'Video'}</Text></View>
  </Pressable>;
}

function messageFor(cause: unknown): string { return cause instanceof DomainError ? cause.message : 'Percakapan belum dapat dimuat atau disimpan. Coba lagi.'; }
function formatDate(value: string, timezone: string) { return Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(value)) : 'Belum ditentukan'; }
function formatTime(value: string, timezone: string) { return Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(value)) : '—'; }
function formatBytes(value: number) { if (!Number.isFinite(value) || value < 0) return 'Ukuran tidak diketahui'; if (value < 1_000_000) return `${Math.max(1, Math.round(value / 1000))} KB`; return `${(value / 1_000_000).toFixed(1)} MB`; }
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream }, flex: { flex: 1 },
  header: { minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[2], gap: spacing[3], backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.cream },
  backButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radii.button, backgroundColor: colors.cream },
  headerText: { flex: 1, gap: 2 }, headerTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: 17, lineHeight: 22, flexShrink: 1 }, subtitle: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 18 },
  scroll: { flex: 1 }, content: { padding: spacing[4], gap: spacing[4], width: '100%', maxWidth: 520, alignSelf: 'center', flexGrow: 1, paddingBottom: spacing[6] },
  contextCard: { gap: spacing[2], padding: spacing[4], backgroundColor: colors.white }, contextTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, contextTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: 17, lineHeight: 23, flexShrink: 1 }, contextCode: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 }, contextLine: { gap: 2 }, label: { color: colors.muted, fontFamily: fonts.medium, fontSize: 11, lineHeight: 16 }, contextValue: { color: colors.dark, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, flexShrink: 1 },
  messageGroup: { maxWidth: '100%', gap: spacing[2] }, outgoing: { alignSelf: 'flex-end', alignItems: 'flex-end' }, incoming: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  mediaTile: { width: 220, minHeight: 76, overflow: 'hidden', borderRadius: radii.button, backgroundColor: colors.white }, outgoingMedia: { alignSelf: 'flex-end' }, incomingMedia: { alignSelf: 'flex-start' }, mediaImage: { width: '100%', height: 136, backgroundColor: colors.cream }, videoPoster: { width: '100%', height: 104, flexDirection: 'row', gap: spacing[2], alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream }, mediaCaption: { gap: 2, padding: spacing[3] }, fileName: { color: colors.dark, fontFamily: fonts.medium, fontSize: 12, lineHeight: 17, flexShrink: 1 }, fileSize: { color: colors.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
  composer: { gap: spacing[2], paddingHorizontal: spacing[3], paddingTop: spacing[2], paddingBottom: spacing[2], borderTopWidth: 1, borderTopColor: colors.gold, backgroundColor: colors.white }, selectedRow: { gap: spacing[2], paddingBottom: spacing[2] }, selectedAsset: { width: 96, minHeight: 100, borderRadius: radii.button, backgroundColor: colors.cream, overflow: 'hidden' }, selectedImage: { width: 96, height: 68 }, selectedVideo: { width: 96, height: 68, alignItems: 'center', justifyContent: 'center' }, removeAsset: { position: 'absolute', top: 2, right: 2, minWidth: 36, minHeight: 36, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[2] }, actionButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radii.button, backgroundColor: colors.cream }, disabled: { opacity: 0.5 }, input: { flex: 1, maxHeight: 128, minHeight: 48, paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderWidth: 1, borderColor: colors.gold, borderRadius: radii.button, color: colors.dark, backgroundColor: colors.white, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 20 }, sendButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.brown }, sendDisabled: { opacity: 0.45 }, counter: { alignSelf: 'flex-end', color: colors.muted, fontFamily: fonts.regular, fontSize: 10, lineHeight: 14 },
  viewerSafe: { flex: 1, backgroundColor: colors.cream }, viewerHeader: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], gap: spacing[3], backgroundColor: colors.white }, viewerTitle: { flex: 1, color: colors.brown, fontFamily: fonts.semiBold, fontSize: 16, flexShrink: 1 }, closeViewer: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }, fullImage: { flex: 1, width: '100%', backgroundColor: colors.dark }, videoViewer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[3], padding: spacing[6] }, viewerBody: { color: colors.dark, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, textAlign: 'center', flexShrink: 1 },
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing[5], backgroundColor: 'rgba(58,23,13,0.5)' }, leaveCard: { padding: spacing[5], gap: spacing[3], borderRadius: radii.cardVet, backgroundColor: colors.white },
});
