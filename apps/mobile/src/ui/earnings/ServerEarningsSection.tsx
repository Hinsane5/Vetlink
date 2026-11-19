import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DomainError } from '../../domain/errors';
import type { ApiEarningTransaction, ApiWithdrawal } from '../../application/ports/ApiEarningsRepository';
import type { ServerEarningsService, ServerEarningsSnapshot } from '../../application/ServerEarningsService';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, InlineFeedback, LoadingState } from '../components/Feedback';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { Icon } from '../components/Icon';
import { TextField } from '../components/TextField';
import { colors, fonts, radii, spacing, typeScale } from '../theme/tokens';

type Screen = 'overview' | 'transaction' | 'amount' | 'review' | 'submitted' | 'history' | 'withdrawal';
type Sheet = 'period' | 'destination' | null;

export function ServerEarningsSection({ service, userId, onExit, backHandlerRef }: {
  service: ServerEarningsService;
  userId: string;
  onExit: () => void;
  backHandlerRef: { current: (() => boolean) | null };
}) {
  const [screen, setScreen] = useState<Screen>('overview');
  const [stack, setStack] = useState<Screen[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [snapshot, setSnapshot] = useState<ServerEarningsSnapshot | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<ApiEarningTransaction | null>(null);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<ApiWithdrawal | null>(null);
  const [period, setPeriod] = useState<string | undefined>();
  const [destinationId, setDestinationId] = useState('');
  const [amountText, setAmountText] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [leaveVisible, setLeaveVisible] = useState(false);
  const [error, setError] = useState('');
  const [pendingAmount, setPendingAmount] = useState<number | null>(null);
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await service.load('vet', userId, period);
      setSnapshot(next);
      setPendingAmount(next.pendingWithdrawal?.amount ?? null);
      setDestinationId((current) => next.destinations.some((item) => item.id === current)
        ? current : next.destinations[0]?.id ?? '');
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setLoading(false);
    }
  }, [period, service, userId]);

  useEffect(() => {
    const request = setTimeout(() => { void reload(); }, 0);
    return () => clearTimeout(request);
  }, [reload]);

  const go = (next: Screen) => {
    setStack((current) => [...current, screen]);
    setScreen(next);
    setError('');
  };

  const back = useCallback(() => {
    if (busy) return true;
    if (confirmVisible) { setConfirmVisible(false); return true; }
    if (leaveVisible) { setLeaveVisible(false); return true; }
    if (sheet) { setSheet(null); return true; }
    if ((screen === 'amount' || screen === 'review') && amountText.length > 0) {
      setLeaveVisible(true);
      return true;
    }
    const previous = stack.at(-1);
    if (previous) {
      setStack((current) => current.slice(0, -1));
      setScreen(previous);
      setError('');
    } else if (screen === 'review' || screen === 'amount' || screen === 'transaction' || screen === 'withdrawal' || screen === 'history' || screen === 'submitted') {
      setScreen('overview');
      setStack([]);
      setError('');
    } else onExit();
    return true;
  }, [amountText, busy, confirmVisible, leaveVisible, onExit, screen, sheet, stack]);

  useEffect(() => {
    backHandlerRef.current = back;
    const listener = BackHandler.addEventListener('hardwareBackPress', back);
    return () => {
      backHandlerRef.current = null;
      listener.remove();
    };
  }, [back, backHandlerRef]);

  const openTransaction = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      setSelectedTransaction(await service.getTransaction('vet', userId, id));
      go('transaction');
    } catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  };

  const openWithdrawal = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      setSelectedWithdrawal(await service.getWithdrawal('vet', userId, id));
      go('withdrawal');
    } catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  };

  const amount = /^\d+$/.test(amountText) ? Number(amountText) : Number.NaN;
  const selectedDestination = snapshot?.destinations.find((item) => item.id === destinationId) ?? null;
  const amountValid = Number.isSafeInteger(amount) && amount > 0
    && Boolean(snapshot && amount <= snapshot.balances.available)
    && Boolean(selectedDestination) && !pendingAmount;

  const submit = async () => {
    if (inFlight.current || !amountValid || !selectedDestination) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await service.submitWithdrawal('vet', userId, amount, selectedDestination.id);
      setSelectedWithdrawal(result.withdrawal);
      setPendingAmount(null);
      setAmountText('');
      setConfirmVisible(false);
      setStack([]);
      setScreen('submitted');
      await reload();
    } catch (cause) {
      setError(messageFor(cause));
      try { setPendingAmount((await service.readPending('vet', userId))?.amount ?? null); }
      catch { setPendingAmount(amount); }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const retryPending = async () => {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await service.retryPending('vet', userId);
      setSelectedWithdrawal(result.withdrawal);
      setPendingAmount(null);
      setStack([]);
      setScreen('submitted');
      await reload();
    } catch (cause) {
      setError(messageFor(cause));
      try { setPendingAmount((await service.readPending('vet', userId))?.amount ?? null); }
      catch { /* Preserve the existing recovery gate when secure storage is unavailable. */ }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const title = screenTitle(screen);
  return <View style={styles.root}>
    <View style={styles.header}>
      <Button role="vet" variant="secondary" label="Kembali" disabled={busy} onPress={back} />
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {error ? <><InlineFeedback message={error} tone="error" /><Button role="vet" variant="secondary" label="Muat ulang status server" loading={loading} disabled={busy} onPress={() => void reload()} /></> : null}
      {loading && !snapshot ? <LoadingState label="Memuat pendapatan…" /> : null}
      {!loading && !snapshot ? <ErrorState message={error || 'Pendapatan belum dapat dimuat.'} role="vet" onRetry={() => void reload()} /> : null}
      {snapshot && screen === 'overview' ? <View style={styles.sections}>
        <View style={styles.periodRow}>
          <Text style={styles.sectionTitle}>{snapshot.periodLabel}</Text>
          <Button label="Pilih periode" role="vet" variant="secondary" onPress={() => setSheet('period')} />
        </View>
        <View style={styles.card}>
          <Text style={styles.muted}>Saldo tersedia</Text>
          <Text style={styles.balance}>{rupiah(snapshot.balances.available)}</Text>
          <Text style={styles.body}>Menunggu {rupiah(snapshot.balances.pending)}</Text>
          <Text style={styles.body}>Dicadangkan {rupiah(snapshot.balances.reserved)}</Text>
          <Text style={styles.body}>Sudah dibayarkan {rupiah(snapshot.balances.paidOut)}</Text>
          <Button role="vet" label="Ajukan pencairan" disabled={snapshot.balances.available <= 0 || !snapshot.destinations.length || Boolean(pendingAmount)} onPress={() => { setAmountText(''); go('amount'); }} />
          {snapshot.balances.available > 0 && !snapshot.destinations.length ? <Text style={styles.muted}>Belum ada tujuan pencairan tersimpan.</Text> : null}
        </View>
        <View style={styles.card}>
          <Line label="Pendapatan kotor" value={snapshot.totals.gross} />
          <Line label="Komisi" value={-snapshot.totals.commission} negative />
          <Line label="Pendapatan bersih" value={snapshot.totals.net} strong />
        </View>
        {pendingAmount !== null ? <View style={styles.recovery}>
          <Text style={styles.heading}>Pengajuan belum terkonfirmasi</Text>
          <Text style={styles.body}>Jumlah {rupiah(pendingAmount)} tersimpan aman untuk dicoba ulang dengan kunci dan tujuan yang sama. Periksa koneksi; saldo hanya mengikuti status server.</Text>
          <Button role="vet" label="Pulihkan pengajuan tersimpan" loading={busy} disabled={loading} onPress={() => void retryPending()} />
        </View> : null}
        <Text accessibilityRole="header" style={styles.sectionTitle}>Transaksi periode ini</Text>
        {snapshot.transactions.length ? snapshot.transactions.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => void openTransaction(item.id)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <View style={styles.rowCopy}><Text style={styles.rowTitle}>{item.displayCode} · {item.serviceLabel}</Text><Text style={styles.muted}>{tanggal(item.earnedAt)} · Bersih {rupiah(item.net)}</Text></View>
          <Text style={styles.status}>{item.status === 'available' ? 'Tersedia' : 'Menunggu'}</Text><Icon name="chevron-right" size={18} color={colors.brown} />
        </Pressable>) : <EmptyState title="Belum ada transaksi" description="Pendapatan tampil setelah layanan selesai dan dicatat server." role="vet" />}
        <View style={styles.periodRow}><Text accessibilityRole="header" style={styles.sectionTitle}>Pencairan periode ini</Text><Pressable accessibilityRole="button" onPress={() => go('history')}><Text style={styles.action}>Riwayat lengkap</Text></Pressable></View>
        {snapshot.withdrawals.length ? snapshot.withdrawals.map((item) => <WithdrawalRow key={item.id} item={item} onPress={() => void openWithdrawal(item.id)} />) : <Text style={styles.muted}>Belum ada pencairan pada periode ini.</Text>}
      </View> : null}
      {snapshot && screen === 'transaction' && selectedTransaction ? <TransactionDetail item={selectedTransaction} /> : null}
      {snapshot && screen === 'amount' ? <View style={styles.sections}>
        <View style={styles.card}><Text style={styles.muted}>Saldo tersedia</Text><Text style={styles.balance}>{rupiah(snapshot.balances.available)}</Text></View>
        <TextField label="Jumlah pencairan" value={amountText} onChangeText={setAmountText} keyboardType="number-pad" maxLength={15} placeholder="Masukkan jumlah rupiah" helperText={`Maksimal ${rupiah(snapshot.balances.available)}. Nominal selalu rupiah bulat.`} errorText={amountText && !amountValid ? amountError(amountText, snapshot.balances.available) : undefined} />
        <View style={styles.card}><Text style={styles.sectionTitle}>Tujuan pencairan</Text>{selectedDestination ? <><Text style={styles.rowTitle}>{selectedDestination.bankLabel}</Text><Text style={styles.body}>{selectedDestination.accountMasked} · {selectedDestination.accountHolder}</Text><Button role="vet" variant="secondary" label="Ubah tujuan" onPress={() => setSheet('destination')} /></> : <EmptyState title="Tujuan belum tersedia" description="Pencairan tidak dapat diajukan tanpa tujuan tersimpan." role="vet" />}</View>
        <Button role="vet" label="Tinjau pengajuan" disabled={!amountValid} onPress={() => go('review')} />
      </View> : null}
      {snapshot && screen === 'review' ? <View style={styles.sections}>
        <View style={styles.card}><Text style={styles.balance}>{rupiah(amount)}</Text><Text style={styles.body}>Periksa jumlah dan tujuan sebelum mengirim.</Text><Line label="Biaya" value={0} /><Line label="Jumlah bersih" value={amount} strong /><Text style={styles.body}>{selectedDestination?.bankLabel} · {selectedDestination?.accountMasked} · {selectedDestination?.accountHolder}</Text><Text style={styles.muted}>Pengajuan akan memakai saldo server dan dapat mencadangkan dana. Status menunggu bukan bukti dana diterima.</Text></View>
        <Button role="vet" label="Konfirmasi pengajuan" onPress={() => setConfirmVisible(true)} disabled={busy} />
        <Button role="vet" variant="secondary" label="Ubah jumlah" onPress={() => { setScreen('amount'); setStack((current) => current.slice(0, -1)); setError(''); }} disabled={busy} />
      </View> : null}
      {screen === 'submitted' && selectedWithdrawal ? <View style={styles.sections}>
        <View style={styles.card}><Text accessibilityRole="header" style={styles.heading}>{selectedWithdrawal.status === 'submitting' ? 'Menunggu hasil adapter' : 'Status pengajuan dari server'}</Text><Text style={styles.balance}>{rupiah(selectedWithdrawal.amount)}</Text><Text style={styles.body}>{selectedWithdrawal.destination.bankLabel} · {selectedWithdrawal.destination.accountMasked}</Text><Text style={styles.body}>Status: {withdrawalLabel(selectedWithdrawal.status)}</Text><Text style={styles.body}>Outcome adapter: {selectedWithdrawal.adapterOutcome}</Text><Text style={styles.muted}>{selectedWithdrawal.adapterOutcome === 'pending' ? 'Dana dapat tercadangkan, tetapi belum ada bukti dana diterima.' : selectedWithdrawal.status === 'paid' ? 'Server mencatat dana telah dibayarkan.' : 'Status ini berasal dari server dan bukan transaksi finansial nyata oleh aplikasi.'}</Text></View>
        <Button role="vet" label="Lihat riwayat" onPress={() => go('history')} />
        <Button role="vet" variant="secondary" label="Kembali ke pendapatan" onPress={() => { setScreen('overview'); setStack([]); void reload(); }} />
      </View> : null}
      {screen === 'history' && snapshot ? <View style={styles.sections}><Text accessibilityRole="header" style={styles.sectionTitle}>Riwayat pencairan</Text>{snapshot.history.length ? snapshot.history.map((item) => <WithdrawalRow key={item.id} item={item} onPress={() => void openWithdrawal(item.id)} />) : <EmptyState title="Belum ada pencairan" description="Riwayat akan tampil setelah server mencatat pengajuan." role="vet" />}</View> : null}
      {screen === 'withdrawal' && selectedWithdrawal ? <View style={styles.sections}><View style={styles.card}><Text style={styles.balance}>{rupiah(selectedWithdrawal.amount)}</Text><Text style={styles.body}>{selectedWithdrawal.destination.bankLabel} · {selectedWithdrawal.destination.accountMasked}</Text><Line label="Biaya" value={-selectedWithdrawal.fee} negative /><Line label="Bersih" value={selectedWithdrawal.netAmount} strong /><Text style={styles.body}>Status: {withdrawalLabel(selectedWithdrawal.status)} · adapter {selectedWithdrawal.adapterOutcome}</Text>{selectedWithdrawal.submittedAt ? <Text style={styles.muted}>Diajukan {tanggal(selectedWithdrawal.submittedAt)}</Text> : <Text style={styles.muted}>Belum ada waktu pengajuan final dari server.</Text>}</View></View> : null}
    </ScrollView>

    <Modal transparent visible={sheet === 'period'} animationType="fade" onRequestClose={() => setSheet(null)}>
      <View style={styles.backdrop}><View style={styles.dialog}><Text accessibilityRole="header" style={styles.heading}>Pilih periode</Text>{(snapshot?.periods ?? []).map((item) => <Button key={item.value} role="vet" variant={item.value === snapshot?.period ? 'primary' : 'secondary'} label={item.label} onPress={() => { setSheet(null); setPeriod(item.value); setScreen('overview'); setStack([]); }} />)}<Button role="vet" variant="secondary" label="Tutup" onPress={() => setSheet(null)} /></View></View>
    </Modal>
    <Modal transparent visible={sheet === 'destination'} animationType="fade" onRequestClose={() => setSheet(null)}>
      <View style={styles.backdrop}><View style={styles.dialog}><Text accessibilityRole="header" style={styles.heading}>Tujuan pencairan</Text>{(snapshot?.destinations ?? []).map((item) => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ selected: item.id === destinationId }} onPress={() => { setDestinationId(item.id); setSheet(null); }} style={styles.destination}><Text style={styles.rowTitle}>{item.bankLabel}</Text><Text style={styles.body}>{item.accountMasked} · {item.accountHolder}</Text><Text style={styles.muted}>{item.label}</Text></Pressable>)}<Button role="vet" variant="secondary" label="Tutup" onPress={() => setSheet(null)} /></View></View>
    </Modal>
    <Modal transparent visible={leaveVisible} animationType="fade" onRequestClose={() => { if (!busy) setLeaveVisible(false); }}>
      <View style={styles.backdrop}><View style={styles.dialog}><Text accessibilityRole="header" style={styles.heading}>Jumlah belum diajukan</Text><Text style={styles.body}>Jumlah {rupiah(Number.isFinite(amount) ? amount : 0)} belum dikirim ke server.</Text><Button role="vet" variant="secondary" label="Buang perubahan" disabled={busy} onPress={() => { setLeaveVisible(false); setAmountText(''); setScreen('overview'); setStack([]); }} /><Button role="vet" label="Tetap mengedit" disabled={busy} onPress={() => setLeaveVisible(false)} /></View></View>
    </Modal>
    <ConfirmationDialog visible={confirmVisible} title="Konfirmasi pencairan" message={`Ajukan ${rupiah(Number.isFinite(amount) ? amount : 0)} ke ${selectedDestination?.label ?? 'tujuan pilihan'}? Server akan mencadangkan saldo jika pengajuan tersimpan.`} role="vet" confirmLabel="Ajukan pencairan" cancelLabel="Kembali" loading={busy} confirmDisabled={!amountValid} onCancel={() => setConfirmVisible(false)} onConfirm={() => void submit()} />
  </View>;
}

