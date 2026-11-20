# VetLink API (BE-00–16)

Backend ini adalah modular monolith NestJS + PostgreSQL. BE-00 menyediakan healthcheck, migrasi awal, seed fiktif non-destruktif, dan kontrak OpenAPI. BE-01 menambahkan register/login/logout/refresh/reset, pergantian active role dalam membership, sesi bearer dan role guard. BE-02 menambahkan profil, Farm/Address, dokumen profesi privat dan review tepercaya. BE-03 menyediakan CRUD ternak, timeline kesehatan dan daftar pasien dokter dengan scope owner/assignment serta response DTO OpenAPI untuk pasien, catatan klinis final pasien, timeline, dan care-event. BE-04 menyediakan discovery dokter, availability, tarif efektif-dated, blocked intervals, kalender dan slot timezone. BE-05 menambahkan quote/booking, request/accept/reject, proposal jadwal, progres kunjungan, completion dan history dengan version/idempotency guard. BE-06 menyediakan Payment dan PaymentAttempt dengan adapter lokal pending, termasuk payable order dari total snapshot BE-11 serta read routes owner-only untuk status Payment/Attempt dan recovery retry lintas sesi. BE-07 menyediakan storage media privat lokal, upload/commit/download terotorisasi, persistensi pesan dan transport polling. BE-08 menyediakan catatan klinis dan rekomendasi. BE-09 menambahkan jadwal follow-up tervalidasi, reminder dengan delivery adapter lokal yang dapat gagal, konfirmasi care yang membuat satu HealthEvent, laporan Peternak terscope, dan event notifikasi ber-actor/recipient. BE-10 menyediakan pencarian/detail katalog aktif dan validasi produk tertaut pada rekomendasi. BE-11 menyediakan cart Peternak, quote checkout, estimasi ongkir lokal fiktif, order/item snapshots, idempotency dan pengosongan cart/order atomik. BE-12 menyediakan shipment timeline dari hasil adapter. BE-13 menyediakan ulasan immutable satu-per-konsultasi selesai, penulisan oleh Peternak pemilik, daftar ulasan Dokter verified, dan agregat rating directory/profil. BE-14 menambahkan domain event/outbox, inbox penerima, state baca, preferensi dan adapter delivery lokal yang hasilnya dicatat idempoten. BE-15 menyediakan earnings ledger dari konsultasi completed/paid, proyeksi periode/detail, destination mask fiktif, serta withdrawal dengan reservasi/idempotency dan adapter lokal. BE-16 menambah kontrak OpenAPI yang diuji, smoke lintas sesi untuk role/membership, akses, Payment/Attempt retry dan idempotensi, serta panduan handover mobile. Integrasi mobile berlangsung bertahap melalui mode API; QA perangkat dua sisi tetap terpisah. Migrasi, seed, dan hasil smoke terbaru tercatat di [Testing](../docs/TESTING.md); provider produksi belum tersedia.

BE-08 menyediakan draft dan finalisasi catatan klinis dengan version guard, final snapshot immutable, rekomendasi CRUD/send dan adapter delivery lokal yang dapat gagal. Finalisasi catatan tidak menyelesaikan konsultasi; Dokter tidak mendapat hak checkout.

## Tindak lanjut BE-09

`POST /v1/consultations/{id}/follow-ups` hanya untuk Dokter assigned yang terverifikasi, dengan konsultasi, pembayaran, dan catatan final yang sesuai. Waktu mulai/selesai divalidasi terhadap timezone dan jam kerja dokter, durasi 5–240 menit, slot masa depan, blocked time, janji, proposal pending, serta follow-up aktif; slot memakai interval setengah terbuka. Follow-up tampil di kalender dan menyisihkan slot yang bentrok.

`POST /v1/reminders` membuat pengingat untuk ternak Peternak sendiri atau layanan Dokter terkait. Status `deliveryStatus` (`pending/sent/failed`) independen dari `careStatus` (`scheduled/done`); hasil adapter lokal dicatat bersama attempt sebelum respons dan dapat dicoba ulang pada `PATCH /v1/reminders/{id}`. Konfirmasi Peternak `POST /v1/reminders/{id}/complete` meminta `confirmation=true`, menulis satu HealthEvent dengan kunci sumber unik, dan tidak mengubah status delivery. Adapter tidak menghubungi provider eksternal. Laporan perkembangan hanya dapat dikirim Peternak pemilik melalui follow-up terkait; Dokter assigned dapat membacanya, dan pembacaan pertama mencatat `viewedAt`. Event notifikasi BE-09 kini disimpan bersama domain event dan outbox BE-14 dalam transaksi yang sama.

