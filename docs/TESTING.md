# Strategi pengujian VetLink

Status: strategi pengujian untuk implementasi VetLink. FE-00 dan FE-02 selesai; FE-01 menunggu pembandingan viewport Figma; FE-03 menunggu input perangkat dan visual QA; FE-04 menunggu QA picker/form; FE-05 lulus typecheck/lint/domain tests dan build native tetapi menunggu QA dashboard pada HP; FE-06 lapisan domain lulus typecheck/lint/tests/build, sedangkan UI menunggu konteks Figma Starter. Fondasi SQLite FE-02 lulus cold-restart/event-idempotency dan FE-03 lulus tes service serta build native pada HP fisik.

## Level pengujian

| Level | Fokus | Kapan |
| --- | --- | --- |
| Domain/use case | Status, otorisasi, note final, jadwal, total, ledger/reservation | Setiap perubahan aturan bisnis |
| Repository contract | CRUD, persistence, transaction rollback, scope, idempotency | Adapter lokal; ulangi untuk API kemudian |
| Component/integration | Typed form, validation, dirty draft, modal, send error, route params | Layar atau binding yang berubah |
| Native Android flow | A–D dan perjalanan Peternak, back/keyboard/tabs/scroll | Per vertical slice dan gate Android |
| Visual | Figma vs Android screenshot, teks panjang/font scaling | Screen implementasi atau visual yang berubah |
| Backend/security/concurrency | Role/owner access, race slot/payout, duplicate callbacks | Setelah backend tersedia |

Framework tes domain/UI dan E2E pada [Tech](TECH.md) belum dipasang. Jalankan script yang benar-benar tersedia dari manifest; saat ini `npm run check` dan build Android tersedia, tetapi tidak ada script `npm test`.

## Fixture dan kondisi

Seed deterministik FE-02: Budi/Sari, dokter verified/pending, sapi/kambing milik berbeda, konsultasi request/chat/visit/completed, proposal, draft/final note, reminder pending/sent/done, produk fiktif tanpa dosis, cart kosong/berisi, pembayaran pending/failed/succeeded, order/shipment, dan ledger. Ledger menghasilkan tersedia Rp88.000, pending Rp81.000, reserved Rp20.000 untuk Yuda; Rani bernilai Rp0 karena belum memiliki ledger. Skenario media/delivery failure menjadi fixture service saat slice terkait dibuat. Tanggal UI harus berasal dari data/clock, bukan hardcoded.

Fault injection dilakukan melalui test harness/development config, tidak lewat tombol alur produk. Reset test database hanya environment development/test. Pengujian restart menggunakan data yang sudah dimutasi, bukan reseed yang menutupi masalah persistence.

## Flow penerimaan

| ID | Skenario | Langkah / hasil yang harus dibuktikan |
| --- | --- | --- |
| T-A | Flow Dokter A | Peternak buat booking dan payment lokal sukses; Dokter terima → detail → mulai chat → ketik clinical note → simpan/tinjau/final → rekomendasi edit/kirim → follow-up → kembali layanan → konfirmasi complete; riwayat completed dan hasil Peternak sama |
| T-B | Flow Dokter B | Visit scheduled → depart → arrive → start examination → note/review/final → complete confirmation; Peternak melihat tiap tahap dan akhir yang sama |
| T-C | Flow Dokter C | Profil → availability → ubah jam → simpan → kalender/slot; jam baru persisten, accepted appointments lama tetap tampil; ulangi save tanpa edit |
| T-D | Flow Dokter D | Earnings → transaction → withdrawal amount/destination → review → confirm → submitted; balance/reservation/history benar; ulangi partial, zero dan service failure |
| T-F1 | Peternak ternak/kesehatan | Register/login, farm/profile/address/species → create/edit/search/filter animal → health tabs → reminder complete; restart dan periksa semua perubahan |
| T-F2 | Peternak request/jadwal | Cari dokter dengan beberapa filter → booking visit/chat → payment gagal/retry/sukses → lihat requested → dokter usulkan jadwal → farmer accept/reject → appointment mengikuti hasil |
| T-F3 | Peternak commerce | Rekomendasi → product → cart quantity/remove → address → quote/checkout → payment → active order/tracking/delivered; history/totals konsisten |
| T-F4 | Peternak hasil/ulasan | Completed consultation → final result/recommendation/follow-up → rating/review → profil dokter memperbarui aggregate |
| T-X | Pendukung akun | Inbox event/read/preferences, help, logout/login, role switch; penerima/route ID benar, tidak membuka data role/owner lain |

