import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { SessionSnapshot } from '../../domain/auth';
import type { PayableType, PaymentMethod, PaymentSnapshot } from '../../application/PaymentService';
import { Button } from '../components/Button';
import { EmptyState, InlineFeedback } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { colors, fonts, radii, spacing } from '../theme/tokens';

export function PaymentPanel({ store, session, payableType, payableId, amount, onBack }: { store: LocalStore; session: SessionSnapshot; payableType?: PayableType; payableId?: string; amount?: number; onBack: () => void }) {
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [items, setItems] = useState<PaymentSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reload = useCallback(() => store.payments.list(session.userId, session.activeRole).then(setItems).catch(() => setError('Riwayat pembayaran belum dapat dimuat.')), [session.activeRole, session.userId, store]);
  useEffect(() => { void reload(); }, [reload]);
  const submit = async () => {
    if (!payableId || !payableType) return;
    const related = items.filter((item) => item.payableType === payableType && item.payableId === payableId);
    if (related.some((item) => item.status === 'pending' || item.status === 'succeeded')) return;
    setBusy(true); setError('');
    const attempt = related.filter((item) => item.status === 'failed' || item.status === 'expired').length;
    try { await store.payments.submit(session.userId, session.activeRole, payableType, payableId, method, `pay:${payableType}:${payableId}:${method}:${attempt}`); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Pembayaran belum dapat disimpan.'); }
    finally { setBusy(false); }
  };
  return <View style={styles.root}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Kembali" onPress={onBack} style={styles.back}><Icon name="arrow-left" size={22} color={colors.brown} /></Pressable><Text accessibilityRole="header" style={styles.title}>Pembayaran</Text></View>
    <ScrollView contentContainerStyle={styles.content}>
      {error ? <InlineFeedback message={error} tone="error" /> : null}
      {payableId && amount !== undefined ? <View style={styles.card}><Text style={styles.label}>Total tagihan</Text><Text style={styles.amount}>{rupiah(amount)}</Text><Text style={styles.copy}>Pilih metode untuk menyimpan permintaan pembayaran. Memilih metode tidak membayar tagihan.</Text>
        {(['bank_transfer', 'e_wallet'] as const).map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: method === value }} onPress={() => setMethod(value)} style={[styles.option, method === value && styles.selected]}><Icon name={method === value ? 'circle-dot' : 'circle'} size={20} color={colors.brown} /><Text style={styles.optionText}>{value === 'bank_transfer' ? 'Transfer bank' : 'Dompet digital'}</Text></Pressable>)}
        <Button role="farmer" label={items.some((item) => item.payableType === payableType && item.payableId === payableId && item.status === 'failed') ? 'Coba lagi' : 'Kirim permintaan pembayaran'} loading={busy} disabled={items.some((item) => item.payableType === payableType && item.payableId === payableId && ['pending', 'succeeded'].includes(item.status))} onPress={() => void submit()} />
      </View> : null}
      <Text style={styles.heading}>Riwayat pembayaran</Text>
      {items.length ? items.map((item) => <View key={item.id} style={styles.card}><Text style={styles.optionText}>{item.payableType === 'consultation' ? 'Konsultasi' : 'Pesanan produk'} · {item.payableId.slice(-8)}</Text><Text style={styles.copy}>{rupiah(item.amount)} · {item.method === 'bank_transfer' ? 'Transfer bank' : 'Dompet digital'}</Text><Text style={styles.status}>{statusLabel(item.status)}</Text><Text style={styles.copy}>{item.message}</Text></View>) : <EmptyState role="farmer" title="Belum ada pembayaran" description="Pembayaran yang dikirim akan tampil di sini." />}
      <Button role="farmer" variant="secondary" label="Kembali" onPress={onBack} />
    </ScrollView>
  </View>;
}
function rupiah(value: number) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value); }
function statusLabel(status: string) { return status === 'succeeded' ? 'Berhasil' : status === 'failed' ? 'Gagal' : status === 'expired' ? 'Kedaluwarsa' : 'Menunggu konfirmasi'; }
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.cream }, header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], gap: spacing[2] }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, title: { fontFamily: fonts.bold, fontSize: 21, color: colors.brown }, content: { padding: spacing[4], gap: spacing[4] }, card: { padding: spacing[4], backgroundColor: colors.white, borderRadius: radii.cardFarmer, gap: spacing[2] }, label: { fontFamily: fonts.medium, color: colors.brown }, amount: { fontFamily: fonts.bold, fontSize: 24, color: colors.brown }, copy: { fontFamily: fonts.regular, color: colors.muted, lineHeight: 21 }, option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[2], borderRadius: radii.cardFarmer, borderWidth: 1, borderColor: colors.muted }, selected: { borderColor: colors.brown }, optionText: { fontFamily: fonts.medium, color: colors.brown, flex: 1 }, heading: { fontFamily: fonts.bold, fontSize: 18, color: colors.brown }, status: { fontFamily: fonts.bold, color: colors.brown } });
