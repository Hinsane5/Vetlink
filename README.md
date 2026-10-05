# VetLink

Aplikasi mobile berbahasa Indonesia untuk pengelolaan kesehatan ternak, konsultasi dokter hewan, kunjungan, dan pembelian produk kesehatan hewan.

**Status: FE-00 dan FE-02 selesai; FE-01, FE-03, FE-04, FE-05, dan FE-06 sedang dikerjakan.** FE-01 menyediakan tokens, Inter, Lucide, dan komponen UI reusable; pembandingan viewport Figma masih tertunda. FE-02 menyediakan SQLite lokal, seed sekali, repository bersama, domain guard awal, dan event idempotent. FE-03 memiliki flow akun dan session guard, tetapi uji input penuh di HP serta visual Figma tertunda. FE-04 menyediakan profil Peternak/Dokter, persistensi farm/alamat, pemilih foto/dokumen, draft lokal, dan pengajuan verifikasi `pending`; QA picker/form di HP masih tertunda. FE-05 menyediakan dashboard berbasis repository bersama, agenda/permintaan/reminder/saldo, detail berbasis ID, dan availability tersimpan dengan guard verified; APK terbaru menampilkan “Pilih Peran” di Xiaomi. QA dashboard menunggu login di HP. FE-06 kini memiliki service domain untuk list/detail/tambah/edit ternak, validasi, pencarian/filter, ownership, dan lampiran foto privat; layar FE-06 menunggu konteks screenshot Figma karena MCP Starter menolak permintaan. Status `revision_required`/`verified` hanya boleh datang dari sumber tepercaya.

## Arah yang telah dipilih

- Mobile: React Native + Expo + TypeScript; target pertama Android. Kode aplikasi tidak menggunakan Kotlin.
- Sumber data awal lokal persisten memakai `expo-sqlite`; backend menyusul melalui kontrak repository yang sama.
- Chat, pembayaran, pengiriman, notifikasi, dan pencairan menggunakan layanan simulasi pada tahap lokal.
- Framework backend, hosting, provider produksi, versi backend, dan dependency backend belum ditetapkan.
- Figma: [VetLink](https://www.figma.com/design/f1WBeG5S1OGXlPXyVEHjuW/Untitled), halaman `01 · VetLink / Prototype` (`0:1`). Bukti dan pemetaan ada di [Figma mapping](docs/FIGMA_MAPPING.md).

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

Seed data fiktif FE-02 tersedia di database lokal, tetapi tidak memiliki credential login. FE-03 menyimpan credential lokal akun yang dibuat pengguna di SecureStore; autentikasi dan pemulihan ini simulasi satu perangkat, bukan layanan produksi. Perintah reset database belum disediakan.

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

Verifikasi FE-06 (lapisan domain): `npm run check` lulus dengan 26 tes; export Android membundle 716 modul dan Gradle `assembleDebug` lulus. Service memakai repository lokal bersama, membatasi list/detail berdasarkan pemilik dan farm, memvalidasi data dan ID unik, serta menyimpan foto privat bersama relasinya. Layar dan QA perangkat belum dikerjakan karena konteks Figma FE-06 tidak tersedia pada kuota Starter. Detail ada di [Testing](docs/TESTING.md) dan [Figma mapping](docs/FIGMA_MAPPING.md).

`npm ci` FE-00 melaporkan 23 advisori (7 moderate, 16 high); instalasi dependency hingga FE-04 melaporkan 24 (8 moderate, 16 high). Rincian belum diaudit dan tidak ada perbaikan otomatis.
