import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { SessionSnapshot } from '../../domain/auth';
import type { OrderSnapshot } from '../../domain/commerce';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';
import { colors, fonts, radii, spacing, typeScale } from '../theme/tokens';

type Props = { store: LocalStore; session: SessionSnapshot; initialOrderId?: string; onBack: () => void; onPay: (order: OrderSnapshot) => void };
type Tab = 'active' | 'done';

export function OrdersFlow({ store, session, initialOrderId, onBack, onPay }: Props) {
  const [tab, setTab] = useState<Tab>('active');
  const [orders, setOrders] = useState<OrderSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialOrderId ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const selected = orders.find((order) => order.id === selectedId) ?? null;
  const missingInitialOrder = Boolean(initialOrderId && !loading && !orders.some((order) => order.id === initialOrderId));
  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try { setOrders(await store.commerce.listOrders(session.userId, session.activeRole)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Pesanan belum dapat dimuat.'); }
    finally { setLoading(false); }
  }, [session.activeRole, session.userId, store]);
  useEffect(() => { const request = setTimeout(() => { void reload(); }, 0); return () => clearTimeout(request); }, [reload]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedId) { setSelectedId(null); return true; }
      onBack(); return true;
    });
    return () => subscription.remove();
  }, [onBack, selectedId]);
  const visibleOrders = orders.filter((order) => tab === 'done' ? order.status === 'delivered' : order.status !== 'delivered');

  return <View style={styles.root}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Kembali" onPress={() => selectedId ? setSelectedId(null) : onBack()} style={styles.back}><Icon name="arrow-left" size={22} color={colors.brown} /></Pressable>
      <Text accessibilityRole="header" style={styles.title}>{selected ? 'Detail pesanan' : 'Pesanan saya'}</Text><View style={styles.back} />
    </View>
    {selected ? <OrderDetail order={selected} onPay={() => onPay(selected)} /> : missingInitialOrder ? <View style={styles.content}><Text style={styles.copy}>Pesanan yang dituju belum dapat dibuka untuk akun ini.</Text><Button label="Kembali ke daftar" role="farmer" variant="secondary" onPress={() => setSelectedId(null)} /></View> : <>
      <View style={styles.tabs}>
        {(['active', 'done'] as const).map((value) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={[styles.tab, tab === value && styles.tabSelected]}><Text style={[styles.tabText, tab === value && styles.tabTextSelected]}>{value === 'active' ? 'Aktif' : 'Selesai'}</Text></Pressable>)}
      </View>
      {loading ? <LoadingState label="Memuat pesanan…" /> : error ? <ErrorState message={error} role="farmer" onRetry={() => void reload()} /> : <ScrollView contentContainerStyle={styles.content}>
        {visibleOrders.length ? visibleOrders.map((order) => <Pressable key={order.id} accessibilityRole="button" onPress={() => setSelectedId(order.id)} style={styles.card}>
          <View style={styles.row}><Text style={styles.code}>{order.displayCode}</Text><StatusBadge label={statusLabel(order.status)} role="farmer" /></View>
          <Text style={styles.copy}>{order.items.length} jenis produk · {formatRupiah(order.totalAmount)}</Text>
          <Text style={styles.muted}>{order.items.map((item) => `${item.nameSnapshot} × ${item.quantity}`).join(' · ')}</Text>
          <Text style={styles.link}>Lihat detail <Icon name="chevron-right" size={16} color={colors.orange} /></Text>
        </Pressable>) : <EmptyState role="farmer" title={tab === 'active' ? 'Belum ada pesanan aktif' : 'Belum ada pesanan selesai'} description={tab === 'active' ? 'Pesanan yang dibuat akan tampil di sini.' : 'Pesanan terkirim akan tampil di sini.'} />}
      </ScrollView>}
    </>}
  </View>;
}

