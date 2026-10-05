# Instruksi pengembangan VetLink

## Konteks dan sumber acuan

Mulai dari [README](README.md), [PRD](docs/PRD.md), [Tech](docs/TECH.md), [Data model](docs/DATA_MODEL.md), dan backlog sesuai pekerjaan. Dokumentasi berbahasa Indonesia; identifier kode dan nama entitas boleh bahasa Inggris.

Urutan acuan: instruksi pengguna terbaru → aturan fungsi PRD/data model → Figma untuk visual → arsitektur dan kontrak teknis yang sudah disepakati. Catat selisih di `docs/FIGMA_MAPPING.md`; jangan mempertahankan perilaku prototype yang melanggar aturan bisnis.

Figma: `f1WBeG5S1OGXlPXyVEHjuW`, halaman `0:1`. Gunakan node nyata pada mapping. Baca konteks desain dan screenshot layar sebelum implementasi. Snapshot lokal membantu review tetapi tidak menggantikan pemeriksaan ulang bila desain berubah. Jangan menggunakan screenshot seluruh layar sebagai UI aplikasi.

## Scope dan teknologi

Mobile diarahkan ke React Native + Expo + TypeScript, Android dahulu, data lokal persisten. Jangan membuat aplikasi native Kotlin atau menambahkan kode Kotlin buatan sendiri. Generated native tooling/dependency harus dibahas di konteks kebutuhan yang nyata, bukan mengganti bahasa aplikasi.

Permintaan awal ini hanya membuat dokumentasi. Scaffold project dikerjakan ketika pengguna meminta tahap implementasi. Backend belum dipilih; jangan menetapkan framework backend atau provider produksi hanya karena tercantum sebagai kandidat di Tech.

Tidak termasuk AI diagnosis, wabah, artikel, IoT, toko/stok dokter, dan checkout oleh dokter. Jangan memperluas scope tanpa arahan pengguna.

## Arsitektur dan data

- Komponen UI tidak mengakses SQLite/API langsung. Gunakan use case dan repository.
- Satu sumber data untuk akun, ternak/pasien, konsultasi, catatan, rekomendasi, pembayaran, pesanan, dan ledger. Dashboard/riwayat harus merupakan proyeksi data yang sama.
- Simpan ID konteks di navigasi; ambil data terbaru dari repository. Jangan hardcode `VL-001` atau pasien default pada layar detail.
- UI boleh menyimpan input sementara. Draft persisten, record final, dan saldo merupakan data domain.
- Peralihan lokal → API mengganti adapter; jangan menjalankan dua otoritas tulis sekaligus. Sinkronisasi offline produksi bukan scope tahap pertama.
- Simulasi harus mengembalikan hasil layanan yang dapat gagal; jangan menampilkan sukses sebelum hasil tersimpan. Hindari tombol produk untuk melompat status atau mengisi contoh.

## Aturan wajib

1. Dokter tidak terverifikasi tidak dapat menerima layanan; pemeriksaan harus berada pada domain dan, setelah tersedia, backend.
2. Catatan final hanya baca. Finalisasi tidak menyelesaikan layanan.
3. Penyelesaian butuh catatan final, status layanan yang sesuai, serta konfirmasi pengguna.
4. Kunjungan: terjadwal → dalam perjalanan → sudah tiba → pemeriksaan berlangsung → selesai. Tolak lompatan status.
5. Bedakan jadwal tindak lanjut, pengiriman pengingat, dan laporan peternak.
6. Dokter hanya mengakses pasien terkait layanannya. Ganti peran tidak memberikan hak akses tambahan.
7. Uang menggunakan integer rupiah. Bersih = kotor − komisi. Pencairan tidak melebihi saldo tersedia dan tidak dapat diajukan dari saldo nol.
8. Pencairan diajukan berarti dana direservasi, bukan dana diterima. Retry/ketuk ganda tidak membuat debit atau transaksi ganda.
9. Dokter merekomendasikan; Peternak membeli dan checkout sendiri.
10. Fixture sepenuhnya fiktif; jangan memasukkan dosis obat nyata.

## UI dan navigasi

Bahasa Indonesia; gunakan “Pilih Peran” sebelum masuk dan “Ganti Peran” dalam akun. Jangan tampilkan “demo”, “Isi Contoh”, “Simulasikan”, atau kontrol pengujian di alur produk. Informasi tentang mode lokal/simulasi dicatat di dokumentasi dan kanal diagnostik pengembangan.

Gunakan tokens warna, Inter, spacing dan radius hasil inspeksi Figma. Pertahankan identitas masing-masing peran. Pakai satu keluarga icon; dokumentasikan penggantian glyph prototype. Area sentuh minimum 44 × 44 dp, safe area nyata, scrolling, keyboard avoidance dan bottom navigation yang tidak menutup konten.

Gabungkan variants menjadi state layar. Input harus dapat diketik, filter bekerja pada data, dialog benar-benar dialog, kalender membaca jadwal. Handle loading/error/empty/disabled serta teks panjang. Back dari form dengan perubahan belum tersimpan menawarkan Simpan Draft/Buang/Tetap Mengedit sesuai fitur.

## Pemeriksaan dan pelaporan

Saat aplikasi tersedia, jalankan script yang benar-benar ada pada manifest: typecheck, lint, domain/repository tests, dan build Android sesuai perubahan. Prioritaskan invariant, flow A–D, kontrol akses dan idempotensi; hindari tes yang hanya menyalin implementasi komponen.

Uji form, tabs, modal, back Android, keyboard dan scroll pada emulator/perangkat. Screenshot web tidak cukup sebagai bukti Android. Bandingkan ukuran 390 × 844, lalu cek ukuran kecil dan font besar. Jangan melaporkan tes atau build yang belum dijalankan.

Selesaikan perubahan yang sudah diotorisasi tanpa pertanyaan berulang. Klarifikasi hanya untuk keputusan yang berdampak besar pada scope/arsitektur; keputusan pengguna terdahulu tetap berlaku. Jangan deploy, kirim pesan kepada pihak lain, atau menggunakan layanan finansial nyata hanya berdasarkan backlog.

Perbarui dokumen, status backlog, README dan catatan bukti bila perilaku berubah. Laporkan fitur selesai, cara menjalankan yang telah diuji, pemeriksaan yang benar-benar dijalankan, selisih Figma, dan simulasi yang tersisa.
