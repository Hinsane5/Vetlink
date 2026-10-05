import { useCallback, useEffect, useState } from 'react';
import {
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { SessionSnapshot } from '../../domain/auth';
import type { LivestockSex, LivestockSnapshot } from '../../domain/livestock';
import { livestockSpecies, type LivestockSpecies, type SelectedAsset } from '../../domain/profiles';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, InlineFeedback, LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { TextField } from '../components/TextField';
import { FarmerHealthFlow } from '../health/FarmerHealthFlow';
import { colors, fonts, layout, radii, spacing, typeScale } from '../theme/tokens';

export type LivestockRoute =
  | { type: 'livestock'; screen: 'list' }
  | { type: 'livestock'; screen: 'detail'; livestockId: string }
  | { type: 'livestock'; screen: 'health'; livestockId: string }
  | { type: 'livestock'; screen: 'saved'; livestockId: string }
  | { type: 'livestock'; screen: 'form'; mode: 'create'; returnTo: 'list' }
  | { type: 'livestock'; screen: 'form'; mode: 'edit'; livestockId: string; returnTo: 'detail' };

type Props = {
  store: LocalStore;
  session: SessionSnapshot;
  route: LivestockRoute;
  onNavigate: (route: LivestockRoute) => void;
  onExit: () => void;
  onOpenProfile: () => void;
};

type SpeciesFilter = LivestockSpecies | 'all';
type SexFilter = LivestockSex | 'all';
type FormValues = {
  displayCode: string;
  name: string;
  species: LivestockSpecies | '';
  breed: string;
  sex: LivestockSex;
  estimatedAgeMonths: string;
  weightKg: string;
};

const speciesLabels: Record<LivestockSpecies, string> = {
  cattle: 'Sapi',
  goat: 'Kambing',
  sheep: 'Domba',
  poultry: 'Unggas',
  duck: 'Bebek',
  pig: 'Babi',
  horse: 'Kuda',
};

const sexLabels: Record<LivestockSex, string> = {
  female: 'Betina',
  male: 'Jantan',
  unknown: 'Belum diketahui',
};

const emptyForm: FormValues = {
  displayCode: '',
  name: '',
  species: '',
  breed: '',
  sex: 'unknown',
  estimatedAgeMonths: '',
  weightKg: '',
};

export function LivestockFlow({ store, session, route, onNavigate, onExit, onOpenProfile }: Props) {
  const [query, setQuery] = useState('');
  const [speciesFilter, setSpeciesFilter] = useState<SpeciesFilter>('all');
  const [sexFilter, setSexFilter] = useState<SexFilter>('all');
  const [filterSpecies, setFilterSpecies] = useState<SpeciesFilter>('all');
  const [filterSex, setFilterSex] = useState<SexFilter>('all');
  const [filterVisible, setFilterVisible] = useState(false);
  const [listRevision, setListRevision] = useState(0);
  const [animals, setAnimals] = useState<LivestockSnapshot[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [detail, setDetail] = useState<LivestockSnapshot | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [imageFailed, setImageFailed] = useState<Set<string>>(() => new Set());
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  const activeFilterCount = Number(speciesFilter !== 'all') + Number(sexFilter !== 'all');
  const canOpenFarmProfile = listError.includes('profil peternakan') || listError.includes('jenis ternak pada profil');

  useEffect(() => {
    if (route.screen !== 'list') return;
    let active = true;
    const timer = setTimeout(() => {
      setListLoading(true);
      setListError('');
      const filters = {
        query,
        species: speciesFilter === 'all' ? undefined : speciesFilter,
        sex: sexFilter === 'all' ? undefined : sexFilter,
      };
      store.livestock.list(session.userId, filters).then((items) => {
        if (active) setAnimals(items);
      }).catch((cause: unknown) => {
        if (active) setListError(messageFor(cause));
      }).finally(() => {
        if (active) setListLoading(false);
      });
    }, query ? 180 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [listRevision, query, route.screen, session.userId, sexFilter, speciesFilter, store]);

  useEffect(() => {
    if (route.screen !== 'detail') return;
    let active = true;
    const timer = setTimeout(() => {
      setDetail(null);
      setDetailError('');
      setDetailLoading(true);
      store.livestock.get(session.userId, route.livestockId).then((item) => {
        if (active) setDetail(item);
      }).catch((cause: unknown) => {
        if (active) setDetailError(messageFor(cause));
      }).finally(() => {
        if (active) setDetailLoading(false);
      });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [route, session.userId, store]);

  const goBack = useCallback(() => {
    if (filterVisible) {
      setFilterVisible(false);
      return true;
    }
    if (previewUri) {
      setPreviewUri(null);
      return true;
    }
    if (route.screen === 'list') {
      onExit();
      return true;
    }
    if (route.screen === 'detail') {
      onNavigate({ type: 'livestock', screen: 'list' });
      return true;
    }
    if (route.screen === 'saved') {
      onNavigate({ type: 'livestock', screen: 'list' });
      return true;
    }
    // Child flows own the health and dirty-form Back behavior.
    return false;
  }, [filterVisible, onExit, onNavigate, previewUri, route]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => subscription.remove();
  }, [goBack]);

  const applyFilters = () => {
    setSpeciesFilter(filterSpecies);
    setSexFilter(filterSex);
    setFilterVisible(false);
  };

  const openFilters = () => {
    setFilterSpecies(speciesFilter);
    setFilterSex(sexFilter);
    setFilterVisible(true);
  };

  const retryList = () => setListRevision((value) => value + 1);

  if (route.screen === 'form') {
    return (
      <LivestockEditor
        key={`${route.mode}:${route.mode === 'edit' ? route.livestockId : 'new'}`}
        store={store}
        session={session}
        route={route}
        onBackToList={() => onNavigate({ type: 'livestock', screen: 'list' })}
        onBackToDetail={(livestockId) => onNavigate({ type: 'livestock', screen: 'detail', livestockId })}
        onSaved={(item, mode) => onNavigate(mode === 'create'
          ? { type: 'livestock', screen: 'saved', livestockId: item.id }
          : { type: 'livestock', screen: 'detail', livestockId: item.id })}
        onOpenProfile={onOpenProfile}
      />
    );
  }

  if (route.screen === 'health') {
    return <FarmerHealthFlow store={store} session={session} animalId={route.livestockId} onBack={() => onNavigate({ type: 'livestock', screen: 'detail', livestockId: route.livestockId })} />;
  }

  if (route.screen === 'saved') {
    return (
      <View style={styles.centerScreen}>
        <View style={styles.savedIcon}><Icon name="check" size={34} color={colors.white} /></View>
        <Text accessibilityRole="header" style={styles.savedTitle}>Ternak berhasil disimpan</Text>
        <Text style={styles.savedBody}>Data tersimpan di peternakan Anda.</Text>
        <View style={styles.savedActions}>
          <Button label="Lihat detail ternak" role="farmer" onPress={() => onNavigate({ type: 'livestock', screen: 'detail', livestockId: route.livestockId })} />
          <Button label="Kembali ke daftar" role="farmer" variant="secondary" onPress={() => onNavigate({ type: 'livestock', screen: 'list' })} />
        </View>
      </View>
    );
  }

  if (route.screen === 'detail') {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.detailContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <ScreenHeader title="Detail Ternak" onBack={() => onNavigate({ type: 'livestock', screen: 'list' })} />
          {detailLoading ? <LoadingState label="Memuat data ternak…" /> : null}
          {!detailLoading && detailError ? (
            <ErrorState message={detailError} role="farmer" onRetry={() => onNavigate({ ...route })} />
          ) : null}
          {!detailLoading && detail ? (
            <>
              <View style={styles.detailHero}>
                <Pressable
                  accessibilityRole={detail.photo?.localUri ? 'button' : undefined}
                  accessibilityLabel={detail.photo?.localUri ? `Lihat foto ${detail.name}` : undefined}
                  disabled={!detail.photo?.localUri || imageFailed.has(detail.id)}
                  onPress={() => detail.photo?.localUri && setPreviewUri(detail.photo.localUri)}
                  style={styles.detailPhotoFrame}
                >
                  {detail.photo?.localUri && !imageFailed.has(detail.id)
                    ? <Image accessibilityLabel={`Foto ${detail.name}`} source={{ uri: detail.photo.localUri }} onError={() => markImageFailed(detail.id, setImageFailed)} style={styles.detailPhoto} />
                    : <Icon name="paw-print" size={42} color={colors.brown} />}
                </Pressable>
                <Text accessibilityRole="header" style={styles.detailName}>{detail.name}</Text>
                <Text style={styles.detailSubtitle}>{speciesLabels[detail.species]} · {detail.displayCode}</Text>
                <Button
                  label="Edit Data Ternak"
                  role="farmer"
                  variant="secondary"
                  onPress={() => onNavigate({ type: 'livestock', screen: 'form', mode: 'edit', livestockId: detail.id, returnTo: 'detail' })}
                  style={styles.editButton}
                />
                <Button
                  label="Riwayat Kesehatan"
                  role="farmer"
                  onPress={() => onNavigate({ type: 'livestock', screen: 'health', livestockId: detail.id })}
                  style={styles.editButton}
                />
              </View>
              <View style={styles.infoCard}>
                <Text style={styles.sectionTitle}>Informasi ternak</Text>
                <DetailLine label="ID ternak" value={detail.displayCode} />
                <DetailLine label="Jenis ternak" value={speciesLabels[detail.species]} />
                <DetailLine label="Ras" value={detail.breed} />
                <DetailLine label="Jenis kelamin" value={sexLabels[detail.sex]} />
                <DetailLine label="Perkiraan umur" value={formatAge(detail.estimatedAgeMonths)} />
                <DetailLine label="Berat" value={`${formatNumber(detail.weightKg)} kg`} last />
              </View>
              <InlineFeedback message="Data ini hanya dapat dibuka oleh akun Peternak pemiliknya." />
            </>
          ) : null}
        </ScrollView>
        <ImagePreview uri={previewUri} onClose={() => setPreviewUri(null)} />
      </View>
    );
  }

  const profileSetupError = canOpenFarmProfile;
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.listHeader}>
          <View style={styles.listHeaderCopy}>
            <Text accessibilityRole="header" style={styles.pageTitle}>Ternak</Text>
            <Text style={styles.pageSubtitle}>{listLoading && !animals.length ? 'Memuat data peternakan…' : `${animals.length} ternak terdaftar`}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Tambah ternak" onPress={() => onNavigate({ type: 'livestock', screen: 'form', mode: 'create', returnTo: 'list' })} style={styles.addIconButton}>
            <Icon name="plus" size={22} color={colors.white} />
          </Pressable>
        </View>

        <View style={styles.searchRow}>
          <View style={styles.searchField}>
            <Icon name="search" size={19} color={colors.muted} />
            <TextInput
              accessibilityLabel="Cari ID, nama, atau ras ternak"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setQuery}
              placeholder="Cari ID, nama, atau ras"
              placeholderTextColor={colors.muted}
              returnKeyType="search"
              value={query}
              style={styles.searchInput}
            />
            {query ? <Pressable accessibilityRole="button" accessibilityLabel="Hapus pencarian" onPress={() => setQuery('')} style={styles.clearSearch}><Icon name="x" size={18} color={colors.muted} /></Pressable> : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={activeFilterCount ? `Filter ternak, ${activeFilterCount} filter aktif` : 'Filter ternak'}
            accessibilityState={{ selected: activeFilterCount > 0 }}
            onPress={openFilters}
            style={[styles.filterButton, activeFilterCount > 0 && styles.filterButtonActive]}
          >
            <Icon name="sliders-horizontal" size={20} color={activeFilterCount ? colors.white : colors.brown} />
            {activeFilterCount > 0 ? <Text style={styles.filterCount}>{activeFilterCount}</Text> : null}
          </Pressable>
        </View>

        <View style={styles.listSummaryRow}>
          <Text style={styles.listSectionTitle}>Daftar ternak</Text>
          <Text style={styles.resultCount}>{listLoading ? 'Memuat…' : `${animals.length} hasil`}</Text>
        </View>

        {listError ? (
          <View style={styles.errorBlock}>
            <InlineFeedback message={listError} tone="error" />
            {profileSetupError ? <Button label="Lengkapi profil peternakan" role="farmer" variant="secondary" onPress={onOpenProfile} /> : <Button label="Coba lagi" role="farmer" variant="secondary" onPress={retryList} />}
          </View>
        ) : null}

        {listLoading && !animals.length && !listError ? <LoadingState label="Memuat daftar ternak…" /> : null}
        {!listLoading && !listError && animals.length === 0 ? (
          query || activeFilterCount ? (
            <EmptyState title="Ternak tidak ditemukan" description="Ubah kata pencarian atau filter untuk melihat hasil lain." role="farmer" style={styles.emptyState} actionLabel="Atur ulang filter" onAction={() => { setQuery(''); setSpeciesFilter('all'); setSexFilter('all'); }} />
          ) : (
            <EmptyState title="Belum ada ternak" description="Tambahkan data ternak agar mudah ditemukan dan diperbarui." role="farmer" style={styles.emptyState} actionLabel="Tambah ternak" onAction={() => onNavigate({ type: 'livestock', screen: 'form', mode: 'create', returnTo: 'list' })} />
          )
        ) : null}
        {!listError && animals.length > 0 ? (
          <View style={styles.animalList}>
            {animals.map((animal) => (
              <AnimalRow
                key={animal.id}
                animal={animal}
                imageFailed={imageFailed.has(animal.id)}
                onImageError={() => markImageFailed(animal.id, setImageFailed)}
                onPress={() => onNavigate({ type: 'livestock', screen: 'detail', livestockId: animal.id })}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
      <FilterSheet
        visible={filterVisible}
        species={filterSpecies}
        sex={filterSex}
        onChangeSpecies={setFilterSpecies}
        onChangeSex={setFilterSex}
        onClose={() => setFilterVisible(false)}
        onReset={() => { setFilterSpecies('all'); setFilterSex('all'); }}
        onApply={applyFilters}
      />
      <ImagePreview uri={previewUri} onClose={() => setPreviewUri(null)} />
    </View>
  );
}

function LivestockEditor({ store, session, route, onBackToList, onBackToDetail, onSaved, onOpenProfile }: {
  store: LocalStore;
  session: SessionSnapshot;
  route: Extract<LivestockRoute, { screen: 'form' }>;
  onBackToList: () => void;
  onBackToDetail: (livestockId: string) => void;
  onSaved: (item: LivestockSnapshot, mode: 'create' | 'edit') => void;
  onOpenProfile: () => void;
}) {
  const [values, setValues] = useState<FormValues>(emptyForm);
  const [initialValues, setInitialValues] = useState<FormValues | null>(null);
  const [speciesOptions, setSpeciesOptions] = useState<LivestockSpecies[]>([]);
  const [existingItem, setExistingItem] = useState<LivestockSnapshot | null>(null);
  const [photoAction, setPhotoAction] = useState<SelectedAsset | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [photoError, setPhotoError] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      store.profiles.load(session.userId, 'farmer'),
      route.mode === 'edit' ? store.livestock.get(session.userId, route.livestockId) : Promise.resolve(null),
    ]).then(([profile, item]) => {
      if (!active) return;
      const supported = profile.farmer?.species ?? [];
      if (!supported.length) throw new Error('Lengkapi jenis ternak pada profil peternakan sebelum menambahkan ternak.');
      const nextValues: FormValues = item ? {
        displayCode: item.displayCode,
        name: item.name,
        species: item.species,
        breed: item.breed,
        sex: item.sex,
        estimatedAgeMonths: String(item.estimatedAgeMonths),
        weightKg: String(item.weightKg),
      } : { ...emptyForm, species: supported[0] };
      setSpeciesOptions([...supported]);
      setExistingItem(item);
      setValues(nextValues);
      setInitialValues(nextValues);
      setPhotoAction(undefined);
    }).catch((cause: unknown) => {
      if (active) setError(messageFor(cause));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [route, session.userId, store]);

  const dirty = Boolean(initialValues && JSON.stringify(values) !== JSON.stringify(initialValues)) || photoAction !== undefined;
  const returnFromForm = useCallback(() => {
    setLeaveDialog(false);
    if (route.returnTo === 'detail' && route.mode === 'edit') onBackToDetail(route.livestockId);
    else onBackToList();
  }, [onBackToDetail, onBackToList, route]);

  const requestLeave = useCallback(() => {
    if (busy) return;
    if (dirty) setLeaveDialog(true);
    else returnFromForm();
  }, [busy, dirty, returnFromForm]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (leaveDialog) {
        setLeaveDialog(false);
        return true;
      }
      requestLeave();
      return true;
    });
    return () => subscription.remove();
  }, [leaveDialog, requestLeave]);

  const updateValue = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const pickPhoto = async () => {
    setBusy(true);
    setError('');
    try {
      const asset = await store.livestock.pickPhoto();
      if (asset) {
        setPhotoAction(asset);
        setPhotoError(false);
      }
    } catch (cause: unknown) {
      setError(messageFor(cause, 'Foto belum dapat dipilih. Periksa izin galeri lalu coba lagi.'));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (busy || loading || !values.species) return;
    setBusy(true);
    setError('');
    try {
      const input = {
        displayCode: values.displayCode,
        name: values.name,
        species: values.species,
        breed: values.breed,
        sex: values.sex,
        estimatedAgeMonths: values.estimatedAgeMonths.trim() ? Number(values.estimatedAgeMonths) : Number.NaN,
        weightKg: values.weightKg.trim() ? Number(values.weightKg.replace(',', '.')) : Number.NaN,
      };
      const photo = photoAction ? { type: 'new' as const, asset: photoAction } : undefined;
      const item = route.mode === 'create'
        ? await store.livestock.create(session.userId, input, photo)
        : await store.livestock.update(session.userId, route.livestockId, input, photoAction === undefined ? undefined : photoAction === null ? null : photo);
      onSaved(item, route.mode);
    } catch (cause: unknown) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const selectedPhotoUri = photoAction === null ? null : photoAction?.uri ?? existingItem?.photo?.localUri ?? null;
  const selectedPhotoLabel = photoAction?.filename ?? existingItem?.photo?.filename ?? '';
  const hasSpeciesOptions = speciesOptions.length > 0;

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <ScreenHeader title={route.mode === 'create' ? 'Tambah Ternak' : 'Edit Ternak'} onBack={requestLeave} />
          {loading ? <LoadingState label="Memuat data formulir…" /> : null}
          {!loading && error && !hasSpeciesOptions ? (
            <View style={styles.errorBlock}>
              <InlineFeedback message={error} tone="error" />
              <Button label="Lengkapi profil peternakan" role="farmer" variant="secondary" onPress={onOpenProfile} />
            </View>
          ) : null}
          {!loading && hasSpeciesOptions ? (
            <>
              <Text style={styles.formIntro}>Isi data ternak. ID harus unik di peternakan Anda.</Text>
              {error ? <InlineFeedback message={error} tone="error" /> : null}
              <TextField label="ID ternak" value={values.displayCode} onChangeText={(value) => updateValue('displayCode', value)} placeholder="Contoh: SAPI-01" autoCapitalize="characters" maxLength={24} returnKeyType="next" />
              <TextField label="Nama ternak" value={values.name} onChangeText={(value) => updateValue('name', value)} placeholder="Masukkan nama ternak" maxLength={100} returnKeyType="next" />
              <ChoiceGroup label="Jenis ternak" values={speciesOptions} labels={speciesLabels} selected={values.species} onSelect={(value) => updateValue('species', value)} />
              {!speciesOptions.includes(values.species as LivestockSpecies) ? <Text style={styles.warningText}>Jenis ternak ini tidak lagi tercantum di profil. Pilih jenis yang tersedia untuk menyimpan.</Text> : null}
              <TextField label="Ras" value={values.breed} onChangeText={(value) => updateValue('breed', value)} placeholder="Masukkan ras ternak" maxLength={100} returnKeyType="next" />
              <ChoiceGroup label="Jenis kelamin" values={['female', 'male', 'unknown']} labels={sexLabels} selected={values.sex} onSelect={(value) => updateValue('sex', value)} />
              <View style={styles.numberRow}>
                <TextField label="Perkiraan umur (bulan)" helperText="Masukkan 0 bila baru lahir." value={values.estimatedAgeMonths} onChangeText={(value) => updateValue('estimatedAgeMonths', value.replace(/[^0-9]/g, ''))} placeholder="Contoh: 18" keyboardType="number-pad" inputStyle={styles.numberInput} containerStyle={styles.numberField} />
                <TextField label="Berat (kg)" helperText="Masukkan berat dalam kilogram." value={values.weightKg} onChangeText={(value) => updateValue('weightKg', value.replace(/[^0-9.,]/g, ''))} placeholder="Contoh: 125" keyboardType="decimal-pad" inputStyle={styles.numberInput} containerStyle={styles.numberField} />
              </View>
              <View style={styles.photoSection}>
                <Text style={styles.fieldLabel}>Foto ternak <Text style={styles.optionalLabel}>(opsional)</Text></Text>
                {selectedPhotoUri && !photoError ? (
                  <Image accessibilityLabel={selectedPhotoLabel ? `Foto ${selectedPhotoLabel}` : 'Foto ternak'} source={{ uri: selectedPhotoUri }} onError={() => setPhotoError(true)} style={styles.formPhoto} />
                ) : (
                  <View style={styles.photoPlaceholder}><Icon name="image" size={28} color={colors.brown} /><Text style={styles.photoPlaceholderText}>Tambahkan foto agar mudah dikenali</Text></View>
                )}
                <View style={styles.photoActions}>
                  <Button label={selectedPhotoUri ? 'Ganti Foto' : 'Pilih Foto'} role="farmer" variant="secondary" onPress={() => void pickPhoto()} loading={busy} style={styles.photoActionButton} />
                  {selectedPhotoUri ? <Button label="Hapus Foto" role="farmer" variant="secondary" onPress={() => { setPhotoAction(null); setPhotoError(false); }} disabled={busy} style={styles.photoActionButton} /> : null}
                </View>
                {selectedPhotoLabel ? <Text numberOfLines={2} style={styles.photoFilename}>{selectedPhotoLabel}</Text> : null}
              </View>
              <View style={styles.formActions}>
                <Button label={route.mode === 'create' ? 'Simpan Ternak' : 'Simpan Perubahan'} role="farmer" onPress={() => void save()} loading={busy} disabled={!values.species || !hasSpeciesOptions} />
                <Button label="Batal" role="farmer" variant="secondary" onPress={requestLeave} disabled={busy} />
              </View>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      <Modal animationType="fade" transparent visible={leaveDialog} onRequestClose={() => setLeaveDialog(false)} statusBarTranslucent>
        <View style={styles.confirmBackdrop}>
          <Pressable accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onPress={() => setLeaveDialog(false)} style={StyleSheet.absoluteFill} />
          <View accessibilityViewIsModal style={styles.confirmCard}>
            <Text accessibilityRole="header" style={styles.confirmTitle}>Perubahan belum disimpan</Text>
            <Text style={styles.confirmBody}>Jika keluar sekarang, perubahan pada formulir ini akan dibuang.</Text>
            <Button label="Tetap mengedit" role="farmer" variant="secondary" onPress={() => setLeaveDialog(false)} />
            <Button label="Buang perubahan" role="farmer" variant="accent" onPress={returnFromForm} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function AnimalRow({ animal, imageFailed, onImageError, onPress }: {
  animal: LivestockSnapshot;
  imageFailed: boolean;
  onImageError: () => void;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${animal.name}, ${speciesLabels[animal.species]}, ID ${animal.displayCode}`} onPress={onPress} style={({ pressed }) => [styles.animalCard, pressed && styles.pressed]}>
      <View style={styles.animalImageFrame}>
        {animal.photo?.localUri && !imageFailed ? <Image accessibilityLabel={`Foto ${animal.name}`} source={{ uri: animal.photo.localUri }} onError={onImageError} style={styles.animalImage} /> : <Icon name="paw-print" size={26} color={colors.brown} />}
      </View>
      <View style={styles.animalCopy}>
        <Text numberOfLines={1} style={styles.animalName}>{animal.name}</Text>
        <Text numberOfLines={1} style={styles.animalMeta}>{speciesLabels[animal.species]} · {animal.breed}</Text>
        <Text numberOfLines={1} style={styles.animalCode}>{animal.displayCode}</Text>
      </View>
      <View style={styles.animalAside}>
        <Text style={styles.animalWeight}>{formatNumber(animal.weightKg)} kg</Text>
        <Icon name="chevron-right" size={20} color={colors.muted} />
      </View>
    </Pressable>
  );
}

function FilterSheet({ visible, species, sex, onChangeSpecies, onChangeSex, onClose, onReset, onApply }: {
  visible: boolean;
  species: SpeciesFilter;
  sex: SexFilter;
  onChangeSpecies: (value: SpeciesFilter) => void;
  onChangeSex: (value: SexFilter) => void;
  onClose: () => void;
  onReset: () => void;
  onApply: () => void;
}) {
  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalBackdrop}>
        <Pressable accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={styles.filterSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text accessibilityRole="header" style={styles.sheetTitle}>Filter Ternak</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Tutup filter" onPress={onClose} style={styles.closeButton}><Icon name="x" size={20} color={colors.brown} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody}>
            <Text style={styles.filterLabel}>Jenis ternak</Text>
            <View style={styles.chipWrap}>
              <ChoiceChip label="Semua" selected={species === 'all'} onPress={() => onChangeSpecies('all')} />
              {livestockSpecies.map((value) => <ChoiceChip key={value} label={speciesLabels[value]} selected={species === value} onPress={() => onChangeSpecies(value)} />)}
            </View>
            <Text style={styles.filterLabel}>Jenis kelamin</Text>
            <View style={styles.chipWrap}>
              <ChoiceChip label="Semua" selected={sex === 'all'} onPress={() => onChangeSex('all')} />
              {(Object.keys(sexLabels) as LivestockSex[]).map((value) => <ChoiceChip key={value} label={sexLabels[value]} selected={sex === value} onPress={() => onChangeSex(value)} />)}
            </View>
          </ScrollView>
          <View style={styles.sheetActions}>
            <Button label="Atur ulang" role="farmer" variant="secondary" onPress={onReset} style={styles.sheetActionButton} />
            <Button label="Tampilkan hasil" role="farmer" onPress={onApply} style={styles.sheetActionButton} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ChoiceGroup<T extends string>({ label, values, labels, selected, onSelect }: {
  label: string;
  values: readonly T[];
  labels: Record<T, string>;
  selected: T | '';
  onSelect: (value: T) => void;
}) {
  return (
    <View style={styles.choiceGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.chipWrap}>
        {values.map((value) => <ChoiceChip key={value} label={labels[value]} selected={selected === value} onPress={() => onSelect(value)} />)}
      </View>
    </View>
  );
}

function ChoiceChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.choiceChip, selected && styles.choiceChipSelected, pressed && styles.pressed]}>
      {selected ? <Icon name="check" size={15} color={colors.white} /> : null}
      <Text allowFontScaling style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.screenHeader}>
      <Pressable accessibilityRole="button" accessibilityLabel="Kembali" onPress={onBack} style={styles.backButton}><Icon name="arrow-left" size={22} color={colors.brown} /></Pressable>
      <Text accessibilityRole="header" style={styles.screenHeaderTitle}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function DetailLine({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.detailLine, last && styles.detailLineLast]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function ImagePreview({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  return (
    <Modal animationType="fade" transparent visible={Boolean(uri)} onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityRole="button" accessibilityLabel="Tutup pratinjau foto" onPress={onClose} style={styles.previewBackdrop}>
        {uri ? <Image accessibilityLabel="Pratinjau foto ternak" source={{ uri }} resizeMode="contain" style={styles.previewImage} /> : null}
        <View style={styles.previewClose}><Icon name="x" size={22} color={colors.white} /></View>
      </Pressable>
    </Modal>
  );
}

function markImageFailed(id: string, setFailed: React.Dispatch<React.SetStateAction<Set<string>>>) {
  setFailed((current) => new Set(current).add(id));
}

function formatAge(months: number): string {
  if (months < 12) return `${months} bulan`;
  const years = Math.floor(months / 12);
  const remaining = months % 12;
  return remaining ? `${years} tahun ${remaining} bulan` : `${years} tahun`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value);
}

function messageFor(cause: unknown, fallback = 'Data ternak belum dapat dimuat. Coba lagi.'): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  return fallback;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.cream },
  listContent: { paddingHorizontal: layout.contentHorizontal, paddingTop: spacing[5], paddingBottom: spacing[6], gap: spacing[4] },
  detailContent: { paddingHorizontal: layout.contentHorizontal, paddingTop: spacing[3], paddingBottom: spacing[6], gap: spacing[4] },
  formContent: { paddingHorizontal: layout.contentHorizontal, paddingTop: spacing[3], paddingBottom: spacing[8], gap: spacing[4] },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3] },
  listHeaderCopy: { flex: 1, gap: spacing[1] },
  pageTitle: { color: colors.dark, fontFamily: fonts.bold, fontSize: typeScale.title, lineHeight: 32 },
  pageSubtitle: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 20 },
  addIconButton: { width: 48, height: 48, borderRadius: radii.button, backgroundColor: colors.brown, alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  searchField: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[3], borderRadius: radii.button, borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.white },
  searchInput: { flex: 1, minHeight: 46, paddingVertical: spacing[2], color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body },
  clearSearch: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  filterButton: { minWidth: 48, height: 48, paddingHorizontal: spacing[2], flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[1], borderRadius: radii.button, borderWidth: 1, borderColor: colors.brown, backgroundColor: colors.white },
  filterButtonActive: { borderColor: colors.brown, backgroundColor: colors.brown },
  filterCount: { color: colors.white, fontFamily: fonts.semiBold, fontSize: typeScale.small },
  listSummaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2], marginTop: spacing[1] },
  listSectionTitle: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.section, lineHeight: 25 },
  resultCount: { color: colors.muted, fontFamily: fonts.medium, fontSize: typeScale.small },
  animalList: { gap: spacing[3] },
  animalCard: { minHeight: 104, flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[3], borderRadius: radii.cardFarmer, backgroundColor: colors.white, borderWidth: 1, borderColor: 'rgba(219, 167, 91, 0.42)' },
  animalImageFrame: { width: 68, height: 68, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  animalImage: { width: '100%', height: '100%' },
  animalCopy: { flex: 1, gap: 3 },
  animalName: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.body, lineHeight: 20 },
  animalMeta: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 18 },
  animalCode: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.small, lineHeight: 18 },
  animalAside: { minHeight: 44, alignItems: 'flex-end', justifyContent: 'space-between' },
  animalWeight: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.small },
  pressed: { opacity: 0.82 },
  emptyState: { marginTop: spacing[4], paddingHorizontal: spacing[4], borderRadius: radii.cardFarmer, backgroundColor: colors.white },
  errorBlock: { gap: spacing[3] },
  screenHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  screenHeaderTitle: { flex: 1, color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.heading, lineHeight: 28, textAlign: 'center' },
  headerSpacer: { width: 44, height: 44 },
  detailHero: { alignItems: 'center', gap: spacing[2], paddingVertical: spacing[3] },
  detailPhotoFrame: { width: 124, height: 124, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 62, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.gold },
  detailPhoto: { width: '100%', height: '100%' },
  detailName: { color: colors.dark, fontFamily: fonts.bold, fontSize: typeScale.title, lineHeight: 32, textAlign: 'center' },
  detailSubtitle: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 20 },
  editButton: { alignSelf: 'stretch', marginTop: spacing[2] },
  infoCard: { padding: spacing[4], gap: spacing[2], borderRadius: radii.cardFarmer, backgroundColor: colors.white },
  sectionTitle: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.section, lineHeight: 24, marginBottom: spacing[1] },
  detailLine: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3], paddingVertical: spacing[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gold },
  detailLineLast: { borderBottomWidth: 0 },
  detailLabel: { flex: 1, color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.body },
  detailValue: { flex: 1, color: colors.dark, fontFamily: fonts.medium, fontSize: typeScale.body, textAlign: 'right' },
  formIntro: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21 },
  warningText: { color: colors.orange, fontFamily: fonts.medium, fontSize: typeScale.small, lineHeight: 18 },
  choiceGroup: { gap: spacing[2] },
  fieldLabel: { color: colors.dark, fontFamily: fonts.medium, fontSize: typeScale.label, lineHeight: 19 },
  optionalLabel: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  choiceChip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[1], paddingHorizontal: spacing[3], borderRadius: radii.pill, borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.white },
  choiceChipSelected: { borderColor: colors.brown, backgroundColor: colors.brown },
  choiceText: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.small, lineHeight: 18 },
  choiceTextSelected: { color: colors.white },
  numberRow: { flexDirection: 'row', gap: spacing[3] },
  numberField: { flex: 1 },
  numberInput: { fontVariant: ['tabular-nums'] },
  photoSection: { gap: spacing[2] },
  formPhoto: { width: '100%', height: 192, borderRadius: radii.cardFarmer, backgroundColor: colors.white },
  photoPlaceholder: { minHeight: 116, alignItems: 'center', justifyContent: 'center', gap: spacing[2], padding: spacing[4], borderRadius: radii.cardFarmer, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.gold, backgroundColor: colors.white },
  photoPlaceholderText: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, textAlign: 'center' },
  photoActions: { flexDirection: 'row', gap: spacing[2] },
  photoActionButton: { flex: 1 },
  photoFilename: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 18 },
  formActions: { gap: spacing[2], paddingTop: spacing[2] },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(58, 23, 13, 0.48)' },
  confirmBackdrop: { flex: 1, justifyContent: 'center', padding: spacing[5], backgroundColor: 'rgba(58, 23, 13, 0.48)' },
  filterSheet: { maxHeight: '86%', paddingHorizontal: spacing[5], paddingTop: spacing[3], paddingBottom: spacing[6], gap: spacing[3], borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.cream },
  sheetHandle: { width: 42, height: 4, alignSelf: 'center', borderRadius: radii.pill, backgroundColor: colors.gold },
  sheetHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { flex: 1, color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.heading },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sheetBody: { gap: spacing[3], paddingBottom: spacing[2] },
  filterLabel: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.body, marginTop: spacing[2] },
  sheetActions: { flexDirection: 'row', gap: spacing[2] },
  sheetActionButton: { flex: 1 },
  confirmCard: { alignSelf: 'center', width: '100%', maxWidth: 350, gap: spacing[3], padding: spacing[5], borderRadius: radii.cardFarmer, backgroundColor: colors.white },
  confirmTitle: { color: colors.dark, fontFamily: fonts.bold, fontSize: typeScale.heading, lineHeight: 28 },
  confirmBody: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21 },
  centerScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: layout.contentHorizontal, gap: spacing[3] },
  savedIcon: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 36, backgroundColor: colors.brown },
  savedTitle: { color: colors.dark, fontFamily: fonts.bold, fontSize: typeScale.heading, lineHeight: 28, textAlign: 'center' },
  savedBody: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.body, textAlign: 'center' },
  savedActions: { alignSelf: 'stretch', gap: spacing[2], marginTop: spacing[3] },
  previewBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(20, 12, 10, 0.96)' },
  previewImage: { width: '100%', height: '78%' },
  previewClose: { position: 'absolute', top: 44, right: 20, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
