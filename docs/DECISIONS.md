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
| DEC-10 | NestJS + PostgreSQL, modular monolith | Terbuka | Kandidat utama backend; belum ada backend dalam folder |
| DEC-11 | Dokter hanya menerima request berbayar sukses pada milestone lokal | Usulan | Mencegah payment method langsung membuka chat; bayar nanti di Figma belum didefinisikan |
| DEC-12 | Refund otomatis dan pay-later belum diaktifkan pada milestone lokal | Usulan | Jangan klaim refund/dana nyata; status refund_needed disimpan untuk ditangani pada fase backend |
| DEC-13 | Komisi 10% hanya fixture, rate disnapshot per layanan | Usulan | Tidak menyatakan tarif komersial platform |
| DEC-14 | Reservasi saldo saat pengajuan pencairan berhasil; release bila gagal/ditolak | Usulan | Menghindari pengajuan melebihi saldo dan debit ganda |
| DEC-15 | Verifikasi lokal fixture; produksi membutuhkan reviewer tepercaya | Terbuka untuk produksi | Tidak boleh ada self-verify oleh akun dokter |
| DEC-16 | Tidak ada multi-device atau sync offline produksi pada tahap lokal | Usulan batas implementasi | Android data lokal dahulu; backend menyusul |
| DEC-17 | Batas ukuran media, minimum pencairan, masa slot hold, cancellation/refund | Terbuka | Jangan menetapkan tarif/SLA bisnis sebagai fakta |
| DEC-18 | iOS, hosting, provider nyata dan operasional admin | Terbuka | Belum diminta sebagai tahap awal |
| DEC-19 | Mulai implementasi dari tiket FE-00 | Dipilih | Instruksi pengguna 5 Oktober 2026; memulai scaffold mobile tanpa memilih backend atau memperluas fitur produk |
| DEC-20 | Lanjut ke FE-02 setelah fondasi FE-01 | Diterapkan | Instruksi pengguna 5 Oktober 2026; fondasi domain, SQLite lokal, seed, repository dan event selesai dengan bukti di Testing |
| DEC-21 | Autentikasi FE-03 satu perangkat; role membership dijaga AuthService; session/verifier lokal memakai SecureStore | Diterapkan untuk milestone lokal | Credential berupa salt + SHA-256 verifier, reset tidak mengirim email dan session kedaluwarsa 30 hari; ini bukan auth produksi/KDF produksi dan harus diganti saat provider backend dipilih |
| DEC-22 | Lampiran profil FE-04 dipilih pengguna lalu disalin privat ke storage dokumen aplikasi; tahap lokal tidak mengunggah dokumen atau menerbitkan hasil review | Diterapkan untuk milestone lokal | Metadata/URI disimpan sebagai Attachment; submission dokter hanya menghasilkan pending. Keputusan storage API dan reviewer produksi tetap terbuka |

DEC-01 mencatat keadaan tahap dokumentasi sebelum pengguna meminta implementasi. DEC-19 memperbarui tahap kerja saat ini; keputusan scope/backend lain tetap berlaku.

Untuk mengubah keputusan, tambah tanggal, alasan dan dampak pada PRD, model status, API, backlog dan acceptance criteria. Jangan menghapus riwayat keputusan pengguna tanpa mencatat penggantinya.
