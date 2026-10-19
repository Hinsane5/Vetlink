import { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { SessionSnapshot } from '../../domain/auth';
import type { FarmerProfileInput } from '../../domain/profiles';
import type {
  CartSnapshot,
  CheckoutAddressInput,
  CheckoutAddressSnapshot,
  CheckoutQuoteSnapshot,
  OrderSnapshot,
} from '../../domain/commerce';
import { DomainError } from '../../domain/errors';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, InlineFeedback, LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { TextField } from '../components/TextField';
import { colors, fonts, layout, radii, roleTokens, spacing, typeScale } from '../theme/tokens';
import { PaymentPanel } from '../payment/PaymentPanel';

type Screen = 'cart' | 'checkout' | 'order' | 'payment';
type AddressField = keyof CheckoutAddressInput;

type Props = {
  store: LocalStore;
  session: SessionSnapshot;
  onExit: () => void;
};

const emptyAddress: CheckoutAddressInput = {
  label: 'Alamat pengiriman',
  recipient: '',
  phone: '',
  address: '',
  city: '',
  province: '',
  postalCode: '',
};

export function CartCheckoutFlow({ store, session, onExit }: Props) {
  const [screen, setScreen] = useState<Screen>('cart');
  const [cart, setCart] = useState<CartSnapshot | null>(null);
  const [addresses, setAddresses] = useState<CheckoutAddressSnapshot[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [address, setAddress] = useState<CheckoutAddressInput>(emptyAddress);
  const [quote, setQuote] = useState<CheckoutQuoteSnapshot | null>(null);
  const [order, setOrder] = useState<OrderSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);

  const reload = async () => {
    setError('');
    try {
      const next = await store.commerce.getCart(session.userId, session.activeRole);
      setCart(next);
    } catch (cause) {
      setCart(null);
      setError(messageFor(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [nextCart, nextAddresses, profile] = await Promise.all([
          store.commerce.getCart(session.userId, session.activeRole),
          store.commerce.listAddresses(session.userId, session.activeRole),
          store.profiles.load(session.userId, 'farmer'),
        ]);
        if (!mounted) return;
        setCart(nextCart);
        setAddresses(nextAddresses);
        const initialAddress = nextAddresses[0] ?? fromProfile(profile.farmer);
        setSelectedAddressId(nextAddresses[0]?.id ?? null);
        setAddress(initialAddress);
      } catch (cause) {
        if (mounted) setError(messageFor(cause));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    const request = setTimeout(() => { void load(); }, 0);
    return () => { mounted = false; clearTimeout(request); };
  }, [session.activeRole, session.userId, store]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'checkout') {
        setScreen('cart');
        return true;
      }
      if (screen === 'order' || screen === 'cart') {
        onExit();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [onExit, screen]);

  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const changeQuantity = (productId: string, quantity: number) => run(async () => {
    const updated = await store.commerce.setQuantity(session.userId, session.activeRole, productId, quantity);
    setCart(updated);
    setQuote(null);
  });

  const removeItem = (productId: string) => run(async () => {
    const updated = await store.commerce.removeItem(session.userId, session.activeRole, productId);
    setCart(updated);
    setQuote(null);
  });

  const openCheckout = () => run(async () => {
    const next = await store.commerce.getCart(session.userId, session.activeRole);
    setCart(next);
    setError('');
    setScreen('checkout');
  });

  const createQuote = () => run(async () => {
    const next = await store.commerce.createQuote(session.userId, session.activeRole, {
      addressId: selectedAddressId,
      address: selectedAddressId ? undefined : address,
    });
    setQuote(next);
    setError('');
  });

  const submitOrder = () => run(async () => {
    if (!quote) throw new DomainError('INVALID_STATE', 'Tinjau biaya dan ongkir sebelum membuat pesanan.');
    let next: OrderSnapshot;
    try {
      next = await store.commerce.submitOrder(session.userId, session.activeRole, quote.id);
    } catch (cause) {
      if (cause instanceof DomainError && ['INVALID_STATE', 'VERSION_CONFLICT'].includes(cause.code)) setQuote(null);
      throw cause;
    }
    setOrder(next);
    setScreen('order');
  });

  const selectAddress = (item: CheckoutAddressSnapshot) => {
    setSelectedAddressId(item.id);
    setAddress(stripId(item));
    setQuote(null);
    setError('');
  };

  const startNewAddress = async () => {
    try {
      const profile = await store.profiles.load(session.userId, 'farmer');
      setSelectedAddressId(null);
      setAddress(fromProfile(profile.farmer));
      setQuote(null);
      setError('');
    } catch (cause) {
      setError(messageFor(cause));
    }
  };

  const changeAddress = (field: AddressField, value: string) => {
    setSelectedAddressId(null);
    setAddress((current) => ({ ...current, [field]: value }));
    setQuote(null);
    setError('');
  };

  const back = () => {
    if (screen === 'payment') { setScreen('order'); return; }
    if (screen === 'checkout') setScreen('cart');
    else onExit();
  };

  if (screen === 'payment' && order) return <PaymentPanel store={store} session={session} payableType="order" payableId={order.id} amount={order.totalAmount} onBack={() => setScreen('order')} />;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={screen === 'checkout' ? 'Kembali ke keranjang' : 'Kembali ke Marketplace'} onPress={back} style={styles.back}>
          <Icon name="arrow-left" size={22} color={colors.brown} />
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>{screen === 'cart' ? 'Keranjang' : screen === 'checkout' ? 'Checkout' : 'Pesanan tersimpan'}</Text>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {error ? screen === 'cart' ? <ErrorState role="farmer" message={error} onRetry={() => { setLoading(true); void reload(); }} /> : <InlineFeedback message={error} tone="error" /> : null}
        {loading ? <LoadingState label="Memuat keranjang…" /> : screen === 'order' && order ? (
          <OrderConfirmation order={order} onReturn={onExit} onPay={() => setScreen('payment')} />
        ) : screen === 'checkout' ? (
          <CheckoutScreen
            addresses={addresses}
            selectedAddressId={selectedAddressId}
            address={address}
            quote={quote}
            busy={busy}
            onSelectAddress={selectAddress}
            onNewAddress={() => void startNewAddress()}
            onChangeAddress={changeAddress}
            onCreateQuote={() => void createQuote()}
            onSubmitOrder={() => void submitOrder()}
          />
        ) : cart && cart.lines.length ? (
          <>
            <Text style={styles.intro}>Periksa jumlah dan harga terkini sebelum melanjutkan.</Text>
            {cart.lines.map((line) => (
              <View key={line.cartItemId} style={styles.cartCard}>
                <View style={styles.productCopy}>
                  <Text style={styles.productName}>{line.name}</Text>
                  {line.available ? <>
                    <Text style={styles.secondary}>{rupiah(line.unitPrice!)} per unit</Text>
                    <Text style={styles.lineTotal}>{rupiah(line.lineTotal!)}</Text>
                  </> : <Text style={styles.unavailable}>Produk tidak tersedia. Hapus item ini untuk melanjutkan.</Text>}
                </View>
                {line.available ? <View style={styles.quantityControl}>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Kurangi jumlah ${line.name}`} accessibilityState={{ disabled: busy || line.quantity <= 1 }} disabled={busy || line.quantity <= 1} onPress={() => changeQuantity(line.productId, line.quantity - 1)} style={[styles.quantityButton, (busy || line.quantity <= 1) && styles.disabled]}>
                      <Icon name="minus" size={18} color={colors.brown} />
                    </Pressable>
                    <Text accessibilityLabel={`Jumlah ${line.quantity}`} style={styles.quantity}>{line.quantity}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Tambah jumlah ${line.name}`} accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => changeQuantity(line.productId, line.quantity + 1)} style={[styles.quantityButton, busy && styles.disabled]}>
                      <Icon name="plus" size={18} color={colors.brown} />
                    </Pressable>
                  </View> : null}
                <Pressable accessibilityRole="button" accessibilityLabel={`Hapus ${line.name} dari keranjang`} disabled={busy} onPress={() => removeItem(line.productId)} style={[styles.removeButton, busy && styles.disabled]}>
                  <Icon name="trash-2" size={19} color={colors.brown} />
                  <Text style={styles.removeText}>Hapus</Text>
                </Pressable>
              </View>
            ))}
            <View style={styles.summaryCard}>
              <SummaryLine label="Subtotal produk" amount={cart.subtotal} />
              <Text style={styles.secondary}>Ongkir dihitung setelah alamat pengiriman dipilih.</Text>
              {cart.hasUnavailableItems ? <InlineFeedback message="Hapus produk yang tidak tersedia sebelum checkout." tone="error" /> : null}
              <Button role="farmer" label="Lanjut ke Checkout" loading={busy} disabled={cart.hasUnavailableItems || !cart.lines.length} onPress={() => void openCheckout()} />
            </View>
          </>
        ) : !error ? (
          <EmptyState role="farmer" title="Keranjang kosong" description="Pilih produk dari Marketplace untuk memulai pembelian." actionLabel="Kembali ke Marketplace" onAction={onExit} />
        ) : null}
      </ScrollView>
    </View>
  );
}

