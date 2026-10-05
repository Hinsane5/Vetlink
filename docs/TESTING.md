# Strategi pengujian VetLink

Status QA per 6 Oktober 2026: bukti FE-00/02 sebelumnya tetap berlaku. Tahap aktif memakai frontend tanpa autentikasi/backend jaringan; Pilih Peran membuka persona lokal. UI FE-06–12 tersedia, termasuk chat lokal dua peran. `npm run check` terbaru lulus typecheck, lint dan 79 tes domain/service; export Android lulus pada 749 modul. Xiaomi fisik membuka aplikasi sampai Pilih Peran dan screenshot tersimpan, tetapi satu tap ditolak MIUI dengan `INJECT_EVENTS`. Layar produk, form, filter, picker, kalender, chat, keyboard/dialog/back/scroll, cold restart draft perangkat, viewport kecil/font besar dan pembandingan visual 390 × 844 belum terbukti. Figma link terbaru terhalang kuota Starter.

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

- Figma `get_design_context` dan screenshot berhasil diperiksa untuk tombol Peternak `12:1666`, tombol Dokter `75:2492`, field `75:2509`, status `75:2614`, chat Dokter `46:16`, serta—melalui link terbaru—Peternak Chat `12:2353` dan Logout Dialog `12:3184`. Screenshot referensi baru berukuran 390 × 844; pemetaan serta selisih tercatat di [Figma mapping](FIGMA_MAPPING.md).
- `npm run check` — **Lulus**; typecheck TypeScript dan ESLint, termasuk harness pemeriksaan FE-01.
- `npx expo export --platform android` — **Lulus**; bundle Android menyertakan empat bobot Inter lokal dan font Lucide.
- `GRADLE_USER_HOME=/private/tmp/vetlink-gradle ./gradlew --no-daemon --max-workers=1 assembleDebug` — **Lulus**; APK debug sekitar 161 MB. Development build FE-01 dipasang dan dijalankan pada HP; katalog komponen hanya aktif di development melalui `EXPO_PUBLIC_FE01_CHECKS=1`.
- Gradle mencatat peringatan `NODE_ENV` tidak ditetapkan, Android SDK XML versi 4 dibaca toolchain yang mengenali sampai versi 3, dan fitur Gradle deprecated. Semuanya non-blocking pada build ini.
- Android fisik — **Lulus untuk interaksi komponen**: tombol utama Peternak dan aksi retry memperbarui feedback diagnostik; tinggi tombol Peternak/Dokter 52/48 dp; target EditText dan retry 44 dp. Field menerima teks `Kandang utama uji`, membacanya kembali melalui accessibility tree, dan membuka keyboard dengan field tetap terlihat. Teks bantuan membungkus pada font besar; drag menggulir konten (dan menutup keyboard sesuai `keyboardDismissMode="on-drag"`). Dialog teks panjang membuka, tombol Kembali/Konfirmasi bekerja, dan Back Android menutup dialog tanpa menjalankan konfirmasi.
- Font besar — **Diuji pada pilihan OEM 125%**, terdekat dengan target tetapi bukan tepat 130%; galeri juga diperiksa pada 145%. Field/helper dan dialog tetap terbaca, tombol dialog tetap terlihat. Xiaomi tidak menyediakan 130% pada slider yang tersedia; setelah tes, ukuran dipulihkan ke 100% melalui Pengaturan. Nilai akhir `font_scale` dan `device_font_scale` diverifikasi 1.0.
- Bukti Android: [katalog komponen pada font 100%](reference/android/fe01-component-catalog-font100.png), [form pada 125%](reference/android/fe01-component-form-font125.png), [keyboard pada 125%](reference/android/fe01-component-keyboard-font125.png), dan [dialog pada 125%](reference/android/fe01-component-dialog-font125.png). Screenshot adalah katalog diagnostik development, bukan screen produk.
- Viewport visual — 390 × 844 dp dan ukuran kecil 360 × 800 dp **Belum dilakukan**. Pada retrospektif, `adb shell wm size`/density menunjukkan perangkat asli 1220 × 2712 px, 480 dpi atau sekitar 407 × 904 dp. Override ke 390 × 844 dp sebelumnya ditolak Android dengan `SecurityException` karena membutuhkan `WRITE_SECURE_SETTINGS`; ukuran OEM kecil tidak tersedia untuk diuji. Font OEM 125% dan 145% yang sudah terdokumentasi tetap menjadi bukti keterbacaan; tidak diklaim sebagai pembandingan visual di target viewport.
- Figma references `12:2353` dan `12:3184` kini berhasil dibaca dari link terbaru setelah sesi sebelumnya menerima `-32001: Unknown tool`. Perbandingan konteks Logout dengan kode menemukan selisih: Figma menumpuk tombol konfirmasi di atas tombol batal, sedangkan `ConfirmationDialog` saat ini menaruh Batal lalu Konfirmasi berdampingan. Ini perbandingan spesifikasi dengan kode, bukan pixel-match; screenshot Android yang tersedia hanya galeri diagnostik, bukan layar Chat/Logout produk.
- Interaksi layar produk Chat/Logout pada Android — **Belum diuji** karena MIUI menolak input ADB. Posisi/ukuran aktual layar produk, termasuk dialog Logout, belum dapat diperiksa pada perangkat.
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
- Retrospektif perangkat pada sesi ini: Xiaomi terdeteksi dan awake, tetapi hanya halaman “Pilih Peran” berhasil dibuka. Tap uji berikutnya ditolak dengan `SecurityException: Injecting input events requires the caller (or the source of the instrumentation, if any) to have the INJECT_EVENTS permission.` Edit profil/farm/alamat, keyboard, pemilihan foto/dokumen, penyimpanan lewat form, state verifikasi UI, dan tampilan guard dokter non-verified tetap **Belum diuji di layar**. Tes service/domain profil/verifikasi dan guard yang sudah ada lulus dalam `npm run check`; itu bukan bukti interaksi UI.
- Alur verifikasi baru menyimpan pengajuan `pending`. Tidak ada reviewer lokal yang tepercaya untuk mengubah status menjadi `revision_required`/`verified`; layar membaca status tersebut dari entity jika diberikan sumber tepercaya. Dokter non-verified tetap ditolak oleh domain guard.

## Hasil pemeriksaan FE-06

