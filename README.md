# VetLink

Aplikasi mobile berbahasa Indonesia untuk pengelolaan kesehatan ternak, konsultasi dokter hewan, kunjungan, dan pembelian produk kesehatan hewan.

**Fokus saat ini: flow frontend Android tanpa autentikasi dan tanpa backend jaringan.** Aplikasi membuka “Pilih Peran”, lalu langsung menampilkan data fiktif lokal untuk Peternak atau Dokter. FE-06 menyediakan pengelolaan ternak; FE-07 riwayat kesehatan dan pasien; FE-08 direktori/profil dokter, pencarian, filter, tarif, jadwal 7 hari, dan ulasan; FE-09 booking chat/kunjungan, draft, media dan review biaya; FE-10 respons layanan, usulan jadwal, dan riwayat; FE-11 editor ketersediaan/tarif/blok serta kalender harian/mingguan. FE-00/02 selesai; FE-01/03/04/05/06/07/08/09/10/11 sedang dikerjakan karena penerimaan visual dan interaksi perangkat belum lengkap. `npm run check` terakhir lulus typecheck, lint dan 70 tes; export Android terbaru membundle 746 modul. Xiaomi memuat bundle sampai Pilih/Ganti Peran dan screenshot disimpan, tetapi MIUI menolak tap ADB. Interaksi layar FE-06–11 dan pembandingan visual produk belum dapat dinyatakan lulus. Lihat [catatan Testing](docs/TESTING.md) untuk bukti serta batas QA.

## Arah yang telah dipilih

