import { useCallback, useEffect, useState } from 'react';
import {
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { SessionSnapshot } from '../../domain/auth';
import type { EarningSnapshot, EarningsPeriod, EarningsSnapshot, PayoutDestinationSnapshot, WithdrawalSnapshot } from '../../application/EarningsService';
import { DomainError } from '../../domain/errors';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, InlineFeedback, LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { StatusBadge, type StatusTone } from '../components/StatusBadge';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { TextField } from '../components/TextField';
import { colors, fonts, layout, radii, spacing, typeScale } from '../theme/tokens';

type Screen = 'earnings' | 'transaction' | 'amount' | 'review' | 'submitted' | 'history' | 'withdrawal';
type Sheet = 'period' | 'destination' | null;

type Props = {
  store: LocalStore;
  session: SessionSnapshot;
  onBack: () => void;
  onChanged?: () => void;
};

export function EarningsFlow({ store, session, onBack, onChanged }: Props) {
  const [screen, setScreen] = useState<Screen>('earnings');
  const [stack, setStack] = useState<Screen[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [period, setPeriod] = useState<EarningsPeriod | undefined>();
  const [snapshot, setSnapshot] = useState<EarningsSnapshot | null>(null);
  const [selectedEarning, setSelectedEarning] = useState<EarningSnapshot | null>(null);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<WithdrawalSnapshot | null>(null);
  const [destinationId, setDestinationId] = useState('');
  const [amountText, setAmountText] = useState('');
  const [operationKey, setOperationKey] = useState<string | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const next = await store.earnings.load(session.userId, session.activeRole, period);
      setSnapshot(next);
      setDestinationId((current) => current || next.destinations[0]?.id || '');
    } catch (cause) {
      setError(messageFor(cause));
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [period, session.activeRole, session.userId, store]);

  useEffect(() => {
    const request = setTimeout(() => { void reload(); }, 0);
    return () => clearTimeout(request);
  }, [reload]);

  const go = (next: Screen) => {
    setStack((current) => [...current, screen]);
    setScreen(next);
    setError('');
  };

  const goBack = useCallback(() => {
    if (confirmVisible) {
      setConfirmVisible(false);
      return;
    }
    if (sheet) {
      setSheet(null);
      return;
    }
    const previous = stack.at(-1);
    if (previous) {
      setStack((current) => current.slice(0, -1));
      setScreen(previous);
      setError('');
      return;
    }
    onBack();
  }, [confirmVisible, onBack, sheet, stack]);

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      goBack();
      return true;
    });
    return () => listener.remove();
  }, [goBack]);

  const openTransaction = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const latest = await store.earnings.getTransaction(session.userId, session.activeRole, id);
      setSelectedEarning(latest);
      go('transaction');
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const openWithdrawal = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const latest = await store.earnings.getWithdrawal(session.userId, session.activeRole, id);
      setSelectedWithdrawal(latest);
      go('withdrawal');
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const amount = /^\d+$/.test(amountText) ? Number(amountText) : Number.NaN;
  const amountValid = Number.isSafeInteger(amount)
    && amount > 0
    && Boolean(snapshot && amount <= snapshot.balances.available)
    && Boolean(destinationId && snapshot?.destinations.some((item) => item.id === destinationId));

  const beginWithdrawal = () => {
    if (!amountValid) return;
    setOperationKey(null);
    go('review');
  };

  const cancelReview = () => {
    setConfirmVisible(false);
    setOperationKey(null);
    setAmountText('');
    setStack([]);
    setScreen('earnings');
  };

  const confirmWithdrawal = async () => {
    if (!snapshot || !amountValid) return;
    const destination = snapshot.destinations.find((item) => item.id === destinationId);
    if (!destination) {
      setError('Tujuan pencairan tidak ditemukan. Pilih tujuan yang tersedia.');
      setConfirmVisible(false);
      return;
    }
    const key = operationKey ?? store.earnings.newWithdrawalOperationKey();
    setOperationKey(key);
    setBusy(true);
    setError('');
    try {
      const submitted = await store.earnings.submitWithdrawal(session.userId, session.activeRole, amount, destination.id, key);
      const latest = await store.earnings.load(session.userId, session.activeRole, snapshot.period);
      setSnapshot(latest);
      setSelectedWithdrawal(submitted);
      setStack([]);
      setScreen('submitted');
      setConfirmVisible(false);
      setOperationKey(null);
      onChanged?.();
    } catch (cause) {
      setError(messageFor(cause));
      setConfirmVisible(false);
    } finally {
      setBusy(false);
    }
  };

  const selectedDestination = snapshot?.destinations.find((item) => item.id === destinationId) ?? null;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Header title={screenTitle(screen)} onBack={goBack} />
        {error ? <InlineFeedback message={error} tone="error" /> : null}
        {loading ? <LoadingState label="Memuat pendapatan…" /> : null}
        {!loading && !snapshot ? <ErrorState message={error || 'Pendapatan belum dapat dimuat.'} role="vet" onRetry={() => void reload()} /> : null}
        {!loading && snapshot && screen === 'earnings' ? (
          <EarningsOverview
            snapshot={snapshot}
            busy={busy}
            onPeriod={() => setSheet('period')}
            onWithdraw={() => {
              setAmountText('');
              setOperationKey(null);
              go('amount');
            }}
            onTransaction={(id) => void openTransaction(id)}
            onHistory={() => go('history')}
            onWithdrawal={(id) => void openWithdrawal(id)}
          />
        ) : null}
        {!loading && snapshot && screen === 'transaction' && selectedEarning ? (
          <TransactionDetail earning={selectedEarning} />
        ) : null}
        {!loading && snapshot && screen === 'amount' ? (
          <AmountForm
            amountText={amountText}
            available={snapshot.balances.available}
            destination={selectedDestination}
            destinationsAvailable={snapshot.destinations.length > 0}
            amountValid={amountValid}
            onAmount={setAmountText}
            onDestination={() => setSheet('destination')}
            onReview={beginWithdrawal}
          />
        ) : null}
        {!loading && snapshot && screen === 'review' ? (
          <WithdrawalReview
            amount={amount}
            destination={selectedDestination}
            busy={busy}
            onConfirm={() => setConfirmVisible(true)}
            onEditAmount={() => {
              setOperationKey(null);
              setScreen('amount');
              setStack((current) => current.slice(0, -1));
            }}
            onCancel={cancelReview}
          />
        ) : null}
        {!loading && snapshot && screen === 'submitted' && selectedWithdrawal ? (
          <SubmittedConfirmation
            withdrawal={selectedWithdrawal}
            balances={snapshot.balances}
            onHistory={() => go('history')}
            onDone={() => {
              setStack([]);
              setScreen('earnings');
            }}
          />
        ) : null}
        {!loading && snapshot && screen === 'history' ? (
          <WithdrawalHistory history={snapshot.history} onWithdrawal={(id) => void openWithdrawal(id)} />
        ) : null}
        {!loading && snapshot && screen === 'withdrawal' && selectedWithdrawal ? (
          <WithdrawalDetail withdrawal={selectedWithdrawal} />
        ) : null}
      </ScrollView>

      <PeriodModal
        visible={sheet === 'period'}
        periods={snapshot?.periods ?? []}
        selected={snapshot?.period ?? ''}
        onClose={() => setSheet(null)}
          onSelect={(value) => {
            setSheet(null);
            setPeriod(value);
          }}
      />
      <DestinationModal
        visible={sheet === 'destination'}
        destinations={snapshot?.destinations ?? []}
        selectedId={destinationId}
        onClose={() => setSheet(null)}
        onSelect={(destination) => {
          setDestinationId(destination.id);
          setSheet(null);
        }}
      />
      <ConfirmationDialog
        visible={confirmVisible}
        title="Konfirmasi pencairan"
        message={`Ajukan pencairan ${formatRupiah(Number.isFinite(amount) ? amount : 0)} ke ${selectedDestination?.label ?? 'tujuan pilihan'}? Dana akan dicadangkan dari saldo tersedia setelah pengajuan tersimpan.`}
        role="vet"
        confirmLabel="Ajukan pencairan"
        cancelLabel="Kembali"
        loading={busy}
        confirmDisabled={!amountValid}
        onCancel={() => setConfirmVisible(false)}
        onConfirm={() => void confirmWithdrawal()}
      />
    </View>
  );
}