## Notifikasi BE-14

`GET /v1/me/notifications` hanya mengembalikan inbox penerima aktif dan mencantumkan tujuan hanya bila resource tetap dapat dibaca dengan peran aktif. `POST /v1/me/notifications/{id}/read` mengisi `readAt` sekali dan memeriksa ownership/assignment link sebelum membuka konteks; ID yang tidak terkait atau link tidak sah sama-sama menjadi 404. `GET/PATCH /v1/me/preferences` menyediakan `enabled` serta kategori `consultations`, `reminders`, dan `commerce`; preferensi mengatur delivery ke depan dan tidak menyaring atau menghapus inbox.

`domain_events` bersifat append-only; identitas event unik dan payload sama pada retry menghasilkan satu event, satu notification per recipient, dan satu row outbox. Dispatcher lokal mengambil outbox setelah commit, mengunci event, memeriksa preferensi terbaru, lalu menyimpan hasil adapter beserta attempt sebelum mengubah delivery status. Hanya outcome adapter `succeeded` yang tersimpan menjadikan notifikasi `sent`; kegagalan retryable dijadwalkan ulang pada event/recipient yang sama, sementara opt-out menghasilkan `suppressed`. Adapter ini tidak menghubungi provider eksternal.

## Ulasan BE-13

`POST /v1/consultations/{consultationId}/review` hanya menerima stars 1–5 dari Peternak pemilik setelah Consultation `completed`. Text opsional dipangkas dan dibatasi 1.000 karakter. Review unik per konsultasi dan immutable; retry dengan isi sama mengembalikan record yang sudah tersimpan, sementara isi berbeda mendapat 409. `GET /v1/vets/{id}/reviews` memberi halaman cursor dari ulasan valid; detail dan directory Dokter menambahkan `ratingAverage` serta `ratingCount` dari record yang sama.

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

`POST /v1/auth/active-role` menerima bearer access token aktif dan `{activeRole}`. Server mengunci sesi serta memeriksa membership dari PostgreSQL, mempertahankan ID/expiry sesi absolut, lalu mengembalikan session response dengan access dan refresh token baru. Token lama tidak lagi aktif; role yang tidak dimiliki mendapat 403 tanpa mengubah sesi atau memberi hak pasien.

Rate limit berjalan di process memory; detail batas ada di [kontrak API](../../docs/API_CONTRACT.md). Ini melindungi proses lokal tunggal, bukan limiter terdistribusi untuk deployment multi-instance. Tidak ada request body, password, access token, refresh token, atau reset token yang ditulis ke log.

Reset mengembalikan status/message generik tanpa membocorkan apakah email terdaftar. Adapter `UnconfiguredPasswordResetDeliveryAdapter` mengembalikan hasil `failed`, tidak mengirim email/SMS dan tidak mengembalikan token. Konfirmasi reset hanya menerima token yang adapter-nya berhasil dan tersimpan sebagai `succeeded`; provider pengiriman belum dipilih. Karena itu endpoint reset aman terhadap enumeration, tetapi pengiriman reset yang dapat digunakan menunggu pilihan provider.

## Batas OpenAPI BE-00–16

Route aktif mencakup health, Auth BE-01/`GET /v1/me`, profil/verifikasi BE-02, ternak/pasien BE-03, vet discovery/availability/slot/review dan agregat rating BE-04/13, booking/request/proposal/visit/completion BE-05, quote/create serta owner read Payment/Attempt BE-06, chat/media BE-07, catatan/rekomendasi BE-08, inbox/read/preferences BE-14, katalog BE-10, cart/checkout quote/order BE-11, shipment timeline BE-12 melalui `GET /v1/orders/{id}/shipment`, dan pendapatan/pencairan Dokter BE-15 melalui `/v1/me/vet/earnings`, `/transactions/{id}`, `/payout-destinations`, dan `/withdrawals`. BE-16 menambahkan response DTO camelCase untuk Farm/address/livestock/directory/slots/pasien/timeline/catatan klinis final/care-event/media pasien, detail Farm/address owner-scoped, serta route pagination additive `/v1/livestock/page` dan `/v1/vets/page`; daftar lama tetap array. Payment dapat ditemukan dengan GET `/v1/payments?payableType=&payableId=`, dibaca melalui `/v1/payments/{id}`, dan histori Attempt melalui `/v1/payments/{id}/attempts`; semua memakai owner ID dari sesi Peternak. Callback payment/shipment/payout lokal hanya metode service internal, tanpa route publik. Settlement juga tidak menerima mutasi publik. Response, status HTTP, error envelope, pagination, enum status, dan adapter `pending/succeeded/failed` tercantum di OpenAPI untuk route aktif. Route domain lain yang ada di [kontrak integrasi](../../docs/API_CONTRACT.md) menunggu tiket backend masing-masing.

