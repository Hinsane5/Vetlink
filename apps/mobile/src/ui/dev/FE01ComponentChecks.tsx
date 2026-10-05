import { useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, type ViewProps } from 'react-native';
import {
  AppointmentRow,
  Button,
  ChatBubble,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  InlineFeedback,
  LoadingState,
  StatusBadge,
  TextArea,
  TextField,
} from '../components';
import { colors, fonts, spacing, typeScale } from '../theme/tokens';

const longMessage =
  'Saya ingin menjadwalkan konsultasi untuk memeriksa kondisi ternak. Waktu yang saya pilih mungkin perlu disesuaikan setelah dokter melihat jadwal dan lokasi kunjungan.';

export function FE01ComponentChecks() {
  const [dialogVisible, setDialogVisible] = useState(false);
  const [selected, setSelected] = useState(false);
  const [fieldValue, setFieldValue] = useState('Kandang utama');
  const [areaValue, setAreaValue] = useState(longMessage);
  const [event, setEvent] = useState('Ketuk kontrol untuk memeriksa responsnya.');
  const scrollRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Record<string, number>>({});

  const jumpTo = (section: string) => {
    scrollRef.current?.scrollTo({ y: sectionOffsets.current[section] ?? 0, animated: false });
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>FE-01 · Pemeriksaan komponen</Text>
          <Text style={styles.subtitle}>Katalog diagnostik development; tidak tampil di build produk.</Text>
        </View>

        <InlineFeedback message={event} tone="info" />

        <View style={styles.jumpLinks}>
          <Button label="Lihat input" role="farmer" variant="secondary" onPress={() => jumpTo('inputs')} style={styles.jumpButton} />
          <Button label="Lihat pesan" role="farmer" variant="secondary" onPress={() => jumpTo('messages')} style={styles.jumpButton} />
          <Button label="Lihat dialog" role="farmer" variant="secondary" onPress={() => jumpTo('dialog')} style={styles.jumpButton} />
        </View>

        <Section title="Tombol · Peternak dan Dokter">
          <Button label="Tombol utama Peternak" role="farmer" onPress={() => setEvent('Tombol utama Peternak merespons sentuhan.')} />
          <Button label="Tombol utama Dokter" role="vet" onPress={() => setEvent('Tombol utama Dokter merespons sentuhan.')} />
          <Button label="Tombol sekunder" role="farmer" variant="secondary" onPress={() => setEvent('Tombol sekunder merespons sentuhan.')} />
          <Button label="Aksi aksen" role="vet" variant="accent" onPress={() => setEvent('Tombol aksen merespons sentuhan.')} />
          <Button label="Status terpilih" role="farmer" selected={selected} onPress={() => setSelected((value) => !value)} />
          <Button label="Tidak tersedia" role="farmer" disabled onPress={() => setEvent('Tombol nonaktif tidak boleh menjalankan aksi.')} />
          <Button label="Sedang memuat" role="vet" loading loadingLabel="Menyimpan…" onPress={() => setEvent('Tombol memuat berstatus sibuk.')} />
        </Section>

        <Section title="Status dan baris layanan">
          <View style={styles.badges}>
            <StatusBadge label="Terjadwal" role="farmer" />
            <StatusBadge label="Menunggu" role="farmer" tone="pending" />
            <StatusBadge label="Selesai" role="vet" tone="success" />
            <StatusBadge label="Perlu ditinjau" role="vet" tone="error" />
          </View>
          <AppointmentRow
            title="Pemeriksaan rutin ternak di kandang utama"
            description="Lokasi: Desa Sukamaju, Kecamatan Cibiru"
            dateLabel="Senin, 12 Oktober · 09.30"
            statusLabel="Menunggu konfirmasi"
            statusTone="pending"
            role="farmer"
            onPress={() => setEvent('Baris layanan merespons sentuhan.')}
          />
        </Section>

        <Section title="Input dan teks panjang" onLayout={(event) => { sectionOffsets.current.inputs = event.nativeEvent.layout.y; }}>
          <TextField
            label="Nama lokasi"
            value={fieldValue}
            onChangeText={setFieldValue}
            helperText="Masukkan nama lokasi dengan jelas; teks bantuan ini menguji pemenggalan baris pada layar sempit."
            placeholder="Nama lokasi"
            returnKeyType="done"
          />
          <TextField label="Nomor kontak" value="" editable={false} readOnly helperText="Bidang hanya baca." />
          <TextField label="Validasi" value="" onChangeText={() => undefined} errorText="Periksa kembali informasi yang dimasukkan sebelum melanjutkan." />
          <TextArea
            label="Catatan konsultasi"
            value={areaValue}
            onChangeText={setAreaValue}
            helperText="Bidang teks panjang dapat digulir dan tetap bisa diketik."
            placeholder="Tulis catatan"
          />
        </Section>

        <Section title="Pesan dan umpan balik" onLayout={(event) => { sectionOffsets.current.messages = event.nativeEvent.layout.y; }}>
          <ChatBubble message={longMessage} author="Peternak" timeLabel="09.30" direction="incoming" />
          <ChatBubble message="Baik, saya akan meninjau jadwal dan memberikan kabar." author="Dokter" timeLabel="09.32" direction="outgoing" />
          <ChatBubble message="Pesan belum terkirim. Periksa koneksi lalu coba lagi." author="Peternak" timeLabel="09.33" direction="incoming" deliveryState="failed" onRetry={() => setEvent('Aksi kirim ulang dapat dijangkau.')} />
          <InlineFeedback message="Perubahan tersimpan." tone="success" />
          <InlineFeedback message="Tidak dapat memuat informasi saat ini." tone="error" />
          <LoadingState label="Memuat jadwal…" />
          <EmptyState title="Belum ada jadwal" description="Jadwal layanan akan tampil di bagian ini setelah tersedia." role="farmer" actionLabel="Periksa tindakan" onAction={() => setEvent('Aksi pada state kosong merespons sentuhan.')} />
          <ErrorState message="Jadwal belum dapat dimuat." role="vet" retryLabel="Coba lagi" onRetry={() => setEvent('Aksi coba lagi merespons sentuhan.')} />
        </Section>

        <Section title="Dialog dan navigasi kembali" onLayout={(event) => { sectionOffsets.current.dialog = event.nativeEvent.layout.y; }}>
          <Button label="Buka dialog konfirmasi" role="farmer" onPress={() => setDialogVisible(true)} />
          <Text style={styles.note}>Dialog memakai tombol perangkat kembali untuk menutup; aksi konfirmasi hanya mengubah catatan diagnostik ini.</Text>
        </Section>
      </ScrollView>

      <ConfirmationDialog
        visible={dialogVisible}
        title="Tinjau permintaan"
        message={`${longMessage} ${longMessage}`}
        role="farmer"
        confirmLabel="Konfirmasi"
        cancelLabel="Kembali"
        onConfirm={() => {
          setEvent('Konfirmasi dialog merespons sentuhan.');
          setDialogVisible(false);
        }}
        onCancel={() => setDialogVisible(false)}
      />
    </View>
  );
}

function Section({ title, children, onLayout }: { title: string; children: ReactNode; onLayout?: ViewProps['onLayout'] }) {
  return (
    <View onLayout={onLayout} style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  content: { paddingHorizontal: spacing[5], paddingTop: spacing[8], paddingBottom: 52, gap: spacing[6] },
  header: { gap: spacing[2] },
  title: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.title, lineHeight: 31, flexShrink: 1 },
  subtitle: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 20 },
  section: { gap: spacing[3] },
  sectionTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.section, lineHeight: 26, flexShrink: 1 },
  sectionContent: { gap: spacing[3] },
  jumpLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  jumpButton: { flexGrow: 1, flexBasis: '30%', minWidth: 108, minHeight: 44 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  note: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 18 },
});
