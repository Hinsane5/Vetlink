import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { SessionSnapshot } from '../../domain/auth';
import type { ReviewContext } from '../../application/ReviewService';
import { reviewTextLimit } from '../../domain/reviews';
import { DomainError } from '../../domain/errors';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, InlineFeedback, LoadingState } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { TextArea } from '../components/TextField';
import { colors, fonts, radii, spacing, typeScale } from '../theme/tokens';

export function ReviewFlow({ store, session, consultationId, onExit }: { store: LocalStore; session: SessionSnapshot; consultationId: string; onExit: () => void }) {
  const role = session.activeRole;
  const [context, setContext] = useState<ReviewContext | null>(null);
  const [stars, setStars] = useState(0);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [leave, setLeave] = useState(false);
  const [savedNow, setSavedNow] = useState(false);
  const locked = useRef(false);
  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try { setContext(await store.reviews.load(session.userId, role, consultationId)); }
    catch (cause) { setContext(null); setError(message(cause)); }
    finally { setLoading(false); }
  }, [consultationId, role, session.userId, store]);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);

  const dirty = !context?.review && (stars > 0 || text.length > 0);
  const back = useCallback(() => {
    if (busy) return;
    if (dirty) setLeave(true); else onExit();
  }, [busy, dirty, onExit]);
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => handler.remove();
  }, [back]);

  const submit = async () => {
    if (locked.current || stars < 1 || stars > 5) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await store.reviews.submit(session.userId, role, consultationId, stars, text);
      setContext(saved);
      setSavedNow(true);
    } catch (cause) { setError(message(cause)); }
    finally { locked.current = false; setBusy(false); }
  };

  const existing = context?.review;
  return <View style={styles.root}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Kembali" disabled={busy} onPress={back} style={styles.back}><Icon name="arrow-left" color={colors.brown} size={22} /></Pressable>
      <Text accessibilityRole="header" style={styles.title}>{existing ? 'Ulasan layanan' : 'Beri rating'}</Text>
    </View>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {loading ? <LoadingState label="Memuat layanan…" /> : error && !context ? <ErrorState role="farmer" message={error} onRetry={() => { void load(); }} /> : !context ? <EmptyState role="farmer" title="Ulasan tidak tersedia" description="Layanan ini tidak dapat diulas." /> : <>
          <View style={styles.card}>
            <Text style={styles.heading}>{context.veterinarianName}</Text>
            <Text style={styles.body}>Layanan {String(context.consultation.payload.displayCode ?? consultationId)}</Text>
            {existing ? <>
              <Text accessibilityRole="header" style={styles.sectionTitle}>{savedNow ? 'Terima kasih, ulasan Anda tersimpan.' : 'Ulasan Anda sudah tersimpan.'}</Text>
              <StarDisplay stars={Number(existing.payload.stars)} />
              <Text style={styles.body}>{String(existing.payload.text || 'Tanpa komentar')}</Text>
              <Button role="farmer" label="Kembali ke layanan" onPress={onExit} />
            </> : <>
              <Text style={styles.body}>Bagaimana pengalaman Anda dengan layanan ini?</Text>
              <StarPicker stars={stars} onSelect={setStars} disabled={busy} />
              <Text style={styles.helper}>{stars ? `Dipilih ${stars} dari 5 bintang` : 'Pilih 1–5 bintang.'}</Text>
              <TextArea label="Ulasan (opsional)" accessibilityLabel="Ulasan layanan" value={text} editable={!busy} maxLength={reviewTextLimit} helperText={`Maksimal ${reviewTextLimit} karakter.`} onChangeText={setText} />
              {error ? <InlineFeedback tone="error" message={error} /> : null}
              <Button role="farmer" label="Kirim ulasan" loading={busy} disabled={!stars} onPress={() => { void submit(); }} />
            </>}
          </View>
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
    <Modal visible={leave} transparent animationType="fade" onRequestClose={() => { if (!busy) setLeave(false); }}>
      <SafeAreaProvider><SafeAreaView style={styles.backdrop}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.dialog}>
        <Text style={styles.heading}>Ulasan belum dikirim</Text>
        <Text style={styles.body}>Perubahan ulasan ini belum tersimpan.</Text>
        {error ? <InlineFeedback message={error} tone="error" /> : null}
        <Button role="farmer" label="Buang perubahan" variant="secondary" disabled={busy} onPress={() => { setLeave(false); onExit(); }} />
        <Button role="farmer" label="Tetap mengedit" disabled={busy} onPress={() => setLeave(false)} />
      </ScrollView></KeyboardAvoidingView></SafeAreaView></SafeAreaProvider>
    </Modal>
  </View>;
}

function StarPicker({ stars, disabled, onSelect }: { stars: number; disabled: boolean; onSelect: (stars: number) => void }) {
  return <View accessibilityLabel="Pilih nilai rating" style={styles.starRow}>
    {[1, 2, 3, 4, 5].map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={`${value} dari 5 bintang`} accessibilityState={{ selected: stars === value, disabled }} disabled={disabled} onPress={() => onSelect(value)} style={({ pressed }) => [styles.starButton, stars === value && styles.starSelected, pressed && !disabled && styles.pressed]}>
      <Icon name="star" size={25} color={stars >= value ? colors.brown : colors.muted} />
    </Pressable>)}
  </View>;
}

function StarDisplay({ stars }: { stars: number }) {
  return <View accessibilityLabel={`${stars} dari 5 bintang`} style={styles.starRow}>
    {[1, 2, 3, 4, 5].map((value) => <View key={value} style={[styles.starButton, value <= stars && styles.starDisplaySelected]}><Icon name="star" size={23} color={value <= stars ? colors.brown : colors.gold} /></View>)}
    <Text style={styles.ratingText}>{stars} / 5</Text>
  </View>;
}

function message(cause: unknown) { return cause instanceof DomainError ? cause.message : 'Ulasan belum dapat dimuat atau disimpan. Coba lagi.'; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing[4], gap: spacing[3] },
  back: { minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.white, borderRadius: radii.button },
  title: { flex: 1, fontFamily: fonts.bold, color: colors.brown, fontSize: 22, flexShrink: 1 },
  content: { padding: spacing[4], gap: spacing[4], width: '100%', maxWidth: 480, alignSelf: 'center', flexGrow: 1 },
  card: { backgroundColor: colors.white, padding: spacing[4], borderRadius: radii.cardFarmer, gap: spacing[3] },
  heading: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: 19, lineHeight: 26, flexShrink: 1 },
  sectionTitle: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.section, lineHeight: 24, flexShrink: 1 },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22, flexShrink: 1 },
  helper: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 18 },
  starRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[1], minHeight: 52 },
  starButton: { minWidth: 48, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  starSelected: { backgroundColor: colors.gold },
  starDisplaySelected: { backgroundColor: colors.cream },
  ratingText: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.label, marginLeft: spacing[2] },
  pressed: { opacity: 0.78 },
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing[5], backgroundColor: 'rgba(58,23,13,0.5)' },
  dialog: { backgroundColor: colors.white, padding: spacing[5], borderRadius: radii.cardFarmer, gap: spacing[3] },
});
