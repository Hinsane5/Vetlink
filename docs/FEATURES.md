# Katalog fitur VetLink

Status implementasi per fitur dicatat pada [backlog frontend](backlog/FRONTEND.md); FE-03, FE-04, dan FE-05 sedang berjalan, sedangkan fitur lain masih direncanakan. Prioritas P0 = fondasi dan flow wajib; P1 = kelengkapan scope lokal. P1 tetap wajib sebelum milestone seluruh scope lokal diterima. Acuan fitur: permintaan pengguna; detail visual: [Figma mapping](FIGMA_MAPPING.md).

## Peternak

| ID | Fitur dan perilaku minimum | Data utama | Backlog |
| --- | --- | --- | --- |
| F-01 | Daftar peternak, login, logout, reset password; validasi dan sesi | User, Session, FarmerProfile | FE-03, BE-01 |
| F-02 | Edit identitas/foto, lokasi peternakan, alamat kirim dan jenis ternak | FarmerProfile, Farm, Address | FE-04, BE-02 |
| F-03 | Ringkasan ternak, aktif/jadwal, perawatan dan akses cepat dari data | Livestock, Consultation, Reminder | FE-05, BE-05 |
| F-04 | Tambah/edit ternak; foto, ID/nama, jenis, ras, kelamin, umur, berat; cari/filter/detail/status | Livestock, Attachment | FE-06, BE-03 |
| F-05 | Riwayat penyakit/pemeriksaan, vaksin, obat, perawatan dan hasil dokter | HealthEvent, ClinicalNote | FE-07, BE-03/08 |
| F-06 | Cari nama dokter; filter jenis ternak, layanan, lokasi, tersedia dan biaya | VetProfile, Availability, ServiceRate | FE-08, BE-04 |
| F-07 | Profil dokter, verifikasi, pengalaman, layanan, tarif, slot dan ulasan | VetProfile, Review, Availability | FE-08, BE-04/13 |
| F-08 | Booking chat/kunjungan; ternak, tanggal/jam, keluhan, foto/video, tinjau biaya | Consultation, Slot, Quote, Attachment | FE-09, BE-05/06 |
| F-09 | Status permintaan, janji diterima, tanggapi usulan jadwal dan pemeriksaan ulang | Consultation, ScheduleProposal, FollowUp | FE-10, BE-05/09 |
| F-10 | Pesan dua arah, foto/video, viewer lampiran, konteks konsultasi | Message, Attachment, Consultation | FE-12, BE-07 |
| F-11 | Alamat peternakan dan detail/progres kunjungan bertahap | Visit, Address, Consultation | FE-13, BE-05 |
| F-12 | Catatan final, resep/rekomendasi, instruksi dan tindak lanjut | ClinicalNote, Recommendation, FollowUp | FE-14/15, BE-08/09 |
| F-13 | Buat pengingat vaksin/obat/perawatan, notifikasi, tandai dilakukan | Reminder, HealthEvent, Notification | FE-16, BE-09/14 |
| F-14 | Cari/filter produk, detail/harga/info, buka dari rekomendasi | Product, RecommendationItem | FE-17, BE-10 |
| F-15 | Cart tambah/hapus/ubah jumlah, alamat kirim, ongkir dan total | Cart, Address, Quote, Order | FE-18, BE-11 |
| F-16 | Bayar konsultasi/produk; metode, status dan riwayat | PaymentAttempt, Payment | FE-19, BE-06 |
| F-17 | Pesanan aktif/selesai, detail dan progres pengiriman | Order, Shipment | FE-20, BE-11/12 |
| F-18 | Riwayat terjadwal/berlangsung/selesai/dibatalkan; buka hasil | Consultation, ClinicalNote | FE-10/14, BE-05/08 |
| F-19 | Rating dan ulasan hanya setelah konsultasi sendiri selesai | Review, Consultation | FE-21, BE-13 |
| F-20 | Notifikasi pesan/booking/jadwal/bayar/pesanan/perawatan; preferensi dan bantuan | Notification, Preferences, HelpEntry | FE-22, BE-14 |

## Dokter Hewan