function OrderDetail({ order, onPay }: { order: OrderSnapshot; onPay: () => void }) {
  return <ScrollView contentContainerStyle={styles.content}>
    <View style={styles.card}>
      <View style={styles.row}><Text style={styles.code}>{order.displayCode}</Text><StatusBadge label={statusLabel(order.status)} role="farmer" /></View>
      <Text style={styles.heading}>Rincian produk</Text>
      {order.items.map((item) => <View key={item.id} style={styles.item}><View style={styles.itemCopy}><Text style={styles.copy}>{item.nameSnapshot}</Text><Text style={styles.muted}>{item.quantity} × {formatRupiah(item.unitPrice)}</Text></View><Text style={styles.copy}>{formatRupiah(item.lineTotal)}</Text></View>)}
      <View style={styles.divider} />
      <DetailLine label="Subtotal" value={formatRupiah(order.subtotal)} /><DetailLine label="Ongkir" value={formatRupiah(order.shippingAmount)} /><DetailLine label="Total snapshot" value={formatRupiah(order.totalAmount)} strong />
      <Text style={styles.heading}>Alamat pengiriman</Text><Text style={styles.copy}>{order.address.recipient} · {order.address.phone}</Text><Text style={styles.copy}>{order.address.address}, {order.address.city}, {order.address.province} {order.address.postalCode}</Text>
      {order.status === 'awaiting_payment' ? <><Text style={styles.notice}>Pembayaran {order.paymentStatus === 'failed' ? 'gagal' : 'menunggu konfirmasi'}. Pesanan belum dibayar.</Text><Button role="farmer" label={order.paymentStatus === 'failed' ? 'Lihat pembayaran' : 'Lihat pembayaran'} variant="secondary" onPress={onPay} /></> : null}
    </View>
    <View style={styles.card}>
      <Text style={styles.heading}>Status pengiriman</Text>
      {order.trackingCode ? <Text style={styles.muted}>Nomor pelacakan: {order.trackingCode}</Text> : null}
      {order.shipmentEvents.length ? [...order.shipmentEvents].sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).map((event, index) => <View key={`${event.time}:${index}`} style={styles.event}><View style={styles.eventRail}><View style={[styles.dot, index === 0 && styles.dotCurrent]} />{index < order.shipmentEvents.length - 1 ? <View style={styles.rail} /> : null}</View><View style={styles.eventCopy}><Text style={styles.eventTitle}>{eventLabel(event.status)}</Text><Text style={styles.muted}>{event.description}</Text><Text style={styles.date}>{formatDate(event.time)}</Text></View></View>) : <Text style={styles.muted}>{order.status === 'awaiting_payment' ? 'Pengiriman dimulai setelah pembayaran berhasil.' : 'Informasi pengiriman belum tersedia.'}</Text>}
    </View>
  </ScrollView>;
}

function DetailLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <View style={styles.line}><Text style={styles.muted}>{label}</Text><Text style={[styles.copy, strong && styles.strong]}>{value}</Text></View>; }
function statusLabel(status: OrderSnapshot['status']) { return ({ awaiting_payment: 'Menunggu pembayaran', paid: 'Dibayar', processing: 'Diproses', shipped: 'Dikirim', delivered: 'Terkirim' } as const)[status]; }
function eventLabel(status: string) { return ({ processing: 'Pesanan diproses', shipped: 'Paket dikirim', delivered: 'Pesanan diterima', failed: 'Pengiriman terkendala' } as Record<string, string>)[status] ?? 'Pembaruan pengiriman'; }
function formatRupiah(value: number) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(date); }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream, paddingHorizontal: spacing[4], paddingTop: spacing[2] },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.heading },
  tabs: { flexDirection: 'row', padding: 4, borderRadius: radii.cardFarmer, backgroundColor: colors.white, marginVertical: spacing[2] },
  tab: { minHeight: 44, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radii.button }, tabSelected: { backgroundColor: colors.orange },
  tabText: { color: colors.brown, fontFamily: fonts.semiBold }, tabTextSelected: { color: colors.white },
  content: { gap: spacing[3], paddingBottom: spacing[6] },
  card: { backgroundColor: colors.white, borderRadius: radii.cardFarmer, padding: spacing[4], gap: spacing[3] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  code: { color: colors.brown, fontFamily: fonts.bold, fontSize: 16, flexShrink: 1 },
  copy: { color: colors.brown, fontFamily: fonts.medium, lineHeight: 22 }, muted: { color: colors.muted, fontFamily: fonts.regular, lineHeight: 21 },
  link: { minHeight: 44, flexDirection: 'row', alignItems: 'center', color: colors.orange, fontFamily: fonts.semiBold },
  heading: { color: colors.brown, fontFamily: fonts.bold, fontSize: 16, marginTop: spacing[2] },
  item: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[2] }, itemCopy: { flex: 1, gap: 2 },
  divider: { height: 1, backgroundColor: colors.gold }, line: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[2] }, strong: { fontFamily: fonts.bold },
  notice: { color: colors.brown, fontFamily: fonts.medium, lineHeight: 21 },
  event: { flexDirection: 'row', gap: spacing[3], minHeight: 70 }, eventRail: { width: 16, alignItems: 'center' }, dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.muted, marginTop: 4 }, dotCurrent: { backgroundColor: colors.orange }, rail: { width: 2, flex: 1, backgroundColor: colors.gold, marginTop: 3 }, eventCopy: { flex: 1, gap: 3 }, eventTitle: { color: colors.brown, fontFamily: fonts.semiBold }, date: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12 },
});
