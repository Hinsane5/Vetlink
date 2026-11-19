import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import type { ServerProfileForm, ServerProfileService, ServerProfileSnapshot } from '../../application/ServerProfileService';
import type { AccountRole } from '../../domain/auth';
import { DomainError } from '../../domain/errors';
import { Button } from '../components/Button';
import { LoadingState } from '../components/Feedback';
import { TextField } from '../components/TextField';
import { colors, fonts, spacing, typeScale } from '../theme/tokens';

type Props = {
  service: ServerProfileService;
  role: AccountRole;
  onExit: () => void;
  onNameSaved: (name: string) => void;
  backHandlerRef: { current: (() => boolean) | null };
};

const emptyForm = (): ServerProfileForm => ({ fullName: '', professionalName: '', registrationReference: '' });

export function ServerProfileSection({ service, role, onExit, onNameSaved, backHandlerRef }: Props) {
  const [snapshot, setSnapshot] = useState<ServerProfileSnapshot | null>(null);
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
      const nextFields = {
        fullName: result.profile.fullName,
        professionalName: result.role === 'vet' ? result.profile.professionalName ?? '' : '',
        registrationReference: result.role === 'vet' ? result.profile.registrationReference ?? '' : '',
      };
      setSnapshot(result); setFields(preservedDraft ?? nextFields); setSavedFields(nextFields); setUncertain(false);
    } catch (cause) { setError(messageFor(cause, 'Profil belum dapat dimuat.')); }
    finally { setLoading(false); }
  }, [role, service]);

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
          <Text style={styles.helper}>Unggah dokumen dan pengajuan verifikasi belum tersedia pada layar ini.</Text>
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