Flow A menyimpan final note dan tetap in_progress sebelum explicit complete. Membuka rekomendasi/tindak lanjut sendiri tidak menyelesaikan layanan. Flow B complete Visit/Consultation atomik. Flow D berakhir submitted, tidak mengklaim transfer paid.

## Matriks aturan dan kegagalan

| ID | Kasus | Harapan | Level utama |
| --- | --- | --- | --- |
| T-01 | Dokter pending/revision mencoba accept lewat UI dan use case langsung | Ditolak, request/slot tidak berubah | Domain + native |
| T-02 | Dokter membuka pasien/consultation/media tidak terkait via arbitrary ID | Denied; daftar tidak bocor | Repository + API nanti |
| T-03 | Peternak mengedit ternak atau order pemilik lain | Ditolak, tanpa write | Repository |
| T-04 | Clinical fields kosong/whitespace | Draft boleh parsial; review/final menampilkan field error, bukan final | Domain + form |
| T-05 | Draft typed → save → close/reopen app | Isi yang diketik sama, pasien/context benar | Repository + native |
| T-06 | Review stale version; draft diubah sebelum konfirmasi | Conflict, tinjau ulang; tidak memfinalkan data lama | Domain |
| T-07 | Edit/delete final note melalui UI/repository/API | Ditolak; isi/waktu/actor snapshot tidak berubah | Domain + repository |
| T-08 | Finalisasi lalu buka detail/history | Note final, consultation masih in_progress | Integration |
| T-09 | Complete tanpa final atau cancel dialog | Tidak completed dan tidak ada earning tambahan | Domain + modal |
| T-10 | Complete dua kali/ketuk ganda/retry operationKey | Satu completion/earning/event | Transaction |
| T-11 | Visit scheduled → arrived/examining langsung atau mundur | Ditolak; tahap tetap | Domain |
| T-12 | Jadwal end ≤ start, overlap/block, date masa lalu | Validation/slot error; tidak terbooking | Domain + form |
| T-13 | Edit jam kerja atau toggle off setelah accepted | Janji lama tetap; slot/request baru mengikuti policy | Integration |
| T-14 | Proposal pending → reject/accept, slot berubah sebelum accept | Jadwal lama tetap saat reject; conflict saat slot tidak lagi valid | Domain |
| T-15 | Dua accept bersamaan pada slot overlap | Maksimum satu accepted; lainnya conflict | Backend nanti; transaksi lokal sekarang |
| T-16 | Request di-cancel di sesi Peternak sebelum dokter accept | Stale command ditolak | Domain |
| T-17 | Tap metode bayar tanpa submit; pending/failed service | Tidak paid, chat tidak in_progress; error bisa retry | Integration |
| T-18 | Payment callback/outcome duplicate/reference/amount mismatch | Tidak debit ganda; mismatch ditolak | Service + backend nanti |
| T-19 | Message/media gagal atau izin kamera ditolak | Error/retry; input tak hilang; tidak sent palsu | Native + service |
| T-20 | Send retry clientMessageId sama | Satu message; kedua pihak membaca record sama | Repository |
| T-21 | Recommendation edit/delete → review → send; list empty | Review berisi actual edits; empty send ditolak | Form + domain |
| T-22 | Reminder delivery sukses/gagal, care done, farmer report | Delivery/care/report tidak saling mengganti status | Domain |
| T-23 | Mark care done dua kali | Satu HealthEvent | Transaction |
| T-24 | Cart qty 0/negatif/pecahan, alamat kosong, harga quote berubah | Input invalid ditolak; quote direfresh; total server/local authoritative | Domain + form |
| T-25 | Doctor mencoba cart/checkout lewat route/use case | Ditolak | Role guard + domain |
| T-26 | Payment order gagal lalu tracking dibuka | Order tidak shipped/delivered; retry valid | Integration |
| T-27 | Rating sebelum selesai/dokter lain/duplikat/nilai di luar 1–5 | Ditolak; aggregate tidak berubah | Domain |
| T-28 | Gross100.000 commission10.000 | Net90.000; available/pending sesuai ledger | Domain |
| T-29 | Withdrawal amount0/negatif/>available, saldo0 | Ditolak tanpa submission/reservation | Domain + form |
| T-30 | Saldo600.000, withdraw200.000 → submitted → paid | Available400.000; reserved200.000 saat submitted lalu0 saat paid; tidak debit dua kali | Transaction |
| T-31 | Withdrawal cancel review, submit failure, duplicate confirm, concurrent submits | Cancel/failure tanpa reservasi; duplicate sekali; total reservasi tidak melebihi saldo sebelum pengajuan | Domain + backend concurrency nanti |
| T-32 | Withdrawal rejected/failed setelah submitted | Reservation dilepas satu kali, history tetap ada | Transaction |
| T-33 | Notifications event duplicate/recipient berbeda/prefs off | Tidak duplikat/bocor; prefs mengatur delivery, bukan menghapus record | Repository |
| T-34 | Session expired/logout/role switch | Guard mengarah ke auth/peran yang benar; domain data tetap | Native + auth |
| T-35 | Disk/database write gagal | Tidak menampilkan saved/success; rollback; retry menjaga data sebelumnya | Repository fault injection |

