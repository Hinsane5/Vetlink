import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AccountRole } from '../../domain/auth';
import { DomainError } from '../../domain/errors';
import type { ApiConsultationDetail } from '../../application/ports/ApiConsultationRepository';
import type { ApiConsultationReview } from '../../application/ports/ApiReviewRepository';
import type { ServerReviewService } from '../../application/ServerReviewService';
import { Button } from '../components/Button';
import { LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { TextArea } from '../components/TextField';
import { colors, fonts, radii, spacing, typeScale } from '../theme/tokens';

export function ServerConsultationReviewSection({ service, consultation, role, userId, onExit, backHandlerRef }: {
  service: ServerReviewService;
  consultation: ApiConsultationDetail;
  role: AccountRole;
  userId: string;
  onExit: () => void;
  backHandlerRef: { current: (() => boolean) | null };
}) {
  const [review, setReview] = useState<ApiConsultationReview | null>(null);
  const [stars, setStars] = useState(0);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [leaveVisible, setLeaveVisible] = useState(false);
  const inFlight = useRef(false);
  const dirty = !review && (stars > 0 || text.length > 0);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReview(await service.load(role, userId, consultation));
      setUncertain(false);
    } catch (cause) {
      setError(messageFor(cause, 'Ulasan belum dapat dimuat.'));
    } finally {
      setLoading(false);
    }
  }, [consultation, role, service, userId]);

  useEffect(() => {
    const timer = setTimeout(() => { void reload(); }, 0);
    return () => clearTimeout(timer);
  }, [reload]);

  const back = useCallback(() => {
    if (busy) return true;
    if (dirty) setLeaveVisible(true);
    else onExit();
    return true;
  }, [busy, dirty, onExit]);

  useEffect(() => {
    backHandlerRef.current = back;
    return () => { backHandlerRef.current = null; };
  }, [back, backHandlerRef]);

  const submit = async () => {
    if (inFlight.current || loading || uncertain || busy || stars < 1 || review) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await service.submit(role, userId, consultation, stars, text);
      setReview(saved);
      setUncertain(false);
    } catch (cause) {
      if (cause instanceof DomainError && cause.code === 'SERVICE_UNAVAILABLE') setUncertain(true);
      setError(cause instanceof DomainError
        ? cause.message
        : 'Ulasan belum dapat disimpan. Muat ulang status sebelum mencoba lagi.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return <View style={styles.root}>
    <View style={styles.header}>
      <Button role="farmer" variant="secondary" label="Kembali" disabled={busy} onPress={back} />
      <Text accessibilityRole="header" style={styles.title}>{review ? 'Ulasan layanan' : 'Beri rating'}</Text>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {loading ? <LoadingState label="Memuat ulasan layanan…" /> : error && !review && !dirty && !uncertain
        ? <View style={styles.card}><Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text><Button role="farmer" variant="secondary" label="Coba muat ulang" onPress={() => { void reload(); }} /></View>
        : <View style={styles.card}>
          <Text style={styles.heading}>Layanan {consultation.displayCode}</Text>
          <Text style={styles.body}>{review ? 'Ulasan Anda tersimpan di server.' : 'Bagaimana pengalaman Anda dengan layanan ini?'}</Text>
          {review ? <>
            <StarDisplay stars={review.stars} />
            <Text style={styles.body}>{review.text || 'Tanpa komentar'}</Text>
            <Text style={styles.muted}>Dikirim {formatDate(review.submittedAt)}</Text>
          </> : <>
            <StarPicker stars={stars} disabled={busy || loading || uncertain} onSelect={setStars} />
            <Text style={styles.helper}>{stars ? `Dipilih ${stars} dari 5 bintang` : 'Pilih 1–5 bintang.'}</Text>
            <TextArea label="Ulasan (opsional)" accessibilityLabel="Ulasan layanan" value={text} editable={!busy && !loading && !uncertain} maxLength={1000} helperText="Maksimal 1.000 karakter." onChangeText={setText} />
            {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
            {uncertain
              ? <Button role="farmer" variant="secondary" label="Muat ulang status ulasan" disabled={busy || loading} onPress={() => { void reload(); }} />
              : <Button role="farmer" label="Kirim ulasan" loading={busy} disabled={!stars || loading} onPress={() => { void submit(); }} />}
          </>}
          {review ? <Button role="farmer" label="Kembali ke layanan" onPress={onExit} /> : null}
        </View>}
      <Button role="farmer" variant="secondary" label="Kembali ke konsultasi" disabled={busy} onPress={back} />
    </ScrollView>
    <Modal visible={leaveVisible} transparent animationType="fade" onRequestClose={() => { if (!busy) setLeaveVisible(false); }}>
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.heading}>Ulasan belum dikirim</Text>
          <Text style={styles.body}>Perubahan ulasan ini belum tersimpan.</Text>
          <Button role="farmer" variant="secondary" label="Buang perubahan" disabled={busy} onPress={() => { setLeaveVisible(false); onExit(); }} />
          <Button role="farmer" label="Tetap mengedit" disabled={busy} onPress={() => setLeaveVisible(false)} />
        </View>
      </View>
    </Modal>
  </View>;
}

function StarPicker({ stars, disabled, onSelect }: { stars: number; disabled: boolean; onSelect: (value: number) => void }) {
  return <View accessibilityLabel="Pilih nilai rating" style={styles.starRow}>
    {[1, 2, 3, 4, 5].map((value) => <Pressable
      key={value}
      accessibilityRole="radio"
      accessibilityLabel={`${value} dari 5 bintang`}
      accessibilityState={{ selected: stars === value, disabled }}
      disabled={disabled}
      onPress={() => onSelect(value)}
      style={({ pressed }) => [styles.starButton, stars === value && styles.starSelected, pressed && !disabled && styles.pressed]}
    ><Icon name="star" size={25} color={stars >= value ? colors.brown : colors.muted} /></Pressable>)}
  </View>;
}

function StarDisplay({ stars }: { stars: number }) {
  return <View accessibilityLabel={`${stars} dari 5 bintang`} style={styles.starRow}>
    {[1, 2, 3, 4, 5].map((value) => <View key={value} style={[styles.starButton, value <= stars && styles.starDisplaySelected]}><Icon name="star" size={23} color={value <= stars ? colors.brown : colors.gold} /></View>)}
    <Text style={styles.ratingText}>{stars} / 5</Text>
  </View>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(value));
}

function messageFor(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

const styles = StyleSheet.create({
  root: { gap: spacing[3] },
  header: { gap: spacing[2], paddingHorizontal: spacing[4] },
  title: { color: colors.brown, fontFamily: fonts.bold, fontSize: 21 },
  content: { gap: spacing[4], paddingHorizontal: spacing[4], paddingBottom: spacing[6] },
  card: { gap: spacing[3], padding: spacing[4], backgroundColor: colors.white, borderRadius: radii.cardFarmer },
  heading: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.section, lineHeight: 24 },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22 },
  muted: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small },
  helper: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 18 },
  error: { color: colors.brown, fontFamily: fonts.medium, lineHeight: 21 },
  starRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[1], minHeight: 52 },
  starButton: { minWidth: 48, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  starSelected: { backgroundColor: colors.gold },
  starDisplaySelected: { backgroundColor: colors.white },
  ratingText: { marginLeft: spacing[2], color: colors.brown, fontFamily: fonts.semiBold },
  pressed: { opacity: 0.75 },
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing[5], backgroundColor: 'rgba(32, 20, 16, 0.55)' },
  dialog: { gap: spacing[3], padding: spacing[4], backgroundColor: colors.cream, borderRadius: radii.cardFarmer },
});