function CheckoutScreen({
  addresses,
  selectedAddressId,
  address,
  quote,
  busy,
  onSelectAddress,
  onNewAddress,
  onChangeAddress,
  onCreateQuote,
  onSubmitOrder,
}: {
  addresses: CheckoutAddressSnapshot[];
  selectedAddressId: string | null;
  address: CheckoutAddressInput;
  quote: CheckoutQuoteSnapshot | null;
  busy: boolean;
  onSelectAddress: (address: CheckoutAddressSnapshot) => void;
  onNewAddress: () => void;
  onChangeAddress: (field: AddressField, value: string) => void;
  onCreateQuote: () => void;
  onSubmitOrder: () => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.intro}>Alamat wajib diisi. Perubahan alamat akan menghitung ulang ongkir.</Text>
      {addresses.length ? <>
        <Text style={styles.sectionHeading}>Alamat tersimpan</Text>
        {addresses.map((item) => (
          <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ selected: selectedAddressId === item.id }} onPress={() => onSelectAddress(item)} style={[styles.addressOption, selectedAddressId === item.id && styles.addressSelected]}>
            <View style={styles.addressIcon}><Icon name={selectedAddressId === item.id ? 'circle-dot' : 'circle'} size={20} color={colors.brown} /></View>
            <View style={styles.addressCopy}>
              <Text style={styles.productName}>{item.label}</Text>
              <Text style={styles.secondary}>{item.recipient} · {item.phone}</Text>
              <Text style={styles.secondary}>{formatAddress(item)}</Text>
            </View>
          </Pressable>
        ))}
        <Button role="farmer" variant="secondary" label="Gunakan alamat baru" disabled={busy} onPress={onNewAddress} />
      </> : <Text style={styles.sectionHeading}>Alamat pengiriman</Text>}

      {!selectedAddressId ? <View style={styles.section}>
        <TextField label="Label alamat" value={address.label} maxLength={80} onChangeText={(value) => onChangeAddress('label', value)} placeholder="Rumah, kandang, atau lainnya" />
        <TextField label="Nama penerima" value={address.recipient} maxLength={80} onChangeText={(value) => onChangeAddress('recipient', value)} placeholder="Nama penerima" />
        <TextField label="Nomor telepon" value={address.phone} maxLength={20} keyboardType="phone-pad" onChangeText={(value) => onChangeAddress('phone', value)} placeholder="08xxxxxxxxxx" />
        <TextField label="Alamat lengkap" value={address.address} maxLength={240} multiline onChangeText={(value) => onChangeAddress('address', value)} placeholder="Jalan, nomor, RT/RW, dan patokan" />
        <TextField label="Kota/kabupaten" value={address.city} maxLength={80} onChangeText={(value) => onChangeAddress('city', value)} placeholder="Kota atau kabupaten" />
        <TextField label="Provinsi" value={address.province} maxLength={80} onChangeText={(value) => onChangeAddress('province', value)} placeholder="Provinsi" />
        <TextField label="Kode pos" value={address.postalCode} maxLength={5} keyboardType="number-pad" onChangeText={(value) => onChangeAddress('postalCode', value.replace(/\D/g, '').slice(0, 5))} placeholder="5 digit" />
      </View> : null}

      {quote ? <View style={styles.summaryCard}>
        <Text style={styles.sectionHeading}>Ringkasan biaya</Text>
        {quote.lines.map((line) => <SummaryLine key={line.cartItemId} label={`${line.nameSnapshot} × ${line.quantity}`} amount={line.lineTotal} />)}
        <SummaryLine label="Subtotal produk" amount={quote.subtotal} />
        <SummaryLine label={quote.shippingLabel} amount={quote.shippingAmount} />
        <View style={styles.divider} />
        <SummaryLine label="Total pesanan" amount={quote.totalAmount} strong />
        <Text style={styles.secondary}>Ringkasan berlaku sampai {localDateTime(quote.expiresAt)}. Ongkir memakai aturan lokal dan tidak memesan kurir.</Text>
      </View> : null}

      <Button role="farmer" label={quote ? 'Buat Pesanan Menunggu Pembayaran' : 'Tinjau Biaya dan Ongkir'} loading={busy} onPress={quote ? onSubmitOrder : onCreateQuote} />
      <Text style={styles.secondary}>Pesanan baru berstatus menunggu pembayaran. Belum ada pembayaran yang dilakukan.</Text>
    </View>
  );
}

