# VetLink API (BE-00–08 dan BE-10)

Backend ini adalah modular monolith NestJS + PostgreSQL. BE-00 menyediakan healthcheck, migrasi awal, seed fiktif non-destruktif, dan kontrak OpenAPI. BE-01 menambahkan register/login/logout/refresh/reset, sesi bearer dan role guard. BE-02 menambahkan profil, Farm/Address, dokumen profesi privat dan review tepercaya. BE-03 menyediakan CRUD ternak, timeline kesehatan dan daftar pasien dokter dengan scope owner/assignment. BE-04 menyediakan discovery dokter, availability, tarif efektif-dated, blocked intervals, kalender dan slot timezone. BE-05 menambahkan quote/booking, request/accept/reject, proposal jadwal, progres kunjungan, completion dan history dengan version/idempotency guard. BE-06 menyediakan Payment dan PaymentAttempt dengan adapter lokal pending; pembayaran order menunggu model BE-11. BE-07 menyediakan storage media privat lokal, upload/commit/download terotorisasi, persistensi pesan dan transport polling. BE-08 menyediakan catatan klinis dan rekomendasi. BE-10 menyediakan pencarian/detail katalog aktif dan validasi produk tertaut pada rekomendasi. Domain lain dan provider produksi belum tersedia. Mobile belum terhubung ke API.

BE-08 menyediakan draft dan finalisasi catatan klinis dengan version guard, final snapshot immutable, rekomendasi CRUD/send dan adapter delivery lokal yang dapat gagal. Finalisasi catatan tidak menyelesaikan konsultasi; Dokter tidak mendapat hak checkout.

## Versi yang dipilih

| Komponen | Versi |
| --- | --- |
| Node.js | `24.15.0` (`.nvmrc`) |
| NestJS | `12.1.3` |
| Nest CLI | `12.0.8` |
| Nest Swagger | `12.0.2` |
| TypeScript | `6.0.3` |
| PostgreSQL | `17.4` (`postgres:17.4-alpine`) |
| Driver PostgreSQL | `pg 8.23.1` |

Gunakan Node.js yang ditetapkan `.nvmrc`. Konfigurasi `DATABASE_SSL` aktif harus memakai sertifikat CA yang tepercaya di lingkungan target; BE-00 tidak memilih hosting atau database provider produksi.

## Menjalankan lokal

Jalankan dari direktori `apps/api`:

```sh
nvm use
cp .env.example .env
npm ci
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run start:dev
```

Health API tersedia di `http://localhost:3000/v1/health/live` dan `http://localhost:3000/v1/health/ready`. Swagger UI tersedia di `http://localhost:3000/docs`, sedangkan OpenAPI JSON di `http://localhost:3000/openapi.json`.

Jika port API `3000` sudah dipakai, ubah `PORT` di `.env` ke port bebas dan gunakan port itu pada URL pemeriksaan.

`live` hanya memeriksa proses API. `ready` melakukan query PostgreSQL dan mengembalikan 503 dengan envelope error standar bila database tidak tersedia. Migration dijalankan eksplisit oleh `npm run db:migrate`, bukan saat proses API boot. Runner memakai advisory lock, hash SHA-256 untuk mendeteksi migrasi lama yang berubah, dan transaksi per file.

Container Compose mengikat port hanya pada `127.0.0.1` dan menyimpan data pada volume `vetlink-postgres-data`. Jangan memakai `docker compose down -v` bila ingin mempertahankan database lokal. Nilai password pada `.env.example` adalah placeholder lokal yang terbuka, bukan secret; gunakan secret manager pada lingkungan di luar pengembangan lokal. PostgreSQL 17.4 dipilih sebagai baseline BE-00 yang benar-benar diuji; upgrade ke PostgreSQL 18.x menjadi gate terpisah sebelum integrasi berikutnya.

Jika port host `5432` sudah dipakai, ubah `DATABASE_PORT` di `.env` ke port bebas sebelum `docker compose up`; Compose mengikat port itu ke 5432 pada container dan aplikasi membaca nilai host yang sama.

Seed hanya menambahkan identitas fixture Budi/Yuda, farm, ternak, serta produk katalog fiktif dengan `INSERT ... ON CONFLICT DO NOTHING`. Fixture tidak berisi credential dan tidak dapat dipakai untuk masuk. Seed tidak menghapus atau menimpa record yang sudah ada; konflik ID fixture dengan data berbeda membuat transaksi seed dibatalkan.

