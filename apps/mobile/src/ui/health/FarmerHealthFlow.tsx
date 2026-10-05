import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { SessionSnapshot } from '../../domain/auth';
import { DomainError } from '../../domain/errors';
import type { FarmerReportKind, HealthRecordAttachment, HealthRecordKind, HealthRecordSnapshot } from '../../domain/health';
import type { LivestockSnapshot } from '../../domain/livestock';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, InlineFeedback, LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { TextArea } from '../components/TextField';
import { colors, fonts, layout, radii, spacing, typeScale } from '../theme/tokens';

type Props = {
  store: LocalStore;
  session: SessionSnapshot;
  animalId: string;
  onBack: () => void;
};

type Filter = 'all' | HealthRecordKind;

const filters: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'examination', label: 'Periksa' },
  { key: 'disease', label: 'Penyakit' },
  { key: 'vaccine', label: 'Vaksin' },
  { key: 'medication', label: 'Obat' },
  { key: 'care', label: 'Perawatan' },
];

const reportKinds: { key: FarmerReportKind; label: string }[] = [
  { key: 'disease', label: 'Kondisi / penyakit' },
  { key: 'vaccine', label: 'Vaksin' },
  { key: 'medication', label: 'Obat' },
  { key: 'care', label: 'Perawatan' },
];

