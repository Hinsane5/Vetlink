# Backlog frontend / mobile Android

Status keseluruhan saat ini: **FE-00 Selesai, FE-01 Sedang dikerjakan, FE-02 Selesai, FE-03/04/05/06 Sedang dikerjakan**; FE-07–FE-25 **Belum mulai**.

Status setiap tiket: **Selesai** berarti seluruh acceptance criteria terpenuhi dan buktinya dicatat; **Sedang dikerjakan** berarti ada progres tetapi acceptance belum lengkap; **Belum mulai** berarti implementasi belum dimulai.

Setiap tiket harus menyertakan implementasi UI/domain/adapter lokal yang relevan, acceptance criteria, bukti pengujian sesuai risiko, dan dokumentasi status. “Frontend” di fase lokal mencakup use case dan repository lokal; tidak boleh menunggu backend untuk menjalankan flow. Acuan visual: [Figma mapping](../FIGMA_MAPPING.md), fungsi: [Features](../FEATURES.md).

## Urutan milestone

| Milestone | Tiket | Exit gate |
| --- | --- | --- |
| M0 Fondasi | FE-00–04 | App Android bootstrap, peran, session, profil, data persisten dan tokens |
| M1 Alur wajib | FE-05–16, FE-19, FE-23 | Booking awal tersedia; flow Dokter A–D dan guard berjalan pada data lokal |
| M2 Seluruh scope lokal | FE-17/18/20/21/22, penyempurnaan M1 | Semua F-01…20 dan V-01…18 mempunyai fungsi dan states relevan |
| M3 Penerimaan Android | FE-24 | Build dan pengujian native/visual sesuai Success criteria |
| M4 Backend | FE-25, backlog backend | Adapter API lulus kontrak dan flow dua perangkat |

Milestone bukan janji tanggal. Tiket M1 dapat dibagi menjadi vertical slice yang melewati beberapa fitur; status selesai dinilai dari seluruh acceptance tiket, bukan screenshot saja.

## Fondasi

| ID | Status | P | Pekerjaan / keluaran | Dependensi | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| FE-00 | Selesai | P0 | Scaffold Expo TypeScript Android, scripts/checks, package lock, development build config | Pengguna meminta mulai implementasi | App terbuka di Android; versi/tooling terdokumentasi; perintah README benar-benar diuji; tidak menambahkan backend terpilih sepihak |
| FE-01 | Sedang dikerjakan | P0 | Tokens per peran dan reusable UI: button, fields, status, rows, chat, dialogs, feedback | FE-00 | Warna/Inter/spacing mengikuti Figma; button states berfungsi; 44 dp hit target; font besar/teks panjang tidak terpotong; visual Android dibandingkan pada 390 × 844 dan font scale besar |
| FE-02 | Selesai | P0 | Domain, ports, SQLite migration, seed fiktif, shared repositories, events | FE-00 | Seed sekali; restart menjaga edit/draft/status; domain guard tanpa UI; notification/health events tidak duplikat; fixture relasi valid |
| FE-03 | Sedang dikerjakan | P0 | Splash/onboarding, Pilih/Ganti Peran, register/login/reset/logout dan session guard | FE-01/02 | Form nyata dan error; register kedua peran; logout membersihkan sesi tanpa menghapus domain; role switch tidak bypass izin; reset mengikuti hasil local AuthService |
| FE-04 | Sedang dikerjakan | P0 | Profil Peternak/farm/alamat dan Dokter; photo/doc picker; verifikasi dan revisi | FE-03 | Perubahan persisten dan tercermin dashboard; jenis ternak/wilayah tersimpan; pending/revision/verified tampil; dokter tidak self-verify; akses menerima terkunci bila belum verified |

Catatan FE-01: tokens, Inter, keluarga ikon Lucide, dan komponen reusable sudah dibuat; `npm run check`, export Metro Android, serta build APK native lulus. Uji fisik Xiaomi `2311DRK48G` membuktikan tombol Peternak/Dokter (52/48 dp), field dapat menerima teks, fokus dan keyboard bekerja, pesan gagal memiliki aksi retry 44 dp, daftar dapat discroll, serta modal menutup lewat Back Android. Pada font Xiaomi 125%, teks helper membungkus, field tetap terbaca, dan dialog panjang beserta kedua tombol tetap terlihat. Ukuran asli perangkat 407 × 904 dp; override ke 390 × 844 dp ditolak Android karena memerlukan `WRITE_SECURE_SETTINGS`, dan pilihan OEM font tidak menyediakan tepat 130%. FE-01 tetap **Sedang dikerjakan** sampai pembandingan viewport dan referensi Figma yang tertunda diselesaikan. Konteks/screenshot Peternak Chat (`12:2353`) dan Logout Dialog (`12:3184`) juga belum tersedia karena batas panggilan MCP; bukti dan selisih ada di [Figma mapping](../FIGMA_MAPPING.md) dan [Testing](../TESTING.md).