function EarningsOverview({ snapshot, busy, onPeriod, onWithdraw, onTransaction, onHistory, onWithdrawal }: {
  snapshot: EarningsSnapshot;
  busy: boolean;
  onPeriod: () => void;
  onWithdraw: () => void;
  onTransaction: (id: string) => void;
  onHistory: () => void;
  onWithdrawal: (id: string) => void;
}) {
  return (
    <View style={styles.sections}>
      <View style={styles.periodRow}>
        <Text style={styles.periodLabel}>{snapshot.periodLabel}</Text>
        <Button label="Periode" role="vet" variant="secondary" onPress={onPeriod} style={styles.periodButton} />
      </View>

      <View style={styles.balanceCard}>
        <Text style={styles.mutedLabel}>Saldo tersedia</Text>
        <Text style={styles.balanceAmount}>{formatRupiah(snapshot.balances.available)}</Text>
        <Text style={styles.body}>Saldo menunggu {formatRupiah(snapshot.balances.pending)}</Text>
        <Text style={styles.body}>Dana dicadangkan {formatRupiah(snapshot.balances.reserved)}</Text>
        <Button
          label="Ajukan Pencairan"
          role="vet"
          onPress={onWithdraw}
          disabled={snapshot.balances.available <= 0 || snapshot.destinations.length === 0}
          accessibilityHint={snapshot.balances.available <= 0 ? 'Saldo tersedia belum dapat dicairkan.' : undefined}
        />
        {snapshot.balances.available > 0 && snapshot.destinations.length === 0 ? (
          <Text style={styles.muted}>Belum ada tujuan pencairan tersimpan.</Text>
        ) : null}
      </View>

      <View style={styles.summaryCard}>
        <SummaryLine label="Pendapatan kotor" value={snapshot.totals.gross} />
        <SummaryLine label="Komisi platform" value={-snapshot.totals.commission} negative />
        <SummaryLine label="Pendapatan bersih" value={snapshot.totals.net} strong />
      </View>

      <SectionTitle title="Transaksi" />
      {snapshot.transactions.length ? snapshot.transactions.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={`${item.displayCode}, ${item.serviceLabel}, bersih ${formatRupiah(item.net)}`}
          onPress={() => onTransaction(item.id)}
          style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
        >
          <View style={styles.rowCopy}>
            <Text style={styles.rowTitle}>{item.displayCode} · {item.serviceLabel}</Text>
            <Text style={styles.muted}>{formatDate(item.earnedAt)} · Bersih {formatRupiah(item.net)}</Text>
          </View>
          <View style={styles.rowEnd}>
            <StatusBadge label={earningStatusLabel(item.status)} role="vet" tone={item.status === 'available' ? 'success' : 'pending'} />
            <Icon name="chevron-right" size={20} color={colors.brown} />
          </View>
        </Pressable>
      )) : (
        <EmptyState title="Belum ada transaksi" description="Pendapatan layanan akan tampil setelah layanan selesai dan tercatat." role="vet" />
      )}

      <View style={styles.historyHeader}>
        <SectionTitle title="Pencairan" />
        <Pressable accessibilityRole="button" accessibilityLabel="Lihat semua riwayat pencairan" onPress={onHistory} style={styles.textAction}>
          <Text style={styles.actionText}>Riwayat</Text>
        </Pressable>
      </View>
      {snapshot.withdrawals.length ? snapshot.withdrawals.map((item) => (
        <WithdrawalRow key={item.id} item={item} onPress={() => onWithdrawal(item.id)} />
      )) : <Text style={styles.muted}>Belum ada pencairan pada periode ini.</Text>}
      {busy ? <LoadingState label="Memuat rincian…" /> : null}
    </View>
  );
}