## UI dan visual Android

Periksa hardware back dan header back; kembali dari chat/viewer/modal tidak kehilangan consultationId; modal dismiss tidak mengirim command; tab kembali mempertahankan konteks yang tepat. Dirty forms menawarkan pilihan simpan/buang/tetap; tidak ada dialog tak dapat ditutup.

Periksa keyboard pada login/register/booking/chat/clinical/withdrawal: field aktif dan tombol kirim/simpan dapat dijangkau, keyboard type sesuai input, error tidak tertutup. Scroll daftar panjang dan seluruh clinical/availability form, termasuk konten di bawah viewport Figma. Bottom navigation tidak menutup item atau action terakhir; safe area tidak double-count status bar.

Viewport acuan 390 × 844 logical units; uji juga 360 × 800 dan 412 × 915 atau ukuran emulator setara. Pada device density berbeda, catat px/dp dan crop hanya system chrome untuk perbandingan. Uji font scale 1.0 dan 1.3, nama/alamat/keluhan panjang, network/service delays, empty/loading/error/disabled.

Visual QA membandingkan warna, Inter/weight/line-height, margin, card/button sizes, icon meaning/geometry, nav active state dan layar scroll. Gunakan [screenshot referensi lokal](reference/figma/README.md); ambil reference terbaru bila Figma berubah. Jangan mengklaim pixel-match dari screenshot web atau membandingkan data fixture yang berbeda tanpa mencatatnya.

## Bukti per run

Catat tanggal, commit bila Git sudah ada, environment/Android OS/device, script/command, pass/fail/blocked, test IDs, screenshot/log artifact, selisih visual dan alasan. Backend yang belum ada diberi Not Run, bukan Passed. Tidak ada coverage percentage fiktif atau klaim seluruh flow lulus karena typecheck.

## Hasil verifikasi dokumentasi sebelum FE-00

Tanggal: 5 Oktober 2026. Pemeriksaan sebenarnya pada pekerjaan dokumentasi:

- Folder awal kosong; tidak ada manifest/source/backend/AGENTS; belum Git repository.
- Figma MCP berhasil membaca halaman, hierarchy, component variants, tokens dan sampel navigation actions.
- Dua dashboard dibaca dengan high-fidelity context dan screenshot; enam screenshot tambahan diperiksa visual. Total delapan PNG referensi disimpan lokal.
- Pemeriksaan otomatis Python lulus: 15 Markdown, 49 link lokal/anchor valid, 3 JSON dapat diparse, 8 PNG berukuran390 ×844, 20 fitur Peternak/18 Dokter berurutan dan terhubung ke backlog, 26 tiket frontend/18 backend, serta node mapping sesuai inventory dan283 named screen variants. Tidak ditemukan link rusak, ID tiket hilang atau PNG invalid pada run akhir.