Catatan FE-02: fondasi domain, port repository/event, SQLite schema v1, fixture seed `fe02-v1`, dan bootstrap root tersedia. Seed berisi 61 entitas serta 79 relasi; versi schema, marker seed, foreign key, dan integritas database telah diperiksa pada HP Xiaomi `2311DRK48G`. Cold restart mempertahankan perubahan preferensi dan draft, seed tidak dijalankan ulang, serta probe adapter SQLite membuktikan satu event tidak menggandakan notifikasi maupun health event. Enam tes domain/repository-usecase dan build Android lulus. Rincian perintah serta screenshot sebelum/sesudah restart ada di [Testing](../TESTING.md).

Catatan FE-03: layar splash/onboarding, Pilih/Ganti Peran, masuk/daftar per peran, reset lokal, dan keluar telah diimplementasikan. SQLite v2 menegakkan email unik; `LocalAuthService` menyimpan User/profil dalam satu transaksi, menjaga role membership, membuat sesi 30 hari, serta mencabut sesi tanpa menghapus domain. Credential lokal adalah verifier bersalt di SecureStore; fixture seed tidak bisa dipakai login atau diklaim melalui reset. Empat tes service FE-03 ditambahkan (10 tes total) dan lulus. Build APK dan buka layar Mulai di HP lulus, tetapi pengujian sentuh/input belum dilakukan karena MIUI menolak `adb shell input tap` dengan `INJECT_EVENTS`; screenshot Figma FE-03 juga tertahan oleh limit Starter. Lihat [Testing](../TESTING.md) dan [Figma mapping](../FIGMA_MAPPING.md) sebelum menandai tiket selesai.

Catatan FE-04: `ProfileService` dan adapter SQLite memuat serta menyimpan identitas, farm, jenis ternak, wilayah, alamat, data profesi, draft, attachment, dan submission dalam transaksi ber-version. Foto/dokumen dipilih dari Android lalu disalin ke direktori dokumen privat aplikasi; belum ada unggahan jaringan. Pengajuan Dokter menghasilkan `pending`; layar membaca `not_submitted/pending/revision_required/verified`, tetapi tidak menyediakan aksi dokter untuk memberi hasil review. Guard konsultasi FE-02 tetap mengunci penerimaan oleh dokter non-verified. `npm run check` lulus dengan 15 tes, termasuk lima skenario profil/verifikasi. Prebuild, export Android (710 modul), dan Gradle `assembleDebug` lulus. ADB serta inventaris USB macOS saat pemasangan tidak melihat HP, sehingga form/picker fisik belum diuji. MCP Starter menolak `get_design_context` untuk profil `12:3066` dan `46:34`.

Catatan FE-05: `DashboardService` menyusun snapshot Peternak dan Dokter dari repository lokal yang sama; jumlah ternak/konsultasi, reminder berikutnya, agenda, permintaan, dan saldo tidak memakai angka layar. Pembukaan konsultasi/pengingat memuat ulang entity memakai ID route dan memeriksa owner/assignment. Perubahan availability memerlukan dokter verified dan hanya mengubah record availability, sehingga janji accepted tidak dibatalkan saat layanan baru dimatikan. `npm run check` lulus dengan 20 tes (lima skenario dashboard/availability/akses konteks); export Android membundle 714 modul. QA sentuh/dashboard HP dan visual Figma terbaru masih tertunda. Tab Ternak, Pesanan, dan Pasien tetap nonaktif sampai tiket fitur tersebut tersedia.

Pembaruan perangkat FE-04: setelah pemeriksaan ADB sebelumnya tidak melihat HP, pengguna menyambungkan kembali Xiaomi `2311DRK48G`; APK FE-04 berhasil diperbarui dengan `adb install -r` tanpa menghapus data. Saat screenshot diambil, layar HP dalam keadaan tidur, sehingga interaksi profil dan picker masih perlu diuji setelah layar dibuka kunci.

