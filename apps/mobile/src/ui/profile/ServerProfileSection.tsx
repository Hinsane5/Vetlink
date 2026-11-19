import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import type { ServerProfileForm, ServerProfileService, ServerProfileSnapshot } from '../../application/ServerProfileService';
import type { ApiProfessionalDocument } from '../../application/ports/ApiProfileRepository';
import type { ServerVetVerificationService } from '../../application/ServerVetVerificationService';
import type { AccountRole } from '../../domain/auth';
import { DomainError } from '../../domain/errors';
import { Button } from '../components/Button';
import { LoadingState } from '../components/Feedback';
import { TextField } from '../components/TextField';
import { colors, fonts, spacing, typeScale } from '../theme/tokens';

type Props = {
  service: ServerProfileService;
  verificationService: ServerVetVerificationService;
  role: AccountRole;
  userId: string;
  onExit: () => void;
  onNameSaved: (name: string) => void;
  backHandlerRef: { current: (() => boolean) | null };
};

const emptyForm = (): ServerProfileForm => ({ fullName: '', professionalName: '', registrationReference: '' });

export function ServerProfileSection({ service, verificationService, role, userId, onExit, onNameSaved, backHandlerRef }: Props) {
  const [snapshot, setSnapshot] = useState<ServerProfileSnapshot | null>(null);
  const [uploadedDocuments, setUploadedDocuments] = useState<ApiProfessionalDocument[]>([]);
  const [pendingUpload, setPendingUpload] = useState<{ filename: string } | null>(null);
  const [fields, setFields] = useState<ServerProfileForm>(emptyForm());
  const [savedFields, setSavedFields] = useState<ServerProfileForm>(emptyForm());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [leaveVisible, setLeaveVisible] = useState(false);

  const dirty = useMemo(() => JSON.stringify(fields) !== JSON.stringify(savedFields), [fields, savedFields]);

  const reload = useCallback(async (preservedDraft?: ServerProfileForm) => {
    setLoading(true); setError('');
    try {
      const result = await service.get(role);
      const documents = role === 'vet' ? await verificationService.listUploaded(role, userId) : [];
      const upload = role === 'vet' ? await verificationService.getPendingUpload(role, userId) : null;
      const nextFields = {
        fullName: result.profile.fullName,
        professionalName: result.role === 'vet' ? result.profile.professionalName ?? '' : '',
        registrationReference: result.role === 'vet' ? result.profile.registrationReference ?? '' : '',
      };
      setSnapshot(result); setFields(preservedDraft ?? nextFields); setSavedFields(nextFields); setUncertain(false);
      setUploadedDocuments(documents); setPendingUpload(upload ? { filename: upload.file.filename } : null);
    } catch (cause) { setError(messageFor(cause, 'Profil belum dapat dimuat.')); }
    finally { setLoading(false); }
  }, [role, service, userId, verificationService]);

  useEffect(() => {
    const request = setTimeout(() => { void reload(); }, 0);
    return () => clearTimeout(request);
  }, [reload]);

  const requestExit = useCallback(() => {
    if (busy) return true;
    if (leaveVisible) { setLeaveVisible(false); return true; }
    if (dirty) { setLeaveVisible(true); return true; }
    onExit();
    return true;
  }, [busy, dirty, leaveVisible, onExit]);

  useEffect(() => {
    backHandlerRef.current = requestExit;
    return () => { backHandlerRef.current = null; };
  }, [backHandlerRef, requestExit]);

  const save = async (exitAfter = false) => {
    if (busy || uncertain || !dirty) {
      if (exitAfter && !dirty && !busy) { setLeaveVisible(false); onExit(); }
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const profile = await service.save(role, fields);
      const next = { ...fields, fullName: profile.fullName };
      if (role === 'vet' && 'professionalName' in profile) {
        next.professionalName = profile.professionalName ?? '';
        next.registrationReference = profile.registrationReference ?? '';
      }
      setFields(next); setSavedFields(next); setSnapshot((current) => current && current.role === 'vet' && role === 'vet'
        ? { ...current, profile: { ...current.profile, ...profile, role: 'vet' } }
        : current && current.role === 'farmer' && role === 'farmer'
          ? { ...current, profile: { ...current.profile, ...profile, role: 'farmer' } }
          : current);
      onNameSaved(profile.fullName);
      setNotice('Profil tersimpan di akun server.');
      if (exitAfter) { setLeaveVisible(false); onExit(); }
    } catch (cause) {
      setError(messageFor(cause, 'Perubahan profil belum tersimpan.'));
      if (cause instanceof DomainError && cause.code === 'SERVICE_UNAVAILABLE') setUncertain(true);
    } finally { setBusy(false); }
  };

  const discardAndExit = () => { setFields(savedFields); setLeaveVisible(false); onExit(); };
  const uploadDocument = async (retryPending = false) => {
    if (busy || dirty || role !== 'vet') return;
    setBusy(true); setError(''); setNotice('');
    try {
      let document;
      if (retryPending) {
        document = await verificationService.upload(role, userId);
      } else {
        const result = await DocumentPicker.getDocumentAsync({
          type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
          multiple: false,
          copyToCacheDirectory: true,
        });
        if (result.canceled || !result.assets[0]) return;
        const asset = result.assets[0];
        document = await verificationService.upload(role, userId, {
          uri: asset.uri, filename: asset.name, mimeType: asset.mimeType ?? mimeFromFilename(asset.name), byteSize: asset.size,
        });
      }
      setUploadedDocuments((current) => current.some((item) => item.id === document.id) ? current : [...current, document]);
      setPendingUpload(null);
      setNotice('Dokumen tersimpan di akun server. Pengajuan belum dikirim.');
    } catch (cause) {
      setError(messageFor(cause, 'Dokumen belum terunggah. Muat ulang atau coba ulang file yang sama.'));
      try {
        const pending = await verificationService.getPendingUpload(role, userId);
        setPendingUpload(pending ? { filename: pending.file.filename } : null);
      } catch { /* Keep the current upload state visible if SecureStore cannot be read. */ }
    } finally { setBusy(false); }
  };

  const submitVerification = async () => {
    if (busy || role !== 'vet' || dirty || pendingUpload || uploadedDocuments.length === 0) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const submission = await verificationService.submit(role, userId);
      setUploadedDocuments([]);
      setNotice(submission.status === 'pending' ? 'Pengajuan terkirim. Status verifikasi menunggu pemeriksa.' : 'Status pengajuan diperbarui dari server.');
      await reload();
    } catch (cause) {
      const message = messageFor(cause, 'Pengajuan belum dapat dikirim. Muat ulang status sebelum mencoba lagi.');
      await reload(dirty ? fields : undefined);
      setError(message);
    }
    finally { setBusy(false); }
  };
  const status = snapshot?.role === 'vet' ? snapshot.profile.verificationStatus : null;
  const latestSubmission = snapshot?.role === 'vet' ? snapshot.submissions[0] : null;

  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>Profil server</Text>
    <Button label="Kembali" role={role} variant="secondary" disabled={busy} onPress={requestExit} />
    {loading ? <LoadingState label="Memuat profil…" /> : null}
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    {!loading && error ? <Button label="Muat ulang profil" role={role} variant="secondary" disabled={busy} onPress={() => void reload(dirty ? fields : undefined)} /> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {uncertain ? <Text style={styles.helper}>Hasil simpan belum pasti. Muat ulang profil sebelum menyimpan lagi.</Text> : null}
    {!loading && snapshot ? <>
      <TextField label="Nama lengkap" value={fields.fullName} onChangeText={(fullName) => setFields((current) => ({ ...current, fullName }))} maxLength={120} editable={!busy && !uncertain} />
      {role === 'vet' ? <>
        <TextField label="Nama praktik (opsional)" value={fields.professionalName} onChangeText={(professionalName) => setFields((current) => ({ ...current, professionalName }))} maxLength={120} editable={!busy && !uncertain} />
        <TextField label="Nomor registrasi (opsional)" value={fields.registrationReference} onChangeText={(registrationReference) => setFields((current) => ({ ...current, registrationReference }))} maxLength={120} editable={!busy && !uncertain} />
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Status verifikasi</Text>
          <Text style={styles.body}>{verificationLabel(status)}</Text>
          {latestSubmission?.reviewerReason ? <Text style={styles.helper}>Catatan pemeriksa: {latestSubmission.reviewerReason}</Text> : null}
          {status === 'pending' ? <Text style={styles.helper}>Pengajuan sedang ditinjau. Dokumen tidak dapat diubah sampai hasil pemeriksaan tersedia.</Text> : null}
          {status !== 'pending' && status !== 'verified' ? <>
            <Text style={styles.helper}>PDF, JPEG, PNG, atau WebP hingga 10 MiB. Maksimal lima dokumen.</Text>
            {uploadedDocuments.map((document) => <Text key={document.id} style={styles.helper}>{document.filename} · {formatBytes(document.byteSize)}</Text>)}
            {pendingUpload ? <View style={styles.card}>
              <Text style={styles.helper}>Hasil unggahan {pendingUpload.filename} belum pasti. Coba ulang file tersimpan dengan kunci yang sama.</Text>
              <Button label="Coba ulang unggahan" role="vet" loading={busy} disabled={busy || dirty} variant="secondary" onPress={() => void uploadDocument(true)} />
            </View> : <Button label="Pilih dan unggah dokumen" role="vet" loading={busy} disabled={busy || dirty || uploadedDocuments.length >= 5} variant="secondary" onPress={() => void uploadDocument(false)} />}
            <Button label="Ajukan verifikasi" role="vet" loading={busy} disabled={busy || dirty || pendingUpload !== null || uploadedDocuments.length === 0} onPress={() => void submitVerification()} />
          </> : null}
        </View>
      </> : null}
      <Button label="Simpan perubahan profil" role={role} loading={busy} disabled={!dirty || uncertain} onPress={() => void save()} />
    </> : null}
    <Modal transparent visible={leaveVisible} animationType="fade" onRequestClose={() => setLeaveVisible(false)}>
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.dialogTitle}>Perubahan belum tersimpan</Text>
          <Text style={styles.body}>Simpan perubahan profil sebelum kembali?</Text>
          <Button label="Simpan dan kembali" role={role} loading={busy} disabled={uncertain} onPress={() => void save(true)} />
          <Button label="Buang perubahan" role={role} variant="secondary" disabled={busy} onPress={discardAndExit} />
          <Button label="Tetap mengedit" role={role} variant="secondary" disabled={busy} onPress={() => setLeaveVisible(false)} />
        </View>
      </View>
    </Modal>
  </View>;
}