Build aplikasi, typecheck, lint source, unit/domain tests, E2E/native Android, dan visual comparison aplikasi saat baseline dokumentasi: **Not Run — project belum dibuat**. Pemeriksaan gambar referensi bukan pengujian aplikasi.

## Hasil pemeriksaan FE-00

Tanggal: 5 Oktober 2026. Lingkungan: macOS, Node.js `24.1.0`, npm `11.3.0`, Expo SDK `~57.0.26`, JDK Android Studio `21`, Gradle `9.3.1`, Android SDK `/Volumes/HowSSD/AndroidStudio/SDK/sdk`. Perangkat yang terlihat ADB: HP USB model `2311DRK48G`. Emulator tidak berjalan; ditutup atas permintaan pengguna.

- `npm ci` — **Lulus**; 747 package terpasang. npm melaporkan 23 advisori (7 moderate, 16 high); rincian belum diaudit dan tidak ada perbaikan otomatis.
- `npm run check` — **Lulus**; `tsc --noEmit` dan `expo lint` selesai dengan exit code 0.
- `npx expo export --platform android` — **Lulus**; Metro membuat bundle JavaScript Android. Ini bukan build native atau uji perangkat.
- `./gradlew assembleDebug` — **Lulus**; menghasilkan `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` berukuran sekitar 60 MB.
- `npm run android` — **Lulus**; Expo membangun, memasang, lalu membuka development build pada HP USB model `2311DRK48G`. Pengguna memilih “Don’t send” pada Play Protect, jadi APK tidak dikirim ke Google. Screenshot perangkat: [fe00-phone-launch.png](reference/android/fe00-phone-launch.png). Aplikasi menampilkan shell FE-00 tanpa crash yang terlihat.
- Setup SDK pada volume exFAT memerlukan perapian karena isi NDK 27.1, Platform Android 36, dan Build Tools 36.0.0 berada satu tingkat di bawah jalur SDK standar. CMake juga membaca 43 file AppleDouble `._*-DetermineCompiler.cmake`; salinannya disimpan di `/private/tmp/vetlink-cmake-appledouble`, lalu dikeluarkan dari direktori modul aktif. Setelah itu build native lulus.
- Tes unit/domain/repository, E2E, dan perbandingan visual terhadap Figma — **Not Run**; fitur domain dan layar produk belum dimulai. Screenshot membuktikan smoke test perangkat, bukan penerimaan desain atau flow produk.

## Hasil pemeriksaan FE-01

Tanggal: 5 Oktober 2026. Lingkungan: macOS, Node.js `24.1.0`, npm `11.3.0`, Expo SDK `~57.0.26`, React Native `0.86.3`, JDK `23.0.1`, Gradle `9.3.1`, Android SDK `/Volumes/HowSSD/AndroidStudio/SDK/sdk`; perangkat Xiaomi `2311DRK48G` melalui USB. Resolusi perangkat 1220 × 2712 px pada density 480 dpi, sekitar 407 × 904 dp. Simulator tetap tertutup.

