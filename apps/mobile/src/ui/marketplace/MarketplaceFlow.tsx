import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { SessionSnapshot } from '../../domain/auth';
import { catalogCategoryLabel, selectCatalogProducts, speciesLabel, type CatalogProduct } from '../../domain/catalog';
import type { LivestockSpecies } from '../../domain/profiles';
import { livestockSpecies } from '../../domain/profiles';
import { DomainError } from '../../domain/errors';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, InlineFeedback, LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { TextField } from '../components/TextField';
import { colors, fonts, layout, radii, roleTokens, spacing, typeScale } from '../theme/tokens';

export type MarketplaceRoute = {
  type: 'marketplace';
  recommendationId: string;
  consultationId: string;
  productId?: string;
  entry: 'catalog' | 'recommendation';
};

type Props = {
  store: LocalStore;
  session: SessionSnapshot;
  route: MarketplaceRoute;
  onExit: () => void;
};

const categories = [
  { value: null, label: 'Semua kategori' },
  { value: 'care', label: 'Perawatan' },
  { value: 'supplement', label: 'Suplemen' },
  { value: 'equipment', label: 'Peralatan' },
] as const;
const speciesOptions: { value: LivestockSpecies | null; label: string }[] = [
  { value: null, label: 'Semua jenis' },
  ...livestockSpecies.map((species) => ({ value: species, label: speciesLabel(species) })),
];

