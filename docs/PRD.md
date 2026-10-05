# Product Requirements Document — VetLink

Status: baseline produk; implementasi awal FE-03 sampai FE-05 berjalan, keseluruhan fitur belum selesai. Tanggal: 5 Oktober 2026. Sumber: spesifikasi pengguna dan [prototype Figma](https://www.figma.com/design/f1WBeG5S1OGXlPXyVEHjuW/Untitled). Stack mobile: React Native + Expo + TypeScript; target pertama Android, data lokal.

## Masalah dan hasil yang dituju

Peternak membutuhkan data ternak dan riwayat kesehatan yang terhubung dengan konsultasi, instruksi perawatan, dan produk yang direkomendasikan. Dokter membutuhkan antrean layanan, jadwal, informasi pasien, catatan pemeriksaan, tindak lanjut dan pendapatan yang konsisten. VetLink menghubungkan kedua pekerjaan tersebut dalam satu aplikasi dengan navigasi berbeda menurut peran.

Keberhasilan tahap lokal berarti pengguna menyelesaikan alur nyata menggunakan input sendiri dan perubahan persisten, tanpa kontrol pengujian atau data yang berbeda antar layar. Tahap ini belum menyediakan komunikasi atau transaksi nyata antar perangkat.

## Pengguna dan hak akses

| Peran | Kebutuhan utama | Batas akses |
| --- | --- | --- |
| Peternak | Ternak sendiri, booking, chat, hasil pemeriksaan, pengingat, pembelian | Tidak menulis diagnosis/catatan dokter atau mengakses ternak pemilik lain |
| Dokter Hewan | Permintaan, jadwal, pasien terkait, catatan, rekomendasi, saldo | Harus terverifikasi untuk menerima layanan; tidak checkout atas nama Peternak |

Tahap lokal menggunakan data domain fixture dan akun yang dibuat melalui form pada satu instalasi. Akun fixture tidak memiliki credential login. Peran adalah hak akun, bukan tombol bypass. “Ganti Peran” hanya memilih profil yang diizinkan; jika akun tidak memiliki profil peran tujuan, pengguna masuk atau mendaftar dengan akun lain. Pergantian akun membuat sesi baru, bukan peningkatan izin. Reset lokal berlaku untuk akun yang credential-nya dibuat pada perangkat ini; tidak ada email pemulihan atau verifikasi identitas, sehingga perilaku ini tidak boleh dianggap auth produksi.

## Scope

Seluruh [38 kelompok fitur](FEATURES.md) menjadi scope baseline. Kategori tersebut meliputi autentikasi/profil, ternak dan rekam kesehatan, penemuan dokter, booking, chat/kunjungan, catatan/rekomendasi/tindak lanjut, marketplace/checkout/pesanan, pendapatan/pencairan, notifikasi/pengaturan/bantuan.

Tahap pertama: Android, data lokal persisten, media dari perangkat, layanan simulasi. Backend menyusul dan tidak menghambat implementasi lokal. Dokter dapat menyimpan dokumen dan mengajukan verifikasi lokal berstatus `pending`; belum ada reviewer lokal tepercaya yang menerbitkan `revision_required` atau `verified`. Status tersebut hanya boleh berasal dari fixture atau hasil reviewer tepercaya. Aplikasi tidak mengklaim validasi profesi sungguhan.

Di luar scope: AI pendeteksi penyakit, notifikasi wabah, artikel edukasi, IoT, pengelolaan toko/stok oleh dokter, checkout oleh dokter. Web dan iOS bukan deliverable rilis Android pertama. Provider finansial/logistik, push lintas perangkat, dan sinkronisasi offline produksi memerlukan scope integrasi berikutnya.

## Perjalanan Peternak

1. Pilih Peran → daftar/masuk → lengkapi peternakan, alamat dan jenis ternak.
2. Dashboard → Tambah Ternak → identitas/foto → detail dan rekam kesehatan.
3. Cari Dokter → filter → profil → pilih chat/kunjungan, ternak, slot, keluhan dan media → tinjau biaya → pembayaran lokal → permintaan menunggu dokter.
4. Lihat permintaan/janji → terima atau tolak usulan jadwal → chat atau pantau kunjungan → lihat catatan final, rekomendasi dan tindak lanjut → riwayat selesai → beri rating.
5. Buka rekomendasi → produk → keranjang → checkout alamat/ongkir → pembayaran → progres pesanan.
6. Lihat atau buat pengingat → tandai perawatan dilakukan → catatan perawatan diperbarui; kirim laporan perkembangan bila terkait tindak lanjut.

Pembayaran berhasil tidak otomatis berarti dokter menerima permintaan. Memilih metode pembayaran tidak menjalankan pembayaran. Konten pasien/layanan selalu merujuk ID yang dipilih.

## Flow Dokter yang wajib

| Flow | Langkah | Hasil akhir |
| --- | --- | --- |
| A | Dashboard → Permintaan → Terima → Detail Janji → Chat → Catatan → Tinjau → Finalisasi → Rekomendasi → Tindak Lanjut → Selesaikan | Konsultasi muncul pada Riwayat Selesai; Peternak melihat hasil yang sama |
| B | Jadwal → Kunjungan → Dalam Perjalanan → Sudah Tiba → Pemeriksaan → Tinjau/Finalisasi → Konfirmasi Selesai | Status kunjungan dan layanan selesai; catatan final terhubung ke ternak |
| C | Profil → Ketersediaan → Ubah Jam → Simpan → Jadwal | Slot mendatang sesuai jam baru; janji yang diterima tetap ada |
| D | Pendapatan → Detail Transaksi → Pencairan → Tinjau → Konfirmasi | Pengajuan berstatus Diajukan, dana direservasi, riwayat dan saldo konsisten |

Alur alternatif wajib: belum terverifikasi, permintaan ditolak dengan alasan, perubahan jadwal menunggu persetujuan, catatan tidak lengkap, draft belum disimpan, pembayaran gagal/tertunda, saldo kosong/tidak cukup, media gagal, dan konflik slot.

## Aturan bisnis

| ID | Aturan | Bukti penerimaan |
| --- | --- | --- |
| BR-01 | Dokter belum terverifikasi tidak dapat menerima layanan | Use case menolak walau dipanggil tanpa UI; setelah backend ada API juga menolak |
| BR-02 | Catatan final immutable dan dapat dibaca kembali | Edit ditolak, snapshot isi dan waktu final tetap sama |
| BR-03 | Finalisasi berbeda dari menyelesaikan layanan | Finalisasi meninggalkan status layanan berlangsung |
| BR-04 | Selesai membutuhkan catatan final dan konfirmasi | Cancel dialog tidak mengubah status; tanpa final ditolak |
| BR-05 | Kunjungan mengikuti urutan tindakan | Status tidak dapat dilompati atau mundur |
| BR-06 | Jadwal tindak lanjut, pengingat terkirim, laporan Peternak berbeda | Ketiganya record/status terpisah; satu perubahan tidak menandai semua selesai |
| BR-07 | Saldo nol tidak dicairkan; jumlah positif ≤ tersedia | Permintaan invalid tidak membuat pengajuan/debit |
| BR-08 | Bersih = kotor − komisi | Jumlah rupiah integer; detail transaksi sesuai agregasi |
| BR-09 | Dokter hanya melihat pasien terkait layanan | Pasien lain ditolak pada daftar maupun pembukaan detail lewat ID |
| BR-10 | Dokter memberikan rekomendasi; Peternak membeli | Tidak ada aksi cart/checkout/pembayaran pembelian pada peran Dokter |
| BR-11 | Data fiktif tanpa dosis pengobatan nyata | Fixture, resep contoh dan media tidak berisi dosis nyata |
| BR-12 | Semua fitur membaca sumber data yang sama | Perubahan tercermin pada dashboard, jadwal, pasien, hasil dan riwayat |
| BR-13 | Sukses berdasarkan hasil layanan yang tersimpan | Kegagalan/retry tidak menghasilkan sukses palsu atau duplikasi |

Kebijakan tambahan untuk rancangan awal, belum keputusan komersial: tidak ada refund otomatis pada milestone lokal; riwayat pembayaran tetap utuh bila layanan ditolak/dibatalkan, dengan refund ditandai belum diproses. Besaran komisi fixture boleh 10% tetapi bukan tarif platform yang disepakati. Lihat [Decisions](DECISIONS.md).

## Kualitas UX

Ukuran acuan 390 × 844; layout menyesuaikan ponsel lain. Bahasa Indonesia, warna/tipografi per Figma, icon satu keluarga, touch target ≥44 dp. Safe area memakai OS; bar status tiruan Figma tidak ditampilkan sebagai konten.

Forms dapat diketik dan divalidasi; filter mengolah data; modal tidak menjadi route duplikat; kalender membaca data. Draft bertahan setelah aplikasi ditutup. Navigasi kembali mempertahankan konteks konsultasi/pasien dan tidak menghilangkan input tanpa pilihan pengguna. Setiap daftar/form memiliki loading, empty, error, disabled yang relevan.

Label “Pilih Peran” dan “Ganti Peran”. Hilangkan kontrol “demo”, “Isi Contoh”, “Simulasikan” dan tombol lompat status. Status finansial/logistik tidak mengklaim layanan produksi.

## Delivery dan keputusan terbuka

Dokumentasi saat ini → fondasi lokal → flow klinis/keuangan → seluruh fitur Peternak/Dokter → acceptance Android → backend. Urutan rinci di backlog; tidak ada estimasi tanggal yang disepakati.

Masih perlu keputusan: framework backend/database final, hosting, verifikator profesi produksi, komisi, kebijakan bayar nanti/refund, batas media, SLA, dan target iOS. Keputusan tersebut dicatat sebagai terbuka, bukan diasumsikan sebagai integrasi yang tersedia.

Kriteria ukur dan bukti: [Success criteria](SUCCESS_CRITERIA.md). Rencana pengujian: [Testing](TESTING.md).