function TransactionDetail({ item }: { item: ApiEarningTransaction }) {
  return <View style={styles.sections}><View style={styles.card}><Text style={styles.balance}>{rupiah(item.net)}</Text><Text style={styles.body}>{item.displayCode} · {item.serviceLabel}</Text><Text style={styles.muted}>{tanggal(item.earnedAt)}</Text></View><View style={styles.card}><Line label="Pendapatan kotor" value={item.gross} /><Line label="Komisi" value={-item.commission} negative /><Line label="Pendapatan bersih" value={item.net} strong /></View><Text style={styles.status}>{item.status === 'available' ? 'Tersedia' : 'Menunggu'}</Text></View>;
}

function WithdrawalRow({ item, onPress }: { item: ApiWithdrawal; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}><View style={styles.rowCopy}><Text style={styles.rowTitle}>{rupiah(item.amount)} · {item.destination.label}</Text><Text style={styles.muted}>{item.submittedAt ? tanggal(item.submittedAt) : 'Belum diajukan'} · {item.adapterOutcome}</Text></View><Text style={styles.status}>{withdrawalLabel(item.status)}</Text><Icon name="chevron-right" size={18} color={colors.brown} /></Pressable>;
}

function Line({ label, value, strong = false, negative = false }: { label: string; value: number; strong?: boolean; negative?: boolean }) {
  return <View style={styles.line}><Text style={[styles.body, strong && styles.strong]}>{label}</Text><Text style={[styles.body, strong && styles.strong]}>{negative && value < 0 ? '−' : ''}{rupiah(Math.abs(value))}</Text></View>;
}