export function FarmerHealthFlow({ store, session, animalId, onBack }: Props) {
  const [animal, setAnimal] = useState<LivestockSnapshot | null>(null);
  const [records, setRecords] = useState<HealthRecordSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [screen, setScreen] = useState<'history' | 'form'>('history');
  const [kind, setKind] = useState<FarmerReportKind>('disease');
  const [description, setDescription] = useState('');
  const [operationKey, setOperationKey] = useState(() => Crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [record, setRecord] = useState<HealthRecordSnapshot | null>(null);
  const [attachment, setAttachment] = useState<HealthRecordAttachment | null>(null);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      Promise.all([
        store.livestock.get(session.userId, animalId),
        store.healthRecords.listForFarmer(session.userId, animalId),
      ]).then(([nextAnimal, nextRecords]) => {
        if (!active) return;
        setAnimal(nextAnimal);
        setRecords(nextRecords);
      }).catch((cause: unknown) => {
        if (active) setError(messageFor(cause));
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [animalId, revision, session.userId, store]);

  const visibleRecords = useMemo(
    () => records.filter((item) => filter === 'all' || item.kind === filter),
    [filter, records],
  );

  const back = useCallback(() => {
    if (saving) return true;
    if (leaveDialog) { setLeaveDialog(false); return true; }
    if (attachment) { setAttachment(null); setAttachmentError(''); return true; }
    if (record) { setRecord(null); return true; }
    if (screen === 'form') {
      if (description.trim() || kind !== 'disease') setLeaveDialog(true);
      else setScreen('history');
      return true;
    }
    onBack();
    return true;
  }, [attachment, description, kind, leaveDialog, onBack, record, saving, screen]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', back);
    return () => subscription.remove();
  }, [back]);

  const openAttachment = async (item: HealthRecordAttachment) => {
    if (!record || attachmentLoading) return;
    setAttachmentLoading(true);
    setAttachmentError('');
    try {
      const allowed = await store.healthRecords.getAttachmentForFarmer(session.userId, animalId, item.id);
      setImageError(false);
      setAttachment(allowed);
    } catch (cause) {
      setAttachmentError(messageFor(cause));
    } finally {
      setAttachmentLoading(false);
    }
  };

  const saveReport = async () => {
    if (saving) return;
    setSaving(true);
    setFormError('');
    try {
      await store.healthRecords.addFarmerReport(session.userId, animalId, {
        kind,
        occurredAt: new Date().toISOString(),
        description,
        operationKey,
      });
      setDescription('');
      setKind('disease');
      setOperationKey(Crypto.randomUUID());
      setNotice('Catatan kesehatan berhasil disimpan.');
      setScreen('history');
      setFilter('all');
      setRevision((value) => value + 1);
    } catch (cause) {
      setFormError(messageFor(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" accessibilityLabel={screen === 'form' ? 'Kembali ke riwayat' : 'Kembali ke detail ternak'} onPress={back} style={styles.backButton}>
              <Icon name="chevron-left" size={23} color={colors.brown} />
            </Pressable>
            <Text accessibilityRole="header" style={styles.headerTitle}>{screen === 'form' ? 'Tambah Catatan' : 'Riwayat Kesehatan'}</Text>
            <View style={styles.headerSpacer} />
          </View>

          {loading && !animal ? <LoadingState label="Memuat riwayat kesehatan…" /> : null}
          {error ? <ErrorState message={error} role="farmer" onRetry={() => setRevision((value) => value + 1)} /> : null}
          {animal && !error ? (
            screen === 'form' ? (
              <>
                <View style={styles.animalCard}>
                  <Text style={styles.animalName}>{animal.name}</Text>
                  <Text style={styles.animalMeta}>{animal.displayCode} · {animal.breed}</Text>
                </View>
                <Text style={styles.intro}>Catatan ini berasal dari Peternak dan tersimpan terpisah dari catatan final Dokter.</Text>
                <Text style={styles.fieldLabel}>Jenis catatan</Text>
                <View style={styles.chips}>
                  {reportKinds.map((option) => (
                    <ChoiceChip key={option.key} label={option.label} selected={kind === option.key} onPress={() => setKind(option.key)} />
                  ))}
                </View>
                <TextArea
                  label="Keterangan"
                  helperText="Tuliskan kondisi atau tindakan yang benar-benar diamati. Maksimal 500 karakter."
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Ceritakan kondisi ternak…"
                  maxLength={500}
                />
                <Text style={styles.dateHint}>Tanggal dicatat otomatis saat disimpan: {formatDateTime(new Date().toISOString())}</Text>
                {formError ? <InlineFeedback message={formError} tone="error" /> : null}
                <Button label="Simpan Catatan" role="farmer" onPress={() => void saveReport()} loading={saving} disabled={description.trim().length < 3} />
                <Button label="Batal" role="farmer" variant="secondary" onPress={back} disabled={saving} />
              </>
            ) : (
              <>
                <View style={styles.animalCard}>
                  <Text accessibilityRole="header" style={styles.animalName}>{animal.name}</Text>
                  <Text style={styles.animalMeta}>{animal.displayCode} · {animal.breed}</Text>
                </View>
                {notice ? <InlineFeedback message={notice} tone="success" /> : null}
                <Button label="Tambah Catatan" role="farmer" onPress={() => { setNotice(''); setScreen('form'); }} />
                <View accessibilityRole="tablist" style={styles.chips}>
                  {filters.map((option) => <ChoiceChip key={option.key} label={option.label} selected={filter === option.key} onPress={() => setFilter(option.key)} />)}
                </View>
                <Text style={styles.sectionTitle}>Catatan {filter === 'all' ? 'kesehatan' : filters.find((item) => item.key === filter)?.label.toLocaleLowerCase('id-ID')}</Text>
                {loading ? <LoadingState label="Memperbarui riwayat…" /> : null}
                {!loading && visibleRecords.length === 0 ? (
                  <EmptyState
                    title="Belum ada catatan"
                    description={filter === 'all' ? 'Catatan kesehatan ternak ini akan tampil di sini.' : 'Belum ada catatan pada kategori ini.'}
                    role="farmer"
                    style={styles.emptyState}
                  />
                ) : null}
                {!loading ? visibleRecords.map((item) => (
                  <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${kindLabel(item.kind)}, ${formatDate(item.occurredAt)}`} onPress={() => setRecord(item)} style={styles.recordCard}>
                    <View style={styles.recordIcon}><Icon name={item.kind === 'examination' ? 'stethoscope' : 'heart-pulse'} size={23} color={colors.brown} /></View>
                    <View style={styles.recordCopy}>
                      <Text style={styles.recordTitle}>{kindLabel(item.kind)}</Text>
                      <Text style={styles.recordDate}>{formatDate(item.occurredAt)} · {sourceLabel(item)}</Text>
                      <Text numberOfLines={2} style={styles.recordDescription}>{item.description}</Text>
                    </View>
                    <Icon name="chevron-right" size={20} color={colors.muted} />
                  </Pressable>
                )) : null}
              </>
            )
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={Boolean(record)} animationType="slide" onRequestClose={() => { if (attachment) setAttachment(null); else setRecord(null); }}>
        {record ? (
          <View style={styles.modalScreen}>
            <View style={styles.header}>
              <Pressable accessibilityRole="button" accessibilityLabel={attachment ? 'Kembali ke catatan' : 'Tutup catatan'} onPress={() => { if (attachment) setAttachment(null); else setRecord(null); }} style={styles.backButton}>
                <Icon name="chevron-left" size={23} color={colors.brown} />
              </Pressable>
              <Text accessibilityRole="header" style={styles.headerTitle}>{attachment ? 'Lampiran' : kindLabel(record.kind)}</Text>
              <View style={styles.headerSpacer} />
            </View>
            {attachment ? (
              <AttachmentView attachment={attachment} imageError={imageError} onImageError={() => setImageError(true)} onOpen={() => {
                if (attachment.uri) Linking.openURL(attachment.uri).catch(() => setAttachmentError('Lampiran tidak dapat dibuka di perangkat ini.'));
              }} error={attachmentError} />
            ) : (
              <ScrollView contentContainerStyle={styles.modalContent}>
                <Text style={styles.modalTitle}>{kindLabel(record.kind)}</Text>
                <DetailLine label="Tanggal" value={formatDateTime(record.occurredAt)} />
                <DetailLine label="Sumber" value={sourceLabel(record)} />
                <DetailLine label="Dicatat oleh" value={record.actorName} />
                <DetailLine label="Keterangan" value={record.description} />
                {record.clinicalNote ? (
                  <>
                    <Text style={styles.readOnlyHint}>Catatan final Dokter · hanya baca</Text>
                    <DetailLine label="Keluhan" value={record.clinicalNote.complaint} />
                    <DetailLine label="Temuan" value={record.clinicalNote.findings} />
                    <DetailLine label="Penilaian" value={record.clinicalNote.assessment} />
                    <DetailLine label="Tindakan" value={record.clinicalNote.actions} />
                    <DetailLine label="Instruksi perawatan" value={record.clinicalNote.careInstructions} />
                  </>
                ) : null}
                {record.attachments.length ? (
                  <>
                    <Text style={styles.sectionTitle}>Lampiran</Text>
                    {record.attachments.map((item) => (
                      <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Buka lampiran ${item.filename}`} onPress={() => void openAttachment(item)} style={styles.attachmentRow}>
                        <Icon name="file-text" size={20} color={colors.brown} />
                        <Text numberOfLines={2} style={styles.attachmentName}>{item.filename}</Text>
                        <Icon name="chevron-right" size={20} color={colors.muted} />
                      </Pressable>
                    ))}
                  </>
                ) : null}
                {attachmentLoading ? <LoadingState label="Memeriksa lampiran…" /> : null}
                {attachmentError ? <InlineFeedback message={attachmentError} tone="error" /> : null}
              </ScrollView>
            )}
          </View>
        ) : null}
      </Modal>

      <Modal visible={leaveDialog} transparent animationType="fade" onRequestClose={() => setLeaveDialog(false)}>
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <Text accessibilityRole="header" style={styles.confirmTitle}>Catatan belum disimpan</Text>
            <Text style={styles.intro}>Jika kembali sekarang, isi catatan akan dibuang.</Text>
            <Button label="Tetap mengedit" role="farmer" variant="secondary" onPress={() => setLeaveDialog(false)} />
            <Button label="Buang catatan" role="farmer" variant="accent" onPress={() => { setLeaveDialog(false); setScreen('history'); setDescription(''); setKind('disease'); setFormError(''); setOperationKey(Crypto.randomUUID()); }} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ChoiceChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return <View style={styles.detailLine}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value || 'Belum dicatat.'}</Text></View>;
}