- Figma `get_design_context` dan screenshot berhasil diperiksa untuk tombol Peternak `12:1666`, tombol Dokter `75:2492`, field `75:2509`, status `75:2614`, dan chat Dokter `46:16`. Pemetaan serta selisih tercatat di [Figma mapping](FIGMA_MAPPING.md).
- `npm run check` — **Lulus**; typecheck TypeScript dan ESLint, termasuk harness pemeriksaan FE-01.
- `npx expo export --platform android` — **Lulus**; bundle Android menyertakan empat bobot Inter lokal dan font Lucide.
- `GRADLE_USER_HOME=/private/tmp/vetlink-gradle ./gradlew --no-daemon --max-workers=1 assembleDebug` — **Lulus**; APK debug sekitar 161 MB. Development build FE-01 dipasang dan dijalankan pada HP; katalog komponen hanya aktif di development melalui `EXPO_PUBLIC_FE01_CHECKS=1`.
- Gradle mencatat peringatan `NODE_ENV` tidak ditetapkan, Android SDK XML versi 4 dibaca toolchain yang mengenali sampai versi 3, dan fitur Gradle deprecated. Semuanya non-blocking pada build ini.
- Android fisik — **Lulus untuk interaksi komponen**: tombol utama Peternak dan aksi retry memperbarui feedback diagnostik; tinggi tombol Peternak/Dokter 52/48 dp; target EditText dan retry 44 dp. Field menerima teks `Kandang utama uji`, membacanya kembali melalui accessibility tree, dan membuka keyboard dengan field tetap terlihat. Teks bantuan membungkus pada font besar; drag menggulir konten (dan menutup keyboard sesuai `keyboardDismissMode="on-drag"`). Dialog teks panjang membuka, tombol Kembali/Konfirmasi bekerja, dan Back Android menutup dialog tanpa menjalankan konfirmasi.
- Font besar — **Diuji pada pilihan OEM 125%**, terdekat dengan target tetapi bukan tepat 130%; galeri juga diperiksa pada 145%. Field/helper dan dialog tetap terbaca, tombol dialog tetap terlihat. Xiaomi tidak menyediakan 130% pada slider yang tersedia; setelah tes, ukuran dipulihkan ke 100% melalui Pengaturan. Nilai akhir `font_scale` dan `device_font_scale` diverifikasi 1.0.
- Bukti Android: [katalog komponen pada font 100%](reference/android/fe01-component-catalog-font100.png), [form pada 125%](reference/android/fe01-component-form-font125.png), [keyboard pada 125%](reference/android/fe01-component-keyboard-font125.png), dan [dialog pada 125%](reference/android/fe01-component-dialog-font125.png). Screenshot adalah katalog diagnostik development, bukan screen produk.
- Viewport visual — ukuran acuan tepat 390 × 844 dp dan ukuran kecil 360 × 800 dp **Belum dilakukan**. Perangkat asli 407 × 904 dp; `adb shell wm size 1170x2532` ditolak Android dengan `SecurityException` karena membutuhkan `WRITE_SECURE_SETTINGS`. Izin sistem tidak diberikan. Karena itu, screenshot perangkat adalah tinjauan visual kualitatif dan bukan pixel-match pada ukuran Figma.
- Figma MCP menolak konteks/screenshot untuk Peternak Chat `12:2353` dan Logout Dialog `12:3184` dengan pesan batas panggilan Starter plan. Node lain yang terbaca tetap menjadi acuan; pembandingan terhadap dua node tersebut masih tertunda.
- Pada pemeriksaan FE-01, tes unit/domain/repository dan E2E belum tersedia; tes domain ditambahkan pada FE-02, sementara E2E masih menunggu screen produk.
- Instalasi dependency FE-01 melaporkan 24 advisori npm (8 moderate, 16 high). Rincian belum diaudit dan tidak menjalankan `npm audit fix`.

## Hasil pemeriksaan FE-02

Tanggal: 5 Oktober 2026. Lingkungan: macOS, Node.js `24.1.0`, npm `11.3.0`, Expo SDK `~57.0.26`, React Native `0.86.3`, JDK `23.0.1`, Gradle `9.3.1`, Android SDK `/Volumes/HowSSD/AndroidStudio/SDK/sdk`; HP Xiaomi `2311DRK48G` lewat USB. Simulator tetap tertutup.

