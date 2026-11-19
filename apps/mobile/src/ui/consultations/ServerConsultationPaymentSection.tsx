import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ApiPaymentGateway, ApiPaymentSnapshot } from '../../application/ApiPaymentGateway';
import type { ApiPaymentQuote } from '../../application/ports/ApiPaymentRepository';
import type { PaymentMethod } from '../../application/PaymentService';
import { Button } from '../components/Button';
import { LoadingState } from '../components/Feedback';
import { colors, fonts, radii, spacing } from '../theme/tokens';

export function ServerConsultationPaymentSection({ gateway, consultationId, expectedAmountIdr, onExit, onPaymentSaved }: {
  gateway: ApiPaymentGateway;
  consultationId: string;
  expectedAmountIdr: number;
  onExit: () => void;
  onPaymentSaved: () => void;
}) {
  const [quote, setQuote] = useState<ApiPaymentQuote | null>(null);
  const [payment, setPayment] = useState<ApiPaymentSnapshot | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [loading, setLoading] = useState(true);
  const [statusChecked, setStatusChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setStatusChecked(false);
    setError('');
    try {
      const [nextQuote, nextPayment] = await Promise.all([
        gateway.getQuote('consultation', consultationId),
        gateway.getPaymentForPayable('consultation', consultationId),
      ]);
      if (nextQuote.amountIdr !== expectedAmountIdr) {
        throw new Error('Quote terbaru berbeda dari tarif konsultasi. Muat ulang detail konsultasi sebelum melanjutkan.');
      }
      if (nextPayment && (nextPayment.payableType !== 'consultation'
        || nextPayment.payableId !== consultationId || nextPayment.amount !== nextQuote.amountIdr)) {
        throw new Error('Catatan pembayaran tidak cocok dengan tagihan konsultasi. Periksa status server sebelum melanjutkan.');
      }
      setQuote(nextQuote);
      setPayment(nextPayment);
      if (nextPayment) setMethod(nextPayment.method);
      setStatusChecked(true);
    } catch (cause) {
      setQuote(null);
      setPayment(null);
      setError(cause instanceof Error ? cause.message : 'Status pembayaran belum dapat dimuat.');
    } finally {
      setLoading(false);
    }
  }, [consultationId, expectedAmountIdr, gateway]);

  useEffect(() => {
    const timer = setTimeout(() => { void reload(); }, 0);
    return () => clearTimeout(timer);
  }, [reload]);

  const submit = async () => {
    if (!statusChecked || !quote || busy || hasActivePayment(payment)
      || (payment && payment.method !== method)) return;
    setBusy(true);
    setError('');
    try {
      const saved = await gateway.submit('farmer', 'consultation', consultationId, method);
      if (saved.amount !== quote.amountIdr || saved.payableId !== consultationId) {
        throw new Error('Hasil permintaan tidak cocok dengan quote server. Muat ulang status pembayaran.');
      }
      setPayment(saved);
      onPaymentSaved();
    } catch (cause) {
      setStatusChecked(false);
      setError(cause instanceof Error
        ? `${cause.message} Muat ulang status sebelum mencoba lagi.`
        : 'Hasil permintaan belum dapat dipastikan. Muat ulang status sebelum mencoba lagi.');
    } finally {
      setBusy(false);
    }
  };

  const retry = payment !== null && (payment.status === 'failed' || payment.status === 'expired');
  const active = hasActivePayment(payment);
  return <View style={styles.root}>
    <View style={styles.header}>
      <Button role="farmer" variant="secondary" label="Kembali" disabled={busy} onPress={onExit} />
      <Text accessibilityRole="header" style={styles.title}>Pembayaran konsultasi</Text>
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {loading ? <LoadingState label="Memuat quote dan status pembayaran…" /> : null}
      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      {!loading && quote ? <View style={styles.card}>
        <Text style={styles.label}>Total tagihan dari server</Text>
        <Text style={styles.amount}>{formatRupiah(quote.amountIdr)}</Text>
        {payment ? <>
          <Text style={styles.label}>Status pembayaran</Text>
          <Text accessibilityLiveRegion="polite" style={styles.status}>{statusLabel(payment.status)}</Text>
          <Text style={styles.copy}>{payment.status === 'succeeded'
            ? 'Server mencatat pembayaran berhasil.'
            : payment.status === 'failed' || payment.status === 'expired'
              ? 'Permintaan sebelumnya tidak berhasil. Jika mencoba lagi, metode pembayaran harus tetap sama.'
              : 'Tagihan masih menunggu konfirmasi. Status ini belum berarti tagihan lunas.'}</Text>
        </> : <Text style={styles.copy}>Pilih metode untuk menyimpan permintaan. Langkah ini belum memindahkan dana atau melunasi tagihan.</Text>}
        {(['bank_transfer', 'e_wallet'] as const).map((value) => <Pressable
          key={value}
          accessibilityRole="radio"
          accessibilityState={{ selected: method === value, disabled: busy || loading || (payment !== null) }}
          disabled={busy || loading || payment !== null}
          onPress={() => setMethod(value)}
          style={[styles.option, method === value && styles.selected, payment !== null && styles.locked]}
        >
          <Text style={styles.radio}>{method === value ? '●' : '○'}</Text>
          <Text style={styles.optionText}>{value === 'bank_transfer' ? 'Transfer bank' : 'Dompet digital'}</Text>
        </Pressable>)}
        {!active ? <Button
          role="farmer"
          label={retry ? 'Coba lagi dengan metode yang sama' : 'Simpan permintaan pembayaran'}
          loading={busy}
          disabled={!statusChecked || loading || busy || (payment !== null && !retry)}
          onPress={() => { void submit(); }}
        /> : null}
      </View> : null}
      {!statusChecked && !loading ? <Button role="farmer" variant="secondary" label="Muat ulang quote dan status" disabled={busy} onPress={() => { void reload(); }} /> : null}
      <Text style={styles.note}>Status tagihan hanya berubah setelah hasil yang sah tersimpan di server. Tidak ada pemindahan dana dari layar ini.</Text>
      <Button role="farmer" variant="secondary" label="Kembali ke konsultasi" disabled={busy} onPress={onExit} />
    </ScrollView>
  </View>;
}