function TransactionDetail({ earning }: { earning: EarningSnapshot }) {
  return (
    <View style={styles.sections}>
      <View style={styles.detailCard}>
        <Text style={styles.detailAmount}>{formatRupiah(earning.net)}</Text>
        <Text style={styles.body}>{earning.displayCode} · {earning.serviceLabel}</Text>
        <Text style={styles.muted}>{formatDate(earning.earnedAt)}</Text>
      </View>
      <View style={styles.summaryCard}>
        <SummaryLine label="Pendapatan kotor" value={earning.gross} />
        <SummaryLine label="Komisi platform" value={-earning.commission} negative />
        <SummaryLine label="Pendapatan bersih" value={earning.net} strong />
      </View>
      <StatusBadge label={earningStatusLabel(earning.status)} role="vet" tone={earning.status === 'available' ? 'success' : 'pending'} />
    </View>
  );
}

function AmountForm({ amountText, available, destination, destinationsAvailable, amountValid, onAmount, onDestination, onReview }: {
  amountText: string;
  available: number;
  destination: PayoutDestinationSnapshot | null;
  destinationsAvailable: boolean;
  amountValid: boolean;
  onAmount: (value: string) => void;
  onDestination: () => void;
  onReview: () => void;
}) {
  const parsedAmount = /^\d+$/.test(amountText) ? Number(amountText) : Number.NaN;
  const amountError = amountText.length === 0
    ? undefined
    : !Number.isSafeInteger(parsedAmount) || parsedAmount <= 0
      ? 'Masukkan jumlah rupiah integer lebih dari nol.'
      : parsedAmount > available
        ? 'Jumlah melebihi saldo tersedia.'
        : undefined;
  return (
    <View style={styles.sections}>
      <View style={styles.detailCard}>
        <Text style={styles.mutedLabel}>Saldo tersedia</Text>
        <Text style={styles.balanceAmount}>{formatRupiah(available)}</Text>
      </View>
      <TextField
        label="Jumlah pencairan"
        value={amountText}
        onChangeText={onAmount}
        keyboardType="number-pad"
        maxLength={15}
        placeholder="Masukkan jumlah rupiah"
        helperText={`Maksimal ${formatRupiah(available)} · tanpa biaya pencairan pada layanan lokal.`}
        errorText={amountError}
        accessibilityHint="Ketik jumlah rupiah dalam angka bulat. Jumlah nol dan yang melebihi saldo tersedia tidak dapat diajukan."
      />
      <View style={styles.destinationSection}>
        <Text style={styles.sectionTitle}>Tujuan pencairan</Text>
        {destination ? (
          <View style={styles.destinationCard}>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{destination.bankLabel}</Text>
              <Text style={styles.muted}>{destination.accountMasked} · {destination.accountHolder}</Text>
            </View>
            <Button label="Ubah" role="vet" variant="secondary" onPress={onDestination} style={styles.changeButton} />
          </View>
        ) : (
          <EmptyState title="Tujuan belum tersedia" description="Pencairan tidak dapat diajukan tanpa tujuan tersimpan." role="vet" />
        )}
      </View>
      <Button label="Tinjau Pengajuan" role="vet" onPress={onReview} disabled={!amountValid} />
    </View>
  );
}