function OrderConfirmation({ order, onReturn, onPay }: { order: OrderSnapshot; onReturn: () => void; onPay: () => void }) {
  return (
    <View style={styles.orderCard}>
      <View style={styles.orderIcon}><Icon name="package-check" size={32} color={colors.brown} /></View>
      <Text accessibilityRole="header" style={styles.orderTitle}>Pesanan tersimpan</Text>
      <Text style={styles.body}>Nomor {order.displayCode}</Text>
      <Text style={styles.status}>Menunggu pembayaran</Text>
      {order.items.map((item) => <SummaryLine key={item.id} label={`${item.nameSnapshot} × ${item.quantity}`} amount={item.lineTotal} />)}
      <SummaryLine label="Ongkir" amount={order.shippingAmount} />
      <SummaryLine label="Total pesanan" amount={order.totalAmount} strong />
      <Text style={styles.secondary}>Alamat tujuan disimpan pada pesanan: {formatAddress(order.address)}</Text>
      <Text style={styles.secondary}>Pembayaran belum dilakukan.</Text>
      <Button role="farmer" label="Lanjut ke Pembayaran" onPress={onPay} />
      <Button role="farmer" variant="secondary" label="Kembali ke Marketplace" onPress={onReturn} />
    </View>
  );
}

function SummaryLine({ label, amount, strong = false }: { label: string; amount: number; strong?: boolean }) {
  return <View style={styles.summaryLine}>
    <Text style={[styles.secondary, strong && styles.strong]}>{label}</Text>
    <Text style={[styles.amount, strong && styles.strong]}>{rupiah(amount)}</Text>
  </View>;
}