- `npm install` memasang `expo-sqlite ~57.0.3`; `npx expo prebuild --platform android` memperbarui native project CNG. Tidak ada kode Kotlin aplikasi buatan tangan.
- `npm run check` — **Lulus**; typecheck, ESLint, dan enam tes `node:test` meliputi fixture/relation guard, verifikasi dokter dan akses peserta, transisi Visit, finalisasi/immutability ClinicalNote, saldo ledger, dan retry event.
- `npx expo export --platform android` — **Lulus**; Metro membundel 666 modul Android.
- `GRADLE_USER_HOME=/private/tmp/vetlink-gradle ./gradlew --no-daemon --max-workers=1 assembleDebug` — **Lulus**; development APK dengan Expo SQLite tersusun. Gradle menampilkan peringatan SDK XML versi 4 serta deprecation dependency; tidak menghalangi build.
- ADB melihat HP Xiaomi `2311DRK48G`; `adb install -r` berhasil dan development app dibuka. Bootstrap membuat `files/SQLite/vetlink.db`; log Metro mencatat schema `1`, seed `fe02-v1`, 61 entitas, 79 relasi, `seedStatus=already-seeded` setelah restart.
- Snapshot read-only database di HP — **Lulus**: `PRAGMA foreign_key_check` kosong dan `PRAGMA integrity_check` mengembalikan `ok`. Marker seed tetap ada, preference kembali ke nilai semula setelah probe, dan ClinicalNote tetap `draft` versi 1.
- Cold restart pertama mengubah preferensi fixture, lalu app ditutup paksa dan dibuka kembali; nilai yang diubah terbaca dan seed tidak ditulis ulang. Cold restart berikutnya mengirim ulang event diagnostik yang sama: adapter SQLite melaporkan `duplicate-on-restart`, tetap satu notification dan satu health event; record probe dibersihkan atomik sehingga jumlah kembali menjadi 61 entitas/79 relasi.
- Pengulangan diagnostik development: jalankan `EXPO_PUBLIC_FE02_CHECKS=1 npx expo start --dev-client --port 8082 --localhost`, lalu untuk cold restart gunakan `adb shell am force-stop com.vetlink.mobile` dan buka kembali VetLink. Hentikan Metro diagnostik dan jalankan Metro normal setelah hasil `Persistensi setelah restart lulus` muncul.
- Screenshot: [sebelum restart](reference/android/fe02-persistence-before-restart.png) dan [setelah restart](reference/android/fe02-persistence-after-restart.png). Keduanya berasal dari harness diagnostik development; Metro lalu dikembalikan ke mode normal dan HP menampilkan shell VetLink.
- Perbandingan Figma tidak diperlukan untuk fondasi penyimpanan ini; belum ada layar produk baru. FE-01 masih memiliki pembandingan viewport/screen tertunda. Flow produk, FE-03/04, dan E2E belum diuji.
- npm melaporkan 24 advisori (8 moderate, 16 high) setelah dependency FE-02. Rincian belum diaudit; tidak menjalankan `npm audit fix`.

## Hasil pemeriksaan FE-04

Tanggal: 5 Oktober 2026. Expo SDK `~57.0.26`; paket media `expo-image-picker ~57.0.20`, `expo-document-picker ~57.0.3`, dan `expo-file-system ~57.0.7`. Emulator tetap tertutup.

- `npm run check` — **Lulus**: typecheck, ESLint, dan 15 tes domain/service. Lima tes FE-04 memeriksa commit profil farm/alamat, dokumen lokal dan pengajuan pending, pemetaan empat state verifikasi/reason, revisi sebagai submission baru tanpa menimpa hasil lama, penolakan pengajuan pada peran Peternak, pencegahan retry saat pending, serta guard menerima layanan untuk dokter pending.
- Figma `get_design_context` node Profil Peternak `12:3066` dan Dokter `46:34` — **Belum tersedia**; MCP mengembalikan batas panggilan Starter plan. Implementasi mengacu pada node dan tokens yang sudah dipetakan; tidak menyatakan visual match.
- `npx expo prebuild --platform android` — **Lulus**; Expo membangkitkan native project dan mengautolink image picker, document picker, serta file system. Tidak ada Kotlin aplikasi buatan tangan.
- `npx expo export --platform android` — **Lulus**; Metro membundel 710 modul dan mengekspor bundle Android 1.9 MB.
- `GRADLE_USER_HOME=/private/tmp/vetlink-gradle ./gradlew --no-daemon --max-workers=1 assembleDebug` — **Lulus**; `BUILD SUCCESSFUL` dalam 2 menit 44 detik. Ada peringatan SDK XML versi 4 serta deprecation Gradle/Expo yang tidak menghalangi build.
- Pemasangan APK dan pemilihan foto/PDF pada HP — APK berhasil diperbarui melalui `adb install -r` tanpa menghapus data; layar terdeteksi sedang tidur (`mWakefulness=Dozing`) dan screenshot hitam. Interaksi/picker belum diuji sampai layar dibuka kunci secara manual. Emulator tidak dibuka atau dipakai.
- Alur verifikasi baru menyimpan pengajuan `pending`. Tidak ada reviewer lokal yang tepercaya untuk mengubah status menjadi `revision_required`/`verified`; layar membaca status tersebut dari entity jika diberikan sumber tepercaya. Dokter non-verified tetap ditolak oleh domain guard.

