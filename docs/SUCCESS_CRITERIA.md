# Kriteria keberhasilan VetLink

Status: kriteria penerimaan, bukan laporan bahwa seluruh produk sudah lulus. FE-02 fondasi lokal lulus tiket; FE-01 masih dikerjakan untuk visual, FE-03/04 dan seluruh screen/use case produk masih direncanakan. Gate M0 tetap belum lulus karena autentikasi, profil penuh, dan role guard layar belum tersedia. Gunakan [Testing](TESTING.md) sebagai prosedur dan bukti. Android lokal dan backend mempunyai gate terpisah.

## Gate dokumentasi saat ini

| ID | Kriteria | Bukti |
| --- | --- | --- |
| SC-DOC-01 | PRD, architecture, features, tech, backlog frontend/backend, README, AGENTS, testing dan success criteria tersedia | File lokal, link silang valid |
| SC-DOC-02 | 20 fitur Peternak dan 18 Dokter tercatat serta punya backlog | F-01…20 dan V-01…18 pada Features |
| SC-DOC-03 | Referensi Figma benar, route/component/data mapping dapat ditelusuri | Node IDs nyata, inventory, sample links, screenshots, batas inspeksi eksplisit |
| SC-DOC-04 | Pilihan mobile/platform/integrasi pengguna dibedakan dari usulan backend | Tech dan Decisions konsisten; tidak scaffold/dependency secara sepihak |
| SC-DOC-05 | Aturan kritis, gap desain, simulasi, serta tes yang belum dijalankan dicatat per fase | PRD/model/status/tests membedakan bukti implementasi, hasil tes, dan pekerjaan tertunda |

## Gate M0: fondasi Android

1. Development build Android dapat dibuka melalui cara menjalankan yang sudah diuji.
2. Register/login/logout/reset dan Pilih/Ganti Peran memakai input/error/session state yang nyata untuk adapter lokal.
3. Profile/farm/address/media/verification tersimpan; seed tidak menghapus perubahan setelah restart.
4. Shell/tabs/role guards dan reusable tokens Figma tersedia; database satu sumber data.
5. Belum verified tidak dapat accept; role change tidak memberi izin owner/doctor secara otomatis.

## Gate M1: alur wajib

| ID | Kriteria terukur | Bukti wajib |
| --- | --- | --- |
| SC-A | Flow Dokter A dapat diselesaikan dari booking Peternak tanpa status jump/testing control | T-A native + domain/repository guards |
| SC-B | Semua tahap B berjalan berurutan dan ditampilkan ke Peternak | T-B native + T-11 |
| SC-C | C menyimpan jam aktual dan kalender/slot membaca nilai sama | T-C + T-12/13 |
| SC-D | D berakhir submitted dengan reservasi saldo yang tepat | T-D + T-28…32 |
| SC-FINAL | Final note immutable; finalisasi meninggalkan layanan berlangsung; complete hanya setelah final/konfirmasi | T-04…10 |
| SC-SHARED | Perubahan pada consultation/note/follow-up/saldo konsisten di dashboard, detail, jadwal dan history | Query integration dan restart checks |
| SC-LOCAL | Domain state/draft/history bertahan setelah force-close/reopen pada perangkat yang sama | Native persistence run tanpa reseed |

Flow M1 tidak dianggap lulus jika hanya bisa berjalan pada pasien/layanan contoh pertama. Jalankan minimal dua consultation berbeda (chat dan visit) untuk mendeteksi salah konteks.

## Gate M2/M3: seluruh scope lokal

- Semua F-01…20 dan V-01…18 memenuhi acceptance backlog P0/P1, termasuk revisi dokter, media, filter lengkap, respons jadwal, rekam kesehatan, pengingat, commerce, reviews dan preferences.
- Flow Peternak T-F1…F4 dan pendukung T-X lulus pada Android dengan input yang diketik pengguna.
- Semua aturan BR-01…13 mempunyai bukti positif dan negatif yang relevan; penolakan tidak mengubah data.
- Payment/shipping/notification/payout sukses hanya dari hasil adapter tersimpan; failures/retries tidak membuat sukses palsu/duplikasi.
- Dokter tidak dapat membeli/checkout dan tidak melihat pasien di luar assignment; Peternak tidak mengubah clinical note dokter.
- Tidak ada blocker berupa crash, kehilangan draft tersimpan, bocor akses, bypass finalization/completion, status lompat, saldo negatif, debit ganda atau total pembayaran salah.
- Build Android dan pemeriksaan source yang tersedia lulus; setiap pengujian native/visual benar-benar dilakukan dan dicatat, bukan disimpulkan dari build.

## Gate visual dan kegunaan

| Area | Kriteria |
| --- | --- |
| Identitas | Warna/tipografi/tata letak peran mengikuti referensi; selisih disengaja tercatat |
| Ukuran | Acuan 390 × 844 dan minimal dua ukuran tambahan diuji tanpa overlap/aksi tersembunyi |
| Aksesibilitas | Target interaksi ≥44 × 44 dp; label dapat dibaca; font scale 1.3 tidak memotong informasi/aksi penting |
| Navigasi | Tab/back/modal mempertahankan konteks; kembali dari form dirty memberi pilihan yang tepat |
| Form & chat | Keyboard tidak menutup field/CTA; send/save error dapat dipulihkan tanpa input hilang |
| List & scroll | Teks panjang dan konten terakhir dapat dijangkau; empty/loading/error/disabled yang relevan tersedia |
| Bahasa | Semua label produk Indonesia; “Pilih Peran”/“Ganti Peran”; tanpa “demo”, “Isi Contoh”, “Simulasikan” atau kontrol testing |

Pemeriksaan keterbacaan warna mempertimbangkan penggunaan teks aktual; gold/orange bukan otomatis warna teks kecil pada cream. Bila perlu perubahan untuk keterbacaan, dokumentasikan dengan screenshot dan alasan. Tidak ada klaim audit aksesibilitas formal sebelum dilakukan.

## Gate M4: backend

Backend dipilih dan runnable; OpenAPI/adapter contract tests lulus; ownership/role rules server-side; race slot/withdrawal dan duplicate provider events ditangani. Flow dua perangkat dan network failure/retry diuji. Modul yang dipindahkan tidak masih menulis status authoritative secara lokal.

Simulasi backend tetap dapat digunakan sampai provider produksi disepakati. Gate backend terhubung tidak otomatis berarti pembayaran, push, kurir atau pencairan produksi tersedia. Integrasi provider memiliki bukti sandbox dan izin operasional terpisah.

## Metrik produk berikutnya

Metrik yang akan diukur setelah aplikasi bisa digunakan: completion rate flow A–D/Peternak, task time, error/retry rate, kehilangan data/draft, dan jumlah pengguna yang membutuhkan bantuan navigasi. Target numerik usability/performance belum disepakati dan belum diukur; jangan menyatakan angka sebagai hasil. Gate saat ini fokus pada flow/invariant yang dapat diverifikasi.