function verificationLabel(status: 'not_submitted' | 'pending' | 'revision_required' | 'verified' | null): string {
  switch (status) {
    case 'not_submitted': return 'Belum diajukan';
    case 'pending': return 'Menunggu verifikasi';
    case 'revision_required': return 'Perlu revisi';
    case 'verified': return 'Terverifikasi';
    default: return 'Tidak tersedia';
  }
}

function messageFor(cause: unknown, fallback: string): string { return cause instanceof Error ? cause.message : fallback; }
function mimeFromFilename(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase();
  return extension === 'pdf' ? 'application/pdf' : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg'
    : extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'application/octet-stream';
}
function formatBytes(value: number): string { return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`; }

const styles = StyleSheet.create({
  section: { gap: spacing[3] },
  heading: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.section },
  card: { gap: spacing[2], padding: spacing[4], backgroundColor: colors.white, borderRadius: 14 },
  cardTitle: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.body },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21 },
  helper: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 19 },
  notice: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.body },
  error: { color: colors.orange, fontFamily: fonts.medium, fontSize: typeScale.body },
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing[5], backgroundColor: 'rgba(58, 23, 13, 0.48)' },
  dialog: { alignSelf: 'center', width: '100%', maxWidth: 360, padding: spacing[5], gap: spacing[3], borderRadius: 16, backgroundColor: colors.white },
  dialogTitle: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.heading },
});