export function MarketplaceFlow({ store, session, route, onExit }: Props) {
  const role = session.activeRole;
  const [screen, setScreen] = useState<'catalog' | 'product'>(route.productId ? 'product' : 'catalog');
  const [selectedProductId, setSelectedProductId] = useState(route.productId ?? null);
  const [openedFromRecommendation, setOpenedFromRecommendation] = useState(route.entry === 'recommendation');
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [species, setSpecies] = useState<LivestockSpecies | null>(null);
  const [draftCategory, setDraftCategory] = useState<string | null>(null);
  const [draftSpecies, setDraftSpecies] = useState<LivestockSpecies | null>(null);
  const [filterVisible, setFilterVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const filteredProducts = useMemo(
    () => selectCatalogProducts(products, { query, category, species }),
    [category, products, query, species],
  );
  const activeFilterCount = Number(Boolean(category)) + Number(Boolean(species));

  const returnToCatalog = useCallback(() => {
    setScreen('catalog');
    setSelectedProductId(null);
    setOpenedFromRecommendation(false);
    setProduct(null);
    setError('');
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (screen === 'catalog') {
        await store.catalog.assertRecommendationContext(session.userId, route.recommendationId, route.consultationId);
        const next = await store.catalog.listProducts(session.userId, role);
        if (mounted) setProducts(next);
      } else {
        if (!selectedProductId) throw new DomainError('NOT_FOUND', 'Produk tidak ditemukan di katalog.');
        const next = openedFromRecommendation
          ? await store.catalog.getRecommendedProduct(session.userId, route.recommendationId, route.consultationId, selectedProductId)
          : await store.catalog.getProduct(session.userId, role, selectedProductId);
        if (mounted) setProduct(next);
      }
    };
    const request = setTimeout(() => {
      setError('');
      setLoading(true);
      void load().catch((cause: unknown) => {
        if (mounted) {
          setProducts([]);
          setProduct(null);
          setError(messageFor(cause));
        }
      }).finally(() => {
        if (mounted) setLoading(false);
      });
    }, 0);
    return () => { mounted = false; clearTimeout(request); };
  }, [openedFromRecommendation, reloadKey, role, route.consultationId, route.recommendationId, screen, selectedProductId, session.userId, store]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (filterVisible) {
        setFilterVisible(false);
        return true;
      }
      if (screen === 'product') {
        returnToCatalog();
        return true;
      }
      onExit();
      return true;
    });
    return () => subscription.remove();
  }, [filterVisible, onExit, returnToCatalog, screen]);

  const openProduct = (id: string) => {
    setSelectedProductId(id);
    setOpenedFromRecommendation(false);
    setScreen('product');
  };

  const openFilters = () => {
    setDraftCategory(category);
    setDraftSpecies(species);
    setFilterVisible(true);
  };

  const applyFilters = () => {
    setCategory(draftCategory);
    setSpecies(draftSpecies);
    setFilterVisible(false);
  };

  const resetFilters = () => {
    setDraftCategory(null);
    setDraftSpecies(null);
    setCategory(null);
    setSpecies(null);
    setFilterVisible(false);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={screen === 'product' ? 'Kembali ke katalog' : 'Kembali ke rekomendasi'} onPress={() => screen === 'product' ? returnToCatalog() : onExit()} style={styles.back}>
          <Icon name="arrow-left" size={22} color={colors.brown} />
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>{screen === 'product' ? 'Detail Produk' : 'Marketplace'}</Text>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {screen === 'catalog' ? <>
          <View style={styles.introCard}>
            <Text style={styles.heading}>Produk dari katalog</Text>
            <Text style={styles.body}>Cari produk berdasarkan nama, kategori, atau jenis ternak. Harga dan informasi mengikuti data katalog.</Text>
          </View>
          <TextField label="Cari produk" value={query} onChangeText={setQuery} placeholder="Nama, kategori, atau jenis ternak" returnKeyType="search" />
          <Pressable accessibilityRole="button" accessibilityLabel={`Filter produk${activeFilterCount ? `, ${activeFilterCount} filter aktif` : ''}`} onPress={openFilters} style={styles.filterButton}>
            <Icon name="list-filter" size={19} color={colors.brown} />
            <Text style={styles.filterButtonText}>{activeFilterCount ? `Filter (${activeFilterCount})` : 'Filter produk'}</Text>
            {activeFilterCount ? <Text style={styles.filterSummary}>{[category ? catalogCategoryLabel(category) : null, species ? speciesLabel(species) : null].filter(Boolean).join(' · ')}</Text> : null}
          </Pressable>
          {error ? <ErrorState role="farmer" message={error} onRetry={() => setReloadKey((value) => value + 1)} /> : null}
          {loading ? <LoadingState label="Memuat katalog…" /> : !error && filteredProducts.length ? (
            <View style={styles.productList}>
              {filteredProducts.map((item) => <ProductCard key={item.id} product={item} onPress={() => openProduct(item.id)} />)}
            </View>
          ) : !error ? <EmptyState
            role="farmer"
            title={products.length ? 'Produk tidak ditemukan' : 'Katalog belum tersedia'}
            description={products.length ? 'Ubah kata pencarian atau kombinasi filter.' : 'Belum ada produk aktif di katalog.'}
            actionLabel={query || activeFilterCount ? 'Hapus pencarian dan filter' : undefined}
            onAction={query || activeFilterCount ? () => { setQuery(''); setCategory(null); setSpecies(null); } : undefined}
          /> : null}
        </> : <>
          {error ? <ErrorState role="farmer" message={error} onRetry={() => setReloadKey((value) => value + 1)} /> : null}
          {loading ? <LoadingState label="Memuat detail produk…" /> : !error && product ? <>
            {openedFromRecommendation ? <InlineFeedback message="Produk ini terhubung ke rekomendasi dokter pada layanan yang dipilih." /> : null}
            <View style={styles.detailCard}>
              <View style={styles.productIcon}><Icon name="package" size={30} color={colors.brown} /></View>
              <Text accessibilityRole="header" style={styles.productTitle}>{product.name}</Text>
              <View style={styles.tags}>
                <Tag label={catalogCategoryLabel(product.category)} />
                {product.species.map((value) => <Tag key={value} label={speciesLabel(value)} />)}
              </View>
              <Text style={styles.price}>{rupiah(product.unitPrice)}</Text>
              <Text style={styles.label}>Harga per unit · Rupiah</Text>
              <View style={styles.divider} />
              <Text style={styles.sectionTitle}>Informasi produk</Text>
              <Text selectable style={styles.body}>{product.description || 'Informasi tambahan belum tersedia di katalog.'}</Text>
              <Text style={styles.sectionTitle}>Jenis ternak</Text>
              <Text style={styles.body}>{product.species.length ? product.species.map(speciesLabel).join(', ') : 'Tidak dibatasi di katalog.'}</Text>
            </View>
            <Button role="farmer" variant="secondary" label="Jelajahi katalog" onPress={returnToCatalog} />
          </> : null}
        </>}
      </ScrollView>

      <Modal visible={filterVisible} transparent animationType="fade" onRequestClose={() => setFilterVisible(false)}>
        <SafeAreaProvider>
          <SafeAreaView style={styles.backdrop}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <View style={styles.dialog}>
                <Text accessibilityRole="header" style={styles.heading}>Filter produk</Text>
                <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.filterContent}>
                  <Text style={styles.sectionTitle}>Kategori</Text>
                  <View style={styles.options}>
                    {categories.map((option) => <Option key={option.label} label={option.label} selected={draftCategory === option.value} onPress={() => setDraftCategory(option.value)} />)}
                  </View>
                  <Text style={styles.sectionTitle}>Jenis ternak</Text>
                  <View style={styles.options}>
                    {speciesOptions.map((option) => <Option key={option.label} label={option.label} selected={draftSpecies === option.value} onPress={() => setDraftSpecies(option.value)} />)}
                  </View>
                </ScrollView>
                <Button role="farmer" label="Terapkan filter" onPress={applyFilters} />
                <Button role="farmer" variant="secondary" label="Reset filter" onPress={resetFilters} />
                <Button role="farmer" variant="secondary" label="Tutup" onPress={() => setFilterVisible(false)} />
              </View>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}