- Mobile: React Native + Expo + TypeScript; target pertama Android. Kode aplikasi tidak menggunakan Kotlin.
- Tahap frontend memakai persona fixture lokal melalui “Pilih Peran”. Layar daftar/masuk/reset/keluar FE-03 tidak dipasang pada alur aktif; backend jaringan belum dibuat.
- Sumber data awal lokal persisten memakai `expo-sqlite`; backend menyusul melalui kontrak repository yang sama.
- Chat, pembayaran, pengiriman, notifikasi, dan pencairan menggunakan layanan simulasi pada tahap lokal.
- Framework backend, hosting, provider produksi, versi backend, dan dependency backend belum ditetapkan.
- Figma utama terdokumentasi: [VetLink](https://www.figma.com/design/f1WBeG5S1OGXlPXyVEHjuW/Untitled), halaman `01 · VetLink / Prototype` (`0:1`). Untuk inspeksi FE-07 digunakan link terbaru yang diberikan pengguna: [VetLink — referensi FE-07](https://www.figma.com/design/TPG6qZunK9EY4z1Vy0GKDx/Untitled?node-id=93-7181&t=hYv9JEpqvZmEonSz-), khusus node daftar/detail pasien Dokter. Bukti dan pemetaan ada di [Figma mapping](docs/FIGMA_MAPPING.md).

## Versi mobile dan development build

| Bagian | Versi / konfigurasi |
| --- | --- |
| Expo SDK | `~57.0.26` |
| React Native / React | `0.86.3` / `19.2.3` |
| TypeScript | `~6.0.3` |
| Development client | `expo-dev-client ~57.0.19` |
| Database FE-02 | `expo-sqlite ~57.0.3` |
| Crypto FE-03 | `expo-crypto ~57.0.3` |
| Credential/sesi FE-03 | `expo-secure-store ~57.0.4` |
| Foto, dokumen, file lokal FE-04 | `expo-image-picker ~57.0.20`, `expo-document-picker ~57.0.3`, `expo-file-system ~57.0.7` |
| Node.js / npm di lingkungan pengerjaan | `24.1.0` / `11.3.0` |
| Package manager / lockfile | npm / `apps/mobile/package-lock.json` |
| Safe area FE-08 | `react-native-safe-area-context ~5.7.0` |
| Font/icon FE-01 | `expo-font ~57.0.4`, Inter lokal (OFL), `@react-native-vector-icons/lucide ^13.1.4` |
| Android application ID | `com.vetlink.mobile` (sementara untuk build lokal; belum ID rilis) |

Expo SDK 57 mensyaratkan Node.js 22.13 atau lebih baru. Periksa [panduan Expo](https://docs.expo.dev/versions/latest/) dan gunakan versi Node LTS yang didukung. Native project Android dihasilkan Expo saat prebuild dan diabaikan Git; tidak ada kode Kotlin aplikasi buatan tangan. Komponen memakai satu keluarga ikon Lucide; glyph Figma akan dipetakan bertahap saat screen dibangun.

## Komponen FE-01

Design tokens per peran berada di `apps/mobile/src/ui/theme/tokens.ts`. Komponen reusable yang tersedia: `Button`, `TextField`, `TextArea`, `StatusBadge`, `AppointmentRow`, `ChatBubble`, `ConfirmationDialog`, `EmptyState`, `LoadingState`, `ErrorState`, dan `InlineFeedback`, diekspor dari `apps/mobile/src/ui/components`. Tinggi minimum tombol Peternak 52 dp dan Dokter 48 dp; label dan konten menggunakan ukuran minimum yang dapat tumbuh, dengan font scaling aktif.

## Menjalankan aplikasi

Perintah berikut dijalankan dari root project mobile:

```sh
cd apps/mobile
npm ci
npm run check
npm run android
```

`npm run android` menjalankan `expo run:android`: Expo membuat native project Android bila belum ada, mengompilasi development build, memasangnya ke emulator/perangkat, dan memulai Metro. Setelah development build terpasang, `npm run start` menjalankan Metro untuk iterasi TypeScript berikutnya. Konfigurasi profil EAS `development` tersedia di `apps/mobile/eas.json`; build EAS belum dijalankan.

Persyaratan build lokal: Android Studio, Android SDK dan Platform Tools terpasang, `ANDROID_HOME` atau `ANDROID_SDK_ROOT` menunjuk ke direktori SDK yang ada, JDK yang kompatibel dengan Android Gradle Plugin, serta emulator aktif atau perangkat Android dengan USB debugging. Belum ada file `.env` yang dibutuhkan.

SDK tersedia di mount `/Volumes/HowSSD/AndroidStudio/SDK/sdk`. ADB mendeteksi HP Xiaomi `2311DRK48G` melalui USB; simulator tetap tertutup sesuai permintaan. [Screenshot smoke test FE-00](docs/reference/android/fe00-phone-launch.png) dan hasil pemeriksaan rinci tersedia di [catatan pengujian](docs/TESTING.md).

Saat aplikasi terbuka, pilih Peternak atau Dokter Hewan lalu tekan “Lanjut”. Peternak memakai profil fiktif Budi dan Dokter memakai profil fiktif Yuda; keduanya membaca penyimpanan lokal yang sama. Tidak diperlukan credential atau layanan backend. Data yang diubah lewat form tersimpan pada SQLite perangkat. Implementasi FE-03 lama masih berada di source untuk riwayat pekerjaan, tetapi tidak digunakan oleh alur aplikasi aktif. Perintah reset database belum disediakan.

Untuk melihat FE-07: sebagai Peternak buka **Ternak → detail ternak → Riwayat Kesehatan**; sebagai Dokter buka tab **Pasien → detail pasien**. Menu pada beranda kedua peran menyediakan **Ganti Peran**.

Untuk melihat FE-08: pilih **Peternak → Konsultasi → pilih dokter**. Pencarian nama dan filter jenis ternak/layanan/lokasi/availability/tarif maksimum dapat digabungkan. Detail memakai ID dokter yang dipilih; layanan, tarif aktif, badge verifikasi, pengalaman, dan ulasan berasal dari record lokal. Jadwal membaca aturan mingguan dalam zona waktu dokter dan menghindari konsultasi, blocked time, serta tindak lanjut yang terjadwal. Tombol Booking konsultasi membuka FE-09 untuk dokter terverifikasi yang menerima permintaan. Tombol **Konsultasi saya** pada beranda tetap membuka layanan milik Peternak.

Untuk melihat FE-09: **Peternak → Konsultasi → dokter → Booking konsultasi**. Pilih layanan, ternak milik Anda, tanggal/jam tersedia, isi keluhan dan alamat untuk kunjungan, lalu pilih foto/video bila diperlukan. **Simpan draft** mempertahankan form setelah aplikasi dibuka ulang; kembali dengan perubahan menawarkan Simpan draft/Buang/Tetap mengedit. Draft dilanjutkan dari dokter yang sama. **Tinjau biaya → Konfirmasi booking** menyimpan konsultasi dan quote secara atomik; hasil berstatus **Menunggu pembayaran**, kemudian **Lihat detail booking** membuka ID konsultasi yang dibuat. Biaya juga tampil pada detail dan daftar Konsultasi saya membaca record yang sama. FE-19 belum menyediakan pembayaran; konfirmasi booking tidak memotong saldo, membuat payment succeeded, mengaktifkan chat, atau membuat janji diterima.

Untuk melihat FE-11: pilih **Dokter Hewan → Jadwal → ikon pengaturan**. Edit penerimaan permintaan, zona waktu, jam kerja per hari, layanan, durasi/tarif, dan blok waktu, lalu **Simpan Pengaturan**. Dokter belum terverifikasi tidak dapat menerima permintaan baru. Kalender mendukung tampilan hari dan minggu; memilih agenda layanan membuka detail FE-10. Janji yang telah diterima tetap ada ketika penerimaan atau jam kerja berubah.

Data fiktif FE-08 disimpan pada SQLite yang sama. Instalasi dengan seed `fe02-v1` mendapat ekstensi `fe08-v1` satu kali: hanya field profil/jadwal yang belum ada ditambahkan, disertai satu ulasan fiktif atas konsultasi selesai. Nilai yang sudah disimpan, termasuk availability off, daftar kosong yang sengaja disimpan, dan lokasi hasil edit, dipertahankan. Tidak ada akun atau layanan jaringan baru.

## Panduan dokumen

| Dokumen | Isi |
| --- | --- |
| [PRD](docs/PRD.md) | Sasaran, scope, perjalanan pengguna, aturan produk |
| [Features](docs/FEATURES.md) | Seluruh 20 fitur Peternak dan 18 fitur Dokter |
| [Architecture](docs/ARCHITECTURE.md) | Lapisan mobile, repository lokal, rancangan backend |
| [Tech](docs/TECH.md) | Stack mobile, dependency aktual FE-00–02, kandidat backend, keputusan terbuka |
| [Figma mapping](docs/FIGMA_MAPPING.md) | Fitur → node → route → komponen → state; selisih referensi |
| [Data model](docs/DATA_MODEL.md) | Entitas, relasi, status, invariant, fixture |
| [API contract](docs/API_CONTRACT.md) | Kontrak usulan untuk integrasi backend berikutnya |
| [Frontend backlog](docs/backlog/FRONTEND.md) | Pekerjaan mobile dan acceptance criteria |
| [Backend backlog](docs/backlog/BACKEND.md) | Pekerjaan backend, dependensi, acceptance criteria |
| [Testing](docs/TESTING.md) | Skenario penerimaan dan hasil pemeriksaan aktual |
| [Success criteria](docs/SUCCESS_CRITERIA.md) | Gate penerimaan per tahap |
| [Decisions](docs/DECISIONS.md) | Keputusan pengguna, usulan, dan hal yang perlu dibahas |
| [Referensi Figma](docs/reference/figma/README.md) | Bukti pemeriksaan dan screenshot lokal |
| [AGENTS.md](AGENTS.md) | Instruksi kerja untuk agen pengembangan |

Urutan baca: PRD → Features → Figma mapping → Data model → Architecture → Tech → backlog → Testing → Success criteria.

## Rencana pengerjaan

1. FE-00 selesai; FE-01 sedang dikerjakan untuk tokens, font/icon, dan komponen UI reusable. Interaksi dasar komponen telah diuji di HP; pemeriksaan ukuran layar dan visual Figma yang tepat masih tersisa.
2. FE-02 selesai: domain, ports, SQLite/repository/event, seed dan cold-restart check lulus. FE-03/04/05 sedang dikerjakan untuk akun/sesi, profil/media, dan dashboard; FE-04 APK sudah terpasang namun QA interaksi menunggu layar HP dibuka.
3. FE-06–16, FE-19, FE-23: ternak, booking, flow Dokter A–D, catatan, tindak lanjut, pembayaran dan ledger lokal.
4. FE-17/18/20/21/22 dan FE-24: seluruh fitur lokal, acceptance Android dan visual.
5. Backend dimulai hanya setelah stack disepakati; lihat [backlog frontend](docs/backlog/FRONTEND.md) dan [backend](docs/backlog/BACKEND.md).

Semua fitur Peternak dan Dokter tetap termasuk baseline. Urutan milestone bukan penghapusan scope.

## Verifikasi FE-00

`npm ci`, `npm run check`, `npx expo export --platform android`, `./gradlew assembleDebug`, dan `npm run android` lulus pada tahap FE-00. APK debug FE-00 berukuran sekitar 60 MB dan pernah dibuka di HP Android USB model `2311DRK48G`; pengguna memilih “Don’t send” pada Play Protect. Baseline saat itu hanya shell FE-00. Lihat [screenshot perangkat](docs/reference/android/fe00-phone-launch.png).

Verifikasi FE-01: `npm run check`, `npx expo export --platform android`, dan `GRADLE_USER_HOME=/private/tmp/vetlink-gradle ./gradlew --no-daemon --max-workers=1 assembleDebug` lulus. APK debug terpasang dan komponen diperiksa langsung di HP. Xiaomi menyediakan pilihan font 125% dan 145%, bukan tepat 130%; uji dilakukan pada 125% dan ukuran font dipulihkan ke 100%. Ukuran logis HP adalah 407 × 904 dp; Android menolak override sementara ke 390 × 844 dp karena izin sistem. Bukti dan pemeriksaan yang tersisa ada di [Testing](docs/TESTING.md) dan [Figma mapping](docs/FIGMA_MAPPING.md).

Verifikasi FE-02: `npm run check` menjalankan typecheck, lint, dan enam tes domain; `npx expo export --platform android` dan `GRADLE_USER_HOME=/private/tmp/vetlink-gradle ./gradlew --no-daemon --max-workers=1 assembleDebug` lulus. APK baru dipasang dan dibuka pada HP. Database schema 1 memiliki seed `fe02-v1`, 61 entitas dan 79 relasi; cold restart menjaga perubahan dan status draft, serta adapter SQLite tidak membuat notification/health event ganda. Lihat [bukti persistence Android sebelum/sesudah restart](docs/reference/android/fe02-persistence-after-restart.png) dan [hasil rinci](docs/TESTING.md).

Verifikasi FE-03: `npm run check` lulus dengan 10 tes, `npx expo export --platform android` membundle 680 modul, Gradle `assembleDebug` lulus, dan APK terpasang serta membuka layar Mulai pada Xiaomi. Migrasi schema 2 pada database yang sudah berisi fixture mempertahankan 61 entitas/79 relasi; `integrity_check` dan `foreign_key_check` lulus. Tap otomatis ditolak MIUI dengan `INJECT_EVENTS`, sehingga registrasi/login/logout langsung di perangkat belum bisa diuji. Screenshot peluncuran ada di [fe03-start-screen.png](docs/reference/android/fe03-start-screen.png). Konteks visual Figma FE-03 juga belum dapat dimuat karena kuota Starter MCP; detail ada di [Testing](docs/TESTING.md) dan [Figma mapping](docs/FIGMA_MAPPING.md).

Verifikasi awal FE-04: `npm run check` lulus dengan 15 tes; lima tes baru mencakup simpan profil farm/alamat, pengajuan dan revisi dokumen, pembacaan status verifikasi, penolakan pengajuan pada peran bukan Dokter, serta guard layanan untuk dokter belum terverifikasi. `npx expo prebuild --platform android`, export Metro (710 modul), dan Gradle `assembleDebug` berhasil. APK FE-05 terbaru kini terbuka di Xiaomi setelah layar dibangunkan dan menampilkan pemilih peran; picker/form FE-04 belum diuji. Perbandingan visual Figma menunggu kuota MCP.

Verifikasi FE-05: `npm run check` lulus dengan 20 tes; lima tes baru mencakup selector dashboard Peternak, agenda/saldo Dokter, guard availability verified, persistensi availability tanpa mengubah janji accepted, dan akses detail sesuai assignment/ID. `npx expo export --platform android` membundle 714 modul; prebuild Android lulus. Hasil Gradle/debug APK dan uji perangkat dicatat pada [Testing](docs/TESTING.md).

Verifikasi FE-06/07 terbaru: `npm run check` lulus dengan 32 tes; `npx expo export --platform android` membundel 724 modul; Gradle `assembleDebug` lulus dan APK terpasang di Xiaomi. Metro memuat bundle dan LocalStore (`schema=2`, 61 entitas) sampai “Pilih Peran”. Interaksi list, form, filter, modal, keyboard, serta perbandingan visual belum dapat diuji karena MIUI menolak input ADB dengan `INJECT_EVENTS`. Node Figma pasien Dokter berhasil diperiksa sebelumnya; node Peternak FE-06/07 tidak dapat diambil karena batas Starter, sehingga layar riwayat Peternak dirancang dari tokens dan aturan fitur. Rincian ada di [Testing](docs/TESTING.md) dan [Figma mapping](docs/FIGMA_MAPPING.md).

Verifikasi FE-08: `npm run check` lulus dengan 40 tes, termasuk delapan skenario direktori/jadwal dan ekstensi fixture; export Android membundel 736 modul; build akhir Gradle `assembleDebug` lulus dalam 3 menit 28 detik setelah perbaikan safe area. APK dipasang pada Xiaomi dan Metro membaca schema 2, 62 entitas, serta seed lama yang dipertahankan. Salinan database perangkat memiliki marker `fixture_directory_version=fe08-v1`, 82 relasi, `integrity_check=ok`, dan tidak ada pelanggaran foreign key. Interaksi layar tetap belum diuji karena MIUI menolak `INJECT_EVENTS`. Figma FE-08 terhalang izin file utama dan kuota Starter; UI dirancang mandiri sesuai arahan pengguna. Rincian serta batas bukti ada di [Testing](docs/TESTING.md).

`npm ci` FE-00 melaporkan 23 advisori (7 moderate, 16 high); instalasi dependency hingga FE-04 melaporkan 24 (8 moderate, 16 high). Rincian belum diaudit dan tidak ada perbaikan otomatis.


Verifikasi FE-09: `npm run check` lulus (49 tes, termasuk sembilan skenario booking); export Android lulus (740 modul, 2,2 MB); Gradle `assembleDebug` lulus (24 menit 51 detik, 492 tasks). APK dipasang dengan `install -r` dan dibuka di Xiaomi melalui Metro offline port 8102; [screenshot startup](docs/reference/android/fe09-ui-startup-after-build.png) membuktikan layar awal, bukan interaksi Booking. MIUI tetap menolak tap `INJECT_EVENTS`, termasuk setelah instalasi build baru. Draft/file/video pada perangkat, form, keyboard/back/dialog/scroll serta visual 390 × 844/kecil/font besar belum diuji; pembayaran FE-19 belum tersedia. FE-09 tetap Sedang dikerjakan. Bukti dan perintah aktual ada di [Testing](docs/TESTING.md).

## Iterasi frontend melalui Metro

Untuk perubahan TypeScript/JS, gunakan APK development yang sudah terpasang; tidak perlu membangun native APK setiap fase. Perintah yang dipakai pada Xiaomi:

```sh
cd apps/mobile
EXPO_OFFLINE=1 npx expo start --dev-client --port 8102 --localhost
```

Hubungkan USB dengan `adb reverse tcp:8102 tcp:8102`, lalu buka development client VetLink ke `http://127.0.0.1:8102`. Native build diperlukan kembali bila dependency/config native berubah. Pertahankan cache Gradle `/private/tmp/vetlink-gradle`; jangan menjalankan clean untuk iterasi UI rutin.

Checkpoint progres FE-06–09 di-commit `d21126a`; FE-10 kemudian di-commit `8dd97a0` (`feat: checkpoint frontend service flows through FE-10`) sesuai instruksi pengguna. Keduanya tidak di-push. FE-11 masih perubahan working tree. Typecheck/lint dan 70 tes lulus; export Android membundle 746 modul/2,4 MB. [Screenshot startup Xiaomi](docs/reference/android/fe11-startup-metro.png) hanya membuktikan aplikasi mencapai Pilih/Ganti Peran. Tap ditolak MIUI; interaksi dan visual FE-11 belum diuji. Tidak ada Gradle rebuild karena perubahan FE-11 hanya TypeScript/JavaScript dan APK development yang ada memakai Metro. Pembayaran booking baru menunggu FE-19. Rincian ada di [Testing](docs/TESTING.md).
