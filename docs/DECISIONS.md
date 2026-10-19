# Catatan keputusan

Tanggal baseline: 5 Oktober 2026. “Dipilih” berarti berasal dari jawaban/instruksi pengguna; “Usulan” dapat disesuaikan saat implementasi; “Terbuka” membutuhkan pembahasan sebelum pekerjaan yang bergantung padanya.

| ID | Keputusan | Status | Sumber / dampak |
| --- | --- | --- | --- |
| DEC-01 | Dokumentasi dahulu; belum scaffold aplikasi | Dipilih | Instruksi terakhir pengguna |
| DEC-02 | React Native + Expo + TypeScript | Dipilih | Jawaban pengguna pada pilihan stack mobile |
| DEC-03 | Android dahulu; data lokal; backend menyusul | Dipilih | Jawaban pengguna pada pilihan platform/integrasi |
| DEC-04 | Tidak memakai Kotlin sebagai bahasa aplikasi | Dipilih | Permintaan pengguna; lihat catatan toolchain di Tech |
| DEC-05 | Figma sebagai visual, fitur sebagai fungsi, repo/backend sebagai teknis | Dipilih | Spesifikasi pengguna |
| DEC-06 | Simulasi chat, bayar, kirim, notifikasi, pencairan | Dipilih | Scope prototype pengguna |
| DEC-07 | SQLite untuk data lokal + repository pengganti API | Diterapkan untuk adapter lokal FE-02; API/backend tetap belum dipilih | Memenuhi persistence dan satu sumber data; `expo-sqlite ~57.0.3`, migration, seed, repository, dan events diuji pada Android |
| DEC-08 | StyleSheet + design tokens, Inter lokal, satu keluarga ikon Lucide; Expo Router | UI FE-01 diterapkan; Expo Router tetap usulan | Framework mobile terpilih, aturan ikon, dan hasil inspeksi Figma; versi library tercatat di Tech |
| DEC-09 | Satu app dengan shell Peternak/Dokter, session role guard | Usulan | Mengikuti Pilih/Ganti Peran tanpa bypass izin |
| DEC-10 | NestJS + PostgreSQL, modular monolith | Dipilih | Instruksi pengguna 13 Oktober 2026; mulai BE-00–16 secara lokal, tanpa memilih provider produksi atau melakukan deploy |
| DEC-11 | Dokter hanya menerima request berbayar sukses pada milestone lokal | Usulan | Mencegah payment method langsung membuka chat; bayar nanti di Figma belum didefinisikan |
| DEC-12 | Refund otomatis dan pay-later belum diaktifkan pada milestone lokal | Usulan | Jangan klaim refund/dana nyata; status refund_needed disimpan untuk ditangani pada fase backend |
| DEC-13 | Komisi 10% hanya fixture, rate disnapshot per layanan | Usulan | Tidak menyatakan tarif komersial platform |
| DEC-14 | Reservasi saldo saat pengajuan pencairan berhasil; release bila gagal/ditolak | Usulan | Menghindari pengajuan melebihi saldo dan debit ganda |
| DEC-15 | Verifikasi lokal fixture; produksi membutuhkan reviewer tepercaya | Terbuka untuk produksi | Tidak boleh ada self-verify oleh akun dokter |
| DEC-16 | Tidak ada multi-device atau sync offline produksi pada tahap lokal | Usulan batas implementasi | Android data lokal dahulu; backend menyusul |
| DEC-17 | Batas ukuran media produksi, minimum pencairan, masa slot hold, cancellation/refund | Terbuka | BE-07 memakai guardrail development configurable: JPEG/PNG/WebP 10 MiB dan MP4 50 MiB secara default; ini bukan kebijakan produk/produksi |
| DEC-18 | iOS, hosting, provider nyata dan operasional admin | Terbuka | Belum diminta sebagai tahap awal |
| DEC-19 | Mulai implementasi dari tiket FE-00 | Dipilih | Instruksi pengguna 5 Oktober 2026; memulai scaffold mobile tanpa memilih backend atau memperluas fitur produk |
| DEC-20 | Lanjut ke FE-02 setelah fondasi FE-01 | Diterapkan | Instruksi pengguna 5 Oktober 2026; fondasi domain, SQLite lokal, seed, repository dan event selesai dengan bukti di Testing |
| DEC-21 | Autentikasi FE-03 satu perangkat; role membership dijaga AuthService; session/verifier lokal memakai SecureStore | Riwayat implementasi, tidak aktif pada UI sekarang | Credential berupa salt + SHA-256 verifier; alur ini digantikan sementara oleh DEC-23 untuk fokus frontend |
| DEC-22 | Lampiran profil FE-04 dipilih pengguna lalu disalin privat ke storage dokumen aplikasi; tahap lokal tidak mengunggah dokumen atau menerbitkan hasil review | Diterapkan untuk milestone lokal | Metadata/URI disimpan sebagai Attachment; submission dokter hanya menghasilkan pending. Keputusan storage API dan reviewer produksi tetap terbuka |
| DEC-23 | Fokus sekarang pada flow frontend tanpa autentikasi dan backend jaringan | Dipilih | Instruksi pengguna 5 Oktober 2026; `FrontendFlow` memilih persona fixture lokal, sedangkan layar daftar/masuk/reset/keluar tidak dipasang pada runtime aktif |
| DEC-24 | Jika node Figma tidak dapat diakses, desain layar mandiri dengan UI/UX aman dan sesuai fungsi | Dipilih | Instruksi pengguna 5 Oktober 2026; FE-06, riwayat Peternak FE-07, direktori/profil FE-08, serta booking FE-09 memakai tokens/aturan fitur, dengan keterbatasan pixel-match dicatat di Figma mapping |
| DEC-25 | BE-00 memakai Node.js 24.15, NestJS 12, PostgreSQL 17.4; SQL eksplisit melalui `pg` tanpa memilih ORM | Diterapkan | Baseline BE-00 yang benar-benar diuji; upgrade PostgreSQL 18.x menjadi gate terpisah, tanpa memilih hosting/provider produksi |
| DEC-26 | BE-01 memakai credential password internal (`scrypt`), token opaque hashed, session PostgreSQL dan role membership guard; reset memakai delivery adapter | Diterapkan untuk backend lokal | Menghindari provider produksi/secret; adapter reset aktif gagal tertutup sampai dipilih provider pengiriman. Rate limit in-memory hanya untuk proses backend tunggal |
| DEC-27 | Satu akun Peternak boleh memiliki banyak Farm | Dipilih | Arahan pengguna 19 Oktober 2026; FE-26 menambah konteks/pemilihan farm mobile. Skema PostgreSQL dan API BE-02 sudah memakai owner satu-ke-banyak; detail ternak dan booking harus tetap diperiksa dengan ID serta owner farm |