## Ternak dan layanan

Catatan FE-06: `LivestockService` dan selector domain awal memakai repository SQLite bersama. List/detail dibatasi ke Peternak dan farm aktif; create/edit memvalidasi ID unik per farm, nama, species sesuai profil farm, ras, sex, estimasi umur, dan berat. Foto disalin ke direktori privat aplikasi dan attachment serta relasinya dikomit dalam transaksi yang sama dengan ternak. `npm run check` lulus dengan enam skenario FE-06; export Android (716 modul) dan build Gradle lulus. Smoke startup pada Xiaomi berhasil mencapai “Pilih Peran” dan memuat LocalStore tanpa error JavaScript; bukti ada di [Testing](../TESTING.md). UI/list-detail dan QA interaksi perangkat belum dibuat. Figma MCP menolak keenam node yang dipetakan karena batas panggilan Starter; detail ada di [Figma mapping](../FIGMA_MAPPING.md).

| ID | Status | P | Pekerjaan / keluaran | Dependensi | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| FE-05 | Sedang dikerjakan | P0 | Dashboard kedua peran dari shared selectors | FE-02/04 | Counts/jadwal/reminder/saldo berdasarkan data; tap membuka ID benar; empty state; availability off menjaga janji diterima |
| FE-06 | Sedang dikerjakan | P0 | List/detail/tambah/edit ternak, media, pencarian/filter | FE-01/02/04 | ID/nama, species, breed, sex, age, weight tervalidasi; cari/filter kombinasi; edit segera terlihat; milik akun lain tidak dapat dibuka |
| FE-07 | Belum mulai | P0 | Rekam kesehatan Peternak dan daftar/detail pasien Dokter | FE-06 | Pemeriksaan/penyakit/vaksin/obat/care tampil menurut animalId; doctor patients scoped assignment; note Peternak tidak menimpa note dokter; viewer media menangani error |
| FE-08 | Belum mulai | P0 | Directory/profile Dokter, filters, tarif, slots, rating | FE-04/11 | Nama/species/layanan/lokasi/availability/fee bekerja; filter empty; verified badge sesuai data; pilih dokter bukan selalu dokter fixture pertama |
| FE-09 | Belum mulai | P0 | Booking chat/visit, animal/slot/keluhan/media, quote/review | FE-06/08/11 | Wajib dan kepemilikan dicek; visit wajib alamat; media dipilih pengguna; waktu valid; payment success menghasilkan requested, bukan chat aktif; double submit tidak booking ganda |
| FE-10 | Belum mulai | P0 | Requests, accept/reject/reason/proposal, respons Peternak, details, histories | FE-09/19 | Verified guard; accept menghasilkan scheduled; reject reason disimpan; proposal menunggu respons dan konflik dicek ulang; cancel/stale request tidak diterima; tabs/status/ID konsisten |
| FE-11 | Belum mulai | P0 | Availability, tarif/duration/block, kalender daily/weekly | FE-01/02/04 | Jam mulai < selesai; edit/simpan aktual; save unchanged tidak mengubah nilai; block mencegah slot; kalender dari data; janji accepted dipertahankan |
| FE-12 | Belum mulai | P0 | Chat kedua peran, text/media/viewer, informasi consultation | FE-10 | Send text/media tersimpan di consultation benar; send pending/failed/retry; ketuk ganda/clientMessageId tidak duplikat; sesi lain pada perangkat yang sama melihat pesan; input aman saat keyboard |
| FE-13 | Belum mulai | P0 | Visit doctor actions, lokasi/alamat, farmer progress, completion confirmation | FE-10/14 | depart→arrive→examining berurutan; lompatan ditolak; address snapshot; final + confirmation dibutuhkan complete; history/status kedua peran sama |
| FE-14 | Belum mulai | P0 | Clinical form/draft/review/final, hasil Peternak dan completion | FE-07/10/12 | Field nyata; draft restart; warning dirty-back; required validation; review version sesuai; final immutable; finalisasi meninggalkan in_progress; cancel complete tidak mengubah status |
| FE-15 | Belum mulai | P0 | Rekomendasi CRUD item, instruksi, product picker, review/send | FE-14, katalog fixture FE-02 | Edited text benar di review/sent; empty send ditolak; product optional; farmer hanya menerima sent; link ke product benar; doctor tidak memperoleh cart/checkout |
| FE-16 | Belum mulai | P0 | Follow-up/recheck, reminder/care completion, laporan perkembangan | FE-07/14/15 | Date/time benar; follow-up tampil kalender; sent reminder bukan care done; laporan terpisah; completed care mencatat HealthEvent sekali; Peternak submit dan dokter terkait dapat membaca |

