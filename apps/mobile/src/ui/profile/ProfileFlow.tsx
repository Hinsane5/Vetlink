import { useCallback, useEffect, useState } from 'react';
import {
  BackHandler,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { SessionSnapshot } from '../../domain/auth';
import { livestockSpecies, type AttachmentSelection, type AttachmentSummary, type FarmerProfileInput, type ProfileForm, type ProfileMediaSelection, type ProfileSnapshot, type VetProfileInput, type VetService } from '../../domain/profiles';
import { DomainError } from '../../domain/errors';
import { Button } from '../components/Button';
import { InlineFeedback, LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { TextField } from '../components/TextField';
import { colors, fonts, layout, radii, spacing, typeScale } from '../theme/tokens';

const speciesLabels: Record<(typeof livestockSpecies)[number], string> = {
  cattle: 'Sapi',
  goat: 'Kambing',
  sheep: 'Domba',
  poultry: 'Ayam',
  duck: 'Bebek',
  pig: 'Babi',
  horse: 'Kuda',
};

const serviceLabels: Record<VetService, string> = { chat: 'Konsultasi chat', visit: 'Kunjungan' };

type Props = {
  store: LocalStore;
  session: SessionSnapshot;
  onBack: () => void;
  onDisplayNameChange: (name: string) => void;
};

export function ProfileFlow({ store, session, onBack, onDisplayNameChange }: Props) {
  const role = session.activeRole;
  const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(null);
  const [farmerForm, setFarmerForm] = useState<FarmerProfileInput>(() => emptyFarmerForm(session.displayName));
  const [vetForm, setVetForm] = useState<VetProfileInput>(() => emptyVetForm(session.displayName));
  const [selectedPhoto, setSelectedPhoto] = useState<AttachmentSelection | undefined>();
  const [selectedDocuments, setSelectedDocuments] = useState<AttachmentSelection[]>([]);
  const [baseKey, setBaseKey] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [photoError, setPhotoError] = useState(false);

  const form: ProfileForm = role === 'farmer'
    ? { role, values: farmerForm }
    : { role, values: vetForm };
  const mediaSelection: ProfileMediaSelection = { photo: selectedPhoto, documents: selectedDocuments };
  const dirtyKey = JSON.stringify({ form, mediaSelection });
  const dirty = Boolean(baseKey) && dirtyKey !== baseKey;
  const verificationStatus = snapshot?.verificationStatus ?? 'not_submitted';
  const photoSummary = selectedPhoto?.type === 'existing'
    ? findAttachment(snapshot, selectedPhoto.attachmentId)
    : snapshot?.photo;
  const photoUri = selectedPhoto?.type === 'new'
    ? selectedPhoto.asset.uri
    : photoSummary?.localUri;

  const reload = async (preserveMode = true) => {
    const loaded = await store.profiles.load(session.userId, role);
    setSnapshot(loaded);
    const draftForm = loaded.draft?.form.role === role ? loaded.draft.form : null;
    const nextFarmer = role === 'farmer'
      ? draftForm?.role === 'farmer' ? draftForm.values : loaded.farmer ?? emptyFarmerForm(loaded.displayName)
      : emptyFarmerForm(loaded.displayName);
    const nextVet = role === 'vet'
      ? draftForm?.role === 'vet' ? draftForm.values : loaded.vet ?? emptyVetForm(loaded.displayName)
      : emptyVetForm(loaded.displayName);
    const nextPhoto: AttachmentSelection | undefined = loaded.draft?.photo
      ? { type: 'existing', attachmentId: loaded.draft.photo.id }
      : loaded.photo ? { type: 'existing', attachmentId: loaded.photo.id } : undefined;
    const nextDocuments: AttachmentSelection[] = loaded.draft?.documents.map((document) => ({ type: 'existing', attachmentId: document.id })) ?? [];
    setFarmerForm(nextFarmer);
    setVetForm(nextVet);
    setSelectedPhoto(nextPhoto);
    setSelectedDocuments(nextDocuments);
    const nextForm: ProfileForm = role === 'farmer' ? { role, values: nextFarmer } : { role, values: nextVet };
    setBaseKey(JSON.stringify({ form: nextForm, mediaSelection: { photo: nextPhoto, documents: nextDocuments } }));
    setPhotoError(false);
    if (!preserveMode) {
      const complete = role === 'farmer' ? farmerIsComplete(nextFarmer) : vetIsComplete(nextVet);
      setEditing(Boolean(loaded.draft) || !complete);
    }
  };

  useEffect(() => {
    let mounted = true;
    store.profiles.load(session.userId, role).then((loaded) => {
      if (!mounted) return;
      setSnapshot(loaded);
      const draftForm = loaded.draft?.form.role === role ? loaded.draft.form : null;
      const nextFarmer = role === 'farmer'
        ? draftForm?.role === 'farmer' ? draftForm.values : loaded.farmer ?? emptyFarmerForm(loaded.displayName)
        : emptyFarmerForm(loaded.displayName);
      const nextVet = role === 'vet'
        ? draftForm?.role === 'vet' ? draftForm.values : loaded.vet ?? emptyVetForm(loaded.displayName)
        : emptyVetForm(loaded.displayName);
      const nextPhoto: AttachmentSelection | undefined = loaded.draft?.photo
        ? { type: 'existing', attachmentId: loaded.draft.photo.id }
        : loaded.photo ? { type: 'existing', attachmentId: loaded.photo.id } : undefined;
      const nextDocuments: AttachmentSelection[] = loaded.draft?.documents.map((document) => ({ type: 'existing', attachmentId: document.id })) ?? [];
      setFarmerForm(nextFarmer);
      setVetForm(nextVet);
      setSelectedPhoto(nextPhoto);
      setSelectedDocuments(nextDocuments);
      const nextForm: ProfileForm = role === 'farmer' ? { role, values: nextFarmer } : { role, values: nextVet };
      setBaseKey(JSON.stringify({ form: nextForm, mediaSelection: { photo: nextPhoto, documents: nextDocuments } }));
      const complete = role === 'farmer' ? farmerIsComplete(nextFarmer) : vetIsComplete(nextVet);
      setEditing(Boolean(loaded.draft) || !complete);
      setError('');
      setLoading(false);
    }).catch(() => {
      if (mounted) {
        setError('Profil belum dapat dimuat dari penyimpanan lokal.');
        setLoading(false);
      }
    });
    return () => { mounted = false; };
  }, [role, session.userId, store]);

  const requestLeave = useCallback(() => {
    if (editing && dirty) setLeaveDialog(true);
    else onBack();
  }, [dirty, editing, onBack]);

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
  }, [dirty, editing, leaveDialog, requestLeave]);

  const saveDraftAndLeave = async () => {
    setBusy(true);
    setError('');
    try {
      await store.profiles.saveDraft(session.userId, role, form, mediaSelection);
      onBack();
    } catch (cause) {
      setError(messageFor(cause));
      setLeaveDialog(false);
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (role === 'farmer') {
        await store.profiles.saveFarmerProfile(session.userId, farmerForm, selectedPhoto);
        onDisplayNameChange(farmerForm.displayName.trim());
        setNotice('Profil, peternakan, jenis ternak, dan alamat berhasil disimpan.');
      } else {
        // Keep a persistent draft if selected verification documents are not submitted yet.
        const saveDraftFirst = selectedDocuments.length > 0 || Boolean(snapshot?.draft);
        if (saveDraftFirst) await store.profiles.saveDraft(session.userId, role, form, mediaSelection);
        const current = await store.profiles.load(session.userId, role);
        const persistedPhoto: AttachmentSelection | undefined = selectedPhoto?.type === 'new' && saveDraftFirst && current.draft?.photo
          ? { type: 'existing', attachmentId: current.draft.photo.id }
          : selectedPhoto;
        if (selectedPhoto?.type === 'new' && persistedPhoto?.type === 'existing') setSelectedPhoto(persistedPhoto);
        await store.profiles.saveVetProfile(session.userId, vetForm, { photo: persistedPhoto });
        setNotice('Profil profesional tersimpan. Status verifikasi tidak berubah.');
      }
      await reload(true);
      setEditing(role === 'vet' && verificationStatus !== 'pending');
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const submitVerification = async () => {
    if (role !== 'vet') return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await store.profiles.submitVetVerification(session.userId, vetForm, selectedDocuments, selectedPhoto);
      await reload(true);
      setEditing(false);
      setNotice('Pengajuan tersimpan dan menunggu peninjauan. Anda belum dapat menerima layanan.');
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const pickPhoto = async () => {
    setBusy(true);
    setError('');
    try {
      const asset = await store.profiles.pickPhoto();
      if (asset) setSelectedPhoto({ type: 'new', asset });
    } catch {
      setError('Foto belum dapat dipilih. Periksa izin galeri lalu coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  const pickDocuments = async () => {
    setBusy(true);
    setError('');
    try {
      const assets = await store.profiles.pickDocuments();
      if (assets.length) setSelectedDocuments((current) => [...current, ...assets.map((asset) => ({ type: 'new' as const, asset }))]);
    } catch {
      setError('Dokumen belum dapat dipilih. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState label="Memuat profil…" />;
  if (!snapshot) {
    return <View style={styles.screen}><InlineFeedback message={error || 'Profil belum dapat dimuat.'} tone="error" /><Button label="Coba lagi" role={role} variant="secondary" onPress={() => void reload(false)} /><Button label="Kembali" role={role} onPress={onBack} /></View>;
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Kembali ke akun" onPress={requestLeave} style={styles.backButton}>
          <Icon name="arrow-left" size={22} color={colors.brown} />
        </Pressable>
        <Text style={styles.headerTitle}>{role === 'farmer' ? 'Profil Peternak' : 'Profil Dokter'}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.hero}>
        <View style={styles.avatar}>
          {photoUri && !photoError ? <Image accessibilityLabel="Foto profil" source={{ uri: photoUri }} style={styles.avatarImage} onError={() => setPhotoError(true)} /> : <Icon name={role === 'farmer' ? 'paw-print' : 'stethoscope'} size={34} color={colors.brown} />}
        </View>
        <Text accessibilityRole="header" style={styles.title}>{role === 'farmer' ? 'Profil peternakan Anda' : 'Profil profesional'}</Text>
        <Text style={styles.description}>{role === 'farmer' ? 'Simpan informasi peternakan dan alamat kunjungan.' : 'Lengkapi data profesi dan ajukan dokumen untuk ditinjau.'}</Text>
        {editing ? <Button label={photoUri ? 'Ganti Foto Profil' : 'Pilih Foto Profil'} role={role} variant="secondary" onPress={() => void pickPhoto()} loading={busy} style={styles.photoButton} /> : null}
      </View>

      {role === 'vet' ? <VerificationPanel snapshot={snapshot} /> : null}
      {notice ? <InlineFeedback message={notice} tone="success" /> : null}
      {error ? <InlineFeedback message={error} tone="error" /> : null}

      {role === 'farmer' ? (
        editing ? (
          <FarmerEditor value={farmerForm} onChange={setFarmerForm} />
        ) : (
          <FarmerSummary value={farmerForm} />
        )
      ) : (
        editing ? (
          <VetEditor value={vetForm} onChange={setVetForm} documents={selectedDocuments} onRemoveDocument={(index) => setSelectedDocuments((items) => items.filter((_, itemIndex) => itemIndex !== index))} onPickDocuments={() => void pickDocuments()} snapshot={snapshot} />
        ) : (
          <VetSummary value={vetForm} snapshot={snapshot} />
        )
      )}

      {editing ? (
        <>
          <Button label="Simpan Profil" role={role} loading={busy} onPress={() => void saveProfile()} />
          {role === 'vet' && verificationStatus !== 'pending' && verificationStatus !== 'verified' ? (
            <Button label={verificationStatus === 'revision_required' ? 'Kirim Ulang Verifikasi' : 'Ajukan Verifikasi'} role="vet" variant="accent" loading={busy} onPress={() => void submitVerification()} />
          ) : null}
          <Button label="Batal Mengedit" role={role} variant="secondary" disabled={busy} onPress={requestLeave} />
        </>
      ) : (
        <Button label="Ubah Profil" role={role} onPress={() => { setNotice(''); setError(''); setEditing(true); }} />
      )}

      <LeaveDraftDialog
        visible={leaveDialog}
        role={role}
        loading={busy}
        onSave={() => void saveDraftAndLeave()}
        onDiscard={() => { setLeaveDialog(false); onBack(); }}
        onKeepEditing={() => setLeaveDialog(false)}
      />
    </View>
  );
}

function FarmerEditor({ value, onChange }: { value: FarmerProfileInput; onChange: (next: FarmerProfileInput) => void }) {
  const update = <K extends keyof FarmerProfileInput>(key: K, next: FarmerProfileInput[K]) => onChange({ ...value, [key]: next });
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>Identitas Peternak</Text>
      <TextField label="Nama lengkap" value={value.displayName} onChangeText={(text) => update('displayName', text)} autoCapitalize="words" returnKeyType="next" />
      <Text style={styles.sectionTitle}>Peternakan</Text>
      <TextField label="Nama peternakan" value={value.farmName} onChangeText={(text) => update('farmName', text)} autoCapitalize="words" returnKeyType="next" />
      <ChoiceChips label="Jenis ternak" values={livestockSpecies} labels={speciesLabels} selected={value.species} onToggle={(item) => update('species', toggleChoice(value.species, item))} />
      <TextField label="Wilayah peternakan" helperText="Kabupaten atau kecamatan tempat peternakan berada." value={value.farmLocation} onChangeText={(text) => update('farmLocation', text)} autoCapitalize="words" returnKeyType="next" />
      <Text style={styles.sectionTitle}>Alamat kunjungan</Text>
      <TextField label="Label alamat" value={value.addressLabel} onChangeText={(text) => update('addressLabel', text)} autoCapitalize="words" returnKeyType="next" />
      <TextField label="Nama penerima" value={value.recipient} onChangeText={(text) => update('recipient', text)} autoCapitalize="words" returnKeyType="next" />
      <TextField label="Nomor telepon" value={value.phone} onChangeText={(text) => update('phone', text)} keyboardType="phone-pad" returnKeyType="next" />
      <TextField label="Alamat lengkap" value={value.address} onChangeText={(text) => update('address', text)} autoCapitalize="sentences" returnKeyType="next" multiline />
      <TextField label="Kota atau kabupaten" value={value.city} onChangeText={(text) => update('city', text)} autoCapitalize="words" returnKeyType="next" />
      <TextField label="Provinsi" value={value.province} onChangeText={(text) => update('province', text)} autoCapitalize="words" returnKeyType="next" />
      <TextField label="Kode pos" value={value.postalCode} onChangeText={(text) => update('postalCode', text)} keyboardType="number-pad" returnKeyType="done" />
    </View>
  );
}

function VetEditor({ value, onChange, documents, onRemoveDocument, onPickDocuments, snapshot }: {
  value: VetProfileInput;
  onChange: (next: VetProfileInput) => void;
  documents: AttachmentSelection[];
  onRemoveDocument: (index: number) => void;
  onPickDocuments: () => void;
  snapshot: ProfileSnapshot;
}) {
  const update = <K extends keyof VetProfileInput>(key: K, next: VetProfileInput[K]) => onChange({ ...value, [key]: next });
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>Identitas profesi</Text>
      <TextField label="Nama profesional" value={value.professionalName} onChangeText={(text) => update('professionalName', text)} autoCapitalize="words" returnKeyType="next" />
      <TextField label="Nomor registrasi profesi" helperText="Disimpan di perangkat untuk pengajuan verifikasi." value={value.registrationNumber} onChangeText={(text) => update('registrationNumber', text)} autoCapitalize="characters" returnKeyType="next" />
      <TextField label="Pengalaman (tahun)" value={String(value.experienceYears)} onChangeText={(text) => update('experienceYears', text === '' ? 0 : Number(text))} keyboardType="number-pad" returnKeyType="next" />
      <Text style={styles.sectionTitle}>Layanan dan wilayah</Text>
      <ChoiceChips label="Jenis layanan" values={['chat', 'visit'] as const} labels={serviceLabels} selected={value.services} onToggle={(item) => update('services', toggleChoice(value.services, item))} />
      <ChoiceChips label="Jenis ternak yang dilayani" values={livestockSpecies} labels={speciesLabels} selected={value.species} onToggle={(item) => update('species', toggleChoice(value.species, item))} />
      <TextField label="Lokasi praktik" value={value.practiceLocation} onChangeText={(text) => update('practiceLocation', text)} autoCapitalize="words" returnKeyType="next" />
      <TextField label="Wilayah kunjungan" helperText="Pisahkan beberapa kota/kabupaten dengan koma." value={value.visitRegions.join(', ')} onChangeText={(text) => update('visitRegions', splitTags(text))} autoCapitalize="words" returnKeyType="done" />
      {snapshot.verificationStatus !== 'pending' && snapshot.verificationStatus !== 'verified' ? (
        <View style={styles.documentSection}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Dokumen verifikasi</Text>
          <Text style={styles.description}>Pilih dokumen pendukung profesi. Berkas tersimpan privat di perangkat dan belum dikirim ke pihak mana pun.</Text>
          {documents.map((selection, index) => (
            <AttachmentRow key={`${selection.type}-${selection.type === 'existing' ? selection.attachmentId : selection.asset.uri}`} selection={selection} onRemove={() => onRemoveDocument(index)} />
          ))}
          <Button label="Tambah Dokumen" role="vet" variant="secondary" onPress={onPickDocuments} />
        </View>
      ) : null}
    </View>
  );
}

function ChoiceChips<T extends string>({ label, values, labels, selected, onToggle }: {
  label: string;
  values: readonly T[];
  labels: Record<T, string>;
  selected: readonly T[];
  onToggle: (value: T) => void;
}) {
  return (
    <View style={styles.chipGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.chips}>
        {values.map((item) => {
          const isSelected = selected.includes(item);
          return (
            <Pressable key={item} accessibilityRole="checkbox" accessibilityState={{ checked: isSelected }} onPress={() => onToggle(item)} style={[styles.chip, isSelected && styles.chipSelected]}>
              <Text style={[styles.chipText, isSelected && styles.chipSelectedText]}>{labels[item]}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function FarmerSummary({ value }: { value: FarmerProfileInput }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>Peternak</Text>
      <ProfileDetail label="Nama lengkap" value={value.displayName} />
      <Text style={styles.sectionTitle}>Peternakan</Text>
      <ProfileDetail label="Nama peternakan" value={value.farmName} />
      <ProfileDetail label="Jenis ternak" value={displaySpecies(value.species)} />
      <ProfileDetail label="Wilayah" value={value.farmLocation} />
      <Text style={styles.sectionTitle}>Alamat kunjungan</Text>
      <ProfileDetail label={value.addressLabel || 'Alamat'} value={[value.address, value.city, value.province, value.postalCode].filter(Boolean).join(', ')} />
      <ProfileDetail label="Penerima" value={value.recipient} />
      <ProfileDetail label="Telepon" value={value.phone} />
    </View>
  );
}

function VetSummary({ value, snapshot }: { value: VetProfileInput; snapshot: ProfileSnapshot }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>Data profesional</Text>
      <ProfileDetail label="Nama profesional" value={value.professionalName} />
      <ProfileDetail label="Nomor registrasi profesi" value={value.registrationNumber} />
      <ProfileDetail label="Layanan" value={value.services.map((service) => serviceLabels[service]).join(', ')} />
      <ProfileDetail label="Jenis ternak" value={displaySpecies(value.species)} />
      <ProfileDetail label="Pengalaman" value={`${value.experienceYears} tahun`} />
      <ProfileDetail label="Lokasi praktik" value={value.practiceLocation} />
      <ProfileDetail label="Wilayah kunjungan" value={value.visitRegions.join(', ')} />
      {snapshot.verificationDocuments.length ? (
        <View style={styles.documentSection}>
          <Text style={styles.fieldLabel}>Dokumen yang diajukan</Text>
          {snapshot.verificationDocuments.map((document) => <ReadOnlyAttachment key={document.id} document={document} />)}
        </View>
      ) : null}
    </View>
  );
}

function VerificationPanel({ snapshot }: { snapshot: ProfileSnapshot }) {
  const status = snapshot.verificationStatus ?? 'not_submitted';
  const text = status === 'pending'
    ? 'Menunggu verifikasi. Dokter belum dapat menerima layanan sampai peninjauan disetujui.'
    : status === 'revision_required'
      ? `Perlu revisi. ${snapshot.reviewerReason || 'Periksa catatan peninjau, perbarui data, lalu kirim ulang.'}`
      : status === 'verified'
        ? 'Terverifikasi. Status ini berasal dari peninjau tepercaya.'
        : 'Belum diajukan. Lengkapi profil dan dokumen untuk memulai peninjauan.';
  const tone = status === 'verified' ? styles.statusSuccess : status === 'revision_required' ? styles.statusRevision : styles.statusPending;
  return (
    <View style={[styles.statusCard, tone]}>
      <Text accessibilityRole="header" style={styles.statusTitle}>{verificationLabel(status)}</Text>
      <Text style={styles.statusText}>{text}</Text>
    </View>
  );
}

function ProfileDetail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value || 'Belum diisi'}</Text>
    </View>
  );
}

function AttachmentRow({ selection, onRemove }: { selection: AttachmentSelection; onRemove: () => void }) {
  const filename = selection.type === 'new' ? selection.asset.filename : `Dokumen tersimpan (${selection.attachmentId.slice(0, 8)})`;
  return (
    <View style={styles.attachmentRow}>
      <Icon name="file-text" size={20} color={colors.brown} />
      <Text style={styles.attachmentName}>{filename}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Hapus ${filename}`} onPress={onRemove} style={styles.removeButton}>
        <Icon name="x" size={18} color={colors.brown} />
      </Pressable>
    </View>
  );
}

function ReadOnlyAttachment({ document }: { document: AttachmentSummary }) {
  return (
    <View style={styles.attachmentRow}>
      <Icon name="file-text" size={20} color={colors.brown} />
      <Text style={styles.attachmentName}>{document.filename || 'Dokumen verifikasi'}</Text>
    </View>
  );
}

function LeaveDraftDialog({ visible, role, loading, onSave, onDiscard, onKeepEditing }: {
  visible: boolean;
  role: 'farmer' | 'vet';
  loading: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onKeepEditing}>
      <View style={styles.modalBackdrop}>
        <View style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.dialogTitle}>Perubahan belum disimpan</Text>
          <Text style={styles.dialogCopy}>Simpan perubahan sebagai draft, buang perubahan, atau lanjut mengedit.</Text>
          <Button label="Simpan Draft" role={role} loading={loading} onPress={onSave} />
          <Button label="Buang Perubahan" role={role} variant="secondary" disabled={loading} onPress={onDiscard} />
          <Button label="Tetap Mengedit" role={role} variant="secondary" disabled={loading} onPress={onKeepEditing} />
        </View>
      </View>
    </Modal>
  );
}

function findAttachment(snapshot: ProfileSnapshot | null, id: string): AttachmentSummary | undefined {
  return snapshot?.photo?.id === id ? snapshot.photo : snapshot?.draft?.photo?.id === id ? snapshot.draft.photo : undefined;
}

function emptyFarmerForm(name: string): FarmerProfileInput {
  return { displayName: name, farmName: '', species: [], farmLocation: '', addressLabel: '', recipient: name, phone: '', address: '', city: '', province: '', postalCode: '' };
}

function emptyVetForm(name: string): VetProfileInput {
  return { professionalName: name, registrationNumber: '', experienceYears: 0, services: [], species: [], practiceLocation: '', visitRegions: [] };
}

function farmerIsComplete(value: FarmerProfileInput): boolean {
  return Boolean(value.farmName && value.species.length && value.farmLocation && value.phone && value.address && value.city && value.province && value.postalCode);
}

function vetIsComplete(value: VetProfileInput): boolean {
  return Boolean(value.professionalName && value.registrationNumber && value.services.length && value.species.length && value.practiceLocation && value.visitRegions.length);
}

function toggleChoice<T extends string>(values: readonly T[], selected: T): T[] {
  return values.includes(selected) ? values.filter((value) => value !== selected) : [...values, selected];
}

function splitTags(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function displaySpecies(values: readonly string[]): string {
  return values.map((value) => speciesLabels[value as keyof typeof speciesLabels] ?? value).join(', ');
}

function verificationLabel(status: NonNullable<ProfileSnapshot['verificationStatus']>): string {
  switch (status) {
    case 'not_submitted': return 'Belum diajukan';
    case 'pending': return 'Menunggu verifikasi';
    case 'revision_required': return 'Perlu revisi';
    case 'verified': return 'Terverifikasi';
  }
}

function messageFor(error: unknown): string {
  if (error instanceof DomainError) return error.message;
  return 'Perubahan belum tersimpan. Periksa koneksi penyimpanan lalu coba lagi.';
}

const styles = StyleSheet.create({
  screen: { gap: spacing[4], paddingBottom: spacing[4] },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: layout.minimumTouchTarget, height: layout.minimumTouchTarget, justifyContent: 'center', alignItems: 'flex-start' },
  headerTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.heading, flexShrink: 1, textAlign: 'center' },
  headerSpacer: { width: layout.minimumTouchTarget },
  hero: { alignItems: 'center', gap: spacing[2], paddingVertical: spacing[2] },
  avatar: { width: 88, height: 88, borderRadius: 44, borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  title: { color: colors.dark, fontFamily: fonts.bold, fontSize: typeScale.title, lineHeight: 32, textAlign: 'center', flexShrink: 1 },
  description: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21, textAlign: 'center', flexShrink: 1 },
  photoButton: { alignSelf: 'center', minHeight: layout.minimumTouchTarget },
  section: { gap: spacing[3], padding: spacing[4], borderRadius: radii.cardFarmer, backgroundColor: colors.white },
  sectionTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.section, lineHeight: 25, flexShrink: 1, marginTop: spacing[1] },
  statusCard: { gap: spacing[2], padding: spacing[4], borderRadius: radii.cardVet, borderWidth: 1 },
  statusPending: { backgroundColor: '#FFF7E5', borderColor: colors.gold },
  statusRevision: { backgroundColor: '#FFF0E6', borderColor: colors.orange },
  statusSuccess: { backgroundColor: '#EEF6E8', borderColor: '#739866' },
  statusTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.body, lineHeight: 22, flexShrink: 1 },
  statusText: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22, flexShrink: 1 },
  fieldLabel: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.label, lineHeight: 19, flexShrink: 1 },
  chipGroup: { gap: spacing[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  chip: { minHeight: layout.minimumTouchTarget, minWidth: layout.minimumTouchTarget, paddingHorizontal: spacing[3], borderRadius: radii.pill, borderWidth: 1, borderColor: colors.gold, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.white },
  chipSelected: { backgroundColor: colors.brown, borderColor: colors.brown },
  chipText: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.body, lineHeight: 20, flexShrink: 1 },
  chipSelectedText: { color: colors.white },
  detail: { gap: 4, paddingVertical: spacing[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gold },
  detailLabel: { color: colors.muted, fontFamily: fonts.medium, fontSize: typeScale.small, lineHeight: 18 },
  detailValue: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22, flexShrink: 1 },
  documentSection: { gap: spacing[2], paddingTop: spacing[3] },
  attachmentRow: { minHeight: layout.minimumTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[2], borderRadius: radii.button, backgroundColor: colors.cream },
  attachmentName: { flex: 1, color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 20, flexShrink: 1 },
  removeButton: { width: layout.minimumTouchTarget, height: layout.minimumTouchTarget, alignItems: 'center', justifyContent: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: spacing[5], backgroundColor: 'rgba(30, 17, 12, 0.45)' },
  dialog: { width: '100%', maxWidth: 430, alignSelf: 'center', gap: spacing[3], padding: spacing[5], borderRadius: radii.cardFarmer, backgroundColor: colors.cream },
  dialogTitle: { color: colors.dark, fontFamily: fonts.bold, fontSize: typeScale.heading, lineHeight: 27, flexShrink: 1 },
  dialogCopy: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21, flexShrink: 1 },
});