function hasActivePayment(payment: ApiPaymentSnapshot | null): boolean {
  return payment?.status === 'pending' || payment?.status === 'succeeded';
}

function statusLabel(status: ApiPaymentSnapshot['status']): string {
  return status === 'succeeded' ? 'Berhasil' : status === 'failed' ? 'Gagal' : status === 'expired' ? 'Kedaluwarsa' : 'Menunggu konfirmasi';
}

function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

const styles = StyleSheet.create({
  root: { gap: spacing[3] },
  header: { gap: spacing[2], paddingHorizontal: spacing[4] },
  title: { color: colors.brown, fontFamily: fonts.bold, fontSize: 21 },
  content: { gap: spacing[4], paddingHorizontal: spacing[4], paddingBottom: spacing[6] },
  card: { padding: spacing[4], backgroundColor: colors.white, borderRadius: radii.cardFarmer, gap: spacing[3] },
  label: { color: colors.brown, fontFamily: fonts.medium },
  amount: { color: colors.brown, fontFamily: fonts.bold, fontSize: 24 },
  copy: { color: colors.muted, fontFamily: fonts.regular, lineHeight: 21 },
  status: { color: colors.brown, fontFamily: fonts.bold },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[3], borderWidth: 1, borderColor: colors.muted, borderRadius: radii.cardFarmer },
  selected: { borderColor: colors.brown },
  locked: { opacity: 0.72 },
  radio: { width: 24, color: colors.brown, fontSize: 20 },
  optionText: { color: colors.brown, fontFamily: fonts.medium },
  error: { color: colors.brown, fontFamily: fonts.medium, lineHeight: 21 },
  note: { color: colors.muted, fontFamily: fonts.regular, lineHeight: 21 },
});