function WithdrawalReview({ amount, destination, busy, onConfirm, onEditAmount, onCancel }: {
  amount: number;
  destination: PayoutDestinationSnapshot | null;
  busy: boolean;
  onConfirm: () => void;
  onEditAmount: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.sections}>
      <View style={styles.detailCard}>
        <Text style={styles.detailAmount}>{formatRupiah(amount)}</Text>
        <Text style={styles.body}>Tinjau rincian sebelum mengajukan.</Text>
      </View>
      <View style={styles.summaryCard}>
        <DetailLine label="Rekening" value={destination?.bankLabel ?? 'Belum dipilih'} />
        <DetailLine label="Nomor" value={destination?.accountMasked ?? '—'} />
        <DetailLine label="Pemilik" value={destination?.accountHolder ?? '—'} />
        <DetailLine label="Biaya" value={formatRupiah(0)} />
        <DetailLine label="Estimasi dana bersih" value={formatRupiah(amount)} strong />
      </View>
      <Text style={styles.muted}>Setelah tersimpan, dana ini dicadangkan dan statusnya menjadi Diajukan. Ini belum berarti dana diterima.</Text>
      <Button label="Konfirmasi" role="vet" onPress={onConfirm} disabled={busy || !destination} />
      <Button label="Ubah Jumlah" role="vet" variant="secondary" onPress={onEditAmount} disabled={busy} />
      <Button label="Batalkan Pengajuan" role="vet" variant="secondary" onPress={onCancel} disabled={busy} />
    </View>
  );
}