DEC-01 mencatat keadaan tahap dokumentasi sebelum pengguna meminta implementasi. DEC-19 memulai implementasi; DEC-23/24 menetapkan fokus frontend aktif. DEC-10 kini menetapkan stack backend; FE-03 tetap ditunda sesuai DEC-23. Keputusan provider dan operasi produksi tetap terbuka.

BE-00 pada 13 Oktober 2026 menerapkan DEC-10 dan mencatat pilihan versi/penggerak SQL melalui DEC-25. BE-01 menerapkan DEC-26: health/auth aktif di API, sedangkan route domain lain menunggu tiketnya. Reset password enumeration-safe tetap gagal tertutup tanpa provider pengiriman; tidak ada pesan atau transaksi nyata.

BE-07 pada 13 Oktober 2026 memakai filesystem privat lokal dan transport polling PostgreSQL, tanpa bucket, realtime, provider produksi, secret, atau transaksi finansial. Default batas media dapat diubah untuk development; kebijakan produksi DEC-17 tetap terbuka.

Untuk mengubah keputusan, tambah tanggal, alasan dan dampak pada PRD, model status, API, backlog dan acceptance criteria. Jangan menghapus riwayat keputusan pengguna tanpa mencatat penggantinya.


5 Oktober 2026 — FE-09 menerapkan DEC-23/24: booking berjalan melalui data lokal tanpa credential/backend jaringan, dengan rancangan mandiri karena izin/kuota Figma. Draft eksplisit tersimpan, review dan submit atomik tidak menandakan pembayaran sukses. Batas media dan expiry hold produksi tetap terbuka (DEC-17); komisi 10% hanya snapshot fixture DEC-13. Tidak memilih provider pembayaran atau memperluas scope ke layanan nyata.

19 Oktober 2026 — BE-04 memakai tabel PostgreSQL availability, profil direktori, rate efektif-dated integer IDR, dan blocked time soft-cancel. Slot adalah proyeksi baca dalam timezone IANA dokter dengan interval `[start,end)`; konfigurasi dikunci per dokter dan tidak menghapus accepted appointment. Tarif dan slot menjadi data server untuk BE-05; slot baca bukan reservasi. Tidak memilih provider produksi atau mengubah kebijakan komersial.