function AttachmentView({ attachment, imageError, onImageError, onOpen, error }: {
  attachment: HealthRecordAttachment;
  imageError: boolean;
  onImageError: () => void;
  onOpen: () => void;
  error: string;
}) {
  if (!attachment.available || !attachment.uri) return <ErrorState message="Lampiran tidak tersedia di perangkat ini." role="farmer" />;
  if (attachment.mimeType.startsWith('image/') && !imageError) {
    return <View style={styles.preview}><Image accessibilityLabel={`Lampiran ${attachment.filename}`} source={{ uri: attachment.uri }} resizeMode="contain" onError={onImageError} style={styles.previewImage} /><Text style={styles.previewCaption}>{attachment.filename}</Text></View>;
  }
  return <View style={styles.preview}><Icon name="file-text" size={40} color={colors.brown} /><Text style={styles.modalTitle}>{attachment.filename}</Text><Text style={styles.intro}>{error || (imageError ? 'Gambar tidak dapat dimuat.' : 'Buka dengan aplikasi yang tersedia di perangkat.')}</Text>{!imageError ? <Button label="Buka lampiran" role="farmer" variant="secondary" onPress={onOpen} /> : null}</View>;
}

function kindLabel(kind: HealthRecordKind): string {
  switch (kind) {
    case 'examination': return 'Pemeriksaan';
    case 'disease': return 'Penyakit';
    case 'vaccine': return 'Vaksin';
    case 'medication': return 'Obat';
    case 'care': return 'Perawatan';
  }
}

