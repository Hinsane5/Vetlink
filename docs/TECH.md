# Teknologi dan bahan diskusi

Status per 13 Oktober 2026: FE-00/02 selesai; FE-01/03–14 masih dikerjakan; BE-00/01 selesai. Mobile tetap memakai persona lokal tanpa autentikasi/backend jaringan. Backend memiliki scaffold NestJS + PostgreSQL, migrasi, seed, OpenAPI healthcheck/auth, CI, dan config lokal; endpoint domain selain auth belum tersedia. Bukti backend ada di [Testing](TESTING.md). QA visual/interaksi Android FE-14 sebelumnya belum terverifikasi karena MIUI menolak tap ADB (`INJECT_EVENTS`).

## Keputusan mobile

| Area | Arah | Status |
| --- | --- | --- |
| Framework | React Native + Expo | Dipilih pengguna |
| Bahasa aplikasi | TypeScript | Dipilih pengguna bersama opsi Expo |
| Platform awal | Android | Dipilih pengguna |
| Sumber data awal | Lokal persisten; backend menyusul | Dipilih pengguna |
| Kotlin | Tidak digunakan sebagai bahasa/kode aplikasi buatan sendiri | Batasan pengguna |
| iOS | Kemungkinan tahap berikutnya | Belum scope rilis pertama |

## Realisasi FE-00

Scaffold berada di `apps/mobile`, menggunakan template Expo `blank-typescript`. Penempatan tersebut mengikuti struktur aplikasi yang diusulkan tanpa membuat workspace monorepo atau backend. Versi dikunci dengan npm dan `package-lock.json`:

| Bagian | Versi / keputusan implementasi |
| --- | --- |
| Expo SDK | `~57.0.26` |
| React Native / React | `0.86.3` / `19.2.3` |
| TypeScript | `~6.0.3` |
| `expo-dev-client` | `~57.0.19`, dipakai untuk development build Android |
| ESLint / Expo config | ESLint `^9.0.0`, `eslint-config-expo ~57.0.2` |
| Node.js minimum | `22.13.0` menurut matriks Expo SDK 57; lingkungan yang dipakai Node `24.1.0` |
| Package manager | npm `11.3.0` pada run FE-00 |
| Android application ID | `com.vetlink.mobile`, nilai sementara untuk development |