function SubmittedConfirmation({ withdrawal, balances, onHistory, onDone }: {
  withdrawal: WithdrawalSnapshot;
  balances: EarningsSnapshot['balances'];
  onHistory: () => void;
  onDone: () => void;
}) {
  return (
    <View style={styles.sections}>
      <View style={styles.successMark}><Icon name="check" size={28} color={colors.white} /></View>
      <Text accessibilityRole="header" style={styles.successTitle}>Pengajuan tersimpan</Text>
      <StatusBadge label="Diajukan · belum dibayar" role="vet" tone="pending" />
      <View style={styles.summaryCard}>
        <SummaryLine label="Jumlah diajukan" value={withdrawal.amount} strong />
        <DetailLine label="Tujuan" value={withdrawal.destination.label} />
        <DetailLine label="Saldo tersedia" value={formatRupiah(balances.available)} />
        <DetailLine label="Dana dicadangkan" value={formatRupiah(balances.reserved)} />
      </View>
      <InlineFeedback message="Dana sudah dicadangkan dari saldo tersedia. Status ini tidak berarti dana telah diterima." tone="info" />
      <Button label="Lihat Riwayat" role="vet" onPress={onHistory} />
      <Button label="Kembali ke Pendapatan" role="vet" variant="secondary" onPress={onDone} />
    </View>
  );
}

function WithdrawalHistory({ history, onWithdrawal }: { history: WithdrawalSnapshot[]; onWithdrawal: (id: string) => void }) {
  return (
    <View style={styles.sections}>
      {history.length ? history.map((item) => <WithdrawalRow key={item.id} item={item} onPress={() => onWithdrawal(item.id)} />) : (
        <EmptyState title="Belum ada riwayat pencairan" description="Pengajuan yang tersimpan akan muncul di sini." role="vet" />
      )}
    </View>
  );
}

function WithdrawalDetail({ withdrawal }: { withdrawal: WithdrawalSnapshot }) {
  const message = withdrawal.status === 'submitted'
    ? 'Dana dicadangkan dari saldo tersedia dan belum diterima.'
    : withdrawal.status === 'processing'
      ? 'Pengajuan sedang diproses. Dana masih dicadangkan.'
      : withdrawal.status === 'paid'
        ? 'Status pembayaran berasal dari catatan tersimpan.'
        : 'Pengajuan ditolak atau gagal; pelepasan reservasi mengikuti catatan saldo tersimpan.';
  return (
    <View style={styles.sections}>
      <StatusBadge label={withdrawalStatusLabel(withdrawal.status)} role="vet" tone={toneForWithdrawal(withdrawal.status)} />
      <View style={styles.detailCard}>
        <Text style={styles.detailAmount}>{formatRupiah(withdrawal.amount)}</Text>
        <Text style={styles.muted}>{formatDate(withdrawal.submittedAt)}</Text>
      </View>
      <View style={styles.summaryCard}>
        <DetailLine label="Rekening" value={withdrawal.destination.bankLabel} />
        <DetailLine label="Nomor" value={withdrawal.destination.accountMasked || '—'} />
        {withdrawal.destination.accountHolder ? <DetailLine label="Pemilik" value={withdrawal.destination.accountHolder} /> : null}
        <DetailLine label="Biaya" value={formatRupiah(withdrawal.fee)} />
        <DetailLine label={withdrawal.status === 'paid' ? 'Dana diterima' : 'Estimasi dana bersih'} value={formatRupiah(withdrawal.netAmount)} strong />
      </View>
      <InlineFeedback message={message} tone={withdrawal.status === 'paid' ? 'success' : 'info'} />
    </View>
  );
}