function amountError(value: string, available: number): string {
  const amount = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(amount) || amount <= 0) return 'Masukkan jumlah rupiah integer lebih dari nol.';
  return amount > available ? 'Jumlah melebihi saldo tersedia.' : 'Pilih tujuan pencairan yang tersedia.';
}

function withdrawalLabel(status: ApiWithdrawal['status']): string {
  switch (status) {
    case 'submitting': return 'Menunggu hasil';
    case 'submitted': return 'Diajukan';
    case 'processing': return 'Diproses';
    case 'paid': return 'Dibayar';
    case 'rejected': return 'Ditolak';
    case 'failed': return 'Gagal';
  }
}

function screenTitle(screen: Screen): string {
  switch (screen) {
    case 'overview': return 'Pendapatan';
    case 'transaction': return 'Rincian pendapatan';
    case 'amount': return 'Ajukan pencairan';
    case 'review': return 'Tinjau pengajuan';
    case 'submitted': return 'Status pengajuan';
    case 'history': return 'Riwayat pencairan';
    case 'withdrawal': return 'Rincian pencairan';
  }
}

function rupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}

function tanggal(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(date)
    : 'Tanggal tidak tersedia';
}

function messageFor(cause: unknown): string {
  return cause instanceof DomainError ? cause.message : 'Data pendapatan belum dapat dimuat atau disimpan. Coba lagi.';
}