Daftar pasien Dokter menyertakan jenis dan status layanan terkait yang dipilih dari konsultasi milik Dokter pada bearer. `draft`/`awaiting_payment` tidak dihitung; tahap kunjungan yang berlangsung dipakai untuk label status. `GET /v1/patients/{id}/clinical-notes` mengembalikan field teks catatan final saja setelah assignment pasien dan catatan diverifikasi ulang; draft dan catatan Dokter lain tidak disertakan. `GET /v1/patients/{id}/media` mengembalikan metadata lampiran privat pada pesan terkirim/laporan perkembangan pasien assigned; file dibuka hanya melalui route download privat. Foto profil ternak belum termasuk karena belum ada model media profil pada backend.

## Script yang tersedia

| Script | Fungsi |
| --- | --- |
| `npm run check` | Typecheck dan build NestJS |
| `npm run db:migrate` | Menerapkan migrasi yang belum ada |
| `npm run db:seed` | Menambahkan fixture yang belum tersedia |
| `npm run api:contract` | Suite kontrak OpenAPI/auth tanpa PostgreSQL: struktur/schema/ref, bearer, read/write DTO Farm/address/livestock/directory/slots, response DTO pasien/catatan klinis final/timeline/care-event dan BE-05, additive cursor routes, route A–D, pergantian role, read Payment/Attempt, integer IDR, dan header idempotency |
| `npm run api:smoke` | Smoke live/ready, OpenAPI/auth, rate-limit/no-password-log, reset enumeration-safe dan 503. Pada PostgreSQL, memeriksa owner/role scope Farm/address/livestock/pasien, DTO dan idempotensi sourceKey untuk timeline/care-event, cursor opaque dan no duplicate/skip, directory/slot fields, membership/token rotation, Payment read/retry lintas sesi, payment/withdrawal paralel dengan key sama, flow BE-03–15 termasuk alur A–D, booking, chat/media, ledger, reminder/notifikasi, katalog, checkout/order/shipment; fixture sementara dibersihkan |

CI menjalankan `check`, `api:contract`, migrasi/seed idempoten, dan `api:smoke` dengan PostgreSQL sementara. `api:contract` tidak memerlukan database; `api:smoke` harus memakai database development/test terisolasi. Tidak ada script reset/drop database.

## Read contract BE-16

`GET /v1/me/farms` dan `/v1/me/addresses` tetap array owner-scoped; detail ditambahkan di `/{id}` untuk tiap resource dan memberi 404 pada resource akun lain. Semua read Farm/address mengembalikan `FarmResponseDto`/`AddressResponseDto` camelCase tanpa `ownerId`. `GET /v1/livestock` dan `/v1/vets` menjaga array lama; client daftar besar beralih ke route additive `/v1/livestock/page` dan `/v1/vets/page` dengan `{items,nextCursor,hasMore}`. Ternak memakai keyset `createdAt DESC,id ASC` serta scope user+active role; directory memakai nama lowercase+ID serta filter binding. `cursor` harus digunakan apa adanya dan tidak berlaku lintas user/role/filter. Field decimal PostgreSQL `latitude`, `longitude`, `weightKg` berupa string presisi; fees/rates direktori berupa integer IDR aman. Slot berisi hanya `startsAt` dan `endsAt` timestamp ISO-8601.

## Discovery dan availability BE-04

Route BE-04 aktif: `GET /v1/vets`, `GET /v1/vets/{id}`, `GET /v1/vets/{id}/slots`, `GET/PUT /v1/me/vet/availability`, `GET/POST/PUT/DELETE /v1/me/vet/blocked-times`, dan `GET /v1/me/vet/schedule`. Discovery menampilkan Dokter yang terverifikasi dan memiliki availability/tarif. Filter name/species/service/location/available/minFee/maxFee dapat digabungkan. Tarif integer rupiah dan durasi menjadi sumber slot di backend; konfigurasi memakai `expectedVersion`, sementara timezone memakai identifier IANA.

Slot dihitung untuk tanggal lokal dokter dengan interval setengah terbuka, menghindari konsultasi aktif dan blokir. Blokir diserialisasi per Dokter, menolak overlap, dan penghapusan membatalkan record tanpa menghilangkan histori. Availability change tidak mengubah janji yang sudah ada. Quote dan slot bukan reservasi; BE-05 menghitung harga/durasi dari konfigurasi server dan mengulang pemeriksaan konflik saat submit, accept, serta persetujuan proposal.