function sourceLabel(item: HealthRecordSnapshot): string {
  if (item.source === 'clinical_note') return 'Catatan final Dokter';
  if (item.source === 'reminder') return 'Perawatan tercatat';
  return 'Laporan Peternak';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(value));
}

function messageFor(cause: unknown): string {
  return cause instanceof DomainError ? cause.message : 'Riwayat kesehatan belum dapat dimuat. Coba lagi.';
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.cream },
  content: { paddingHorizontal: layout.contentHorizontal, paddingTop: spacing[3], paddingBottom: spacing[8], gap: spacing[4] },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[2] },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.heading, textAlign: 'center' },
  headerSpacer: { width: 44 },
  animalCard: { padding: spacing[4], gap: spacing[1], borderRadius: radii.cardFarmer, backgroundColor: colors.white },
  animalName: { color: colors.dark, fontFamily: fonts.bold, fontSize: typeScale.heading, lineHeight: 28 },
  animalMeta: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.body },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing[3], borderRadius: radii.pill, borderWidth: 1, borderColor: colors.brown, backgroundColor: colors.white },
  chipSelected: { backgroundColor: colors.brown },
  chipText: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.small },
  chipTextSelected: { color: colors.white },
  sectionTitle: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.section, lineHeight: 24 },
  emptyState: { backgroundColor: colors.white, borderRadius: radii.cardFarmer },
  recordCard: { minHeight: 98, flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[3], borderRadius: radii.cardFarmer, backgroundColor: colors.white },
  recordIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: colors.cream },
  recordCopy: { flex: 1, gap: spacing[1] },
  recordTitle: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.body },
  recordDate: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.small },
  recordDescription: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 18 },
  intro: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21 },
  fieldLabel: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.label },
  dateHint: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 18 },
  modalScreen: { flex: 1, backgroundColor: colors.cream },
  modalContent: { paddingHorizontal: layout.contentHorizontal, paddingTop: spacing[4], paddingBottom: spacing[8], gap: spacing[3] },
  modalTitle: { color: colors.dark, fontFamily: fonts.bold, fontSize: typeScale.heading, lineHeight: 28 },
  detailLine: { gap: spacing[1], paddingVertical: spacing[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gold },
  detailLabel: { color: colors.muted, fontFamily: fonts.medium, fontSize: typeScale.small },
  detailValue: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21 },
  readOnlyHint: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.small, paddingTop: spacing[2] },
  attachmentRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[3], borderRadius: radii.button, backgroundColor: colors.white },
  attachmentName: { flex: 1, color: colors.dark, fontFamily: fonts.medium, fontSize: typeScale.body },
  preview: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[4], padding: spacing[5] },
  previewImage: { width: '100%', height: '72%' },
  previewCaption: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small },
  confirmBackdrop: { flex: 1, justifyContent: 'center', padding: spacing[5], backgroundColor: 'rgba(58, 23, 13, 0.48)' },
  confirmCard: { width: '100%', gap: spacing[3], padding: spacing[5], borderRadius: radii.cardFarmer, backgroundColor: colors.white },
  confirmTitle: { color: colors.dark, fontFamily: fonts.bold, fontSize: typeScale.heading },
});
