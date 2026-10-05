import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { runFE02PersistenceProbe, type PersistenceProbeResult } from '../../data/local/sqlite/FE02PersistenceProbe';
import { useLocalStore } from '../../application/LocalStoreContext';
import { colors, fonts, spacing, typeScale } from '../theme/tokens';

export function FE02StorageChecks() {
  const store = useLocalStore();
  const [result, setResult] = useState<PersistenceProbeResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    runFE02PersistenceProbe(store).then(
      (value) => {
        if (active) setResult(value);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [store]);

  const headline = failed
    ? 'Pemeriksaan penyimpanan gagal'
    : result?.status === 'passed'
      ? 'Persistensi setelah restart lulus'
      : result?.status === 'awaiting-restart'
        ? 'Perubahan tersimpan; tutup lalu buka ulang aplikasi'
        : 'Memeriksa database lokal…';

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.heading}>FE-02 · Diagnostik penyimpanan</Text>
      <Text accessibilityRole="summary" style={styles.headline}>{headline}</Text>
      {result ? (
        <Text style={styles.details}>
          Seed: {result.seedStatus} · schema {result.schemaVersion}{'\n'}
          Data: {result.entityCount} entitas · {result.relationCount} relasi{'\n'}
          Draft: {result.draftStatus} · versi {result.draftVersion}{'\n'}
          Event: {result.eventProbe}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[4],
    padding: spacing[6],
    backgroundColor: colors.cream,
  },
  heading: {
    color: colors.brown,
    fontFamily: fonts.bold,
    fontSize: typeScale.section,
    textAlign: 'center',
  },
  headline: {
    color: colors.dark,
    fontFamily: fonts.semiBold,
    fontSize: typeScale.body,
    textAlign: 'center',
  },
  details: {
    color: colors.dark,
    fontFamily: fonts.regular,
    fontSize: typeScale.body,
    lineHeight: 25,
    textAlign: 'center',
  },
});
