import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { SessionSnapshot } from '../../domain/auth';
import type { NotificationSnapshot } from '../../application/NotificationService';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, InlineFeedback, LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { colors, fonts, roleTokens, spacing, typeScale } from '../theme/tokens';

type Props = {
  store: LocalStore;
  session: SessionSnapshot;
  onBack: () => void;
  onOpenSettings?: () => void;
  onOpenContext: (notification: NotificationSnapshot) => void;
};

export function NotificationsFlow({ store, session, onBack, onOpenSettings, onOpenContext }: Props) {
  const role = session.activeRole;
  const cardRadius = roleTokens[role].cardRadius;
  const [notifications, setNotifications] = useState<NotificationSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setNotifications(await store.notifications.listForRecipient(session.userId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kotak masuk belum dapat dimuat.');
    } finally {
      setLoading(false);
    }
  }, [session.userId, store]);

  useEffect(() => {
    const request = setTimeout(() => { void reload(); }, 0);
    return () => clearTimeout(request);
  }, [reload]);

  const openNotification = async (item: NotificationSnapshot) => {
    if (busyId) return;
    setBusyId(item.id);
    setError('');
    setNotice('');
    try {
      const saved = item.readAt ? item : await store.notifications.markRead(session.userId, item.id);
      setNotifications((current) => current.map((notification) => notification.id === saved.id ? saved : notification));
      if (!saved.contextId) {
        setNotice('Pembaruan ini belum memiliki halaman tujuan.');
        return;
      }
      onOpenContext(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Status baca belum tersimpan. Coba lagi.');
    } finally {
      setBusyId('');
    }
  };

  const unreadCount = notifications.filter((item) => !item.readAt).length;
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Kembali" onPress={onBack} style={styles.headerButton}>
          <Icon name="arrow-left" size={22} color={colors.brown} />
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>Kotak Masuk</Text>
        <View style={styles.headerButton} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={[styles.summary, { borderRadius: cardRadius }]}>
          <Icon name="bell" size={20} color={role === 'farmer' ? colors.orange : colors.brown} />
          <Text style={styles.summaryText}>{unreadCount ? `${unreadCount} belum dibaca` : 'Semua pembaruan sudah dibaca'}</Text>
        </View>
        <Text style={styles.helper}>Pembaruan yang tersimpan tetap ada di kotak masuk meskipun preferensi kategori dimatikan.</Text>
        {notice ? <InlineFeedback message={notice} tone="info" /> : null}
        {error ? <ErrorState message={error} role={role} onRetry={() => void reload()} /> : null}
        {loading ? <LoadingState label="Memuat kotak masuk…" /> : null}
        {!loading && !error && notifications.length === 0 ? (
          <EmptyState role={role} title="Belum ada pembaruan" description="Pembaruan layanan yang ditujukan kepada akun ini akan tampil di sini." />
        ) : null}
        {!loading && !error ? notifications.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${item.body}. ${item.readAt ? 'Sudah dibaca' : 'Belum dibaca'}`}
            accessibilityState={{ disabled: Boolean(busyId) }}
            disabled={Boolean(busyId)}
            onPress={() => void openNotification(item)}
            style={({ pressed }) => [styles.card, { borderRadius: cardRadius }, !item.readAt && styles.unreadCard, pressed && styles.pressed]}
          >
            <View style={[styles.indicator, !item.readAt && styles.unreadIndicator]} />
            <View style={styles.cardCopy}>
              <View style={styles.cardHeading}>
                <Text style={[styles.cardTitle, !item.readAt && styles.unreadTitle]}>{item.title}</Text>
                <Text style={styles.date}>{formatDate(item.createdAt)}</Text>
              </View>
              <Text style={styles.body}>{item.body}</Text>
              <View style={styles.cardFooter}>
                <Text style={styles.readState}>{item.readAt ? 'Sudah dibaca' : 'Belum dibaca'}</Text>
                <Text style={styles.link}>{busyId === item.id ? 'Membuka…' : item.contextId ? 'Buka pembaruan' : 'Tandai dibaca'}</Text>
              </View>
            </View>
          </Pressable>
        )) : null}
        {onOpenSettings ? <Button label="Pengaturan notifikasi" role={role} variant="secondary" onPress={onOpenSettings} style={styles.settingsButton} /> : null}
      </ScrollView>
    </View>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(date);
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream, paddingHorizontal: spacing[4], paddingTop: spacing[2] },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.heading, textAlign: 'center' },
  content: { gap: spacing[3], paddingBottom: spacing[6] },
  summary: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[4], backgroundColor: colors.white },
  summaryText: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.body },
  helper: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 19 },
  card: { flexDirection: 'row', gap: spacing[3], padding: spacing[4], backgroundColor: colors.white, borderWidth: 1, borderColor: 'transparent' },
  unreadCard: { borderColor: colors.gold },
  pressed: { opacity: 0.8 },
  indicator: { width: 10, height: 10, marginTop: 5, borderRadius: 5, backgroundColor: 'transparent' },
  unreadIndicator: { backgroundColor: colors.orange },
  cardCopy: { flex: 1, gap: spacing[2] },
  cardHeading: { gap: spacing[1] },
  cardTitle: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.body, lineHeight: 22, flexShrink: 1 },
  unreadTitle: { fontFamily: fonts.bold },
  date: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21, flexShrink: 1 },
  cardFooter: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  readState: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, flexShrink: 1 },
  link: { color: colors.orange, fontFamily: fonts.semiBold, fontSize: typeScale.small, textAlign: 'right', flexShrink: 1 },
  settingsButton: { marginTop: spacing[2] },
});