## Media dan chat BE-07

Migrasi `20261013_000003_chat_media.sql` menambah Attachment, Message, dan relasi lampiran. Storage adapter lokal menulis di luar static web root; default-nya `apps/api/.local/private-media` dengan permission privat. Ubah `MEDIA_STORAGE_DIR` bila membutuhkan lokasi lokal lain. Tidak ada bucket/provider produksi, file URL publik, atau path/storage key di response API.

Default limit development di `.env.example` adalah `MEDIA_IMAGE_MAX_BYTES=10485760` (gambar JPEG/PNG/WebP) dan `MEDIA_VIDEO_MAX_BYTES=52428800` (video MP4). Nilai integer positif dapat diubah sampai 100 MiB, batas parser multipart. Backend memeriksa byte aktual dan signature MIME, bukan hanya `Content-Type`; satu pesan menerima maksimal lima lampiran dan teks maksimal 4.000 karakter. Batas ini adalah guardrail development; keputusan produksi pada DEC-17 tetap terbuka.

Endpoint aktif BE-07 adalah `GET/POST /v1/consultations/{consultationId}/messages`, `POST .../{messageId}/retry`, `POST /v1/attachments/uploads`, `POST /v1/attachments/{id}/commit`, `GET /v1/attachments/{id}`, dan `GET /v1/attachments/{id}/content`. Semua memerlukan bearer dan mengotorisasi ulang participant/owner. Upload retry memakai `Idempotency-Key` sama; message retry memakai `clientMessageId`/message ID sama. Adapter delivery menyimpan status ke PostgreSQL; penerima membaca pesan sent lewat polling tanpa realtime. Kegagalan tercatat dan dapat diulang tanpa membuat message duplikat.

Fault injection delivery hanya tersedia saat `NODE_ENV=test`: `CHAT_DELIVERY_TEST_FAIL_FIRST_ATTEMPT=true` membuat attempt pertama gagal untuk smoke retry. Nilai ini ditolak pada environment lain; tidak ada tombol atau jalur produk untuk memaksa kegagalan.

## Auth BE-01

Provider credential yang dipilih untuk milestone ini adalah password internal VetLink: password di-hash dengan `scrypt`; access/refresh token opaque diterbitkan oleh API dan hanya hash token yang disimpan di PostgreSQL. Access token berlaku 15 menit, refresh token berotasi dan sesi berakhir setelah 30 hari. Logout mencabut sesi terkait, replay refresh mencabut sesi, dan password reset yang berhasil mencabut semua sesi akun. `GET /v1/me` mengambil identitas dari sesi dan role guard memastikan active role memang membership akun.

Rate limit berjalan di process memory; detail batas ada di [kontrak API](../../docs/API_CONTRACT.md). Ini melindungi proses lokal tunggal, bukan limiter terdistribusi untuk deployment multi-instance. Tidak ada request body, password, access token, refresh token, atau reset token yang ditulis ke log.

Reset mengembalikan status/message generik tanpa membocorkan apakah email terdaftar. Adapter `UnconfiguredPasswordResetDeliveryAdapter` mengembalikan hasil `failed`, tidak mengirim email/SMS dan tidak mengembalikan token. Konfirmasi reset hanya menerima token yang adapter-nya berhasil dan tersimpan sebagai `succeeded`; provider pengiriman belum dipilih. Karena itu endpoint reset aman terhadap enumeration, tetapi pengiriman reset yang dapat digunakan menunggu pilihan provider.

## Batas OpenAPI BE-00–08 dan BE-10

Route aktif mencakup health, Auth BE-01/`GET /v1/me`, profil/verifikasi BE-02, ternak/pasien BE-03, vet discovery/availability/slot BE-04, booking/request/proposal/visit/completion BE-05, quote/create payment BE-06, chat/media BE-07, catatan/rekomendasi BE-08, serta `GET /v1/products` dan `GET /v1/products/{id}` BE-10. Callback pembayaran lokal hanya metode service internal, tanpa route publik. Response, status HTTP, error envelope, pagination, enum status, dan adapter `pending/succeeded/failed` tercantum di OpenAPI untuk route aktif. Route domain lain yang ada di [kontrak integrasi](../../docs/API_CONTRACT.md) menunggu tiket backend masing-masing.

## Script yang tersedia

