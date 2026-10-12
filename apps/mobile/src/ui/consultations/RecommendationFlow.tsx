import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { SessionSnapshot } from '../../domain/auth';
import type { RecommendationItemInput, RecommendationProduct, RecommendationSnapshot } from '../../domain/recommendations';
import type { ConsultationDetail } from '../../domain/consultations';
import type { ClinicalNoteSnapshot } from '../../domain/clinicalNotes';
import { DomainError } from '../../domain/errors';
import { Button } from '../components/Button';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { EmptyState, ErrorState, InlineFeedback, LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { TextArea, TextField } from '../components/TextField';
import { colors, fonts, layout, radii, roleTokens, spacing, typeScale } from '../theme/tokens';

type ItemForm = {
  key: string;
  id: string | null;
  productId: string | null;
  titleSnapshot: string;
  instructions: string;
  note: string;
};

type Props = { store: LocalStore; session: SessionSnapshot; consultationId: string; onExit: () => void };

export function RecommendationFlow({ store, session, consultationId, onExit }: Props) {
  const role = session.activeRole;
  const [consultation, setConsultation] = useState<ConsultationDetail | null>(null);
  const [clinicalNote, setClinicalNote] = useState<ClinicalNoteSnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<RecommendationSnapshot | null>(null);
  const [items, setItems] = useState<ItemForm[]>([]);
  const [savedItems, setSavedItems] = useState<RecommendationItemInput[]>([]);
  const [products, setProducts] = useState<RecommendationProduct[]>([]);
  const [query, setQuery] = useState('');
  const [pickerItemKey, setPickerItemKey] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [leave, setLeave] = useState(false);
  const [sendConfirm, setSendConfirm] = useState(false);
  const [removeItemKey, setRemoveItemKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const locked = useRef(false);
  const localSequence = useRef(0);
  const roleCanWrite = role === 'vet' && consultation?.verified === true && consultation.paid
    && consultation.record.payload.status === 'in_progress' && clinicalNote?.status === 'final'
    && snapshot?.status !== 'sent';
  const dirty = JSON.stringify(items.map(toInput)) !== JSON.stringify(savedItems);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextConsultation, nextNote, nextRecommendation, nextProducts] = await Promise.all([
        store.consultations.detail(session.userId, role, consultationId),
        store.clinicalNotes.load(session.userId, role, consultationId),
        store.recommendations.load(session.userId, role, consultationId),
        role === 'vet' ? store.recommendations.listProducts(session.userId, consultationId) : Promise.resolve([]),
      ]);
      setConsultation(nextConsultation);
      setClinicalNote(nextNote);
      setSnapshot(nextRecommendation);
      setProducts(nextProducts);
      const nextItems = nextRecommendation?.items.map((item) => ({
        key: item.id,
        id: item.id,
        productId: item.productId,
        titleSnapshot: item.titleSnapshot,
        instructions: item.instructions,
        note: item.note,
      })) ?? [];
      setItems(nextItems);
      setSavedItems(nextItems.map(toInput));
    } catch (cause) {
      setConsultation(null);
      setClinicalNote(null);
      setSnapshot(null);
      setItems([]);
      setSavedItems([]);
      setError(messageFor(cause));
    } finally {
      setLoading(false);
    }
  }, [consultationId, role, session.userId, store]);

  useEffect(() => {
    const timer = setTimeout(() => { void reload(); }, 0);
    return () => clearTimeout(timer);
  }, [reload]);

  const back = useCallback(() => {
    if (busy) return;
    if (pickerItemKey) { setPickerItemKey(null); return; }
    if (removeItemKey) { setRemoveItemKey(null); return; }
    if (sendConfirm) { setSendConfirm(false); return; }
    if (leave) { setLeave(false); return; }
    if (review) { setReview(false); return; }
    if (dirty && roleCanWrite) { setLeave(true); return; }
    onExit();
  }, [busy, dirty, leave, onExit, pickerItemKey, removeItemKey, review, roleCanWrite, sendConfirm]);

  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => handler.remove();
  }, [back]);

  const updateItem = (key: string, patch: Partial<ItemForm>) => {
    setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  };

  const addItem = () => {
    if (items.length >= 10) return;
    const key = `local-recommendation-${++localSequence.current}`;
    setItems((current) => [...current, { key, id: null, productId: null, titleSnapshot: '', instructions: '', note: '' }]);
  };

  const runSave = async (leaveAfter = false): Promise<RecommendationSnapshot | null> => {
    if (!roleCanWrite || locked.current) return null;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await store.recommendations.saveDraft(
        session.userId,
        consultationId,
        snapshot?.record.version ?? null,
        items.map(toInput),
      );
      const nextItems = next.items.map((item) => ({
        key: item.id,
        id: item.id,
        productId: item.productId,
        titleSnapshot: item.titleSnapshot,
        instructions: item.instructions,
        note: item.note,
      }));
      setSnapshot(next);
      setItems(nextItems);
      setSavedItems(nextItems.map(toInput));
      setLeave(false);
      if (leaveAfter) onExit();
      return next;
    } catch (cause) {
      setError(messageFor(cause));
      return null;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const openReview = async () => {
    const next = await runSave();
    if (next) setReview(true);
  };

  const send = async () => {
    if (!snapshot || !roleCanWrite || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await store.recommendations.send(session.userId, {
        consultationId,
        expectedVersion: snapshot.record.version,
        operationKey: `recommendation-send:${consultationId}:${snapshot.record.version}`,
      });
      setSnapshot(next);
      const nextItems = next.items.map((item) => ({
        key: item.id,
        id: item.id,
        productId: item.productId,
        titleSnapshot: item.titleSnapshot,
        instructions: item.instructions,
        note: item.note,
      }));
      setItems(nextItems);
      setSavedItems(nextItems.map(toInput));
      setReview(false);
      setSendConfirm(false);
      setNotice('Rekomendasi tersimpan dan terkirim ke Peternak.');
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const chooseProduct = (product: RecommendationProduct | null) => {
    if (!pickerItemKey) return;
    const item = items.find((candidate) => candidate.key === pickerItemKey);
    if (!item) return;
    updateItem(item.key, {
      productId: product?.id ?? null,
      titleSnapshot: product && !item.titleSnapshot.trim() ? product.name : item.titleSnapshot,
    });
    setPickerItemKey(null);
    setQuery('');
  };

  const confirmRemove = () => {
    if (!removeItemKey) return;
    setItems((current) => current.filter((item) => item.key !== removeItemKey));
    setRemoveItemKey(null);
  };

  const discardChanges = () => {
    setItems(savedItems.map((item, index) => ({ ...item, key: item.id ?? `saved-${index}`, id: item.id ?? null })));
    setLeave(false);
    setError('');
    onExit();
  };

  const filteredProducts = products.filter((product) => [product.name, product.category, product.description]
    .join(' ').toLocaleLowerCase('id').includes(query.trim().toLocaleLowerCase('id')));
  const code = String(consultation?.record.payload.displayCode ?? 'layanan ini');
  const removeItem = items.find((item) => item.key === removeItemKey);
  const pickerItem = items.find((item) => item.key === pickerItemKey);

  return <View style={styles.root}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Kembali" disabled={busy} onPress={back} style={styles.back}>
        <Icon name="arrow-left" color={colors.brown} size={22} />
      </Pressable>
      <Text accessibilityRole="header" style={styles.title}>{review ? 'Tinjau rekomendasi' : snapshot?.status === 'sent' ? 'Rekomendasi terkirim' : role === 'farmer' ? 'Rekomendasi dokter' : 'Rekomendasi'}</Text>
    </View>

    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {error ? <ErrorState message={error} role={role} onRetry={() => { void reload(); }} /> : null}
      {notice ? <InlineFeedback message={notice} tone="success" /> : null}
      {loading ? <LoadingState label="Memuat rekomendasi…" /> : null}
      {!loading && consultation ? <>
        <View style={styles.card}>
          <Text style={styles.heading}>{code}</Text>
          <Meta label="Pasien" value={consultation.animalName} />
          <Meta label={role === 'vet' ? 'Peternak' : 'Dokter'} value={consultation.otherPartyName} />
          {snapshot?.status === 'sent' ? <InlineFeedback message={`Dikirim ${formatDate(snapshot.sentAt)}. Isi rekomendasi hanya dapat dibaca.`} tone="success" /> : null}
          {!clinicalNote || clinicalNote.status !== 'final' ? <InlineFeedback message={role === 'vet'
            ? 'Finalisasi catatan pemeriksaan sebelum membuat rekomendasi.'
            : 'Dokter belum mengirim rekomendasi untuk layanan ini.'} /> : null}
          {role === 'vet' && !consultation.verified ? <InlineFeedback message="Dokter harus terverifikasi untuk mengelola rekomendasi." /> : null}
          {role === 'vet' && consultation.record.payload.status !== 'in_progress' ? <InlineFeedback message="Rekomendasi hanya dapat dikirim saat layanan berlangsung." /> : null}
          {role === 'vet' && !consultation.paid ? <InlineFeedback message="Pembayaran layanan belum berhasil." /> : null}
        </View>

        {snapshot?.status === 'sent' || role === 'farmer' || review ? <View style={styles.card}>
          {snapshot?.items.length ? snapshot.items.map((item, index) => <View key={item.id} style={styles.itemReview}>
            <Text style={styles.itemHeading}>Rekomendasi {index + 1}</Text>
            <Meta label="Nama rekomendasi" value={item.titleSnapshot || 'Belum diisi'} />
            {item.productId ? <Meta label="Produk terkait" value={`${item.productName ?? products.find((product) => product.id === item.productId)?.name ?? 'Produk katalog'}${item.productUnitPrice !== null ? ` · ${rupiah(item.productUnitPrice)}` : ''}`} /> : <Meta label="Produk" value="Tidak dipilih" />}
            <Meta label="Instruksi" value={item.instructions || 'Belum diisi'} />
            {item.note ? <Meta label="Catatan tambahan" value={item.note} /> : null}
          </View>) : <EmptyState role={role} title="Belum ada item rekomendasi" description={role === 'vet' ? 'Tambahkan item dan instruksi sebelum mengirim.' : 'Dokter belum mengirim rekomendasi untuk layanan ini.'} />}
          {role === 'vet' && review && snapshot?.status !== 'sent' ? <>
            <InlineFeedback message="Periksa teks dan produk yang dipilih. Peternak akan menerima isi ini setelah pengiriman tersimpan." />
            <Button role={role} label="Kirim rekomendasi" loading={busy} onPress={() => setSendConfirm(true)} />
            <Button role={role} variant="secondary" disabled={busy} label="Kembali mengedit" onPress={() => setReview(false)} />
          </> : null}
        </View> : null}

        {roleCanWrite && !review && snapshot?.status !== 'sent' ? <>
          <View style={styles.card}>
            <Text style={styles.heading}>{snapshot ? 'Edit draft rekomendasi' : 'Tambah rekomendasi'}</Text>
            {items.length === 0 ? <EmptyState role={role} title="Belum ada item" description="Produk bersifat opsional. Rekomendasi teks dapat dikirim tanpa menautkan produk." /> : null}
            {items.map((item, index) => {
              const product = item.productId ? products.find((candidate) => candidate.id === item.productId) : null;
              return <View key={item.key} style={styles.itemEditor}>
                <Text style={styles.itemHeading}>Item {index + 1}</Text>
                {product ? <View style={styles.productSummary}>
                  <Text style={styles.body}>{product.name}</Text>
                  <Text style={styles.label}>{rupiah(product.unitPrice)} · {categoryLabel(product.category)}</Text>
                </View> : item.productId ? <InlineFeedback message="Produk tertaut tidak ada dalam katalog aktif; pilih produk lain atau hapus tautannya." tone="error" /> : null}
                <Button role={role} variant="secondary" disabled={busy} label={item.productId ? 'Ganti Produk' : 'Pilih Produk (opsional)'} onPress={() => { setPickerItemKey(item.key); setQuery(''); }} />
                {item.productId ? <Button role={role} variant="secondary" disabled={busy} label="Lepas Produk" onPress={() => updateItem(item.key, { productId: null })} /> : null}
                <TextField label="Nama rekomendasi" value={item.titleSnapshot} editable={!busy} maxLength={120} placeholder="Tulis rekomendasi" helperText="Maksimal 120 karakter" onChangeText={(value) => updateItem(item.key, { titleSnapshot: value })} />
                <TextArea label="Instruksi" value={item.instructions} editable={!busy} maxLength={2000} placeholder="Tulis instruksi perawatan" helperText="Maksimal 2.000 karakter" onChangeText={(value) => updateItem(item.key, { instructions: value })} />
                <TextArea label="Catatan tambahan (opsional)" value={item.note} editable={!busy} maxLength={1000} placeholder="Catatan untuk Peternak" helperText="Maksimal 1.000 karakter" onChangeText={(value) => updateItem(item.key, { note: value })} />
                <Button role={role} variant="secondary" disabled={busy} label="Hapus Item" onPress={() => setRemoveItemKey(item.key)} />
              </View>;
            })}
            <Button role={role} variant="secondary" disabled={busy || items.length >= 10} label="Tambah Item" onPress={addItem} />
          </View>
          <Button role={role} label="Simpan Draft" loading={busy} onPress={() => { void runSave(); }} />
          <Button role={role} variant="secondary" disabled={busy} label="Tinjau sebelum dikirim" onPress={() => { void openReview(); }} />
        </> : null}

        {role === 'vet' && !roleCanWrite && snapshot?.status !== 'sent' && clinicalNote?.status === 'final' ? <InlineFeedback message="Draft rekomendasi hanya dapat diubah oleh dokter terverifikasi saat layanan berlangsung." /> : null}
        {role === 'farmer' && snapshot?.status !== 'sent' ? <EmptyState role={role} title="Belum ada rekomendasi terkirim" description="Rekomendasi baru tampil setelah dokter mengirimkannya." /> : null}
        {role === 'vet' && snapshot?.status === 'sent' && snapshot.items.length === 0 ? <InlineFeedback message="Rekomendasi terkirim tidak memiliki item. Periksa data yang tersimpan." tone="error" /> : null}
      </> : null}
    </ScrollView>

    <Modal visible={leave} transparent animationType="fade" onRequestClose={() => { if (!busy) setLeave(false); }}>
      <SafeAreaProvider><SafeAreaView style={styles.backdrop}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.heading}>Perubahan belum tersimpan</Text>
          {error ? <InlineFeedback message={error} tone="error" /> : null}
          <Button role={role} label="Simpan Draft" loading={busy} onPress={() => { void runSave(true); }} />
          <Button role={role} variant="secondary" disabled={busy} label="Buang Perubahan" onPress={discardChanges} />
          <Button role={role} variant="secondary" disabled={busy} label="Tetap Mengedit" onPress={() => setLeave(false)} />
        </View>
      </KeyboardAvoidingView></SafeAreaView></SafeAreaProvider>
    </Modal>

    <Modal visible={!!pickerItemKey} transparent animationType="fade" onRequestClose={() => { setPickerItemKey(null); setQuery(''); }}>
      <SafeAreaProvider><SafeAreaView style={styles.backdrop}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.heading}>Pilih Produk</Text>
          <Text style={styles.body}>Produk katalog hanya ditautkan ke rekomendasi. Pembelian dilakukan Peternak.</Text>
          <TextField label="Cari produk" value={query} editable={!busy} placeholder="Nama atau kategori" returnKeyType="search" onChangeText={setQuery} />
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.productList}>
            <Button role={role} variant="secondary" label="Tanpa produk terkait" onPress={() => chooseProduct(null)} />
            {filteredProducts.length ? filteredProducts.map((product) => <Pressable
              key={product.id}
              accessibilityRole="button"
              accessibilityLabel={`${product.name}, ${rupiah(product.unitPrice)}`}
              accessibilityState={{ selected: pickerItem?.productId === product.id }}
              onPress={() => chooseProduct(product)}
              style={[styles.productChoice, pickerItem?.productId === product.id && styles.selectedProduct]}
            >
              <Text style={styles.itemHeading}>{product.name}</Text>
              <Text style={styles.body}>{product.description}</Text>
              <Text style={styles.label}>{categoryLabel(product.category)} · {rupiah(product.unitPrice)}</Text>
            </Pressable>) : <EmptyState role={role} title="Produk tidak ditemukan" description={query ? 'Coba kata pencarian lain atau lanjut tanpa produk.' : 'Belum ada produk aktif untuk ditautkan.'} />}
          </ScrollView>
          <Button role={role} variant="secondary" label="Tutup" onPress={() => { setPickerItemKey(null); setQuery(''); }} />
        </View>
      </KeyboardAvoidingView></SafeAreaView></SafeAreaProvider>
    </Modal>

    <ConfirmationDialog
      visible={sendConfirm}
      role={role}
      title="Kirim rekomendasi?"
      message={`${code}\nPeternak akan melihat item, produk tertaut, dan instruksi setelah pengiriman berhasil disimpan.${error ? `\n\n${error}` : ''}`}
      confirmLabel="Kirim"
      loading={busy}
      onCancel={() => { if (!busy) { setSendConfirm(false); setError(''); } }}
      onConfirm={() => { void send(); }}
    />
    <ConfirmationDialog
      visible={!!removeItem}
      role={role}
      title="Hapus item?"
      message="Item ini akan dihapus dari draft rekomendasi. Perubahan baru tersimpan setelah Anda menyimpan draft."
      confirmLabel="Hapus Item"
      destructive
      loading={busy}
      onCancel={() => setRemoveItemKey(null)}
      onConfirm={confirmRemove}
    />
  </View>;
}

