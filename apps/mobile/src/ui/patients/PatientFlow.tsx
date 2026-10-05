import { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { SessionSnapshot } from '../../domain/auth';
import type { HealthRecordAttachment, HealthRecordKind, HealthRecordSnapshot, PatientDetailSnapshot, PatientSnapshot } from '../../domain/health';
import { DomainError } from '../../domain/errors';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, InlineFeedback, LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { colors, fonts, layout, radii, spacing, typeScale } from '../theme/tokens';

type Props = {
  store: LocalStore;
  session: SessionSnapshot;
  patientId?: string;
  onOpenPatient: (animalId: string) => void;
  onBackToList: () => void;
};

type SpeciesFilter = 'all' | 'cattle' | 'goat';
type HistoryFilter = 'examination' | 'vaccine' | 'medication' | 'other';
type Overlay =
  | { type: 'record'; record: HealthRecordSnapshot }
  | { type: 'attachment'; record: HealthRecordSnapshot; attachment: HealthRecordAttachment };

const speciesOptions: { key: SpeciesFilter; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'cattle', label: 'Sapi' },
  { key: 'goat', label: 'Kambing' },
];

const historyOptions: { key: HistoryFilter; label: string }[] = [
  { key: 'examination', label: 'Periksa' },
  { key: 'vaccine', label: 'Vaksin' },
  { key: 'medication', label: 'Obat' },
  { key: 'other', label: 'Lainnya' },
];

