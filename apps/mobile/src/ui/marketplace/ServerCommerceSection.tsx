import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CatalogProduct } from '../../domain/catalog';
import { catalogCategoryLabel, speciesLabel } from '../../domain/catalog';
import { livestockSpecies, type LivestockSpecies } from '../../domain/profiles';
import { DomainError } from '../../domain/errors';
import type { ApiCart, ApiCheckoutQuote, ApiOrder, ApiOrderShipment } from '../../application/ports/ApiCommerceRepository';
import type { ApiPaymentSnapshot, ApiPaymentGateway } from '../../application/ApiPaymentGateway';
import type { PaymentMethod } from '../../application/PaymentService';
import type { ServerCommerceService } from '../../application/ServerCommerceService';
import { Button } from '../components/Button';
import { EmptyState, InlineFeedback, LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { TextField } from '../components/TextField';
import { colors, fonts, radii, spacing, typeScale } from '../theme/tokens';

type Screen = 'catalog' | 'product' | 'cart' | 'quote' | 'orders' | 'order';
type Tab = 'catalog' | 'cart' | 'orders';
type OrderTab = 'active' | 'done';
type Filters = { category?: string; species?: LivestockSpecies };

export function ServerCommerceSection({ service, paymentGateway, userId, onExit, backHandlerRef }: {
  service: ServerCommerceService;
  paymentGateway: ApiPaymentGateway;
  userId: string;
  onExit: () => void;
  backHandlerRef: { current: (() => boolean) | null };
}) {
  const [screen, setScreen] = useState<Screen>('catalog');
  const [tab, setTab] = useState<Tab>('catalog');
  const [orderTab, setOrderTab] = useState<OrderTab>('active');
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [cart, setCart] = useState<ApiCart | null>(null);
  const [addresses, setAddresses] = useState<Awaited<ReturnType<ServerCommerceService['getAddresses']>>>([]);
  const [quote, setQuote] = useState<ApiCheckoutQuote | null>(null);
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [ordersCursor, setOrdersCursor] = useState<string | null>(null);
  const [ordersHasMore, setOrdersHasMore] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ApiOrder | null>(null);
  const [shipment, setShipment] = useState<ApiOrderShipment | null>(null);
  const [payment, setPayment] = useState<ApiPaymentSnapshot | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('bank_transfer');
  const [paymentQuoteAmount, setPaymentQuoteAmount] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  const [addressId, setAddressId] = useState('');
  const [pendingOrder, setPendingOrder] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cartNeedsRefresh, setCartNeedsRefresh] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  const reloadCart = useCallback(async () => {
    const next = await service.getCart('farmer', userId);
    setCart(next);
    setCartNeedsRefresh(false);
    return next;
  }, [service, userId]);

  const loadOrders = useCallback(async (append = false) => {
    const page = await service.listOrders('farmer', {
      limit: 30,
      ...(append && ordersCursor ? { cursor: ordersCursor } : {}),
    });
    setOrders((current) => append ? mergeOrders(current, page.items) : page.items);
    setOrdersCursor(page.nextCursor);
    setOrdersHasMore(page.hasMore);
  }, [ordersCursor, service]);

  const reloadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    const results = await Promise.allSettled([
      service.listProducts('farmer', { limit: 30 }),
      reloadCart(),
      service.getAddresses('farmer'),
      service.listOrders('farmer', { limit: 30 }),
      service.getPendingOrder('farmer', userId),
    ]);
    const failed: unknown[] = [];
    if (results[0].status === 'fulfilled') setProducts(results[0].value.items); else failed.push(results[0].reason);
    if (results[1].status === 'fulfilled') setCart(results[1].value); else failed.push(results[1].reason);
    if (results[2].status === 'fulfilled') {
      const nextAddresses = results[2].value;
      setAddresses(nextAddresses);
      setAddressId((current) => nextAddresses.some((item) => item.id === current) ? current : nextAddresses[0]?.id ?? '');
    } else failed.push(results[2].reason);
    if (results[3].status === 'fulfilled') {
      setOrders(results[3].value.items);
      setOrdersCursor(results[3].value.nextCursor);
      setOrdersHasMore(results[3].value.hasMore);
    } else failed.push(results[3].reason);
    if (results[4].status === 'fulfilled') setPendingOrder(results[4].value?.quoteId ?? null); else failed.push(results[4].reason);
    if (failed.length) setError(messageFor(failed[0]));
    setLoading(false);
  }, [reloadCart, service, userId]);

  useEffect(() => { const request = setTimeout(() => { void reloadAll(); }, 0); return () => clearTimeout(request); }, [reloadAll]);

  const back = useCallback(() => {
    if (filterOpen || addressOpen) { setFilterOpen(false); setAddressOpen(false); return true; }
    if (screen === 'product') { setScreen('catalog'); setProduct(null); return true; }
    if (screen === 'quote') { setScreen('cart'); return true; }
    if (screen === 'order') { setScreen('orders'); setSelectedOrder(null); return true; }
    if (screen !== 'catalog' || tab !== 'catalog') { setScreen('catalog'); setTab('catalog'); return true; }
    onExit();
    return true;
  }, [addressOpen, filterOpen, onExit, screen, tab]);

  useEffect(() => {
    backHandlerRef.current = back;
    const listener = BackHandler.addEventListener('hardwareBackPress', back);
    return () => { backHandlerRef.current = null; listener.remove(); };
  }, [back, backHandlerRef]);

  const search = async (nextFilters = filters) => {
    setBusy(true); setError('');
    try {
      const page = await service.listProducts('farmer', { name: query.trim() || undefined, ...nextFilters, limit: 30 });
      setProducts(page.items);
    } catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  };

  const openProduct = async (id: string) => {
    setBusy(true); setError('');
    try {
      const next = await service.getProduct('farmer', id);
      setProduct(next); setScreen('product');
    } catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  };

  const mutateCart = async (action: () => Promise<ApiCart>) => {
    if (inFlight.current || cartNeedsRefresh) return false;
    inFlight.current = true; setBusy(true); setError('');
    try { setCart(await action()); return true; }
    catch (cause) {
      setError(messageFor(cause));
      if (cause instanceof DomainError && ['SERVICE_UNAVAILABLE', 'API_RESPONSE_INVALID', 'VERSION_CONFLICT'].includes(cause.code)) setCartNeedsRefresh(true);
      return false;
    } finally { inFlight.current = false; setBusy(false); }
  };

  const addToCart = async () => {
    if (!product) return;
    const quantity = cart?.items.find((item) => item.productId === product.id)?.quantity ?? 0;
    const saved = await mutateCart(() => service.setQuantity('farmer', userId, product.id, quantity + 1));
    if (saved) { setScreen('cart'); setTab('cart'); }
  };

  const createQuote = async () => {
    if (!addressId) { setError('Simpan alamat pengiriman sebelum checkout.'); return; }
    setBusy(true); setError('');
    try { setQuote(await service.createQuote('farmer', userId, addressId)); setScreen('quote'); }
    catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  };

  const placeOrder = async () => {
    if (!quote || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const saved = await service.createOrder('farmer', userId, quote);
      setSelectedOrder(saved); setPendingOrder(null); setScreen('order'); setTab('orders');
      await Promise.all([reloadCart(), loadOrders()]);
      await loadOrderDetails(saved.id, false);
    } catch (cause) {
      setError(messageFor(cause));
      try { setPendingOrder((await service.getPendingOrder('farmer', userId))?.quoteId ?? null); }
      catch { setPendingOrder(quote.id); }
    } finally { inFlight.current = false; setBusy(false); }
  };

  const retryOrder = async () => {
    if (inFlight.current || busy) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const saved = await service.retryPendingOrder('farmer', userId);
      setSelectedOrder(saved); setPendingOrder(null); setScreen('order'); setTab('orders');
      await Promise.all([reloadCart(), loadOrders()]);
      await loadOrderDetails(saved.id, false);
    } catch (cause) {
      setError(messageFor(cause));
      try { setPendingOrder((await service.getPendingOrder('farmer', userId))?.quoteId ?? null); }
      catch { /* Preserve recovery gate while SecureStore is unavailable. */ }
    } finally { inFlight.current = false; setBusy(false); }
  };

  const loadOrderDetails = async (orderId: string, showBusy = true) => {
    if (showBusy) setBusy(true);
    setError('');
    try {
      const [nextOrder, nextShipment] = await Promise.all([
        service.getOrder('farmer', orderId), service.getShipment('farmer', orderId),
      ]);
      setSelectedOrder(nextOrder); setShipment(nextShipment);
      setPayment(null); setPaymentQuoteAmount(null); setPaymentMethod('bank_transfer');
      if (nextOrder.status === 'awaiting_payment') {
        const currentPayment = await paymentGateway.getPaymentForPayable('order', orderId);
        setPayment(currentPayment);
        if (currentPayment) setPaymentMethod(currentPayment.method);
        if (!currentPayment || (currentPayment.status !== 'pending' && currentPayment.status !== 'succeeded')) {
          try { setPaymentQuoteAmount((await paymentGateway.getQuote('order', orderId)).amountIdr); }
          catch { setPaymentQuoteAmount(null); }
        }
      }
      setScreen('order'); setTab('orders');
    } catch (cause) { setError(messageFor(cause)); }
    finally { if (showBusy) setBusy(false); }
  };

  const requestPayment = async () => {
    if (!selectedOrder || inFlight.current || selectedOrder.status !== 'awaiting_payment') return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await paymentGateway.submit('farmer', 'order', selectedOrder.id, paymentMethod);
      setPayment(result);
      await loadOrderDetails(selectedOrder.id, false);
    } catch (cause) { setError(messageFor(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  };

  const switchTab = (next: Tab) => { setTab(next); setScreen(next === 'catalog' ? 'catalog' : next === 'cart' ? 'cart' : 'orders'); setError(''); };
  const cartQuantity = cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const visibleOrders = orders.filter((item) => orderTab === 'done' ? item.status === 'delivered' : item.status !== 'delivered');

  return <View style={styles.root}>
    <View style={styles.header}><Button role="farmer" variant="secondary" label="Kembali" disabled={busy} onPress={back} /><Text accessibilityRole="header" style={styles.title}>{screenTitle(screen)}</Text></View>
    <View style={styles.tabs}>{(['catalog', 'cart', 'orders'] as const).map((value) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => switchTab(value)} style={[styles.tab, tab === value && styles.tabSelected]}><Text style={[styles.tabText, tab === value && styles.tabTextSelected]}>{value === 'catalog' ? 'Katalog' : value === 'cart' ? `Keranjang (${cartQuantity})` : 'Pesanan'}</Text></Pressable>)}</View>
    {error ? <View style={styles.errorBox}><InlineFeedback message={error} tone="error" /><Button role="farmer" variant="secondary" label="Muat ulang data server" loading={loading} disabled={busy} onPress={() => void reloadAll()} /></View> : null}
    {loading ? <LoadingState label="Memuat katalog dan keranjang…" /> : null}
    {screen === 'catalog' ? <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TextField label="Cari produk" value={query} onChangeText={setQuery} placeholder="Nama produk" returnKeyType="search" />
      <View style={styles.filterRow}><Text style={styles.muted}>{filters.category ? catalogCategoryLabel(filters.category) : 'Semua kategori'}{filters.species ? ` · ${speciesLabel(filters.species)}` : ' · Semua ternak'}</Text><Button role="farmer" variant="secondary" label="Filter" onPress={() => setFilterOpen(true)} /></View>
      <Button role="farmer" label="Cari di katalog" loading={busy} disabled={busy} onPress={() => void search()} />
      {products.length ? products.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => void openProduct(item.id)} style={styles.card}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.muted}>{catalogCategoryLabel(item.category)} · {item.species.length ? item.species.map(speciesLabel).join(', ') : 'Semua jenis ternak'}</Text><Text style={styles.price}>{rupiah(item.unitPrice)}</Text><Text numberOfLines={3} style={styles.body}>{item.description || 'Informasi produk belum tersedia.'}</Text><Text style={styles.link}>Lihat detail <Icon name="chevron-right" size={16} color={colors.orange} /></Text></Pressable>) : !loading ? <EmptyState role="farmer" title="Katalog belum tersedia" description="Produk aktif akan tampil di sini." /> : null}
    </ScrollView> : null}
    {screen === 'product' && product ? <ScrollView contentContainerStyle={styles.content}><View style={styles.card}><Text style={styles.cardTitle}>{product.name}</Text><Text style={styles.muted}>{catalogCategoryLabel(product.category)}</Text><Text style={styles.price}>{rupiah(product.unitPrice)}</Text><Text style={styles.body}>{product.description || 'Informasi produk belum tersedia.'}</Text><Text style={styles.body}>{product.species.length ? product.species.map(speciesLabel).join(', ') : 'Semua jenis ternak'}</Text></View><Button role="farmer" label="Tambah ke keranjang" loading={busy} disabled={busy || cartNeedsRefresh} onPress={() => void addToCart()} /><Button role="farmer" variant="secondary" label="Buka keranjang" onPress={() => switchTab('cart')} /></ScrollView> : null}
    {screen === 'cart' ? <ScrollView contentContainerStyle={styles.content}>
      {cartNeedsRefresh ? <View style={styles.recovery}><Text style={styles.cardTitle}>Keranjang perlu disegarkan</Text><Text style={styles.body}>Hasil perubahan belum dipastikan atau versi keranjang berubah. Muat ulang sebelum mengubah jumlah atau checkout.</Text><Button role="farmer" variant="secondary" label="Muat ulang keranjang" loading={busy} disabled={busy} onPress={() => { setBusy(true); void reloadCart().catch((cause) => setError(messageFor(cause))).finally(() => setBusy(false)); }} /></View> : null}
      {cart?.items.length ? cart.items.map((item) => <View key={item.productId} style={styles.card}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.muted}>{item.active ? rupiah(item.unitPriceIdr ?? 0) : 'Produk tidak tersedia'}</Text><View style={styles.quantityRow}><Button role="farmer" variant="secondary" label="Kurangi" disabled={busy || cartNeedsRefresh || item.quantity <= 1 || !item.active} onPress={() => void mutateCart(() => service.setQuantity('farmer', userId, item.productId, item.quantity - 1))} /><Text style={styles.quantity}>{item.quantity}</Text><Button role="farmer" variant="secondary" label="Tambah" disabled={busy || cartNeedsRefresh || !item.active} onPress={() => void mutateCart(() => service.setQuantity('farmer', userId, item.productId, item.quantity + 1))} /><Button role="farmer" variant="secondary" label="Hapus" disabled={busy || cartNeedsRefresh} onPress={() => void mutateCart(() => service.removeItem('farmer', userId, item.productId))} /></View><Text style={styles.body}>{item.lineTotalIdr === null ? 'Harga perlu ditinjau ulang.' : `Subtotal ${rupiah(item.lineTotalIdr)}`}</Text></View>) : <EmptyState role="farmer" title="Keranjang kosong" description="Pilih produk aktif dari katalog untuk memulai." actionLabel="Buka katalog" onAction={() => switchTab('catalog')} />}
      {cart?.items.length ? <View style={styles.card}><Line label="Subtotal server" amount={cart.subtotalIdr} /><Text style={styles.muted}>{cart.itemCount} produk · {cart.quantityCount} unit</Text><Button role="farmer" label="Pilih alamat dan tinjau checkout" disabled={busy || cartNeedsRefresh || cart.hasUnavailableItems} onPress={() => setAddressOpen(true)} /></View> : null}
    </ScrollView> : null}
    {screen === 'quote' && quote ? <ScrollView contentContainerStyle={styles.content}><View style={styles.card}><Text style={styles.cardTitle}>Tinjau checkout</Text><Text style={styles.body}>{quote.addressSnapshot.recipientName} · {quote.addressSnapshot.phone}</Text><Text style={styles.body}>{quote.addressSnapshot.addressLine}, {quote.addressSnapshot.city}, {quote.addressSnapshot.province} {quote.addressSnapshot.postalCode}</Text>{quote.items.map((item) => <Line key={item.productId} label={`${item.nameSnapshot} × ${item.quantity}`} amount={item.lineTotalIdr} />)}<View style={styles.divider} /><Line label="Subtotal" amount={quote.subtotalIdr} /><Line label={quote.shippingLabel} amount={quote.shippingAmountIdr} /><Line label="Total rupiah" amount={quote.totalIdr} strong /><Text style={styles.muted}>Quote berlaku sampai {tanggal(quote.expiresAt)}. Harga dan ongkir dihitung server.</Text></View><Button role="farmer" label="Buat pesanan" loading={busy} disabled={busy} onPress={() => void placeOrder()} /><Button role="farmer" variant="secondary" label="Kembali ke keranjang" onPress={() => setScreen('cart')} /></ScrollView> : null}
    {screen === 'orders' ? <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.orderTabs}>{(['active', 'done'] as const).map((value) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: orderTab === value }} onPress={() => setOrderTab(value)} style={[styles.orderTab, orderTab === value && styles.orderTabSelected]}><Text style={[styles.tabText, orderTab === value && styles.tabTextSelected]}>{value === 'active' ? 'Aktif' : 'Selesai'}</Text></Pressable>)}</View>
      {pendingOrder ? <View style={styles.recovery}><Text style={styles.cardTitle}>Pesanan menunggu kepastian</Text><Text style={styles.body}>Quote {pendingOrder} tersimpan aman. Coba ulang dengan kunci yang sama setelah koneksi tersedia.</Text><Button role="farmer" label="Pulihkan pesanan tersimpan" loading={busy} disabled={busy} onPress={() => void retryOrder()} /></View> : null}
      {visibleOrders.length ? visibleOrders.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => void loadOrderDetails(item.id)} style={styles.card}><Text style={styles.cardTitle}>{item.displayCode} · {orderLabel(item.status)}</Text><Text style={styles.body}>{item.items.length} jenis produk · {rupiah(item.totalIdr)}</Text><Text style={styles.muted}>{item.items.map((line) => `${line.nameSnapshot} × ${line.quantity}`).join(' · ')}</Text><Text style={styles.link}>Lihat detail <Icon name="chevron-right" size={16} color={colors.orange} /></Text></Pressable>) : !loading ? <EmptyState role="farmer" title={orderTab === 'active' ? 'Belum ada pesanan aktif' : 'Belum ada pesanan selesai'} description="Pesanan yang dibuat akan tampil di sini." /> : null}
      {ordersHasMore ? <Button role="farmer" variant="secondary" label="Muat pesanan berikutnya" loading={busy} disabled={busy || !ordersCursor} onPress={() => { setBusy(true); void loadOrders(true).catch((cause) => setError(messageFor(cause))).finally(() => setBusy(false)); }} /> : null}
    </ScrollView> : null}
    {screen === 'order' && selectedOrder ? <ScrollView contentContainerStyle={styles.content}><View style={styles.card}><Text style={styles.cardTitle}>{selectedOrder.displayCode} · {orderLabel(selectedOrder.status)}</Text>{selectedOrder.items.map((item) => <Line key={item.id} label={`${item.nameSnapshot} × ${item.quantity}`} amount={item.lineTotalIdr} />)}<View style={styles.divider} /><Line label="Subtotal" amount={selectedOrder.subtotalIdr} /><Line label="Ongkir" amount={selectedOrder.shippingAmountIdr} /><Line label="Total snapshot" amount={selectedOrder.totalIdr} strong /><Text style={styles.body}>{selectedOrder.addressSnapshot.recipientName} · {selectedOrder.addressSnapshot.phone}</Text><Text style={styles.body}>{selectedOrder.addressSnapshot.addressLine}, {selectedOrder.addressSnapshot.city}, {selectedOrder.addressSnapshot.province} {selectedOrder.addressSnapshot.postalCode}</Text></View>
      {selectedOrder.status === 'awaiting_payment' ? <View style={styles.card}><Text style={styles.cardTitle}>Pembayaran pesanan</Text>{payment ? <><Text style={styles.body}>Status {payment.status}; nominal server {rupiah(payment.amount)}.</Text>{payment.reference ? <Text style={styles.muted}>Referensi lokal: {payment.reference}</Text> : null}</> : null}{paymentQuoteAmount !== null ? <Text style={styles.body}>Quote server {rupiah(paymentQuoteAmount)} · IDR</Text> : null}{payment?.status === 'pending' || payment?.status === 'succeeded' ? <Text style={styles.muted}>Permintaan pembayaran tercatat. Status pending bukan konfirmasi pelunasan.</Text> : <><Text style={styles.body}>Metode pembayaran</Text><View style={styles.methodRow}><Button role="farmer" variant={paymentMethod === 'bank_transfer' ? 'primary' : 'secondary'} label="Transfer bank" onPress={() => setPaymentMethod('bank_transfer')} disabled={Boolean(payment?.status === 'failed')} /><Button role="farmer" variant={paymentMethod === 'e_wallet' ? 'primary' : 'secondary'} label="Dompet digital" onPress={() => setPaymentMethod('e_wallet')} disabled={Boolean(payment?.status === 'failed')} /></View><Button role="farmer" label={payment?.status === 'failed' ? 'Coba ajukan ulang' : 'Ajukan permintaan pembayaran'} loading={busy} disabled={busy || paymentQuoteAmount === null} onPress={() => void requestPayment()} /></>}<Text style={styles.muted}>Mode API memakai adapter lokal yang hanya mencatat status; tidak mengirim uang atau menghubungi provider.</Text></View> : null}
      <View style={styles.card}><Text style={styles.cardTitle}>Pengiriman</Text>{shipment?.events.length ? [...shipment.events].reverse().map((event) => <View key={event.id} style={styles.event}><Text style={styles.body}>{event.description}</Text><Text style={styles.muted}>{event.outcome} · {tanggal(event.occurredAt)}</Text></View>) : <Text style={styles.muted}>Belum ada event pengiriman dari server.</Text>}{shipment?.shipment?.trackingCode ? <Text style={styles.body}>Nomor pelacakan: {shipment.shipment.trackingCode}</Text> : null}</View>
    </ScrollView> : null}

    <Modal transparent visible={filterOpen} animationType="fade" onRequestClose={() => setFilterOpen(false)}><View style={styles.backdrop}><View style={styles.dialog}><Text accessibilityRole="header" style={styles.cardTitle}>Filter katalog</Text><Text style={styles.muted}>Kategori</Text>{['', 'care', 'supplement', 'equipment'].map((value) => <Button key={value || 'all'} role="farmer" variant={(filters.category ?? '') === value ? 'primary' : 'secondary'} label={value ? catalogCategoryLabel(value) : 'Semua kategori'} onPress={() => setFilters((current) => ({ ...current, category: value || undefined }))} />)}<Text style={styles.muted}>Jenis ternak</Text>{[{ value: undefined, label: 'Semua jenis' }, ...livestockSpecies.map((value) => ({ value, label: speciesLabel(value) }))].map((item) => <Button key={item.label} role="farmer" variant={filters.species === item.value ? 'primary' : 'secondary'} label={item.label} onPress={() => setFilters((current) => ({ ...current, species: item.value }))} />)}<Button role="farmer" label="Terapkan filter" onPress={() => { setFilterOpen(false); void search(); }} /><Button role="farmer" variant="secondary" label="Tutup" onPress={() => setFilterOpen(false)} /></View></View></Modal>
    <Modal transparent visible={addressOpen} animationType="fade" onRequestClose={() => setAddressOpen(false)}><View style={styles.backdrop}><View style={styles.dialog}><Text accessibilityRole="header" style={styles.cardTitle}>Pilih alamat pengiriman</Text>{addresses.length ? addresses.map((item) => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ selected: addressId === item.id }} onPress={() => setAddressId(item.id)} style={styles.address}><Text style={styles.cardTitle}>{item.label}</Text><Text style={styles.body}>{item.recipientName} · {item.phone}</Text><Text style={styles.muted}>{item.addressLine}, {item.city}, {item.province} {item.postalCode}</Text></Pressable>) : <EmptyState role="farmer" title="Alamat belum tersedia" description="Simpan alamat Peternak sebelum checkout." />}<Button role="farmer" label="Buat quote checkout" loading={busy} disabled={busy || !addressId} onPress={() => { setAddressOpen(false); void createQuote(); }} /><Button role="farmer" variant="secondary" label="Tutup" onPress={() => setAddressOpen(false)} /></View></View></Modal>
  </View>;
}