function toInput(item: ItemForm): RecommendationItemInput {
  return { id: item.id, productId: item.productId, titleSnapshot: item.titleSnapshot, instructions: item.instructions, note: item.note };
}

function Meta({ label, value }: { label: string; value: string }) {
  return <View style={styles.meta}><Text style={styles.label}>{label}</Text><Text selectable style={styles.body}>{value}</Text></View>;
}

function formatDate(value: string | null): string {
  return value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : 'waktu tidak tersedia';
}

function rupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}

function categoryLabel(category: string): string {
  return ({ care: 'Perawatan', supplement: 'Suplemen', equipment: 'Peralatan' } as Record<string, string>)[category] ?? category;
}

function messageFor(error: unknown): string {
  return error instanceof DomainError ? error.message : 'Rekomendasi belum dapat dimuat atau disimpan.';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingHorizontal: layout.contentHorizontal, paddingVertical: spacing[2] },
  back: { width: 48, height: 48, borderRadius: radii.button, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: colors.brown, fontFamily: fonts.bold, fontSize: 21, lineHeight: 28, flexShrink: 1 },
  content: { flexGrow: 1, width: '100%', maxWidth: 480, alignSelf: 'center', gap: spacing[4], padding: spacing[4], paddingBottom: spacing[8] },
  card: { gap: spacing[3], padding: spacing[4], borderRadius: roleTokens.vet.cardRadius, backgroundColor: colors.white },
  heading: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.heading, lineHeight: 28, flexShrink: 1 },
  itemHeading: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.section, lineHeight: 24, flexShrink: 1 },
  itemEditor: { gap: spacing[3], paddingTop: spacing[3], borderTopWidth: 1, borderColor: colors.cream },
  itemReview: { gap: spacing[3], paddingTop: spacing[3], borderTopWidth: 1, borderColor: colors.cream },
  meta: { gap: spacing[1], paddingTop: spacing[2], borderTopWidth: 1, borderColor: colors.cream },
  label: { color: colors.muted, fontFamily: fonts.medium, fontSize: typeScale.small, lineHeight: 18, flexShrink: 1 },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22, flexShrink: 1 },
  productSummary: { gap: spacing[1], padding: spacing[3], backgroundColor: colors.cream, borderRadius: radii.button },
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing[5], backgroundColor: 'rgba(58,23,13,0.5)' },
  dialog: { width: '100%', maxWidth: 400, alignSelf: 'center', maxHeight: '90%', padding: spacing[5], gap: spacing[3], borderRadius: roleTokens.vet.cardRadius, backgroundColor: colors.white },
  productList: { flexGrow: 0, maxHeight: 390 },
  productChoice: { minHeight: 72, justifyContent: 'center', gap: spacing[1], padding: spacing[3], marginVertical: spacing[1], borderWidth: 1, borderColor: colors.gold, borderRadius: radii.button },
  selectedProduct: { borderWidth: 2, borderColor: colors.brown },
});
