# Teknologi dan bahan diskusi

Status per 5 Oktober 2026: FE-00 dan FE-02 selesai; FE-01, FE-03, FE-04, dan FE-05 sedang dikerjakan. Scaffold, fondasi database, AuthService, ProfileService, dan DashboardService tersedia. Build native FE-05 lulus; APK FE-04 sudah dipasang ke Xiaomi tetapi layar tidur saat QA, sedangkan visual Figma terbaru tertunda kuota MCP.

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
| Tes | `npm run test:domain` menjalankan Node `node:test` tanpa framework tambahan; 20 tes total: enam fondasi FE-02, empat FE-03, lima FE-04, dan lima FE-05 |
| Perangkat | Xiaomi `2311DRK48G`; schema 2, seed `fe02-v1`, 61 entitas/79 relasi dipertahankan oleh migrasi; foreign-key/integrity check lulus; cold restart dan retry event SQLite lulus |

## Realisasi FE-03: akun dan sesi lokal

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

Autentikasi tersebut hanya berjalan pada instalasi ini. SHA-256 bersalt bukan KDF password produksi; tidak ada verifikasi email, proteksi percobaan login/rate limit server, pemulihan identitas, atau otoritas lintas perangkat. Jangan merilisnya sebagai auth produksi—ganti adapter verifier/session dengan provider/server tepercaya ketika backend dipilih. Akun fixture sengaja tidak dapat diklaim lewat reset karena tidak memiliki verifier lokal.

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

## Kandidat backend

| Kandidat | Kesesuaian untuk VetLink | Tradeoff yang perlu dibahas |
| --- | --- | --- |
| NestJS + PostgreSQL | TypeScript untuk mobile/backend, modul use case eksplisit, transaksi untuk slot dan ledger | Perlu mengelola server, auth, migration, deployment dan worker |
| Supabase + PostgreSQL | Kandidat layanan terkelola untuk auth/database/storage; aturan akses dan transaksi tetap harus dirancang | Ketergantungan layanan; operasi finansial/penyelesaian klinis harus ditempatkan pada boundary server yang tepat |
| FastAPI + PostgreSQL | Kandidat jika tim lebih nyaman Python | Dua bahasa; berbagi tipe perlu melalui OpenAPI |

**Usulan utama: NestJS + PostgreSQL**, karena VetLink memiliki banyak aturan status lintas modul dan kebutuhan transaksi. Ini penilaian untuk kebutuhan project, bukan keputusan pengguna. Nest menyediakan kerangka server Node.js dengan dukungan TypeScript; PostgreSQL menyediakan mekanisme isolasi transaksi yang relevan untuk konflik booking dan reservasi saldo. [NestJS](https://docs.nestjs.com/), [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html).

Pemilihan ORM (misalnya Prisma), provider auth, penyimpanan media, realtime, queue, hosting dan provider produksi dilakukan setelah backend dipilih. Modular monolith diusulkan untuk awal; microservices belum dibutuhkan oleh scope ini.

## Hal yang dibahas sebelum backend

1. Apakah backend memakai NestJS + PostgreSQL atau layanan terkelola?
2. Siapa peninjau dokumen dokter; apakah perlu tooling admin terpisah?
3. Kapan simulasi diganti provider nyata, serta aturan bayar nanti/refund/komisi?
4. Target hosting, kebutuhan backup, biaya operasional dan target iOS.

Pertanyaan ini tidak menghambat penyusunan dokumen atau adapter lokal. Catat jawabannya di [Decisions](DECISIONS.md); jangan memaksakan stack backend dari usulan ini.