function WithdrawalRow({ item, onPress }: { item: WithdrawalSnapshot; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{formatDate(item.submittedAt)} · {formatRupiah(item.amount)}</Text>
        <Text style={styles.muted}>{item.destination.label}</Text>
      </View>
      <View style={styles.rowEnd}>
        <StatusBadge label={withdrawalStatusLabel(item.status)} role="vet" tone={toneForWithdrawal(item.status)} />
        <Icon name="chevron-right" size={20} color={colors.brown} />
      </View>
    </Pressable>
  );
}

function PeriodModal({ visible, periods, selected, onClose, onSelect }: {
  visible: boolean;
  periods: EarningsSnapshot['periods'];
  selected: string;
  onClose: () => void;
  onSelect: (period: string) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable accessibilityElementsHidden onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Pilih Periode</Text>
          <ScrollView style={styles.modalOptions} keyboardShouldPersistTaps="handled">
            {periods.map((item) => (
              <Pressable
                key={item.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: item.value === selected }}
                onPress={() => onSelect(item.value)}
                style={styles.modalOption}
              >
                <Text style={styles.body}>{item.label}</Text>
                {item.value === selected ? <Icon name="check" size={20} color={colors.brown} /> : null}
              </Pressable>
            ))}
          </ScrollView>
          <Button label="Tutup" role="vet" variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function DestinationModal({ visible, destinations, selectedId, onClose, onSelect }: {
  visible: boolean;
  destinations: PayoutDestinationSnapshot[];
  selectedId: string;
  onClose: () => void;
  onSelect: (destination: PayoutDestinationSnapshot) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable accessibilityElementsHidden onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Tujuan pencairan</Text>
          <Text style={styles.muted}>Tujuan tersimpan bersifat fiktif pada mode lokal. Data rekening nyata tidak digunakan.</Text>
          {destinations.length ? destinations.map((destination) => (
            <Pressable
              key={destination.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: destination.id === selectedId }}
              onPress={() => onSelect(destination)}
              style={[styles.destinationCard, destination.id === selectedId && styles.selectedDestination]}
            >
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{destination.bankLabel}</Text>
                <Text style={styles.muted}>{destination.accountMasked} · {destination.accountHolder}</Text>
              </View>
              <Icon name={destination.id === selectedId ? 'circle-check' : 'circle'} size={22} color={colors.brown} />
            </Pressable>
          )) : <EmptyState title="Belum ada tujuan tersimpan" description="Tujuan pencairan belum tersedia untuk akun ini." role="vet" />}
          <Button label="Tutup" role="vet" variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Kembali"
        hitSlop={4}
        onPress={onBack}
        style={styles.backButton}
      >
        <Icon name="chevron-left" size={21} color={colors.brown} />
      </Pressable>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>;
}

function SummaryLine({ label, value, strong = false, negative = false }: { label: string; value: number; strong?: boolean; negative?: boolean }) {
  return <DetailLine label={label} value={`${negative && value < 0 ? '−' : ''}${formatRupiah(Math.abs(value))}`} strong={strong} />;
}

function DetailLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.detailLine}>
      <Text style={[styles.body, styles.flexCopy]}>{label}</Text>
      <Text style={[styles.body, styles.value, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

function screenTitle(screen: Screen): string {
  switch (screen) {
    case 'earnings': return 'Pendapatan';
    case 'transaction': return 'Rincian Pendapatan';
    case 'amount': return 'Ajukan Pencairan';
    case 'review': return 'Tinjau Pencairan';
    case 'submitted': return 'Pengajuan Tersimpan';
    case 'history': return 'Riwayat Pencairan';
    case 'withdrawal': return 'Rincian Pencairan';
  }
}

function earningStatusLabel(status: EarningSnapshot['status']): string {
  return status === 'available' ? 'Tersedia' : 'Menunggu';
}

function withdrawalStatusLabel(status: WithdrawalSnapshot['status']): string {
  switch (status) {
    case 'submitted': return 'Diajukan';
    case 'processing': return 'Diproses';
    case 'paid': return 'Dibayar';
    case 'rejected': return 'Ditolak';
    case 'failed': return 'Gagal';
  }
}

function toneForWithdrawal(status: WithdrawalSnapshot['status']): StatusTone {
  if (status === 'paid') return 'success';
  if (status === 'rejected' || status === 'failed') return 'error';
  return 'pending';
}

function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Tanggal tidak tersedia';
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(date);
}

function messageFor(cause: unknown): string {
  if (cause instanceof DomainError) return cause.message;
  return 'Data pendapatan belum dapat dimuat atau disimpan. Coba lagi.';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  content: { flexGrow: 1, paddingHorizontal: layout.contentHorizontal, paddingTop: spacing[3], paddingBottom: spacing[8], gap: spacing[4] },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  backButton: { width: 44, height: 44, borderWidth: 1, borderColor: colors.brown, borderRadius: radii.button, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.heading, lineHeight: 28, flexShrink: 1 },
  sections: { gap: spacing[4] },
  periodRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3] },
  periodLabel: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.section, lineHeight: 26, flexShrink: 1 },
  periodButton: { minWidth: 104, alignSelf: 'auto' },
  balanceCard: { gap: spacing[2], padding: spacing[4], borderRadius: radii.cardVet, backgroundColor: colors.white },
  summaryCard: { gap: spacing[3], padding: spacing[4], borderRadius: radii.cardVet, backgroundColor: colors.white },
  detailCard: { gap: spacing[2], padding: spacing[4], borderRadius: radii.cardVet, backgroundColor: colors.white },
  mutedLabel: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21 },
  balanceAmount: { color: colors.brown, fontFamily: fonts.bold, fontSize: 30, lineHeight: 38, flexShrink: 1 },
  detailAmount: { color: colors.brown, fontFamily: fonts.bold, fontSize: 29, lineHeight: 37, flexShrink: 1 },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21, flexShrink: 1 },
  muted: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 18, flexShrink: 1 },
  sectionTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.section, lineHeight: 25, flexShrink: 1 },
  listRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gold },
  rowCopy: { flex: 1, gap: spacing[1], minWidth: 0 },
  rowTitle: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.body, lineHeight: 21, flexShrink: 1 },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], flexShrink: 1 },
  historyHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  textAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing[2] },
  actionText: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.body },
  destinationSection: { gap: spacing[3] },
  destinationCard: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[3], borderRadius: radii.button, backgroundColor: colors.white },
  selectedDestination: { borderWidth: 2, borderColor: colors.brown },
  changeButton: { minWidth: 72, alignSelf: 'auto' },
  detailLine: { minHeight: 26, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing[4] },
  flexCopy: { flex: 1 },
  value: { textAlign: 'right', maxWidth: '58%' },
  strong: { color: colors.brown, fontFamily: fonts.semiBold },
  successMark: { width: 60, height: 60, alignSelf: 'center', borderRadius: 30, backgroundColor: colors.brown, alignItems: 'center', justifyContent: 'center' },
  successTitle: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.title, lineHeight: 32, textAlign: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(58, 23, 13, 0.42)' },
  sheet: { maxHeight: '82%', paddingHorizontal: spacing[5], paddingTop: spacing[5], paddingBottom: spacing[6], gap: spacing[3], borderTopLeftRadius: radii.cardVet, borderTopRightRadius: radii.cardVet, backgroundColor: colors.cream },
  modalOptions: { flexShrink: 1 },
  modalOption: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gold, paddingVertical: spacing[2] },
  pressed: { opacity: 0.82 },
});
