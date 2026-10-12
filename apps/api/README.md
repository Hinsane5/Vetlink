# VetLink API (BE-00/01)

Backend ini adalah modular monolith NestJS + PostgreSQL. BE-00 menyediakan healthcheck, migrasi awal, seed fiktif non-destruktif, dan kontrak OpenAPI. BE-01 menambahkan register/login/logout/refresh/reset, sesi bearer dan role guard. Route domain lain, integrasi payment, dan provider produksi belum tersedia.

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

Seed hanya menambahkan identitas fixture Budi/Yuda, farm, dan ternak fiktif dengan `INSERT ... ON CONFLICT DO NOTHING`. Fixture tidak berisi credential dan tidak dapat dipakai untuk masuk. Seed tidak menghapus atau menimpa record yang sudah ada; konflik ID fixture dengan data berbeda membuat transaksi seed dibatalkan.

## Auth BE-01

Provider credential yang dipilih untuk milestone ini adalah password internal VetLink: password di-hash dengan `scrypt`; access/refresh token opaque diterbitkan oleh API dan hanya hash token yang disimpan di PostgreSQL. Access token berlaku 15 menit, refresh token berotasi dan sesi berakhir setelah 30 hari. Logout mencabut sesi terkait, replay refresh mencabut sesi, dan password reset yang berhasil mencabut semua sesi akun. `GET /v1/me` mengambil identitas dari sesi dan role guard memastikan active role memang membership akun.

Rate limit berjalan di process memory; detail batas ada di [kontrak API](../../docs/API_CONTRACT.md). Ini melindungi proses lokal tunggal, bukan limiter terdistribusi untuk deployment multi-instance. Tidak ada request body, password, access token, refresh token, atau reset token yang ditulis ke log.

Reset mengembalikan status/message generik tanpa membocorkan apakah email terdaftar. Adapter `UnconfiguredPasswordResetDeliveryAdapter` mengembalikan hasil `failed`, tidak mengirim email/SMS dan tidak mengembalikan token. Konfirmasi reset hanya menerima token yang adapter-nya berhasil dan tersimpan sebagai `succeeded`; provider pengiriman belum dipilih. Karena itu endpoint reset aman terhadap enumeration, tetapi pengiriman reset yang dapat digunakan menunggu pilihan provider.

## Batas OpenAPI BE-00/01

Route aktif adalah `GET /v1/health/live`, `GET /v1/health/ready`, endpoint Auth BE-01 dan `GET /v1/me`. Response, status HTTP, error envelope, shared pagination/version/idempotency schemas, enum status domain, dan bentuk adapter `pending/succeeded/failed` tercantum di OpenAPI. Route domain yang ada di [kontrak integrasi](../../docs/API_CONTRACT.md) akan ditambahkan oleh tiket backend masing-masing setelah request/response-nya disepakati dengan mobile.

## Script yang tersedia

| Script | Fungsi |
| --- | --- |
| `npm run check` | Typecheck dan build NestJS |
| `npm run db:migrate` | Menerapkan migrasi yang belum ada |
| `npm run db:seed` | Menambahkan fixture yang belum tersedia |
| `npm run api:smoke` | Menjalankan smoke check live/ready, OpenAPI/auth, login rate-limit dan no-password-log, reset enumeration-safe, serta error 503 |

CI menjalankan script tersebut dengan PostgreSQL sementara. Tidak ada script reset/drop database.