function fromProfile(input: FarmerProfileInput | null): CheckoutAddressInput {
  return input ? {
    label: input.addressLabel || 'Alamat pengiriman',
    recipient: input.recipient,
    phone: input.phone,
    address: input.address,
    city: input.city,
    province: input.province,
    postalCode: input.postalCode,
  } : { ...emptyAddress };
}

function stripId(address: CheckoutAddressSnapshot): CheckoutAddressInput {
  const { id: _id, ...input } = address;
  return input;
}

function formatAddress(address: CheckoutAddressInput): string {
  return [address.address, address.city, address.province, address.postalCode].filter(Boolean).join(', ');
}

function rupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}

function localDateTime(value: string): string {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value));
}

function messageFor(error: unknown): string {
  return error instanceof DomainError ? error.message : 'Keranjang atau checkout belum dapat dimuat. Coba lagi.';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingHorizontal: layout.contentHorizontal, paddingVertical: spacing[2] },
  back: { width: 48, height: 48, borderRadius: radii.button, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: colors.brown, fontFamily: fonts.bold, fontSize: 21, lineHeight: 28, flexShrink: 1 },
  content: { flexGrow: 1, width: '100%', maxWidth: 480, alignSelf: 'center', gap: spacing[3], padding: spacing[4], paddingBottom: spacing[8] },
  intro: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22, flexShrink: 1 },
  section: { gap: spacing[3] },
  sectionHeading: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.section, lineHeight: 24, flexShrink: 1 },
  cartCard: { gap: spacing[3], padding: spacing[4], borderRadius: roleTokens.farmer.cardRadius, backgroundColor: colors.white },
  productCopy: { gap: spacing[1] },
  productName: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.body, lineHeight: 21, flexShrink: 1 },
  secondary: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 19, flexShrink: 1 },
  lineTotal: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.body, lineHeight: 21 },
  unavailable: { color: colors.orange, fontFamily: fonts.medium, fontSize: typeScale.small, lineHeight: 19, flexShrink: 1 },
  quantityControl: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  quantityButton: { width: 44, minHeight: 44, borderRadius: radii.button, borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' },
  quantity: { minWidth: 38, textAlign: 'center', color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.body },
  disabled: { opacity: 0.45 },
  removeButton: { alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[2] },
  removeText: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.body },
  summaryCard: { gap: spacing[3], padding: spacing[4], borderRadius: roleTokens.farmer.cardRadius, backgroundColor: colors.white },
  summaryLine: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing[2], alignItems: 'center' },
  amount: { color: colors.dark, fontFamily: fonts.medium, fontSize: typeScale.body, textAlign: 'right', flexShrink: 1 },
  strong: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.body },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.gold },
  addressOption: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[3], borderWidth: 1, borderColor: colors.gold, borderRadius: roleTokens.farmer.cardRadius, backgroundColor: colors.white },
  addressSelected: { borderWidth: 2, borderColor: colors.brown },
  addressIcon: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  addressCopy: { flex: 1, gap: spacing[1], minWidth: 0 },
  orderCard: { gap: spacing[3], padding: spacing[5], borderRadius: roleTokens.farmer.cardRadius, backgroundColor: colors.white },
  orderIcon: { width: 64, height: 64, alignSelf: 'center', borderRadius: 32, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' },
  orderTitle: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.heading, lineHeight: 28, textAlign: 'center', flexShrink: 1 },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22, flexShrink: 1 },
  status: { alignSelf: 'flex-start', paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: radii.pill, backgroundColor: colors.cream, color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.small },
});