## Booking dan completion BE-05

Route BE-05 aktif menerima quote booking (`POST /v1/consultation-quotes`), membuat booking (`POST /v1/consultations`), membaca daftar/detail/visit, menerima atau menolak request, membuat dan merespons proposal jadwal, memulai konsultasi chat, memajukan Visit, dan menyelesaikan konsultasi; daftar lengkap ada di [kontrak API](../../docs/API_CONTRACT.md#be-05-executable-contract). Role Peternak hanya mengakses booking miliknya; Dokter dibatasi ke assignment. Accept memerlukan Dokter verified dan payment succeeded yang cocok. Rejection memerlukan alasan; setelah payment sukses, backend mencatat `refund_needed` tanpa mengklaim dana kembali.

Semua mutasi memakai `expectedVersion` dan `Idempotency-Key`; slot di-serialize dengan advisory transaction lock dokter yang sama dengan BE-04. Submit, accept, dan proposal consent memvalidasi ulang availability dan konflik. Visit wajib maju berurutan; final note tidak menyelesaikan Consultation. Completion meminta konfirmasi, note final, payment succeeded, Dokter verified dan status yang sesuai, serta Visit `examining` jika jenis layanan `visit`. Action/outbox lokal memiliki hasil adapter `succeeded/pending/failed`; pending/gagal menggagalkan transaksi dan tidak menghasilkan respons sukses.

Quote menyimpan fee integer IDR dan snapshot komisi saat ini Rp0 karena kebijakan komersial belum dipilih. Quote belum mereservasi slot; booking `awaiting_payment` menahan jadwal sampai status berubah dan expiry policy tetap terbuka. Pembatalan/refund aktual, attachment booking, earning/ledger dan provider produksi tidak termasuk BE-05.

## Katalog BE-10

`GET /v1/products` mendukung gabungan filter nama, kategori, spesies, rentang harga integer IDR dan cursor stabil; respons hanya memuat produk aktif. `GET /v1/products/{id}` menyembunyikan produk nonaktif atau tidak dikenal dengan 404. Kedua route hanya baca dan tersedia bagi Peternak serta Dokter; katalog ditambah lewat seed/tooling internal tanpa route admin publik. Harga `unitPriceIdr` selalu berasal dari PostgreSQL. Tautan produk pada rekomendasi harus menunjuk produk aktif; judul snapshot berasal dari katalog, dan rekomendasi terkirim tetap dapat dibaca sesudah produk berubah status atau harga. Tidak ada stok/toko Dokter atau checkout Dokter.

## Cart, checkout, dan order BE-11

Peternak membaca cart dari `GET /v1/me/cart`, menetapkan jumlah positif dengan `PUT /v1/me/cart/items/{productId}`, dan menghapus item dengan `DELETE` pada path yang sama. Mutasi cart memakai `expectedVersion`; harga berasal dari katalog. Dokter mendapat 403 pada seluruh route commerce. Alamat checkout harus milik Peternak dan tertaut ke Farm miliknya.

`POST /v1/checkout-quotes` menerima `addressId`; backend menghitung ulang harga aktif, subtotal, ongkir lokal dan total. Estimator fiktif menyokong Bogor/Depok Rp9.000 serta Sleman/Yogyakarta Rp12.000, tanpa kontak kurir. Wilayah lain belum didukung. Quote menyimpan snapshots item/alamat/ongkir/total selama 15 menit.

`POST /v1/orders` menerima `quoteId` plus `Idempotency-Key`. Backend mengulang hitung cart, harga dan alamat dalam PostgreSQL transaction; quote basi menghasilkan 409 dan client perlu meminta quote baru untuk meninjau jumlah terbaru. Saat berhasil, order `awaiting_payment`, item/alamat/harga/total snapshots, konsumsi quote, pengosongan cart dan rekaman idempotensi commit bersama. Replay key/payload sama memberi Order yang sama; payload lain mendapat 409. `GET /v1/orders` dan `GET /v1/orders/{id}` memeriksa owner. Payment quote memakai `total_snapshot_idr`; adapter payment lokal hanya memberi `pending`, dan status baru menjadi `paid` setelah hasil `succeeded` tersimpan melalui jalur internal. BE-12 menambah `GET /v1/orders/{id}/shipment`; shipment dimulai oleh adapter lokal fiktif sesudah payment berhasil tersimpan, dan timeline membatasi pembacaan pada Peternak pemilik. Tidak ada provider kurir/uang nyata.