function mergeOrders(current: ApiOrder[], incoming: ApiOrder[]): ApiOrder[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

function Line({ label, amount, strong = false }: { label: string; amount: number; strong?: boolean }) {
  return <View style={styles.line}><Text style={[styles.body, strong && styles.strong]}>{label}</Text><Text style={[styles.body, strong && styles.strong]}>{rupiah(amount)}</Text></View>;
}

function orderLabel(status: ApiOrder['status']): string {
  return ({ awaiting_payment: 'Menunggu pembayaran', paid: 'Dibayar', processing: 'Diproses', shipped: 'Dikirim', delivered: 'Terkirim' } as const)[status];
}

function screenTitle(screen: Screen): string {
  return ({ catalog: 'Marketplace', product: 'Detail produk', cart: 'Keranjang', quote: 'Tinjau checkout', orders: 'Pesanan saya', order: 'Detail pesanan' } as const)[screen];
}

function rupiah(value: number): string { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value); }
function tanggal(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(date); }
function messageFor(cause: unknown): string { return cause instanceof Error ? cause.message : 'Permintaan belum berhasil. Coba muat ulang.'; }

const styles = StyleSheet.create({
  root: { gap: spacing[3] }, header: { gap: spacing[2], paddingHorizontal: spacing[4] },
  title: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.heading },
  tabs: { flexDirection: 'row', gap: spacing[1], padding: spacing[1], marginHorizontal: spacing[4], backgroundColor: colors.white, borderRadius: radii.cardFarmer },
  orderTabs: { flexDirection: 'row', gap: spacing[1], padding: spacing[1], backgroundColor: colors.white, borderRadius: radii.cardFarmer },
  orderTab: { minHeight: 44, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radii.button }, orderTabSelected: { backgroundColor: colors.orange },
  tab: { minHeight: 44, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radii.button }, tabSelected: { backgroundColor: colors.orange },
  tabText: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.small }, tabTextSelected: { color: colors.white },
  content: { gap: spacing[3], paddingHorizontal: spacing[4], paddingBottom: spacing[8] }, errorBox: { paddingHorizontal: spacing[4], gap: spacing[2] },
  card: { gap: spacing[2], padding: spacing[4], backgroundColor: colors.white, borderRadius: radii.cardFarmer },
  recovery: { gap: spacing[2], padding: spacing[4], backgroundColor: colors.gold, borderRadius: radii.cardFarmer },
  cardTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.section, lineHeight: 24 },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22 },
  muted: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 19 },
  price: { color: colors.orange, fontFamily: fonts.bold, fontSize: typeScale.heading },
  link: { minHeight: 44, color: colors.orange, fontFamily: fonts.semiBold, textAlignVertical: 'center' },
  filterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing[2] },
  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexWrap: 'wrap' }, quantity: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.heading, minWidth: 32, textAlign: 'center' },
  line: { minHeight: 30, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing[2] },
  divider: { height: 1, backgroundColor: colors.gold }, strong: { color: colors.brown, fontFamily: fonts.bold },
  methodRow: { flexDirection: 'row', gap: spacing[2] }, event: { gap: spacing[1], paddingVertical: spacing[2], borderBottomWidth: 1, borderBottomColor: colors.gold },
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing[5], backgroundColor: 'rgba(32,20,16,0.55)' },
  dialog: { maxHeight: '88%', gap: spacing[2], padding: spacing[4], backgroundColor: colors.cream, borderRadius: radii.cardFarmer },
  address: { gap: spacing[1], padding: spacing[3], backgroundColor: colors.white, borderRadius: radii.cardFarmer },
});