export function PatientFlow({ store, session, patientId, onOpenPatient, onBackToList }: Props) {
  const [query, setQuery] = useState('');
  const [species, setSpecies] = useState<SpeciesFilter>('all');
  const [patients, setPatients] = useState<PatientSnapshot[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [listRevision, setListRevision] = useState(0);
  const [detail, setDetail] = useState<PatientDetailSnapshot | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailRevision, setDetailRevision] = useState(0);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('examination');
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setListLoading(true);
      setListError('');
      if (session.activeRole !== 'vet') {
        setListError('Daftar pasien hanya tersedia pada peran Dokter Hewan.');
        setListLoading(false);
        return;
      }
      store.patients.list(session.userId, {
        query,
        species: species === 'all' ? undefined : species,
      }).then((items) => {
        if (active) setPatients(items);
      }).catch((cause: unknown) => {
        if (active) setListError(messageFor(cause));
      }).finally(() => {
        if (active) setListLoading(false);
      });
    }, query ? 140 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [listRevision, query, session.activeRole, session.userId, species, store]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setHistoryFilter('examination');
      setOverlay(null);
      setDetail(null);
      setDetailError('');
      if (!patientId) {
        setDetailLoading(false);
        return;
      }
      setDetailLoading(true);
      store.patients.get(session.userId, patientId).then((next) => {
        if (active) setDetail(next);
      }).catch((cause: unknown) => {
        if (active) setDetailError(messageFor(cause));
      }).finally(() => {
        if (active) setDetailLoading(false);
      });
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [detailRevision, patientId, session.userId, store]);

  const visibleHistory = useMemo(() => {
    const history = detail?.history ?? [];
    if (historyFilter === 'other') return history.filter((item) => item.kind === 'disease' || item.kind === 'care');
    return history.filter((item) => item.kind === historyFilter);
  }, [detail?.history, historyFilter]);

  const openAttachment = async (record: HealthRecordSnapshot, attachment: HealthRecordAttachment) => {
    if (!detail) return;
    setAttachmentError('');
    setAttachmentLoading(true);
    try {
      const authorized = await store.healthRecords.getAttachmentForVet(
        session.userId,
        detail.patient.id,
        attachment.id,
      );
      setImageError(false);
      setOverlay({ type: 'attachment', record, attachment: authorized });
    } catch (cause) {
      setAttachmentError(messageFor(cause));
    } finally {
      setAttachmentLoading(false);
    }
  };

  const retryDetail = () => setDetailRevision((revision) => revision + 1);

  const closeOverlay = () => {
    setOverlay((current) => current?.type === 'attachment' ? { type: 'record', record: current.record } : null);
    setAttachmentError('');
  };

  return (
    <View style={styles.screen}>
      {patientId ? (
        <PatientDetailScreen
          detail={detail}
          loading={detailLoading}
          error={detailError}
          history={visibleHistory}
          selectedFilter={historyFilter}
          attachmentLoading={attachmentLoading}
          attachmentError={attachmentError}
          onFilter={setHistoryFilter}
          onBack={onBackToList}
          onRetry={retryDetail}
          onOpenRecord={(record) => setOverlay({ type: 'record', record })}
        />
      ) : (
        <PatientListScreen
          query={query}
          patients={patients}
          species={species}
          loading={listLoading}
          error={listError}
          onQuery={setQuery}
          onSpecies={setSpecies}
          onOpenPatient={onOpenPatient}
          onClearQuery={() => setQuery('')}
          onRetry={() => setListRevision((revision) => revision + 1)}
        />
      )}

      <Modal visible={Boolean(overlay)} animationType="slide" onRequestClose={closeOverlay}>
        {overlay ? (
          <View style={styles.overlayScreen}>
            <View style={styles.overlayHeader}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={overlay.type === 'attachment' ? 'Kembali ke catatan kesehatan' : 'Tutup catatan kesehatan'}
                onPress={closeOverlay}
                style={styles.backButton}
              >
                <Icon name="chevron-left" size={22} />
              </Pressable>
              <Text accessibilityRole="header" style={styles.overlayTitle}>
                {overlay.type === 'attachment' ? 'Lampiran' : 'Catatan Kesehatan'}
              </Text>
              <View style={styles.headerSpacer} />
            </View>
            {overlay.type === 'record' ? (
              <RecordDetail
                record={overlay.record}
                attachmentLoading={attachmentLoading}
                attachmentError={attachmentError}
                onOpenAttachment={(attachment) => void openAttachment(overlay.record, attachment)}
              />
            ) : (
              <AttachmentPreview
                attachment={overlay.attachment}
                record={overlay.record}
                imageError={imageError}
                onImageError={() => setImageError(true)}
                onOpenExternal={() => {
                  const uri = overlay.attachment.uri;
                  if (!uri) return;
                  Linking.openURL(uri).catch(() => setAttachmentError('Lampiran tidak dapat dibuka di perangkat ini.'));
                }}
                error={attachmentError}
              />
            )}
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

function PatientListScreen({
  query,
  patients,
  species,
  loading,
  error,
  onQuery,
  onSpecies,
  onOpenPatient,
  onClearQuery,
  onRetry,
}: {
  query: string;
  patients: PatientSnapshot[];
  species: SpeciesFilter;
  loading: boolean;
  error: string;
  onQuery: (value: string) => void;
  onSpecies: (value: SpeciesFilter) => void;
  onOpenPatient: (animalId: string) => void;
  onClearQuery: () => void;
  onRetry: () => void;
}) {
  return (
    <View style={styles.listScreen}>
      <Text accessibilityRole="header" style={styles.pageTitle}>Pasien</Text>

      <View style={styles.searchFieldWrap}>
        <Text style={styles.fieldLabel}>Cari pasien</Text>
        <View style={styles.searchInputFrame}>
          <TextInput
            accessibilityLabel="Cari pasien"
            accessibilityHint="Cari berdasarkan ID ternak, nama ternak, atau nama pemilik."
            allowFontScaling
            autoCorrect={false}
            enterKeyHint="search"
            onChangeText={onQuery}
            placeholder="ID ternak atau nama pemilik"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            style={styles.searchInput}
            value={query}
          />
          {query ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Hapus pencarian" onPress={onClearQuery} style={styles.clearSearch}>
              <Icon name="x" size={18} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View accessibilityRole="tablist" style={styles.speciesFilters}>
        {speciesOptions.map((option) => {
          const selected = species === option.key;
          return (
            <Pressable
              key={option.key}
              accessibilityRole="tab"
              accessibilityLabel={option.label}
              accessibilityState={{ selected }}
              onPress={() => onSpecies(option.key)}
              style={[styles.speciesButton, selected ? styles.selectedFilter : styles.unselectedFilter]}
            >
              <Text style={[styles.speciesLabel, selected ? styles.selectedLabel : styles.unselectedLabel]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.listCaption}>Pasien dari layanan Anda</Text>
      {error ? <ErrorState message={error} role="vet" /> : null}
      {loading && !patients.length ? <LoadingState label="Memuat daftar pasien…" /> : null}
      {!loading && !error && patients.length === 0 ? (
        <EmptyState
          title={query || species !== 'all' ? 'Tidak ada pasien yang cocok' : 'Belum ada pasien'}
          description={query || species !== 'all'
            ? 'Ubah kata pencarian atau pilih jenis ternak lain.'
            : 'Pasien akan muncul setelah ada layanan yang terkait dengan akun Dokter Anda.'}
          role="vet"
          style={styles.emptyState}
        />
      ) : null}
      {error ? (
        <Button label="Coba lagi" role="vet" variant="secondary" onPress={onRetry} />
      ) : null}
      {!error && patients.length ? (
        <View style={styles.patientRows}>
          {patients.map((patient) => (
            <PatientRow key={patient.id} patient={patient} onPress={() => onOpenPatient(patient.id)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function PatientRow({ patient, onPress }: { patient: PatientSnapshot; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${patient.name}, pemilik ${patient.ownerName}`}
      accessibilityHint="Membuka rekam kesehatan pasien ini."
      onPress={onPress}
      style={styles.patientRow}
    >
      <View style={styles.patientCopy}>
        <Text numberOfLines={2} style={styles.patientName}>{patient.name}</Text>
        <Text numberOfLines={2} style={styles.patientMeta}>{patient.ownerName} · {ageLabel(patient.estimatedAgeMonths)} · {weightLabel(patient.weightKg)}</Text>
        <Text numberOfLines={2} style={styles.patientService}>{latestServiceLabel(patient)}</Text>
      </View>
      <Icon name="chevron-right" size={22} />
    </Pressable>
  );
}

function PatientDetailScreen({
  detail,
  loading,
  error,
  history,
  selectedFilter,
  attachmentLoading,
  attachmentError,
  onFilter,
  onBack,
  onRetry,
  onOpenRecord,
}: {
  detail: PatientDetailSnapshot | null;
  loading: boolean;
  error: string;
  history: HealthRecordSnapshot[];
  selectedFilter: HistoryFilter;
  attachmentLoading: boolean;
  attachmentError: string;
  onFilter: (value: HistoryFilter) => void;
  onBack: () => void;
  onRetry: () => void;
  onOpenRecord: (record: HealthRecordSnapshot) => void;
}) {
  return (
    <View style={styles.detailScreen}>
      <View style={styles.detailHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel="Kembali ke daftar pasien" onPress={onBack} style={styles.backButton}>
          <Icon name="chevron-left" size={22} />
        </Pressable>
        <Text accessibilityRole="header" style={styles.detailHeaderTitle}>Rekam Kesehatan</Text>
      </View>

      {loading && !detail ? <LoadingState label="Memuat rekam kesehatan…" /> : null}
      {error ? <ErrorState message={error} role="vet" onRetry={onRetry} /> : null}
      {detail ? (
        <View style={styles.detailBody}>
          <Text accessibilityRole="header" style={styles.patientDetailName}>{detail.patient.name}</Text>
          <Text style={styles.patientDetailMeta}>{detail.patient.ownerName} · {ageLabel(detail.patient.estimatedAgeMonths)} · {weightLabel(detail.patient.weightKg)}</Text>

          <View accessibilityRole="tablist" style={styles.historyFilters}>
            {historyOptions.map((option) => {
              const selected = selectedFilter === option.key;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="tab"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected }}
                  onPress={() => onFilter(option.key)}
                  style={[styles.historyButton, selected ? styles.selectedFilter : styles.unselectedFilter]}
                >
                  <Text style={[styles.historyLabel, selected ? styles.selectedLabel : styles.unselectedLabel]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {attachmentError ? <InlineFeedback message={attachmentError} tone="error" /> : null}
          {attachmentLoading ? <LoadingState label="Memeriksa lampiran…" /> : null}
          {history.length ? (
            <View style={styles.historyRows}>
              {history.map((record) => <HistoryRow key={record.id} record={record} onPress={() => onOpenRecord(record)} />)}
            </View>
          ) : (
            <Text style={styles.historyEmpty}>Belum ada riwayat {historyLabel(selectedFilter).toLocaleLowerCase('id-ID')} yang tercatat.</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

function HistoryRow({ record, onPress }: { record: HealthRecordSnapshot; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${healthRecordLabel(record.kind)}, ${formatDate(record.occurredAt)}`}
      accessibilityHint="Membuka isi catatan yang hanya dapat dibaca."
      onPress={onPress}
      style={styles.historyRow}
    >
      <View style={styles.historyCopy}>
        <Text numberOfLines={2} style={styles.historyDate}>{formatDate(record.occurredAt)}</Text>
        <Text numberOfLines={3} style={styles.historyDescription}>{record.description}</Text>
        <Text style={styles.historySource}>{record.source === 'clinical_note' ? 'Catatan final' : record.source === 'reminder' ? 'Perawatan tercatat' : 'Laporan peternak'}</Text>
      </View>
      <Icon name="chevron-right" size={22} />
    </Pressable>
  );
}

function RecordDetail({ record, attachmentLoading, attachmentError, onOpenAttachment }: {
  record: HealthRecordSnapshot;
  attachmentLoading: boolean;
  attachmentError: string;
  onOpenAttachment: (attachment: HealthRecordAttachment) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.overlayContent} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={styles.overlayRecordTitle}>{healthRecordLabel(record.kind)}</Text>
      <DetailLine label="Tanggal" value={formatDateTime(record.occurredAt)} />
      <DetailLine label={record.source === 'clinical_note' ? 'Dokter' : 'Dicatat oleh'} value={record.actorName} />
      <DetailLine label="Catatan" value={record.description} />
      {record.clinicalNote ? (
        <>
          <DetailLine label="Keluhan" value={record.clinicalNote.complaint} />
          <DetailLine label="Temuan" value={record.clinicalNote.findings} />
          <DetailLine label="Penilaian" value={record.clinicalNote.assessment} />
          <DetailLine label="Tindakan" value={record.clinicalNote.actions} />
          <DetailLine label="Instruksi perawatan" value={record.clinicalNote.careInstructions} />
        </>
      ) : null}
      {record.attachments.length ? (
        <View style={styles.attachmentSection}>
          <Text accessibilityRole="header" style={styles.attachmentHeading}>Lampiran</Text>
          {record.attachments.map((attachment) => (
            <Pressable
              key={attachment.id}
              accessibilityRole="button"
              accessibilityLabel={`Buka lampiran ${attachment.filename}`}
              onPress={() => onOpenAttachment(attachment)}
              style={styles.attachmentRow}
            >
              <Icon name={attachment.mimeType.startsWith('image/') ? 'image' : attachment.mimeType.startsWith('video/') ? 'video' : 'file-text'} size={20} />
              <Text style={styles.attachmentName}>{attachment.filename}</Text>
              <Icon name="chevron-right" size={20} />
            </Pressable>
          ))}
          {attachmentLoading ? <LoadingState label="Memeriksa lampiran…" /> : null}
          {attachmentError ? <InlineFeedback message={attachmentError} tone="error" /> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function AttachmentPreview({ attachment, record, imageError, onImageError, onOpenExternal, error }: {
  attachment: HealthRecordAttachment;
  record: HealthRecordSnapshot;
  imageError: boolean;
  onImageError: () => void;
  onOpenExternal: () => void;
  error: string;
}) {
  if (!attachment.available || !attachment.uri) {
    return <ErrorState message="Lampiran ini tidak tersedia di perangkat." role="vet" />;
  }
  if (attachment.mimeType.startsWith('image/') && !imageError) {
    return (
      <View style={styles.previewContent}>
        <Text style={styles.previewCaption}>{attachment.filename} · {formatDate(record.occurredAt)}</Text>
        <Image
          accessibilityLabel={`Lampiran gambar ${attachment.filename}`}
          onError={onImageError}
          resizeMode="contain"
          source={{ uri: attachment.uri }}
          style={styles.previewImage}
        />
      </View>
    );
  }
  return (
    <View style={styles.previewContent}>
      <Icon name={imageError ? 'circle-alert' : attachment.mimeType.startsWith('video/') ? 'video' : 'file-text'} size={40} />
      <Text accessibilityRole="header" style={styles.previewTitle}>{imageError ? 'Gambar tidak dapat dimuat' : attachment.filename}</Text>
      <Text style={styles.previewCaption}>{error || (imageError ? 'Coba buka lampiran kembali atau periksa file lokal.' : 'Buka lampiran dengan aplikasi yang tersedia di perangkat.')}</Text>
      {!imageError ? <Button label="Buka lampiran" role="vet" variant="secondary" onPress={onOpenExternal} /> : null}
    </View>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value || 'Belum dicatat.'}</Text>
    </View>
  );
}

function ageLabel(months: number | null): string {
  if (months === null) return 'Umur belum dicatat';
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (years && remainingMonths) return `${years} tahun ${remainingMonths} bulan`;
  if (years) return `${years} tahun`;
  return `${months} bulan`;
}

function weightLabel(weight: number | null): string {
  return weight === null ? 'Berat belum dicatat' : `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(weight)} kg`;
}

function latestServiceLabel(patient: PatientSnapshot): string {
  const service = patient.latestServiceType === 'visit' ? 'Kunjungan' : patient.latestServiceType === 'chat' ? 'Konsultasi' : 'Layanan';
  const status = patient.latestServiceStatus;
  if (status === 'requested') return `${service} menunggu dokter`;
  if (status === 'scheduled') return `${service} terjadwal`;
  if (status === 'en_route') return `${service} dalam perjalanan`;
  if (status === 'arrived') return `${service} sudah tiba`;
  if (status === 'examining' || status === 'in_progress') return `${service} berlangsung`;
  if (status === 'completed') return `${service} selesai`;
  return patient.serviceCount ? `${patient.serviceCount} layanan terkait` : 'Layanan terkait';
}

function healthRecordLabel(kind: HealthRecordKind): string {
  switch (kind) {
    case 'examination': return 'Pemeriksaan';
    case 'disease': return 'Laporan penyakit';
    case 'vaccine': return 'Vaksin';
    case 'medication': return 'Obat';
    case 'care': return 'Perawatan';
  }
}

function historyLabel(filter: HistoryFilter): string {
  return historyOptions.find((item) => item.key === filter)?.label ?? 'riwayat';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}

function messageFor(error: unknown): string {
  if (error instanceof DomainError) return error.message;
  return 'Data pasien belum dapat dimuat. Periksa penyimpanan lokal lalu coba lagi.';
}

const styles = StyleSheet.create({
  screen: { width: '100%', maxWidth: 430, gap: spacing[4] },
  listScreen: { width: '100%', gap: spacing[4] },
  pageTitle: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.heading, lineHeight: 29 },
  searchFieldWrap: { gap: 6 },
  fieldLabel: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.label, lineHeight: 19 },
  searchInputFrame: { minHeight: 74, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: spacing[2], borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.gold, borderRadius: radii.button, backgroundColor: colors.white },
  searchInput: { flex: 1, minHeight: 44, padding: 0, color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 20 },
  clearSearch: { width: layout.minimumTouchTarget, height: layout.minimumTouchTarget, alignItems: 'center', justifyContent: 'center' },
  speciesFilters: { flexDirection: 'row', gap: 6 },
  speciesButton: { flex: 1, minHeight: 48, minWidth: layout.minimumTouchTarget, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing[2], borderRadius: radii.button, borderWidth: 1 },
  selectedFilter: { borderColor: colors.brown, backgroundColor: colors.brown },
  unselectedFilter: { borderColor: colors.brown, backgroundColor: colors.white },
  speciesLabel: { fontFamily: fonts.semiBold, fontSize: typeScale.body, lineHeight: 20, textAlign: 'center' },
  selectedLabel: { color: colors.white },
  unselectedLabel: { color: colors.brown },
  listCaption: { color: colors.dark, fontFamily: fonts.medium, fontSize: typeScale.label, lineHeight: 19 },
  patientRows: { width: '100%' },
  patientRow: { minHeight: layout.minimumTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: 14, paddingRight: spacing[1], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gold },
  patientCopy: { flex: 1, minWidth: 0, gap: spacing[1] },
  patientName: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 22, flexShrink: 1 },
  patientMeta: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.label, lineHeight: 19, flexShrink: 1 },
  patientService: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.small, lineHeight: 18, flexShrink: 1 },
  emptyState: { paddingVertical: spacing[4], paddingHorizontal: spacing[3], borderRadius: radii.cardVet, backgroundColor: colors.white },
  detailScreen: { width: '100%', gap: spacing[4] },
  detailHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  backButton: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radii.button, borderWidth: 1, borderColor: colors.brown, backgroundColor: colors.white },
  detailHeaderTitle: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.heading, lineHeight: 28, flexShrink: 1 },
  detailBody: { gap: spacing[4] },
  patientDetailName: { color: colors.brown, fontFamily: fonts.bold, fontSize: 28, lineHeight: 39, flexShrink: 1 },
  patientDetailMeta: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21, flexShrink: 1 },
  historyFilters: { flexDirection: 'row', gap: 6 },
  historyButton: { flex: 1, minWidth: layout.minimumTouchTarget, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, borderRadius: radii.button, borderWidth: 1 },
  historyLabel: { fontFamily: fonts.semiBold, fontSize: typeScale.label, lineHeight: 19, textAlign: 'center', flexShrink: 1 },
  historyRows: { width: '100%' },
  historyRow: { minHeight: layout.minimumTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: 14, paddingRight: spacing[1], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gold },
  historyCopy: { flex: 1, minWidth: 0, gap: spacing[1] },
  historyDate: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 22, flexShrink: 1 },
  historyDescription: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.label, lineHeight: 19, flexShrink: 1 },
  historySource: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.small, lineHeight: 18 },
  historyEmpty: { color: colors.brown, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22, textAlign: 'center', paddingVertical: spacing[3], paddingHorizontal: spacing[2] },
  headerSpacer: { width: layout.minimumTouchTarget },
  overlayScreen: { flex: 1, backgroundColor: colors.cream, paddingHorizontal: spacing[5], paddingTop: spacing[3] },
  overlayHeader: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2], marginBottom: spacing[4] },
  overlayTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.heading, textAlign: 'center', flexShrink: 1 },
  overlayContent: { gap: spacing[4], paddingBottom: spacing[8] },
  overlayRecordTitle: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.title, lineHeight: 32 },
  detailLine: { gap: spacing[1] },
  detailLabel: { color: colors.muted, fontFamily: fonts.medium, fontSize: typeScale.small, lineHeight: 18 },
  detailValue: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22, flexShrink: 1 },
  attachmentSection: { gap: spacing[2], paddingTop: spacing[2] },
  attachmentHeading: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.section },
  attachmentRow: { minHeight: layout.minimumTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing[2], padding: spacing[3], borderRadius: radii.button, backgroundColor: colors.white },
  attachmentName: { flex: 1, color: colors.dark, fontFamily: fonts.medium, fontSize: typeScale.body, lineHeight: 20 },
  previewContent: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[4], paddingBottom: spacing[8] },
  previewImage: { width: '100%', height: '75%' },
  previewTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.heading, textAlign: 'center' },
  previewCaption: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22, textAlign: 'center', flexShrink: 1 },
});