Tanggal: 5 Oktober 2026. UI `LivestockFlow` kini menyediakan daftar/detail/tambah/edit ternak, search/filter species+sex, foto, empty/error/loading, dan konfirmasi setelah simpan. Sebelumnya domain FE-06 lulus enam skenario dengan 26 tes total; hasil itu tetap menjadi bukti service. Simulator tetap tertutup.

- Pemeriksaan kode terbaru `npm run check` — **Lulus**; typecheck, ESLint, dan 32 tes domain/service. Enam skenario FE-06 tetap mencakup validasi, kombinasi search/filter, owner/farm scope, pembuatan ID dan foto dalam satu commit, edit/version serta pelepasan foto, dan pembatasan MIME/species. Tes ini tidak menguji komponen React Native.
- `npx expo export --platform android` — **Lulus**; Metro membundel 724 modul dan menghasilkan bundle Android 2,1 MB untuk alur frontend terbaru.
- `GRADLE_USER_HOME=/private/tmp/vetlink-gradle ./gradlew --no-daemon --max-workers=1 assembleDebug` — **Lulus**; build akhir `BUILD SUCCESSFUL in 16s`, 460 task (17 dijalankan, 443 up-to-date).
- Xiaomi `2311DRK48G` terdeteksi melalui USB. APK terbaru dipasang dengan `adb install -r` (**Success**) tanpa menghapus data; deep link development client memuat bundle dan Metro mencatat `schema=2`, seed `fe02-v1`, 61 entitas, `already-seeded`, tanpa error JavaScript. Ini **smoke startup terbatas**, bukan bukti list/form FE-06. Screenshot build ini tidak disimpan karena overlay panggilan pribadi pada layar perangkat.
- Satu tap ADB pada layar “Pilih Peran” ditolak MIUI dengan `java.lang.SecurityException: Injecting input events requires the caller (or the source of the instrumentation, if any) to have the INJECT_EVENTS permission.` Daftar/detail, search/filter, validasi form, picker foto, edit, back/keyboard/scroll, dan penolakan akses di UI tetap **Belum diuji/terblokir**. Domain owner/farm scope lulus pada tes service.
- Node FE-06 `12:1889` pada file Figma utama gagal untuk context dan screenshot dengan pesan izin edit file `Looks like you don't have edit access to this file. The file owner can share it with you and make you an editor.` serta kode `INVALID_ARGUMENT`. Link terbaru untuk node yang sama terkena batas panggilan Starter. Karena acuan layar tidak berhasil diambil, tidak ada klaim pixel-match; rancangan mandiri mengikuti arahan pengguna dan dicatat pada [Figma mapping](FIGMA_MAPPING.md).

## Hasil pemeriksaan FE-07

Tanggal: 5 Oktober 2026. `PatientFlow` menyediakan daftar/detail pasien Dokter; `FarmerHealthFlow` sekarang menyediakan riwayat Peternak dari detail ternak, filter kategori, detail final hanya baca, viewer lampiran, dan form laporan Peternak. `FrontendFlow` membuka persona lokal tanpa login. Simulator tetap tertutup.