## Hasil pemeriksaan FE-06

Tanggal: 5 Oktober 2026. Perubahan FE-06 sejauh ini hanya domain/use case, repository binding, dan test; UI belum dibuat karena Figma MCP membatasi akses Starter. Simulator tetap tertutup.

- `npm run check` — **Lulus**; typecheck, ESLint, dan 26 tes domain/service. Enam skenario FE-06 memeriksa validasi field, kombinasi search/filter, list/detail sesuai owner dan farm, pembuatan ID unik beserta attachment foto dalam satu commit, edit record/version dan pelepasan relasi foto, serta pembatasan species dan MIME foto.
- `npx expo export --platform android` — **Lulus**; Metro membundel 716 modul dan menghasilkan bundle Android sekitar 2 MB.
- `GRADLE_USER_HOME=/private/tmp/vetlink-gradle ./gradlew --no-daemon --max-workers=1 assembleDebug` — **Lulus**; `BUILD SUCCESSFUL` dalam 27 detik (460 task; 17 dijalankan, sisanya up-to-date).
- `adb devices -l` — **Lulus** setelah SDK dimount dan HP disambungkan ulang; Xiaomi `2311DRK48G` terdeteksi melalui USB. Tidak ada APK native baru yang dipasang karena perubahan FE-06 hanya TypeScript; smoke memakai development build yang sudah terpasang.
- Smoke startup pada development build terpasang — **Lulus terbatas** setelah layar HP dinyalakan, Metro localhost berjalan pada port 8083, dan `adb reverse` disiapkan. Deep link membuka VetLink sampai layar “Pilih Peran”; screenshot [fe06-role-selection.png](reference/android/fe06-role-selection.png) menjadi bukti. Metro mencatat bootstrap LocalStore (`schema=2`, seed `fe02-v1`, 61 entitas, seed sudah ada) tanpa error JavaScript. Alur layar ternak, input, picker, dan visual Figma belum diuji karena UI FE-06 belum dibuat.
- `get_design_context` beserta screenshot untuk node `12:1889`, `12:1934`, `12:3196`, `12:1980`, `12:2019`, dan `12:2032` — **Terhalang**; seluruh panggilan ditolak karena tool call limit Starter. `figma_whoami` mengonfirmasi plan tim Starter. Screenshot UI Android, interaksi UI, dan visual Figma belum diuji.

## Hasil pemeriksaan FE-05

Tanggal: 5 Oktober 2026. Dashboard Peternak/Dokter memakai screenshot referensi lokal `farmer-dashboard.png` (`12:1833`) dan `vet-dashboard.png` (`46:7`) yang diinspeksi sebelumnya; permintaan konteks/screenshot Figma terkini tidak dapat dijalankan karena batas Starter MCP. Simulator tetap tertutup.

- `npm run check` — **Lulus**; typecheck, ESLint, dan 20 tes domain/service. Lima tes FE-05 menguji hitung dashboard Peternak dari data milik akun, agenda/reminder/ledger Dokter, availability hanya untuk status verified, janji accepted tetap tersimpan ketika availability dimatikan, serta akses detail konsultasi berdasarkan ID/assignment.
- `npx expo export --platform android` — **Lulus**; Metro membundel 714 modul dan menghasilkan bundle Android 2 MB.
- `npx expo prebuild --platform android` — **Lulus**; native project Android dibangkitkan dari konfigurasi Expo.
- `GRADLE_USER_HOME=/private/tmp/vetlink-gradle ./gradlew --no-daemon --max-workers=1 assembleDebug` — **Lulus**; `BUILD SUCCESSFUL` (17 detik pada incremental build), menghasilkan APK debug sekitar 168 MB.
- Instalasi dan peluncuran FE-05 pada HP — APK terbaru berhasil dipasang melalui USB tanpa menghapus data. Setelah layar dibangunkan, [screenshot perangkat](reference/android/fe05-role-selection.png) menunjukkan layar “Pilih Peran” dan pilihan Peternak sudah terpilih; dashboard belum dibuka, sehingga interaksi dashboard belum diuji. Ketukan “Masuk” perlu dilakukan langsung di HP karena MIUI menolak input tap ADB dengan `INJECT_EVENTS`. Simulator tetap tertutup.
- Perbedaan visual yang diketahui: aksi Peternak pada screenshot Figma `Tambah ternak/Konsultasi` belum seluruhnya tersedia; yang ditampilkan adalah profil peternakan dan konsultasi saya. Tab Ternak/Pesanan/Pasien disabled sampai tiket terkait diimplementasikan. Pembandingan pixel pada 390 × 844 dp dan font besar belum dilakukan.