| Script | Fungsi |
| --- | --- |
| `npm run check` | Typecheck dan build NestJS |
| `npm run db:migrate` | Menerapkan migrasi yang belum ada |
| `npm run db:seed` | Menambahkan fixture yang belum tersedia |
| `npm run api:smoke` | Smoke live/ready, OpenAPI/auth, rate-limit/no-password-log, reset enumeration-safe dan 503. Saat PostgreSQL ready, script juga memeriksa katalog aktif, filter/cursor/harga, tautan rekomendasi, owner/related scope, vet verification guard, booking/slot race, proposals, visit/completion, dedupe/retry, MIME/size, dan private download; fixture sementara dibersihkan |

CI menjalankan script tersebut dengan PostgreSQL sementara. Tidak ada script reset/drop database.

## Discovery dan availability BE-04

Route BE-04 aktif: `GET /v1/vets`, `GET /v1/vets/{id}`, `GET /v1/vets/{id}/slots`, `GET/PUT /v1/me/vet/availability`, `GET/POST/PUT/DELETE /v1/me/vet/blocked-times`, dan `GET /v1/me/vet/schedule`. Discovery menampilkan Dokter yang terverifikasi dan memiliki availability/tarif. Filter name/species/service/location/available/minFee/maxFee dapat digabungkan. Tarif integer rupiah dan durasi menjadi sumber slot di backend; konfigurasi memakai `expectedVersion`, sementara timezone memakai identifier IANA.

Slot dihitung untuk tanggal lokal dokter dengan interval setengah terbuka, menghindari konsultasi aktif dan blokir. Blokir diserialisasi per Dokter, menolak overlap, dan penghapusan membatalkan record tanpa menghilangkan histori. Availability change tidak mengubah janji yang sudah ada. Quote dan slot bukan reservasi; BE-05 menghitung harga/durasi dari konfigurasi server dan mengulang pemeriksaan konflik saat submit, accept, serta persetujuan proposal.

## Booking dan completion BE-05

Route BE-05 aktif menerima quote booking (`POST /v1/consultation-quotes`), membuat booking (`POST /v1/consultations`), membaca daftar/detail/visit, menerima atau menolak request, membuat dan merespons proposal jadwal, memulai konsultasi chat, memajukan Visit, dan menyelesaikan konsultasi; daftar lengkap ada di [kontrak API](../../docs/API_CONTRACT.md#be-05-executable-contract). Role Peternak hanya mengakses booking miliknya; Dokter dibatasi ke assignment. Accept memerlukan Dokter verified dan payment succeeded yang cocok. Rejection memerlukan alasan; setelah payment sukses, backend mencatat `refund_needed` tanpa mengklaim dana kembali.

Semua mutasi memakai `expectedVersion` dan `Idempotency-Key`; slot di-serialize dengan advisory transaction lock dokter yang sama dengan BE-04. Submit, accept, dan proposal consent memvalidasi ulang availability dan konflik. Visit wajib maju berurutan; final note tidak menyelesaikan Consultation. Completion meminta konfirmasi, note final, payment succeeded, Dokter verified dan status yang sesuai, serta Visit `examining` jika jenis layanan `visit`. Action/outbox lokal memiliki hasil adapter `succeeded/pending/failed`; pending/gagal menggagalkan transaksi dan tidak menghasilkan respons sukses.

Quote menyimpan fee integer IDR dan snapshot komisi saat ini Rp0 karena kebijakan komersial belum dipilih. Quote belum mereservasi slot; booking `awaiting_payment` menahan jadwal sampai status berubah dan expiry policy tetap terbuka. Pembatalan/refund aktual, attachment booking, earning/ledger dan provider produksi tidak termasuk BE-05.

## Katalog BE-10

`GET /v1/products` mendukung gabungan filter nama, kategori, spesies, rentang harga integer IDR dan cursor stabil; respons hanya memuat produk aktif. `GET /v1/products/{id}` menyembunyikan produk nonaktif atau tidak dikenal dengan 404. Kedua route hanya baca dan tersedia bagi Peternak serta Dokter; katalog ditambah lewat seed/tooling internal tanpa route admin publik. Harga `unitPriceIdr` selalu berasal dari PostgreSQL. Tautan produk pada rekomendasi harus menunjuk produk aktif; judul snapshot berasal dari katalog, dan rekomendasi terkirim tetap dapat dibaca sesudah produk berubah status atau harga. Tidak ada stok/toko Dokter atau checkout Dokter.