Paket SDK Expo dipasangkan mengikuti rekomendasi dan matriks versi resmi Expo; SDK 57 mencantumkan React Native 0.86, React 19.2, serta Node minimal 22.13. [Matriks Expo SDK](https://docs.expo.dev/versions/latest/), [panduan membuat project Expo](https://docs.expo.dev/get-started/create-a-project/).

`npm run android` memakai Expo Continuous Native Generation (CNG): folder native Android dibuat dari konfigurasi dan dependency saat dibutuhkan, lalu diabaikan Git. Kode aplikasi yang ditulis tetap TypeScript; tidak ada kode Kotlin buatan tangan. Kebutuhan generated Android project berasal dari kompilasi development build lokal. `expo-dev-client` adalah dependency native yang diperlukan agar development build memuat tooling pengembang. [Build debug lokal](https://docs.expo.dev/guides/local-app-development/).

`npm run check` menjalankan typecheck, ESLint, dan tes domain/use case FE-02 sampai FE-05. `apps/mobile/eas.json` memiliki profil development APK, tetapi EAS belum dikonfigurasi dengan akun dan belum dijalankan. ID Android serta ikon bawaan template perlu ditinjau sebelum distribusi.

Expo mendukung satu project JavaScript/TypeScript untuk aplikasi native. Development build menyediakan runtime aplikasi sendiri dan konfigurasi native; dokumentasi Expo merekomendasikannya untuk aplikasi yang akan dirilis. Ini cocok untuk menyiapkan pengujian Android VetLink. [Expo](https://docs.expo.dev/), [Development builds](https://docs.expo.dev/develop/development-builds/introduction/).

“Tanpa Kotlin” diterjemahkan sebagai menulis aplikasi dalam TypeScript. Toolchain/dependency Android dapat memiliki implementasi native atau generated code. Bila maksudnya melarang seluruh dependency yang mengandung Kotlin, keputusan itu perlu dibahas sebelum scaffold karena berbeda dari pilihan bahasa aplikasi.

## Realisasi FE-01

| Kebutuhan | Implementasi aktual |
| --- | --- |
| Font | Inter Regular/Medium/Semi Bold/Bold dibundel lokal di `apps/mobile/assets/fonts` dan dimuat melalui `expo-font ~57.0.4`; lisensi SIL OFL disertakan |
| Ikon | `@react-native-vector-icons/lucide ^13.1.4`, satu keluarga Lucide untuk ikon semantik reusable |
| Styling | `StyleSheet` dan tokens per peran di `apps/mobile/src/ui/theme/tokens.ts`; tidak memakai Tailwind |
| Komponen | Button, field/textarea, status, appointment row, chat bubble, confirmation dialog, empty/loading/error feedback |
| Pemeriksaan aktual | `npm run check`, `npx expo export --platform android`, dan build `assembleDebug` lulus; tombol, field/keyboard, dialog/Back, retry, scroll, dan font besar diperiksa di Xiaomi `2311DRK48G`; viewport 390 × 844 dp masih tertunda |

Lucide dimuat sebelum shell dirender bersama Inter agar glyph ikon tersedia saat pertama tampil. Package dan versi dicatat pada `apps/mobile/package.json` serta lockfile. Paket icon lama `@expo/vector-icons` tidak dipakai; Figma mapping mencatat glyph prototype yang masih harus dipetakan saat layar produk dibuat.

## Realisasi FE-02

| Kebutuhan | Implementasi aktual |
| --- | --- |
| Database | `expo-sqlite ~57.0.3`; file `vetlink.db`, WAL, foreign key, exclusive transaction |
| Migrasi dan seed | Schema saat ini `user_version=2`, audit `schema_migrations`, fixture seed `fe02-v1` satu kali saat tabel entitas kosong; v2 menambah indeks email unik tanpa kolom database khusus baru |
| Repository | Envelope entity dan relasi ber-FK; lookup by ID/owner/relationship; update optimistic version; final clinical note immutable |
| Domain | Guard verified/assignment, akses peserta layanan, urutan Visit, kelengkapan/finalitas note, dan kalkulasi saldo integer rupiah |
| Event | `domain_events` + `event_effects`; notification unik per penerima/event dan health event unik per source key; proyeksi satu transaksi |
| Tes | `npm run test:domain` menjalankan Node `node:test` tanpa framework tambahan; 40 tes total sampai FE-08, termasuk transaksi ekstensi fixture pada SQLite in-memory melalui `node:sqlite` |
| Perangkat | Xiaomi `2311DRK48G`; schema 2, seed `fe02-v1`, 61 entitas/79 relasi dipertahankan oleh migrasi; foreign-key/integrity check lulus; cold restart dan retry event SQLite lulus |

## Tahap frontend aktif

`App.tsx` sekarang memasang `FrontendFlow`. Pilih Peran menggunakan `FrontendPreviewService` untuk membuka persona fixture Peternak Budi atau Dokter Yuda tanpa credential, sesi autentikasi, maupun backend jaringan. SQLite lokal tetap menjadi sumber data untuk memperlihatkan list, detail, filter, dan perubahan form yang konsisten. Ini mode penelusuran UI, bukan otoritas akses produksi. Implementasi FE-03 di bawah tetap ada sebagai riwayat teknis tetapi tidak dipasang pada runtime aktif.

## Realisasi historis FE-03: akun dan sesi lokal

| Kebutuhan | Implementasi aktual |
| --- | --- |
| Flow | Splash/onboarding, Pilih/Ganti Peran, daftar/masuk Peternak dan Dokter, reset pada perangkat ini, konfirmasi keluar |
| Use case | `LocalAuthService` memvalidasi email/nama/kata sandi, memeriksa keanggotaan peran dan profil, menerbitkan/memulihkan/mencabut sesi, serta mengubah peran hanya bila diizinkan |
| Penyimpanan akun | User dan profil baru masuk SQLite dalam satu transaksi; indeks unik email tak peka huruf besar-kecil menjaga duplikasi termasuk race transaksi |
| Credential/sesi | `expo-secure-store ~57.0.4`; salt + SHA-256 verifier, session ID, dan penanda onboarding berada di secure store, terpisah dari SQLite |
| Crypto | `expo-crypto ~57.0.3` menghasilkan UUID/salt dan digest SHA-256; fixture seed tidak memperoleh credential otomatis |
| Peran Dokter | Pendaftaran menghasilkan `verificationStatus=not_submitted`; tidak ada aksi self-verify dan guard FE-02 tetap menolak dokter yang belum verified |
| Logout/reset | Logout mencabut sesi tetapi mempertahankan akun/domain; reset lokal hanya mengganti verifier akun yang sudah terdaftar pada perangkat dan tidak mengirim email |
| Session expiry | Sesi lokal kedaluwarsa setelah 30 hari dan diverifikasi kembali saat bootstrap |
| Pemeriksaan | Empat tes AuthService lulus; build Android lulus dan layar Mulai terbuka. Uji tap/form di HP menunggu akses input MIUI; screenshot Figma FE-03 tertahan oleh batas MCP |

Kode autentikasi FE-03 tidak dipakai pada alur aktif. Verifier SHA-256 bersalt pada adapter lokal historis bukan KDF password produksi; backend BE-01 terpisah memakai `scrypt` dan limiter auth per proses. Mobile belum terhubung ke backend, verifikasi email/reset delivery provider belum dipilih, dan fixture sengaja tidak dapat diklaim lewat reset karena tidak memiliki credential.

## Realisasi awal FE-04: profil, farm, alamat, dan verifikasi

| Kebutuhan | Implementasi aktual |
| --- | --- |
| Profil Peternak | `ProfileService` menyimpan nama, foto opsional, farm, species, wilayah, alamat, telepon, dan penerima; perubahan profil/farm/alamat disatukan dalam transaksi SQLite |
| Profil Dokter | Nama profesional, nomor registrasi, pengalaman, layanan, species, lokasi praktik, wilayah kunjungan, dan foto tersimpan di `vetProfile` |
| Dokumen | `expo-image-picker ~57.0.20`, `expo-document-picker ~57.0.3`, `expo-file-system ~57.0.7`; foto/dokumen disalin ke direktori privat, metadata `Attachment` tersimpan lokal, tanpa unggah jaringan |
| Verifikasi | Pengajuan pemilik menghasilkan `VerificationSubmission.status=pending` dan `VetProfile.verificationStatus=pending`; tidak ada kontrol self-verify |
| Review status | UI menangani `not_submitted/pending/revision_required/verified`; tidak ada reviewer lokal tepercaya pada fase ini, jadi akun baru hanya bisa menghasilkan pending |
| Draft | Isian profil dan lampiran terpilih dapat disimpan sebagai entity `profileDraft`; perubahan profil menggunakan optimistic version dan transaksi batch |
| Pemeriksaan | Lima tes profil/verifikasi lulus; typecheck, lint, prebuild, export (710 modul), dan Gradle build lulus. APK berhasil dipasang melalui USB; layar HP tidur saat cek sehingga QA picker belum dilakukan. Visual Figma tertahan kuota MCP |

## Realisasi awal FE-05: dashboard Peternak dan Dokter

| Kebutuhan | Implementasi aktual |
| --- | --- |
| Snapshot Peternak | Selector membaca jumlah ternak milik akun, konsultasi aktif, pengingat scheduled terdekat, lokasi farm, dan konsultasi aktif. Detail pengingat/layanan dimuat ulang dengan ID dan owner check |
| Snapshot Dokter | Selector membaca request assigned, agenda hari ini/mendatang, availability, dan saldo available/pending dari ledger integer rupiah |
| Availability | Update tersimpan dengan optimistic version; status verified diwajibkan untuk mengaktifkan layanan baru. Mematikan availability hanya mengubah record ketersediaan; konsultasi scheduled/in_progress tetap ada |
| Navigasi | Dashboard, list konsultasi/jadwal, dan detail ID terhubung; profil, ganti peran, keluar tetap dapat dibuka. Tab Ternak/Pesanan/Pasien disabled sampai layar backlog terkait tersedia |
| Pemeriksaan | Lima tes dashboard/akses/ketersediaan ditambahkan (20 tes total); typecheck, lint, export Android (714 modul), prebuild, dan Gradle debug build lulus. QA UI HP menunggu layar menyala dan dibuka kunci; Figma context terbaru tertahan kuota Starter |

Harness diagnostik FE-02 hanya tampil saat development dengan `EXPO_PUBLIC_FE02_CHECKS=1`. Harness mengubah satu preferensi fixture, memeriksanya setelah cold restart, mencoba ulang event notification/health, lalu mengembalikan preferensi dan membersihkan record probe.

## Usulan pendukung mobile

| Kebutuhan | Usulan | Pertimbangan |
| --- | --- | --- |
| Navigasi | Expo Router dengan stack/tabs per peran | Route logis sudah dipetakan; dialog dan variants bukan file route baru |
| Styling | React Native StyleSheet + design tokens | Menjaga Figma tanpa menambah framework CSS web |
| State domain | Repository + use case; React hooks/context untuk binding | Database sebagai sumber utama; jangan salin seluruh entity ke beberapa store |
| State UI | State React; Zustand hanya bila kebutuhan lintas layar terbukti | State input/filter/dialog terpisah dari data persisten |
| Data lokal | `expo-sqlite ~57.0.3` diterapkan di FE-02 | Database persisten, versioned migration, exclusive transaction, seed only-if-empty. [SQLite Expo](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/) |
| Sesi/secret | `expo-secure-store ~57.0.4` diterapkan FE-03 untuk session ID dan verifier lokal | Bukan tempat database, media atau arsip utama. [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) |
| Form | React Hook Form + Zod sebagai kandidat | Schema input dan error konsisten; tidak mengganti invariant domain |
| Media | Expo image/document picker dan file-system diterapkan FE-04 | Foto/dokumen privat lokal; belum ada upload maupun sinkronisasi |
| Icon/font | Lucide dan Inter sudah dipakai FE-01 | Ganti glyph campuran Figma secara konsisten dan catat selisih |
| Testing | Node `node:test` untuk domain/usecase; Jest/jest-expo + React Native Testing Library kandidat UI; Maestro kandidat E2E Android | Tes domain/usecase FE-02–05 aktif; framework UI/E2E dipilih ketika slice tersebut membutuhkannya |
| API nanti | REST JSON, OpenAPI, adapter client | Kontrak independen framework; TanStack Query hanya bila integrasi API memerlukannya |

Paket Expo yang benar-benar terpasang dan keterkaitannya dengan FE-01–04 dicatat di README. Form/test framework dan seluruh kandidat lain tetap usulan; tidak ada kewajiban menginstall semua kandidat state/form/test sekaligus.

## Pilihan backend dan realisasi BE-00/01

| Kandidat | Kesesuaian untuk VetLink | Tradeoff yang perlu dibahas |
| --- | --- | --- |
| NestJS + PostgreSQL | TypeScript untuk mobile/backend, modul use case eksplisit, transaksi untuk slot dan ledger | Perlu mengelola server, auth, migration, deployment dan worker |
| Supabase + PostgreSQL | Kandidat layanan terkelola untuk auth/database/storage; aturan akses dan transaksi tetap harus dirancang | Ketergantungan layanan; operasi finansial/penyelesaian klinis harus ditempatkan pada boundary server yang tepat |
| FastAPI + PostgreSQL | Kandidat jika tim lebih nyaman Python | Dua bahasa; berbagi tipe perlu melalui OpenAPI |

**Dipilih pengguna 13 Oktober 2026: NestJS + PostgreSQL** untuk backend modular monolith BE-00–16. Baseline stack memilih Node.js 24.15.0, NestJS 12.1.3, Nest CLI 12.0.8, TypeScript 6.0.3, driver `pg` 8.23.1, dan PostgreSQL 17.4. PostgreSQL 18.x dicatat sebagai upgrade gate sebelum integrasi berikutnya. Nest memakai ESM; project memakai NodeNext. Database diakses lewat port infrastructure dan SQL eksplisit, belum memilih ORM. Migrasi berjalan eksplisit dengan advisory lock, checksum, dan transaksi; seed fiktif hanya insert conflict-do-nothing. BE-01 memilih password auth internal `scrypt`, hash token opaque di PostgreSQL, dan role guard; email reset gagal tertutup tanpa adapter/provider terpilih. BE-01 check lokal berjalan pada Node 24.10 karena Node 24.15 tidak tersedia di shell, lihat [Testing](TESTING.md). Hosting dan izin deploy tetap belum dipilih. Lihat [panduan backend](../apps/api/README.md), [NestJS](https://docs.nestjs.com/), dan [kebijakan versi PostgreSQL](https://www.postgresql.org/support/versioning/).

Port HTTP aktual memakai adapter Express NestJS; module Health dan Auth menyediakan healthcheck, auth, bearer `/me`, serta role membership guard. Module domain akan mengikuti boundary use case/repository pada API masing-masing. Shared error response dan status domain sudah ada di OpenAPI; endpoint business selain auth belum aktif. Provider credential eksternal, reset delivery, penyimpanan media, realtime, queue, hosting dan provider produksi tetap belum dipilih. Modular monolith dipakai untuk awal; microservices belum dibutuhkan oleh scope ini.

## Hal yang masih terbuka untuk backend

1. Siapa peninjau dokumen dokter; apakah perlu tooling admin terpisah?
2. Kapan simulasi diganti provider nyata, serta aturan bayar nanti/refund/komisi?
3. Target hosting, kebutuhan backup, biaya operasional dan target iOS.

Pertanyaan ini tidak menghambat pekerjaan fondasi backend. Catat keputusan baru di [Decisions](DECISIONS.md); jangan memilih provider produksi dari kandidat saja.

## Realisasi FE-08: direktori dan profil dokter

`react-native-safe-area-context ~5.7.0` ditambahkan melalui Expo untuk inset status bar/gesture Android. Root memakai SafeAreaProvider dan shell aktif/Modal filter memakai SafeAreaView dari library tersebut, dengan provider tersendiri pada Modal. Kebutuhan native library ini adalah layout aman pada perangkat; tidak ada Kotlin aplikasi buatan sendiri atau backend jaringan baru. Mengikuti [dokumentasi Expo](https://docs.expo.dev/versions/latest/sdk/safe-area-context/) dan versi SDK yang tercantum pada `expo/bundledNativeModules.json`. `VetDirectoryService`, filter domain, dan proyeksi slot 7 hari menggunakan adapter SQLite bersama; `VetDirectoryFlow` memakai StyleSheet, tokens, Inter, Lucide, Modal, input, serta state loading/error/empty. Native debug APK tetap memuat JavaScript dari Metro. Pemeriksaan terbaru `npm run check` lulus 40 tes; export 736 modul dan Gradle debug build lulus. Tes ekstensi fixture memakai SQLite in-memory bawaan Node 24 yang terpasang (`node:sqlite`, masih menampilkan ExperimentalWarning), dengan rollback dan retry transaksi; runtime mobile tetap memakai `expo-sqlite`. Bukti perangkat serta batas QA dicatat di Testing.


## Realisasi FE-09: booking

Tidak ada dependency atau kode Kotlin aplikasi baru. Photo/video memakai `expo-image-picker` yang sudah terpasang; file disalin lewat adapter `expo-file-system`. `SelectedAsset` kini mengenal video untuk booking, sedangkan validator foto profil/ternak dan dokumen verifikasi tetap membatasi jenis sebelumnya. Booking memakai React Native ScrollView/TextInput/Modal, tokens Inter/Lucide, safe-area provider Modal dan keyboard avoidance shell aktif. Penyimpanan draft/quote/consultation memakai adapter SQLite tunggal; tes integrasi transaksi menggunakan `node:sqlite` in-memory, bukan SQLite mock yang menggantikan SQL. Status/perintah pemeriksaan aktual ada di Testing.

## Realisasi FE-10 dan iterasi cepat

FE-10 memakai ConsultationService/ConsultationFlow, domain projection, dan adapter SQLite yang sudah ada; tanpa package/config native baru. Shared transaction queue menghindari nested exclusive transaction. Status, Proposal, Visit dan ConsultationAction disimpan atomik; audit append-only dan versi/operationKey menjaga retry. Draft usulan merupakan data domain lokal. UI menggunakan Inter/Lucide/tokens, native Modal, ScrollView/TextInput, safe area shell/viewer/dialog back serta keyboard avoidance shell.

Pemeriksaan TypeScript/lint dan 61 tes SQLite/domain lulus; export Android 743 modul/2,3 MB lulus. Iterasi FE-10 memakai APK development FE-09 dan Metro offline 8102, tidak menjalankan Gradle assembleDebug baru. Build native hanya diulang saat dependency/config native berubah; cache Gradle dipertahankan. Ini bukan APK mandiri FE-10 untuk dibagikan. QA Android dan keterbatasan MIUI/Figma dicatat di Testing.

## Realisasi FE-11: ketersediaan dan kalender

`AvailabilityService` memakai adapter SQLite dan transaksi bersama booking/konsultasi. Ia membaca profil/verification, availability, rate history, blok aktif, draft serta commitment dari repository; optimistic token menolak stale write. Save unchanged tidak menulis ulang. Perubahan membuat snapshot tarif dengan effectiveAt/configurationVersion, menjaga fee snapshot booking lama, menyimpan/cancel blok sebagai history, dan mencegah blok baru menimpa booking/tindak lanjut. Dokter harus verified untuk mengaktifkan penerimaan. Kalender merangkum layanan assigned dan follow-up terkait, tidak menampilkan hold pembayaran ke Dokter, dan membuka detail dengan ID ber-scope FE-10.

`VetScheduleFlow` menambah editor layanan, jam, zona waktu Indonesia, durasi, tarif rupiah, blok waktu, draft/back actions, serta agenda harian/mingguan. Perubahan hanya TypeScript/JavaScript; tidak ada dependency atau konfigurasi native baru. `npm run check` lulus typecheck/lint/70 tes; `npx expo export --platform android` lulus pada 746 modul/2,4 MB. APK development dan Metro dipakai kembali; Gradle tidak dijalankan untuk FE-11. Xiaomi mencapai layar Pilih/Ganti Peran, tetapi MIUI menolak tap input. Hasil runtime/visual dan error Figma yang tepat tercatat di Testing dan Figma mapping.

## Realisasi FE-12: chat lokal

`ChatService` menggunakan transaksi SQLite bersama consultation/booking, memvalidasi participant, relasi akun/ternak, pembayaran succeeded yang cocok, dan status layanan sebelum menampilkan percakapan. Dokter hanya dapat membaca konsultasi assigned; penulisan Dokter dibatasi ke akun dokter verified. Pesan memakai `clientMessageId` idempotent, status pending/sent/failed, retry pada pesan yang sama, teks maksimum 4.000 karakter, serta maksimum lima foto/video per kiriman. Lampiran disalin privat dan hanya dibuka setelah scope konsultasi, pemilik, relasi, jenis file, MIME dan URI lokal diperiksa kembali.

`ChatFlow` dapat dibuka dari detail konsultasi pada dashboard dan kalender Dokter. Budi/Yuda memperoleh satu konsultasi chat fiktif FE-12 agar flow dapat dijangkau melalui UI; marker `fixture_chat_version=fe12-v1` menambahkan data itu sekali dan seed mempertahankan perubahan lain. Perubahan hanya TypeScript/JavaScript/data fixture, tanpa package native baru. `npm run check` lulus dengan 79 tes dan export Android membundle 749 modul/2,4 MB. Tidak ada Gradle build baru. Viewer foto tersedia; video dapat dilampirkan dan ditampilkan sebagai detail file, tetapi playback video belum tersedia. Chat hanya tersimpan lokal pada satu instalasi, tanpa backend/realtime lintas perangkat. QA interaksi/visual Android belum terbukti; detail alat/Figma ada di Testing dan Figma mapping.

## Realisasi FE-13: progres kunjungan

`ConsultationFlow` merender alamat snapshot dan Visit timeline pada detail layanan. `ConsultationService.advanceVisit` hanya menerima tiga perintah tahap selanjutnya dan menulis timestamp, status Consultation (`in_progress` saat berangkat), serta audit dalam transaction queue SQLite. Dokter assigned/verified dengan pembayaran cocok harus menyetujui dialog untuk setiap tahap; Peternak hanya membaca progres terbaru. Tombol peta memakai URI `geo:` dengan snapshot alamat dan fallback jika aplikasi peta tidak tersedia. Tidak ada dependency atau konfigurasi native baru. `npm run check` lulus 84 tes, export Android 749 modul; tidak ada Gradle build baru. QA sentuh/visual belum lulus; Figma mapping dan Testing merekam hambatan akses serta perangkat.

## FE-14: catatan pemeriksaan lokal

`ClinicalNoteService` menggunakan `SqliteBookingRepository` yang sama dengan booking dan consultation. Draft, finalisasi, HealthEvent proyeksi dan audit bersifat transaksi; Visit/Consultation completion dan EarningTransaction/ledger pending juga atomik serta memeriksa versi yang diharapkan. Tidak ada dependency Expo/native baru. `ClinicalNoteFlow` mengisi form dan review tanpa akses SQL langsung; status final terkunci, Peternak hanya membaca hasil. `npm run check`, Android export, dan Gradle `assembleRelease` lulus; APK mandiri 76 MB terpasang serta dibuka setelah Metro dihentikan. Interaksi UI belum teruji karena MIUI menolak tap ADB dengan `INJECT_EVENTS`.