## Hasil pemeriksaan FE-03

Tanggal: 5 Oktober 2026. Lingkungan: macOS, Node.js `24.1.0`, npm `11.3.0`, Expo SDK `~57.0.26`, React Native `0.86.3`, SecureStore `~57.0.4`, Crypto `~57.0.3`, JDK `23.0.1`, Gradle `9.3.1`; HP Xiaomi `2311DRK48G` melalui USB, 1220 × 2712 px atau sekitar 407 × 904 dp. Simulator tetap tertutup.

- `npm install` menambahkan `expo-secure-store` dan `expo-crypto` sesuai SDK 57; tidak ada kode Kotlin aplikasi buatan tangan.
- `npm run check` — **Lulus**; typecheck/lint dan 10 tes `node:test`. Empat tes FE-03 menguji pendaftaran role-specific dan duplikasi email, pencegahan role bypass, reset credential lokal tanpa mengambil alih fixture, serta logout yang mempertahankan akun/data domain.
- `npx expo prebuild --platform android` — **Lulus**; modul native SecureStore/Crypto terautolink. `npx expo export --platform android` — **Lulus**, bundle Android memuat 680 modul.
- `GRADLE_USER_HOME=/private/tmp/vetlink-gradle ./gradlew --no-daemon --max-workers=1 assembleDebug` — **Lulus**, 7 menit 15 detik. Native module SecureStore/Crypto terkompilasi; peringatan deprecation Gradle/Expo dan Android SDK XML v4 tidak menghalangi build.
- `adb devices -l` melihat hanya HP USB `WOGYXS4THUQ8H6UO`, model `2311DRK48G`; `adb install -r` berhasil dan VetLink dibuka. Layar Splash/Mulai tampil; screenshot [fe03-start-screen.png](reference/android/fe03-start-screen.png). Screenshot awal hitam terjadi saat Metro belum tersambung, lalu layar termuat setelah Metro di port 8082 dan `adb reverse` disiapkan.
- Snapshot baca database setelah bootstrap — **Lulus**: migration schema `1 → 2`, 61 entitas/79 relasi tetap, `PRAGMA integrity_check=ok`, `foreign_key_check` kosong. Tidak ada akun percobaan yang dibuat pada HP.
- Unique index email diuji pada salinan snapshot SQLite: `BUDI@EXAMPLE.TEST` dengan spasi tepi ditolak ketika `budi@example.test` sudah ada; transaksi tes dibatalkan dan hanya menyentuh file sementara.
- Navigasi form, keyboard, registrasi/login/reset/logout, cold restart sesi, dan switch role pada HP — **Belum diuji**. `adb shell input tap` ditolak MIUI dengan `SecurityException: Injecting input events requires ... INJECT_EVENTS`. Pengguna diminta mengaktifkan Developer options → USB debugging (Security settings), atau mengetuk Mulai/Lewati manual supaya pemeriksaan dapat dilanjutkan. Jangan menghapus/menginstal ulang aplikasi; database fixture tetap terpasang.
- Figma `get_design_context` untuk screenshot Auth node `12:1672`, `12:1683`, `12:1697`, `12:1711`, `46:2`, dan form auth — **Belum tersedia**; MCP membalas “Starter plan tool call limit”. Mapping kode berdasarkan token/route lokal dan seluruh selisih dicatat di [Figma mapping](FIGMA_MAPPING.md); tidak mengklaim visual match.
- `npm install` melaporkan 24 advisori (8 moderate, 16 high). Tidak diaudit dan tidak menjalankan `npm audit fix`.