const styles = StyleSheet.create({
  root: { gap: spacing[3] },
  header: { gap: spacing[2], paddingHorizontal: spacing[4] },
  title: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.heading },
  content: { gap: spacing[4], paddingHorizontal: spacing[4], paddingBottom: spacing[8] },
  sections: { gap: spacing[3] },
  periodRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  card: { gap: spacing[2], backgroundColor: colors.white, padding: spacing[4], borderRadius: radii.cardVet },
  recovery: { gap: spacing[3], backgroundColor: colors.gold, padding: spacing[4], borderRadius: radii.cardVet },
  heading: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.section, lineHeight: 24 },
  sectionTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.section },
  balance: { color: colors.brown, fontFamily: fonts.bold, fontSize: 27, lineHeight: 34 },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22 },
  muted: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 19 },
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing[2], padding: spacing[3], backgroundColor: colors.white, borderRadius: radii.cardVet },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.body, lineHeight: 21 },
  status: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.small },
  action: { color: colors.brown, fontFamily: fonts.semiBold, textDecorationLine: 'underline', padding: spacing[2] },
  pressed: { opacity: 0.7 },
  line: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3] },
  strong: { fontFamily: fonts.bold, color: colors.brown },
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing[5], backgroundColor: 'rgba(32, 20, 16, 0.55)' },
  dialog: { maxHeight: '85%', gap: spacing[3], padding: spacing[4], backgroundColor: colors.cream, borderRadius: radii.cardVet },
  destination: { gap: spacing[1], padding: spacing[3], backgroundColor: colors.white, borderRadius: radii.cardVet },
});