- `npm run check` — **Lulus**; typecheck, ESLint, dan 32 tes domain/service. Enam tes FE-07 memeriksa laporan Peternak terpisah/idempotent, riwayat final-only, filter pasien, scope assignment, dan akses/URI lampiran. Ini tidak menguji komponen React Native.
- Export awal sebelum UI riwayat Peternak: `npx expo export --platform android` — **Lulus**; 721 modul, bundle Android 2,1 MB.
- Build awal sebelum UI riwayat Peternak: Gradle `assembleDebug` — **Lulus** dalam 26 detik (460 task; 17 dijalankan, 443 up-to-date). Percobaan sandbox pertama gagal membuka socket lock (`java.net.SocketException: Operation not permitted`); build berhasil setelah dijalankan dengan akses yang diperlukan.
- Xiaomi `2311DRK48G` (1220 × 2712 px, 480 dpi, sekitar 407 × 904 dp; font scale 1.0) terdeteksi lewat ADB. APK debug terbaru dipasang dengan `adb install -r`, Metro lokal tersambung, dan bundle Android termuat sampai “Pilih Peran”. Log Metro menunjukkan `schema=2`, `seed=fe02-v1`, `entities=61`, tanpa error JavaScript. Screenshot startup: [fe07-ui-startup-after-build.png](reference/android/fe07-ui-startup-after-build.png). Ini hanya smoke startup, bukan bukti layar pasien.
- Interaksi UI FE-07 pada build sebelumnya — **Belum diuji/terblokir**. Tap ke layar Pilih Peran ditolak dengan `java.lang.SecurityException: Injecting input events requires the caller (or the source of the instrumentation, if any) to have the INJECT_EVENTS permission.` Daftar pasien, riwayat Peternak, form, filter, modal/back, keyboard/scroll, dan viewer lampiran belum diuji pada HP. Tidak ada klaim lulus visual.
- Figma link terbaru [Dokter / Tampilan dan interaksi](https://www.figma.com/design/TPG6qZunK9EY4z1Vy0GKDx/Untitled?node-id=93-7181&t=hYv9JEpqvZmEonSz-) berhasil untuk node daftar `80:4594`, detail `80:4726`, vaksin `80:4759`, obat `80:4786`, dan final `80:4842`; screenshot acuan layar utama 390 × 844 telah diperiksa. Frame `93:7181` mula-mula memberi metadata ringkas karena ukuran, lalu child nodes memberi konteks high-fidelity.
- Node Peternak `12:2032`, `12:2068`, dan `12:2132` menghasilkan error persis `You've reached the Figma MCP tool call limit on the Starter plan. Upgrade your plan for more tool calls: https://www.figma.com/files/team/1688904264667270127/all-projects?upgrade=mcp_rate_limit_paywall`. `12:2100` sempat berhasil. `figma_whoami` berjalan dan melaporkan tier `starter`, seat `View`; ini rate limit, bukan tool MCP yang tidak tersedia (`-32001: Unknown tool`) dan bukan error autentikasi/izin file.
- Pemeriksaan terbaru setelah penambahan `FarmerHealthFlow` dan bypass autentikasi: `npm run check` **Lulus** (32 tes), export Android **Lulus** (724 modul), Gradle debug build **Lulus** (16 detik). APK akhir dipasang pada Xiaomi dan Metro memuat LocalStore (`schema=2`, 61 entitas) hingga layar awal tanpa error JavaScript. Tap ADB tetap ditolak; interaksi FE-07 pada build terbaru **Belum diuji**. Layar riwayat Peternak dibuat dari tokens dan kontrak fitur karena node Figma tidak dapat diakses; perbandingan visual belum ada.

## Hasil pemeriksaan FE-05

Tanggal: 5 Oktober 2026. Dashboard Peternak/Dokter memakai screenshot referensi lokal `farmer-dashboard.png` (`12:1833`) dan `vet-dashboard.png` (`46:7`) yang diinspeksi sebelumnya; permintaan konteks/screenshot Figma terkini tidak dapat dijalankan karena batas Starter MCP. Simulator tetap tertutup.

- `npm run check` — **Lulus**; typecheck, ESLint, dan 20 tes domain/service. Lima tes FE-05 menguji hitung dashboard Peternak dari data milik akun, agenda/reminder/ledger Dokter, availability hanya untuk status verified, janji accepted tetap tersimpan ketika availability dimatikan, serta akses detail konsultasi berdasarkan ID/assignment.
- `npx expo export --platform android` — **Lulus**; Metro membundel 714 modul dan menghasilkan bundle Android 2 MB.
- `npx expo prebuild --platform android` — **Lulus**; native project Android dibangkitkan dari konfigurasi Expo.
- `GRADLE_USER_HOME=/private/tmp/vetlink-gradle ./gradlew --no-daemon --max-workers=1 assembleDebug` — **Lulus**; `BUILD SUCCESSFUL` (17 detik pada incremental build), menghasilkan APK debug sekitar 168 MB.
- Instalasi dan peluncuran FE-05 pada HP — APK terbaru berhasil dipasang melalui USB tanpa menghapus data. Screenshot [fe05-role-selection.png](reference/android/fe05-role-selection.png) menunjukkan “Pilih Peran”; dashboard tidak dibuka. Retrospektif sesi ini berhasil membuka development bundle terbaru lagi sampai layar yang sama, tetapi tap masih ditolak MIUI dengan `INJECT_EVENTS`. Data, tombol, tujuan navigasi, empty state, dan availability pada layar dashboard **Belum diuji**.
- Perbedaan visual yang diketahui: aksi cepat Peternak sekarang menampilkan “Tambah ternak” dan “Konsultasi saya”; tab Ternak dan Pasien Dokter aktif, sedangkan Pesanan masih nonaktif. Pembandingan pixel pada 390 × 844 dp dan font besar belum dilakukan.

## Hasil pemeriksaan FE-03

Tanggal: 5 Oktober 2026. Lingkungan: macOS, Node.js `24.1.0`, npm `11.3.0`, Expo SDK `~57.0.26`, React Native `0.86.3`, SecureStore `~57.0.4`, Crypto `~57.0.3`, JDK `23.0.1`, Gradle `9.3.1`; HP Xiaomi `2311DRK48G` melalui USB, 1220 × 2712 px atau sekitar 407 × 904 dp. Simulator tetap tertutup.

- `npm install` menambahkan `expo-secure-store` dan `expo-crypto` sesuai SDK 57; tidak ada kode Kotlin aplikasi buatan tangan.
- `npm run check` — **Lulus**; typecheck/lint dan 10 tes `node:test`. Empat tes FE-03 menguji pendaftaran role-specific dan duplikasi email, pencegahan role bypass, reset credential lokal tanpa mengambil alih fixture, serta logout yang mempertahankan akun/data domain.
- `npx expo prebuild --platform android` — **Lulus**; modul native SecureStore/Crypto terautolink. `npx expo export --platform android` — **Lulus**, bundle Android memuat 680 modul.
- `GRADLE_USER_HOME=/private/tmp/vetlink-gradle ./gradlew --no-daemon --max-workers=1 assembleDebug` — **Lulus**, 7 menit 15 detik. Native module SecureStore/Crypto terkompilasi; peringatan deprecation Gradle/Expo dan Android SDK XML v4 tidak menghalangi build.
- `adb devices -l` melihat hanya HP USB `WOGYXS4THUQ8H6UO`, model `2311DRK48G`; `adb install -r` berhasil dan VetLink dibuka. Layar Splash/Mulai tampil; screenshot [fe03-start-screen.png](reference/android/fe03-start-screen.png). Screenshot awal hitam terjadi saat Metro belum tersambung, lalu layar termuat setelah Metro di port 8082 dan `adb reverse` disiapkan.
- Snapshot baca database setelah bootstrap — **Lulus**: migration schema `1 → 2`, 61 entitas/79 relasi tetap, `PRAGMA integrity_check=ok`, `foreign_key_check` kosong. Tidak ada akun percobaan yang dibuat pada HP.
- Unique index email diuji pada salinan snapshot SQLite: `BUDI@EXAMPLE.TEST` dengan spasi tepi ditolak ketika `budi@example.test` sudah ada; transaksi tes dibatalkan dan hanya menyentuh file sementara.
- Navigasi form, keyboard, registrasi/login/reset/logout, cold restart sesi, dan switch role pada HP — **Belum diuji**. Retrospektif ini mengulang satu tap pada layar peran dan tetap ditolak MIUI dengan `SecurityException: Injecting input events requires the caller (or the source of the instrumentation, if any) to have the INJECT_EVENTS permission.` Sesi akun/peran tidak dilewati dengan fixture atau bypass. Data fixture dan aplikasi tetap terpasang; tidak ada simulator.
- Figma `get_design_context` untuk screenshot Auth node `12:1672`, `12:1683`, `12:1697`, `12:1711`, `46:2`, dan form auth — **Belum tersedia**; MCP membalas “Starter plan tool call limit”. Mapping kode berdasarkan token/route lokal dan seluruh selisih dicatat di [Figma mapping](FIGMA_MAPPING.md); tidak mengklaim visual match.
- `npm install` melaporkan 24 advisori (8 moderate, 16 high). Tidak diaudit dan tidak menjalankan `npm audit fix`.

## Hasil pemeriksaan FE-08

Tanggal: 5 Oktober 2026. UI direktori/profil dokter dibuka melalui tab Konsultasi Peternak; alur aktif tetap tanpa autentikasi/backend jaringan. Simulator tidak dibuka. Data fiktif tambahan disimpan pada repository lokal yang sama; booking FE-09 dan editor availability FE-11 belum dibuat.

- `npm run check` — **Lulus**, exit 0: typecheck, lint, dan 40 tes domain/service. Delapan skenario baru mencakup kombinasi filter, ID dokter berbeda, tarif efektif (termasuk offset zona waktu), ulasan konsultasi selesai yang cocok dengan pemilik/dokter, slot berzona waktu, konflik appointment/blocked/follow-up, guard verified/availability, batas end eksklusif, ekstensi fixture yang menjaga edit, serta rollback/retry transaksi pada SQLite in-memory. Tes ini tidak menjalankan komponen React Native atau input Android.
- `npx expo export --platform android --output-dir /private/tmp/vetlink-fe08-final-export` — **Lulus**, exit 0; 736 modul, bundle Hermes Android sekitar 2,2 MB.
- `env GRADLE_USER_HOME=/private/tmp/vetlink-gradle ANDROID_HOME=/Volumes/HowSSD/AndroidStudio/SDK/sdk ./gradlew --no-daemon --max-workers=1 assembleDebug` dari `apps/mobile/android` — **Lulus untuk build awal**, `BUILD SUCCESSFUL in 16s`; 460 task (17 dijalankan, 443 up-to-date). Setelah warning safe area ditemukan, build final diulang untuk menyertakan dependency layout native; hasilnya dicatat di bawah.
- ADB sandbox awal gagal memulai daemon dengan `could not install *smartsocket* listener: Operation not permitted`. Setelah mendapat akses eksekusi yang diperlukan, `adb devices -l` mendeteksi Xiaomi USB `2311DRK48G`. Ini keterbatasan sandbox lokal, terpisah dari penolakan input oleh Android di bawah.
- `adb install -r` — **Success**, mempertahankan data aplikasi. Metro normal pada port 8102 tersambung melalui USB reverse; deep link development client memuat bundle terbaru. Log startup: `[VetLink][local-store] schema=2 seed=fe02-v1 entities=62 seedStatus=already-seeded`. Ini **smoke bootstrap terbatas**, bukan bukti layar direktori/profil. Run awal juga memberi warning deprecation SafeAreaView shell, sehingga shell dan Modal filter kemudian diperbaiki dengan `react-native-safe-area-context ~5.7.0`; penerimaan inset pada layar direktori/profil tetap belum diuji.
- Salinan baca database aplikasi melalui `run-as` — **Lulus**: schema 2, 62 entitas/82 relasi, marker `fixture_directory_version=fe08-v1`, tiga profil mempunyai species/location, dua availability mempunyai weekday rules, satu Review, `integrity_check=ok`, dan `foreign_key_check` kosong. Pemeriksaan ini dilakukan karena FE-08 menambahkan ekstensi fixture; bukan pengulangan seluruh QA persistence/event FE-02. Tests membuktikan field existing, termasuk array kosong dan availability off, tidak ditimpa, retry tidak menggandakan ulasan, dan failure rollback.
- Satu tap pada tombol Lanjut sebagai Peternak yang ditemukan dari hierarchy VetLink ditolak dengan pesan persis `java.lang.SecurityException: Injecting input events requires the caller (or the source of the instrumentation, if any) to have the INJECT_EVENTS permission.` Exit 255. Pencarian/filter/reset, pemilihan dokter, layanan/tanggal jadwal, modal/header/hardware Back, keyboard/scroll, foto/fallback, teks panjang, serta perbandingan ukuran target/kecil/font besar — **Belum diuji/terblokir pada perangkat**. Tidak ada klaim lulus interaksi atau pixel-match. Tidak mengubah pengaturan keamanan MIUI atau memakai simulator untuk melewati batas tersebut.
- Figma FE-08 — **Terblokir**: node daftar `12:2161` pada file utama menolak izin edit, link terbaru terkena kuota Starter; context/screenshot layar tidak diperoleh. Ini berbeda dari MCP tool tidak tersedia dan bukan kegagalan autentikasi. Error persis serta rancangan mandiri tercatat di [Figma mapping](FIGMA_MAPPING.md).

Status fase terkait setelah FE-08:

| Fase | Bukti yang tetap berlaku | Penerimaan layar yang belum lengkap |
| --- | --- | --- |
| FE-00/02 | Bootstrap, persistence dan event dari run terdahulu; kompatibilitas ekstensi fixture FE-08 diperiksa seperlunya | Tidak mengulang seluruh acceptance tanpa perubahan relevan |
| FE-01 | Komponen dan font besar pernah diuji; checks terbaru lulus | Visual Figma Android, 390 × 844, ukuran kecil dan font besar pada layar produk terbaru belum diuji |
| FE-03 | Tes akun/sesi lokal historis tetap lulus | Auth tidak dipasang pada frontend aktif; acceptance daftar/masuk/reset/logout/sesi setelah reopen ditunda |
| FE-04 | Tes simpan profil/media/verifikasi/guard tetap lulus | Edit farm/alamat, picker, keyboard, persistence lewat form, status dan guard pada layar belum diuji |
| FE-05 | Tes proyeksi dashboard dan availability yang menjaga janji tetap lulus | Kedua dashboard, CTA/tujuan navigasi, empty dan toggle pada layar belum diuji |
| FE-06 | UI list/detail/tambah/edit kini tersedia; tes scope/validasi/filter/foto tetap lulus | Search/filter, form/foto/edit, back/keyboard dan akses akun lain di layar belum diuji |
| FE-07 | UI riwayat/pasien tersedia; tes assignment/final-only/laporan/lampiran tetap lulus | List/detail/filter/form/modal/viewer di layar belum diuji |
| FE-08 | UI direktori/profil/filter/jadwal tersedia; delapan tes baru, build dan bootstrap Android lulus | Interaksi dan visual layar tetap belum diuji karena input MIUI ditolak |

Seluruh FE-01/03–08 tetap **Sedang dikerjakan** pada backlog. Tidak mengubah status menjadi selesai hanya berdasarkan checks/build.

Pemeriksaan akhir FE-08 setelah perbaikan safe area:

- `npx expo install react-native-safe-area-context` memasang versi SDK 57 `~5.7.0` dan mengunci `5.7.0` pada lockfile. Provider dipasang stabil pada root; shell aktif dan Modal filter memakai inset native. Dependency native dibutuhkan untuk layout status bar/gesture, tanpa menulis Kotlin aplikasi sendiri. Acuan API: [dokumentasi resmi Expo](https://docs.expo.dev/versions/latest/sdk/safe-area-context/).
- `npm run check` akhir — **Lulus**, 40 tes/0 gagal; test ekstensi fixture juga memeriksa bahwa timestamp record tidak mundur saat menambah field dan retry tidak menulis ulang versi. `npx expo export --platform android --output-dir /private/tmp/vetlink-fe08-final-export` akhir — **Lulus**, 736 modul dan bundle sekitar 2,2 MB. Output sementara: `/private/tmp/vetlink-fe08-final-check.log` dan `/private/tmp/vetlink-fe08-final-export.log`.
- Gradle `assembleDebug` akhir — **Lulus**, `BUILD SUCCESSFUL in 3m 28s`; 492 task (66 dijalankan, 426 up-to-date). Log sementara: `/private/tmp/vetlink-fe08-safearea-build.log`. Ada warning deprecation pada dependency native, tanpa kegagalan build.
- APK akhir dipasang lagi dengan `adb install -r` (**Success**), lalu deep link Metro 8102 memuat “Pilih Peran”. Log LocalStore tetap schema 2/seed `fe02-v1`/62 entitas, tanpa error JavaScript pada startup akhir. Hierarchy menempatkan glyph brand pada y=264 px, dibanding y=144 px sebelum perbaikan, sehingga inset atas 120 px/40 dp diterapkan pada layar awal. [Screenshot startup akhir](reference/android/fe08-ui-startup-after-safe-area.png) diperiksa; status bar dan gesture tidak menutupi konten awal. Tombol Tools pada gambar berasal dari development client. Ini bukti inset/startup **layar awal saja**, bukan penerimaan visual atau interaksi direktori/profil/modal.

Tidak ada commit/push pada pengerjaan FE-08. Perubahan FE-06/07 yang sebelumnya belum di-commit tetap dipertahankan.


## Hasil pemeriksaan FE-09

Tanggal: 5 Oktober 2026. Jalur UI: Peternak → Konsultasi → dokter → Booking konsultasi → Tinjau biaya → Konfirmasi booking → Menunggu pembayaran → Lihat detail booking. Aplikasi aktif tetap tanpa autentikasi/backend jaringan; tidak membuka simulator, mengirim payment nyata, commit, atau push. Perubahan FE-06/07/08 yang belum di-commit dipertahankan.

| Pemeriksaan | Hasil / batas bukti |
| --- | --- |
| `npm run check` | Lulus: typecheck, lint, 49 tes; sembilan skenario booking baru memakai SQL SQLite in-memory serta migration/seed/adapter sebenarnya |
| Export Android | Lulus: `npx expo export --platform android --output-dir /private/tmp/vetlink-fe09-export-verified`; 740 modul, bundle Hermes 2,2 MB |
| Gradle debug | Lulus: `assembleDebug`, 24 menit 51 detik; 492 tasks (17 executed, 475 up-to-date), setelah cache/distribusi Gradle diunduh. Tidak ada dependency/native Kotlin aplikasi baru |
| Install APK | Lulus: `adb install -r` mengembalikan Success pada Xiaomi; data aplikasi dipertahankan |
| Draft | Tes lulus untuk save parsial, rehydration pada service baru, private owner, version conflict, discard dan draft baru; bukan bukti cold restart UI perangkat |
| Validasi booking | Tes lulus untuk alamat wajib, ternak akun lain, slot tidak valid, dokter belum verified, hilangnya verifikasi/berubahnya pemilik setelah review, availability off, tarif berubah dan versi draft stale |
| Atomicity/idempotensi | Tes lulus untuk consultation/quote/draft dalam satu transaksi, rollback saat quote gagal dan retry; submit paralel antar instance mengembalikan satu ID, dua Peternak pada slot sama hanya satu berhasil |
| Status / akses pasien | Konfirmasi hanya awaiting_payment dengan paymentId null; tes membuktikan tidak membuat Payment/Message dan tidak menambah assignment pasien dokter sebelum pembayaran |
| Media | Tes dengan adapter media fiktif lulus untuk pemanggilan store, metadata image/video persisten/private, rollback MIME invalid/gagal transaksi, metadata removed dan pemanggilan cleanup saat hapus/ganti/discard; picker OS, penyalinan file dan berkas video nyata pada Android belum diuji |
| Xiaomi startup | APK hasil build dibuka melalui Metro offline port 8102; [screenshot startup](reference/android/fe09-ui-startup-after-build.png) menunjukkan Pilih Peran dan inset nyata. Overlay gear Tools milik Expo development client, bukan tombol produk. Metro membaca schema 2, seed fe02-v1, 62 entitas, already-seeded. Ini bukan bukti membuka Booking |
| QA sentuh | Terblokir: tap tombol Lanjut sebagai Peternak ditolak MIUI (exit 255), termasuk setelah APK hasil build dipasang, sehingga flow booking belum dapat dimasuki melalui otomatisasi |
| Figma | Context/screenshot node Booking nyata 12:2280 gagal izin edit file utama; link terbaru terkena kuota Starter. Tool tersedia, bukan error Unknown tool/auth. Referensi lokal lama ditinjau dan layout dirancang mandiri; pixel-match belum diuji |

Error input yang benar-benar diperoleh:

```text
java.lang.SecurityException: Injecting input events requires the caller (or the source of the instrumentation, if any) to have the INJECT_EVENTS permission.
```

Perangkat fisik Xiaomi `2311DRK48G`, serial `WOGYXS4THUQ8H6UO`, viewport 1220 × 2712 px (480 dpi pada pemeriksaan sebelumnya), fontScale 1.0. Tidak mengubah pengaturan keamanan atau membuka simulator. `uiautomator` membuktikan hierarchy startup milik com.vetlink.mobile dengan Pilih Peran/Peternak/Dokter Hewan; tidak memperoleh hierarchy Booking atau bukti tap berhasil.

Penerimaan FE-09 yang masih **Belum diuji/terblokir**: pilihan layanan/ternak/tanggal/jam, perubahan keluhan/alamat, photo/video picker dan thumbnail/hapus, draft setelah cold restart Android, resume/discard dialog, review biaya, double tap pada UI, scroll teks panjang, keyboard, back Android, viewport 390 × 844/kecil/font besar. Pemilihan/payment pending/failed/success dan payment-success → requested **Belum dapat diuji** karena FE-19 belum dibuat; editor availability FE-11 belum dibuat. Video dipilih/disimpan dan dilabeli sebagai berkas, belum mempunyai playback form. Slot awaiting_payment belum mempunyai TTL produksi; itu keputusan terbuka DEC-17. File cleanup best effort melapor lewat kanal diagnostik bila gagal.

Status retrospektif fase terdahulu tetap akurat:

| Fase | Bukti yang tersedia | Yang tetap tertunda |
| --- | --- | --- |
| FE-00/02 | Bukti bootstrap/persistensi/integritas/idempotensi sebelumnya tetap berlaku; tes SQL baru diperlukan untuk perubahan booking | Tidak mengulang seluruh cold restart/event perangkat tanpa alasan baru |
| FE-01 | Tokens/komponen dan startup safe area sebelumnya | Perbandingan Figma Android 390 × 844, viewport kecil dan font besar |
| FE-03 | Tes domain historis masih lulus | QA masuk/reset/logout/sesi tidak dijalankan karena auth tidak aktif sesuai fokus frontend |
| FE-04 | UI profil dan tes save/domain tersedia | Edit profil/farm/alamat, picker dokumen/foto dan guard pada UI belum diuji di run ini |
| FE-05 | Dashboard/proyeksi serta tes availability tersedia | Flow kedua peran, tujuan tombol, empty state dan availability pada UI |
| FE-06 | UI ternak sekarang tersedia; tes ownership/validasi/photo/update lulus | Search/filter/form/foto/edit serta penolakan akses pada UI Android |
| FE-07 | UI riwayat/pasien dan tes domain tersedia | Interaksi/visual pada perangkat |
| FE-08 | UI direktori/profil/filter/jadwal dan tes tersedia | Interaksi/visual pada perangkat |
| FE-09 | UI form/review/result dan tes transaksi tersedia | QA interaksi Android, visual, dependensi FE-11/19; tetap Sedang dikerjakan |


Perintah native FE-09 yang benar-benar dijalankan dari `apps/mobile/android`:

```sh
env GRADLE_USER_HOME=/private/tmp/vetlink-gradle ANDROID_HOME=/Volumes/HowSSD/AndroidStudio/SDK/sdk ./gradlew --no-daemon --max-workers=1 assembleDebug
```

Runtime diuji dengan `npm start -- --port 8102 --offline` dari `apps/mobile`, reverse USB port 8102, force-stop lalu buka kembali lewat deep link development client. Ini bukti bootstrap APK/bundle terbaru; tidak dihitung sebagai kelulusan draft/form cold restart Android. Paket APK: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`. `git diff --check` akhir bersih; tidak ada commit/push.

## Hasil pemeriksaan FE-10 — 6 Oktober 2026

Checkpoint progres FE-06–09 di-commit sebagai `d21126a` (`feat: checkpoint frontend flows through FE-09`) atas instruksi pengguna, setelah status/diff diperiksa. Tidak di-push. Implementasi FE-10 selanjutnya berada di working tree. Frontend tetap tanpa autentikasi/backend jaringan; tidak membuka simulator.

| Pemeriksaan | Hasil dan batas bukti |
| --- | --- |
| `npm run check` | Lulus: typecheck, lint, 61 tes domain/service; 12 skenario FE-10 memakai SQLite sebenarnya in-memory, migration/seed dan adapter bersama |
| `npx expo export --platform android --output-dir /private/tmp/vetlink-fe10-export-final` | Lulus: 743 modul, bundle 2,3 MB. Export JS/Hermes, bukan APK baru atau bukti interaksi |
| Native APK | APK development FE-09 yang sudah terpasang dipakai kembali dengan Metro offline port 8102. Tidak ada dependency/config native baru; Gradle build/install baru tidak dijalankan untuk FE-10 |
| Xiaomi fisik | ADB melihat `WOGYXS4THUQ8H6UO`, model `2311DRK48G`; USB reverse/deep link membuka bundle terbaru sampai Pilih Peran. [Screenshot startup](reference/android/fe10-ui-startup-metro.png) diperiksa; inset layar awal terlihat, gear Tools berasal dari development client. Ini smoke startup terbatas |
| Database perangkat | Salinan baca DB+WAL setelah force-stop: integrity_check=ok, foreign_key_check kosong, 66 entitas/87 relasi; marker fixture_consultations_version=fe10-v1, request baru requested dan payment succeeded. Satu bookingDraft existing tetap ada; tidak menghapus/reset data perangkat. Bukti diperlukan karena ekstensi fixture baru, bukan pengulangan seluruh FE-02 |
| Input Android | Tap pada peran Dokter ditolak, exit 255: `java.lang.SecurityException: Injecting input events requires the caller (or the source of the instrumentation, if any) to have the INJECT_EVENTS permission.` Tidak mengubah keamanan MIUI atau bypass batas tersebut |
| Figma | Context dan screenshot node nyata Requests 46:8 pada file utama gagal izin edit; context dan screenshot root nyata 93:7181 link terbaru gagal kuota Starter. Error persis ada di FIGMA_MAPPING; tool MCP tersedia, bukan Unknown tool atau bukti auth gagal |

Tes FE-10 membuktikan:

- List/detail scoped sesuai owner/assignment, peran salah/akun asing dan Dokter membuka booking unpaid ditolak; histori tidak dibatasi ringkasan dashboard.
- Accept atomik menghasilkan scheduled dan Visit scheduled sekali; retry dua instance tidak menggandakan audit/visit. Reuse operationKey untuk keputusan berbeda dan versi stale ditolak.
- Penulisan memeriksa ulang trusted verification, payment succeeded dengan payable/owner/amount yang cocok, waktu future, jam praktik dan konflik blocked slot.
- Reject wajib alasan; reject/cancel berbayar hanya menandai refund_needed. Payment dan ledger tidak dianggap sudah direfund atau berubah. Pembatalan awaiting_payment tidak menghasilkan refund palsu.
- Propose mempertahankan waktu lama dan reservasinya. Decline memulihkan requested/scheduled. Approve memeriksa konflik kembali sebelum mengganti waktu; tarif snapshot tetap sama.
- Proposal fixture lama pada scheduled ditanggapi tanpa reset; kunjungan yang sudah en_route tidak dapat dibatalkan/dijadwalkan ulang. Cancel menyupersede usulan pending.
- Kegagalan penulisan audit rollback status dan Visit; retry berhasil. Draft tetap tersedia pada instance baru, version conflict ditolak, discard tersimpan; bootstrap tidak menimpa keputusan sebelumnya.
- Availability off mempertahankan layanan assigned, dashboard menjaga accepted appointment selama proposal pending. Lampiran harus tertaut dan milik owner/context booking submitted; URI asing/remote dan file yang removed tidak dibuka.
- Ekstensi fixture gagal di Payment me-rollback request dan marker, lalu retry berhasil tanpa duplikasi.

Penerimaan UI FE-10 **Belum diuji/terblokir**: tabs/search/status/ID, membuka detail, accept/reject/reason, slot proposal, konfirmasi terima/tolak usulan lintas peran, pembatalan, foto/error viewer, draft setelah cold restart perangkat, modal/back Android, keyboard/scroll, font besar/teks panjang dan visual 390 × 844/viewport kecil. Tes service di atas tidak membuktikan sentuhan UI. Video belum mempunyai playback. Payment-success → requested dari booking baru **Belum dapat diuji** sampai FE-19; request pra-bayar fiktif FE-10 hanya menyediakan data awal, bukan tombol mengubah status. Editor availability tetap FE-11.

| Fase | Status QA setelah FE-10 |
| --- | --- |
| FE-00/02 | Bukti sebelumnya tetap berlaku; pemeriksaan ekstensi fixture dilakukan karena perubahan baru |
| FE-01 | Perbandingan visual Android/Figma, viewport kecil dan font besar produk masih tertunda |
| FE-03 | Auth tidak aktif sesuai arahan frontend; QA daftar/masuk/reset/logout/sesi ditunda |
| FE-04 | Edit profil/farm/alamat, picker, penyimpanan lewat form, status verifikasi dan guard UI belum diuji |
| FE-05 | Service/dashboard tetap diuji; interaksi kedua dashboard, CTA, empty/availability belum diuji |
| FE-06 | UI sudah tersedia; search/filter/form/foto/edit/akses asing di Android belum diuji |
| FE-07 | UI riwayat/pasien tersedia; interaksi/filter/form/viewer di Android belum diuji |
| FE-08 | UI direktori/profil tersedia; interaksi/filter/slot/visual Android belum diuji |
| FE-09 | UI booking tersedia; form/media/review/draft Android dan dependensi FE-11/19 belum diterima |
| FE-10 | UI dan 12 tes baru tersedia; QA interaksi/visual Android serta integrasi pembayaran FE-19 belum diterima |
| FE-11 | UI editor availability/kalender tersedia; seluruh interaksi layar dan visual belum diuji di Android |
| FE-12 | UI chat tersedia dan 9 tes domain/repository lulus; chat pada layar Android, media viewer, retry sentuh, keyboard/scroll dan visual belum diuji |

FE-01/03–11 tetap **Sedang dikerjakan**. Tidak menaikkan status fase berdasarkan screenshot startup. Untuk review manual: Dokter → Konsultasi → request VL-V-106 → terima/tolak/usulkan; Peternak → Konsultasi saya → layanan yang sama → respons usulan. Waktu fixture 7 Oktober 2026 11:00–12:00 Asia/Jakarta sengaja tidak digeser otomatis; setelah lewat, permintaan tidak dapat diterima, sesuai guard stale.

## Hasil pemeriksaan FE-11 — 6 Oktober 2026

FE-11 menambahkan AvailabilityService/SQLite dan halaman Dokter **Jadwal → Atur ketersediaan**. FE-10 sebelumnya di-commit sebagai `8dd97a0`; FE-11 kini di-commit sebagai `917a83c` sesuai instruksi pengguna dan tidak di-push. FE-12 masih berada di working tree. Frontend tetap tanpa autentikasi/backend jaringan, serta simulator tidak dibuka.

| Pemeriksaan | Hasil dan batas bukti |
| --- | --- |
| `npm run check` dari `apps/mobile` | Lulus: TypeScript typecheck, lint, 70 tes domain/service (9 baru untuk FE-11) |
| `npx expo export --platform android --output-dir /private/tmp/vetlink-fe11-export-final` | Lulus: 746 modul; Hermes Android bundle 2,4 MB. Ini export JS, bukan APK baru atau bukti interaksi |
| Native build | Gradle tidak dijalankan untuk FE-11 karena hanya TypeScript/JavaScript dan tidak ada dependency/config native yang berubah. APK development yang ada memakai Metro port 8102 |
| Xiaomi fisik | ADB melihat `WOGYXS4THUQ8H6UO`, model `2311DRK48G`. Aktivitas aplikasi terbuka dan [screenshot startup](reference/android/fe11-startup-metro.png) menunjukkan Pilih/Ganti Peran; ini hanya membuktikan startup/inset layar awal |
| Interaksi layar | Satu tap biasa pada pemilih peran gagal dengan error persis `java.lang.SecurityException: Injecting input events requires the caller (or the source of the instrumentation, if any) to have the INJECT_EVENTS permission.` Layar FE-11 belum dibuka melalui perangkat. Tidak mengubah izin atau pengaturan keamanan MIUI |
| Figma | Skill `figma-design-to-code` sudah dibaca sebelum pemanggilan. Context/screenshot Schedule `46:10` dan Availability `46:11` file utama gagal izin edit; context/screenshot root nyata terbaru `93:7181` gagal kuota Starter. Tool membalas, jadi bukan `-32001: Unknown tool`; tidak ada bukti error autentikasi. Error dan UUID persis ada di [Figma mapping](FIGMA_MAPPING.md) |

Tes FE-11 membuktikan: konfigurasi timezone/tarif/jam terbaca dan save unchanged tidak menulis; perubahan availability/rate/block transaksional serta tarif booking lama tidak berubah; guard verified dijalankan saat simpan; penerimaan off tidak menghapus janji; blok menghilangkan slot terkait dan pembatalannya memulihkan slot; blok konflik booking/follow-up ditolak; optimistic token/draft menolak perubahan stale; kegagalan transaksi dapat retry; kalender harian/mingguan menggunakan hari lokal dan menampilkan appointment/follow-up assigned tanpa menampilkan hold pembayaran Dokter.

Penerimaan UI FE-11 **Belum diuji/terblokir**: navigasi tab Jadwal, buka/tutup editor, switch penerimaan, edit zona waktu/jam/layanan/durasi/tarif/blok, validasi inline, simpan/buang/resume draft pada cold restart Android, konflik dialog/back, interaksi kalender hari/minggu dan tanggal, buka detail dari agenda, keyboard/scroll, serta ukuran layar 390 × 844/lebih kecil/font besar. Screenshot referensi lokal [vet-availability.png](reference/figma/screenshots/vet-availability.png) sudah ditinjau sebagai cache desain lama, namun context/screenshot Figma terbaru tidak didapat dan pixel-match belum diuji. Test service dan screenshot startup tidak dihitung sebagai kelulusan flow.

| Fase | Status QA terbaru |
| --- | --- |
| FE-00/02 | Bukti bootstrap, cold restart, integritas dan idempotensi terdahulu tetap berlaku; tidak diulang tanpa perubahan terkait |
| FE-01 | Interaksi komponen dasar pernah diperiksa; perbandingan layar Figma Android, 390 × 844, layar kecil dan font besar masih tertunda |
| FE-03 | Alur daftar/masuk/reset/logout tidak aktif mengikuti arahan frontend; penerimaan sesi/auth ditunda |
| FE-04 | Form profil/farm/alamat, picker, penyimpanan lewat UI, status verifikasi dan guard layar belum diuji |
| FE-05 | UI dashboard kedua peran tersedia; data/service dites, tetapi tombol/tujuan, empty state dan availability di layar belum diuji |
| FE-06 | UI list/detail/form tersedia; search/filter, foto/edit/validasi, back dan akses ternak lain belum diuji di Android |
| FE-07 | UI riwayat Peternak/pasien Dokter tersedia; filter, form laporan, detail dan viewer belum diuji di Android |
| FE-08 | UI direktori/profil/filter/jadwal tersedia; pencarian/filter, slot, detail dan visual belum diuji di Android |
| FE-09 | UI booking/draft/media/review tersedia; form/picker/draft/cold restart dan konfirmasi payment belum diuji di UI Android; payment flow FE-19 belum ada |
| FE-10 | UI request/detail/decision/proposal/history tersedia; interaksi lintas peran dan visual belum diuji di Android |
| FE-11 | UI editor availability/kalender tersedia; seluruh interaksi layar dan visual belum diuji di Android |

FE-01 dan FE-03–11 tetap **Sedang dikerjakan**; status backlog mencerminkan bahwa acceptance Android/visual belum lengkap. Pengujian fase lain tidak diulang kecuali check regression yang berjalan bersama suite domain.

## Hasil pemeriksaan FE-12 — 6 Oktober 2026

FE-12 menambahkan `ChatService`/`ChatFlow` dan tombol chat dari detail konsultasi. Marker `fixture_chat_version=fe12-v1` menambahkan konsultasi chat fiktif Budi→Yuda/Mawar, payment lokal succeeded, dan pesan awal agar kedua persona utama bisa mencapai halaman yang sama. Ekstensi tidak mereset record/data existing. Jalur layar: Peternak Budi → **Konsultasi saya → Jadwal → VL-C-107**; Dokter Yuda → **Konsultasi → Jadwal → VL-C-107**.

| Pemeriksaan | Hasil dan batas bukti |
| --- | --- |
| `npm run check` dari `apps/mobile` | Lulus: typecheck, lint, 79 tes domain/service (9 baru untuk scope, payment/status guard, assigned participant, shared messages, media, clientMessageId, retry, rollback dan fixture extension) |
| `npx expo export --platform android --output-dir /private/tmp/vetlink-fe12-export-final2` | Lulus: 749 modul; Hermes Android bundle 2,4 MB. Ini export JavaScript, bukan APK baru atau bukti semua layar terpasang |
| Native build | Gradle tidak dijalankan; FE-12 hanya mengubah TypeScript/JavaScript serta data fixture SQLite. Tidak ada dependency/config native baru |
| Xiaomi fisik `2311DRK48G` | ADB mendeteksi perangkat; APK development dibuka dan screenshot [fe12-startup-metro.png](reference/android/fe12-startup-metro.png) menunjukkan Pilih Peran. Ini smoke test startup, bukan bukti halaman Chat |
| Interaksi perangkat | Satu tap tombol Lanjut gagal dengan pesan persis `java.lang.SecurityException: Injecting input events requires the caller (or the source of the instrumentation, if any) to have the INJECT_EVENTS permission.` Maka Chat tidak dibuka; interaksi UI **Belum diuji/terblokir**. Simulator tidak dibuka |
| Figma | Skill `figma-design-to-code` dibaca. Context/screenshot diminta dari node `12:2353` pada link nyata `TPG6qZunK9EY4z1Vy0GKDx`, tetapi keduanya ditolak kuota Starter. Kehadiran/relevansi node itu pada file terbaru tidak dapat dipastikan. Tool tersedia dan membalas; bukan `-32001: Unknown tool` atau bukti auth gagal. Detail ada di [Figma mapping](FIGMA_MAPPING.md) |

Tes FE-12 membuktikan service hanya membuka konsultasi chat dengan participant/relasi valid dan payment yang cocok; request belum diterima dan layanan belum dibayar tidak membuka chat; dokter assigned dengan verifikasi pending tidak dapat menulis; Peternak/Dokter ditugaskan membaca record sama; clientMessageId duplikat tidak menambah pesan dan isi berbeda ditolak; foto/video disalin privat dan viewer mengotorisasi ulang; write gagal merollback data/file; status failed dapat retry di record lama; pending baru tidak di-retry sebelum 30 detik; fixture hanya ditambahkan sekali.

Penerimaan UI FE-12 **Belum diuji/terblokir**: membuka tab Jadwal dan Buka Chat di kedua peran, mengirim teks/media, viewer foto/video, status pending/failed dan retry sentuh, keyboard/composer/scroll, Back Android, pergantian persona, ukuran 390 × 844/layar kecil/font besar, serta pembandingan Figma. Foto mempunyai viewer penuh. Video bisa dipilih/dikirim dan detail lampirannya tampil, tetapi playback belum tersedia. Tidak ada sinkronisasi multi-device atau backend jaringan.

FE-11 telah di-commit `917a83c` tanpa push. FE-12 belum di-commit. FE-01 dan FE-03–12 tetap **Sedang dikerjakan** sampai acceptance layar/visual Android yang tertunda selesai; screenshot startup atau service tests tidak dihitung sebagai kelulusan flow.