function ProductCard({ product, onPress }: { product: CatalogProduct; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${product.name}, ${rupiah(product.unitPrice)}`} onPress={onPress} style={({ pressed }) => [styles.productCard, pressed && styles.pressed]}>
      <View style={styles.cardIcon}><Icon name="package" size={23} color={colors.brown} /></View>
      <View style={styles.cardCopy}>
        <Text style={styles.cardTitle}>{product.name}</Text>
        <Text numberOfLines={2} style={styles.body}>{product.description || 'Informasi tambahan belum tersedia di katalog.'}</Text>
        <Text style={styles.cardPrice}>{rupiah(product.unitPrice)} · {catalogCategoryLabel(product.category)}</Text>
        {product.species.length ? <Text style={styles.label}>{product.species.map(speciesLabel).join(', ')}</Text> : null}
      </View>
      <Icon name="chevron-right" size={20} color={colors.muted} />
    </Pressable>
  );
}

function Tag({ label }: { label: string }) {
  return <View style={styles.tag}><Text style={styles.tagText}>{label}</Text></View>;
}

function Option({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={[styles.option, selected && styles.selectedOption]}>
      <Text style={[styles.optionText, selected && styles.selectedOptionText]}>{label}</Text>
      {selected ? <Icon name="check" size={18} color={colors.white} /> : null}
    </Pressable>
  );
}

function rupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}

function messageFor(error: unknown): string {
  return error instanceof DomainError ? error.message : 'Katalog atau detail produk belum dapat dimuat.';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingHorizontal: layout.contentHorizontal, paddingVertical: spacing[2] },
  back: { width: 48, height: 48, borderRadius: radii.button, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: colors.brown, fontFamily: fonts.bold, fontSize: 21, lineHeight: 28, flexShrink: 1 },
  content: { flexGrow: 1, width: '100%', maxWidth: 480, alignSelf: 'center', gap: spacing[3], padding: spacing[4], paddingBottom: spacing[8] },
  introCard: { gap: spacing[2], padding: spacing[4], borderRadius: roleTokens.farmer.cardRadius, backgroundColor: colors.white },
  heading: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.heading, lineHeight: 28, flexShrink: 1 },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22, flexShrink: 1 },
  label: { color: colors.muted, fontFamily: fonts.medium, fontSize: typeScale.small, lineHeight: 18, flexShrink: 1 },
  filterButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderWidth: 1, borderColor: colors.gold, borderRadius: radii.button, backgroundColor: colors.white },
  filterButtonText: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.body },
  filterSummary: { flex: 1, color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, textAlign: 'right', flexShrink: 1 },
  productList: { gap: spacing[3] },
  productCard: { minHeight: 104, flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[3], borderRadius: roleTokens.farmer.cardRadius, backgroundColor: colors.white },
  cardIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  cardCopy: { flex: 1, gap: spacing[1] },
  cardTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.section, lineHeight: 24, flexShrink: 1 },
  cardPrice: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.body, lineHeight: 21, flexShrink: 1 },
  pressed: { opacity: 0.82 },
  detailCard: { gap: spacing[3], padding: spacing[4], borderRadius: roleTokens.farmer.cardRadius, backgroundColor: colors.white },
  productIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream, alignSelf: 'center' },
  productTitle: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.heading, lineHeight: 30, textAlign: 'center', flexShrink: 1 },
  tags: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: spacing[2] },
  tag: { minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing[3], paddingVertical: spacing[1], borderRadius: 16, backgroundColor: colors.cream },
  tagText: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.small, lineHeight: 18, flexShrink: 1 },
  price: { color: colors.brown, fontFamily: fonts.bold, fontSize: 25, lineHeight: 32, textAlign: 'center', flexShrink: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.gold, marginVertical: spacing[1] },
  sectionTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.section, lineHeight: 24, flexShrink: 1 },
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing[5], backgroundColor: 'rgba(58,23,13,0.5)' },
  dialog: { width: '100%', maxWidth: 400, maxHeight: '92%', alignSelf: 'center', padding: spacing[5], gap: spacing[3], borderRadius: roleTokens.farmer.cardRadius, backgroundColor: colors.white },
  filterContent: { gap: spacing[3], paddingBottom: spacing[2] },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  option: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], paddingHorizontal: spacing[3], borderWidth: 1, borderColor: colors.gold, borderRadius: radii.button, backgroundColor: colors.white },
  selectedOption: { borderColor: colors.brown, backgroundColor: colors.brown },
  optionText: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.body, lineHeight: 20, flexShrink: 1 },
  selectedOptionText: { color: colors.white, fontFamily: fonts.semiBold },
});