FE-08/09 bergantung availability dari FE-11; kerjakan FE-11 lebih awal dalam slice booking walau nomor tiket lebih besar. FE-13 bergantung clinical guards FE-14; baseline action visit dapat dibangun lebih dahulu, completion setelah FE-14. Hindari stub UI yang mengaku flow selesai sebelum dependensi siap.

## Commerce, finansial dan pendukung

| ID | Status | P | Pekerjaan / keluaran | Dependensi | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| FE-17 | Belum mulai | P1 | Marketplace search/filter/details, recommendation entry | FE-01/02/15 | Produk/price/info dari catalog; query/filter kombinasi; link recommendation ID benar; produk inactive/unknown error jelas |
| FE-18 | Belum mulai | P1 | Cart quantities/remove, address, quote, checkout | FE-04/17 | Qty integer positif; remove/empty; totals + ongkir akurat; address required; order price/address snapshot; doctor access ditolak |
| FE-19 | Belum mulai | P0 | Payment method, submit, pending/failed/success, history | FE-02; context FE-09 dan FE-18 | Tap method tidak membayar; service result persisten; pending bukan paid; retry/idempotency; consultation/order dipisahkan; riwayat dapat dibuka kembali |
| FE-20 | Belum mulai | P1 | Orders active/done/details/shipment timeline | FE-18/19 | Paid hanya dari payment sukses; delivery status dari adapter; jumlah/harga sesuai snapshot; gagal kirim tidak ditampilkan delivered |
| FE-21 | Belum mulai | P1 | Rating/review dan agregasi profil dokter | FE-10/14 | Hanya consultation own completed; stars 1–5; satu review per layanan; rating dokter berubah dari review tersimpan |
| FE-22 | Belum mulai | P1 | Inbox kedua peran, prefs, help, account settings | FE-03/10/12/16/19/20 | Events milik penerima; read state/prefs persisten; link mempertahankan ID; prefs tidak menghapus inbox; help Indonesia; logout confirmation |
| FE-23 | Belum mulai | P0 | Earnings/period/detail, destination, amount/review/confirm/submitted/history | FE-02/14/19 | Gross−commission=net; pending/available berbeda; amount invalid/zero blocked; partial reserve sesuai jumlah; cancel review tanpa debit; retry tidak duplikat; submitted bukan paid |
| FE-24 | Belum mulai | P0 | QA Android, visual comparison, accessibility, regression A–D dan farmer flow | Semua P0/P1 untuk acceptance lengkap | Bukti build, tests, native interactions dan screenshots; zero blocking errors; semua selisih dicatat; README run steps terbukti; tidak ada kontrol pengujian produk |
| FE-25 | Belum mulai | P2 | API adapters dan integrasi bertahap | BE-00/16 + persetujuan tahap backend | Contract tests local/API; session/security server; dua perangkat; network/retry; tidak fallback payment gagal ke sukses lokal |

FE-19 dibuat dengan consultation payable pada M1; cabang order diselesaikan setelah FE-18 pada M2. FE-24 dapat dijalankan per slice, tetapi acceptance lengkap menunggu seluruh P0/P1. FE-25 tidak menjadi syarat penerimaan lokal.

## Definition of Done tiket

- Perilaku dan states acceptance di atas bekerja melalui data/use case, tanpa tombol testing dalam produk.
- Route/component Figma dipetakan, screenshot dibandingkan untuk layar yang berubah; selisih beralasan dicatat.
- Guard kritis mempunyai tes domain/repository yang bermakna; UI keyboard/back/scroll diperiksa di Android bila terpengaruh.
- Failure/retry tidak meninggalkan data setengah commit atau sukses palsu.
- Status backlog, README dan dokumentasi integrasi mencerminkan bukti nyata; jangan menandai semua fitur selesai hanya karena screen ada.