| ID | Fitur dan perilaku minimum | Data utama | Backlog |
| --- | --- | --- | --- |
| V-01 | Daftar dokter, login/logout, reset password | User, Session, VetProfile | FE-03, BE-01 |
| V-02 | Unggah dokumen, status pending/verified/revision, unggah perbaikan; layanan terkunci sebelum verified | VerificationSubmission, Attachment | FE-04, BE-02 |
| V-03 | Identitas/foto, pengalaman, bidang/jenis ternak, lokasi praktik/wilayah kunjungan, ulasan | VetProfile, Review | FE-04/21, BE-02/13 |
| V-04 | Permintaan, hari ini, aktif, ulang, ringkasan pendapatan | Consultation, FollowUp, LedgerEntry | FE-05, BE-05/15 |
| V-05 | Toggle tersedia, hari/jam, durasi slot, blok waktu, tarif chat/kunjungan | Availability, BlockedTime, ServiceRate | FE-11, BE-04 |
| V-06 | Baca keluhan/media/riwayat; terima/tolak beralasan/usulkan jadwal | Consultation, ScheduleProposal | FE-10, BE-05 |
| V-07 | Kalender harian/mingguan, detail chat/kunjungan/ulang | Consultation, FollowUp, Availability | FE-11, BE-04/05/09 |
| V-08 | Chat teks/media, viewer dan akses riwayat pasien terkait | Message, Attachment, Livestock | FE-12, BE-07 |
| V-09 | Alamat/lokasi, berangkat, tiba, mulai pemeriksaan, selesai | Visit, Consultation | FE-13, BE-05 |
| V-10 | Cari/filter pasien terkait, identitas/pemilik dan riwayat pemeriksaan/vaksin/obat | Livestock, HealthEvent, Consultation | FE-07, BE-03 |
| V-11 | Keluhan/temuan/penilaian/tindakan/perawatan, draft, tinjau/finalisasi hanya baca | ClinicalNote | FE-14, BE-08 |
| V-12 | Rekomendasi item tambah/edit/hapus, instruksi/catatan, tinjau/kirim, link marketplace | Recommendation, RecommendationItem, Product | FE-15, BE-08/10 |
| V-13 | Jadwalkan ulang, pengingat perawatan/obat/vaksin, baca laporan perkembangan | FollowUp, Reminder, ProgressReport | FE-16, BE-09 |
| V-14 | Selesaikan setelah final/konfirmasi; semua status riwayat dan hasil | Consultation, ClinicalNote, Recommendation | FE-10/13/14, BE-05/08 |
| V-15 | Kotor/komisi/bersih, tertunda/tersedia, detail transaksi dan periode | LedgerEntry, EarningTransaction | FE-23, BE-15 |
| V-16 | Jumlah/rekening, tinjau/konfirmasi pengajuan, status dan riwayat | Withdrawal, PayoutDestination, LedgerEntry | FE-23, BE-15 |
| V-17 | Notifikasi request/pesan/persetujuan/perawatan/bayar/ulang | Notification | FE-22, BE-14 |
| V-18 | Preferensi notifikasi, akun dan bantuan | Preferences, HelpEntry, User | FE-22, BE-14 |

## Perilaku lokal dan simulasi

| Area | Perilaku tahap Android lokal | Batas tahap ini |
| --- | --- | --- |
| Data/akun | CRUD tersimpan di satu database perangkat; sesi lokal melalui adapter autentikasi | Tidak menyediakan keamanan akun atau login antar perangkat setara backend |
| Reset password | Form dan hasil layanan pemulihan lokal; skenario berhasil/gagal diuji lewat adapter | Tidak mengirim email/SMS nyata atau mengklaim tautan sudah dikirim oleh provider |
| Verifikasi | Dokumen lokal dan status fixture/service lokal | Tidak menilai keabsahan izin profesi |
| Chat | Message disimpan, delivery status dari adapter lokal; lawan bicara lewat sesi akun lain di instalasi yang sama atau fixture balasan | Tidak ada realtime lintas perangkat; balasan fixture tidak menjadi instruksi medis nyata |
| Pembayaran | Adapter hasil pending/succeeded/failed; ID transaksi dan status persisten | Tidak memindahkan uang, tidak memakai rekening pengguna nyata |
| Pengiriman | Shipment timeline dari adapter lokal dengan hasil tersimpan | Tidak menghubungi kurir atau melacak GPS nyata |
| Notifikasi | Inbox lokal dibentuk dari event; pengiriman simulasi tercatat | Tidak ada push produksi dan tidak menjamin alarm saat aplikasi ditutup |
| Pencairan | Pengajuan dan reservasi saldo lokal; hasil diajukan sesuai adapter | Tidak mentransfer dana ke bank |

Skenario gagal tersedia melalui fixture/test injection di pengembangan, bukan tombol “Simulasikan” dalam produk. Keberhasilan UI selalu mengikuti hasil adapter yang digunakan.
