import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AccountRole } from '../../domain/auth';
import { Button } from '../components/Button';
import { colors, fonts, roleTokens, spacing, typeScale } from '../theme/tokens';

type Props = {
  role: AccountRole;
  onExit: () => void;
  backHandlerRef: { current: (() => boolean) | null };
};

const entries = [
  {
    id: 'consultation',
    title: 'Bagaimana membuka detail layanan?',
    body: 'Buka Kotak Masuk atau Konsultasi, lalu pilih pembaruan yang ingin dilihat. Dokter hanya dapat membuka pasien yang terhubung dengan layanannya.',
  },
  {
    id: 'reminder',
    title: 'Apa bedanya pengingat dan tindak lanjut?',
    body: 'Pengingat memiliki status pengiriman dan status perawatan. Jadwal tindak lanjut dan laporan perkembangan Peternak tersimpan sebagai catatan terpisah.',
  },
  {
    id: 'preferences',
    title: 'Apa yang berubah saat preferensi dimatikan?',
    body: 'Preferensi mengatur kategori pembaruan. Notifikasi yang sudah tersimpan tetap dapat dibaca di Kotak Masuk.',
  },
  {
    id: 'role',
    title: 'Bagaimana mengganti peran?',
    body: 'Pilih Ganti Peran pada halaman akun. Pilihan peran tidak menambah hak akses akun.',
  },
] as const;

export function ServerHelpSection({ role, onExit, backHandlerRef }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const back = useCallback(() => {
    onExit();
    return true;
  }, [onExit]);

  useEffect(() => {
    backHandlerRef.current = back;
    return () => { backHandlerRef.current = null; };
  }, [back, backHandlerRef]);

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>Bantuan</Text>
      <Text style={styles.description}>Panduan singkat penggunaan VetLink.</Text>
      {entries.map((entry) => {
        const expanded = openId === entry.id;
        return (
          <Pressable
            key={entry.id}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => setOpenId(expanded ? null : entry.id)}
            style={({ pressed }) => [styles.card, { borderRadius: roleTokens[role].cardRadius }, pressed && styles.pressed]}
          >
            <Text style={styles.question}>{entry.title}</Text>
            {expanded ? <Text style={styles.answer}>{entry.body}</Text> : null}
          </Pressable>
        );
      })}
      <Button label="Kembali ke akun" role={role} variant="secondary" onPress={onExit} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing[4] },
  title: { color: colors.dark, fontFamily: fonts.bold, fontSize: typeScale.heading },
  description: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22 },
  card: { backgroundColor: colors.white, borderColor: '#E9DCC0', borderWidth: 1, gap: spacing[3], minHeight: 52, padding: spacing[4] },
  question: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.body, lineHeight: 21 },
  answer: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22 },
  pressed: { opacity: 0.82 },
});
