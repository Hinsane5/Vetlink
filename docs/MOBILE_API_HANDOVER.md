# Handover kontrak API untuk mobile

Status 16 November 2026: dokumen ini menyiapkan integrasi mobile ke backend lokal. Aplikasi mobile masih memakai SQLite dan belum mengirim request ke API. Gunakan OpenAPI aktif di `/openapi.json` dan [kontrak integrasi](API_CONTRACT.md) sebagai sumber detail route/schema; tidak ada URL produksi yang dipilih.

## Koneksi dan sesi

Untuk development, API berjalan di `http://localhost:3000`; prefix route adalah `/v1`, sehingga endpoint kesehatan ada di `/v1/health/live` dan `/v1/health/ready`. Swagger UI tersedia di `/docs`. Jalankan backend mengikuti [README API](../apps/api/README.md) dengan PostgreSQL lokal dan nilai terbuka dari `.env.example`.

`POST /v1/auth/register` atau `POST /v1/auth/login` mengembalikan `accessToken`, `refreshToken`, `sessionId`, `activeRole`, dan user. Kirim token sebagai `Authorization: Bearer <accessToken>` pada setiap route terproteksi. `GET /v1/me` membaca identitas serta peran dari sesi, bukan dari ID atau klaim user yang dikirim client. Access token berlaku 15 menit; refresh token berotasi dan sesi berakhir dalam 30 hari. Logout dan refresh memakai refresh token sesuai schema OpenAPI.

Pergantian active role pada sesi yang sama memakai `POST /v1/auth/active-role` dengan body `{ "activeRole": "farmer" | "vet" }` dan bearer access token saat ini. Server memeriksa membership di PostgreSQL dalam transaksi, mempertahankan `sessionId` dan expiry absolut, lalu mengembalikan `AuthSessionResponse` dengan access/refresh token baru; token lama tidak lagi aktif. Jika membership tidak ada, server merespons 403 dan sesi/token tidak berubah. Ganti peran tidak membuka pasien atau transaksi pihak lain karena setiap route tetap memeriksa active role dan owner/assignment. Simpan ID resource di navigasi lalu baca ulang data terkini dari repository/API. Seorang Peternak dapat memiliki banyak Farm (DEC-27); daftar ternak dapat mencakup seluruh Farm milik akun, dan pembuatan ternak wajib mengirim `farmId` pilihan.

## Aturan request yang harus dipertahankan

- Gunakan UUID/ID resource yang dikembalikan API; jangan mengandalkan kode tampilan atau pasien default.
- Rupiah dikirim dan diterima sebagai integer `IDR`. Nominal payment/order dihitung backend dari quote/snapshot; `CreatePaymentDto` tidak menerima nominal.
- Timestamp request memakai ISO-8601 dengan zona waktu. Slot dan kalender mengikuti timezone Dokter; jangan menafsirkan waktu lokal sebagai UTC tanpa offset.
- Mutasi dengan `expectedVersion` harus memakai versi terbaru. `409` meminta client memuat ulang dan meninjau perubahan sebelum mencoba lagi.
- Untuk route yang menampilkan `Idempotency-Key` di OpenAPI, buat key 8–128 karakter per tindakan logis. Simpan key bersama request tertunda; retry request yang sama menggunakan key dan payload yang sama. Payload berbeda memerlukan tindakan baru dan key baru.
- `cursor` adalah opaque. Pertahankan persis nilai `nextCursor`; hentikan saat `hasMore=false`.
- Jangan menetapkan `verified`, `final`, `completed`, `paid`, atau saldo dari client. Ikuti action endpoint dan hasil yang disimpan server.

Envelope error memuat `{code, message, requestId}` dan dapat memuat `fieldErrors`. Peta respons untuk client: `400` input tidak valid, `401` sesi/token, `403` role, `404` resource tidak dapat diakses/ada, `409` konflik versi/status/idempotensi, `413` file terlalu besar, `422` aturan domain atau saldo, `429` pembatasan request, dan `503` layanan/adapter gagal. Untuk `409`/`503`, baca ulang status sebelum retry; jangan tampilkan keberhasilan yang belum tersimpan.

## Flow mobile A–D

| Flow | Urutan request backend | Hasil yang dibaca mobile |
| --- | --- | --- |
| A · Konsultasi chat | Peternak baca `GET /v1/vets` dan `/v1/vets/{id}/slots`; buat `POST /v1/consultation-quotes`, `POST /v1/consultations`, lalu `POST /v1/payments`. Dokter verified menerima request, mulai sesi, menulis/finalisasi note, mengirim rekomendasi dan follow-up; penyelesaian melalui `POST /v1/consultations/{id}/complete` setelah syarat terpenuhi. | Status payment hanya berubah dari hasil adapter tersimpan. Final note tidak menyelesaikan layanan; perlu konfirmasi completion. Peternak membaca note/rekomendasi terkirim dan riwayat dari ID konsultasi yang sama. |
| B · Kunjungan | Dokter menjalankan `POST .../visit/depart`, `.../arrive`, `.../start-examination` berurutan, membuat note final, kemudian mengonfirmasi `POST .../complete`. | Tahap hanya maju `scheduled → en_route → arrived → examining`; Peternak membaca status server yang sama. Completion memerlukan Visit `examining`, note final, payment yang sesuai, dan konfirmasi. |
| C · Ketersediaan Dokter | Baca `GET /v1/me/vet/availability`; simpan perubahan melalui `PUT /v1/me/vet/availability` dengan `expectedVersion`. Baca ulang `GET /v1/me/vet/schedule` dan `/v1/vets/{id}/slots`. | Jam/tarif di server menjadi sumber slot baru. Janji diterima yang sudah ada tetap tampil saat konfigurasi berubah. |
| D · Pendapatan/pencairan | Baca `GET /v1/me/vet/earnings`, `GET /v1/me/vet/payout-destinations`; ajukan `POST /v1/me/vet/withdrawals` dengan integer `amount`, `destinationId`, dan `Idempotency-Key`; baca ulang daftar/detail withdrawal. | Dana saat diajukan menjadi `reserved`. `submitting` belum berarti adapter menerima; `submitted` berarti permintaan lokal diterima, bukan dana telah masuk rekening. Jangan menandai payout `paid` dari UI. |

Untuk recovery Payment setelah install ulang, response hilang, atau pindah perangkat, baca `GET /v1/payments?payableType=consultation&payableId=<id>` (atau `payableType=order`) memakai payable ID dari API. Route ini mengembalikan Payment owner saja; 404 berarti Payment belum ada atau tidak dimiliki. Setelah mendapatkan Payment ID, `GET /v1/payments/{id}` memuat status Payment, Attempt terbaru, dan seluruh `attempts[]`; `GET /v1/payments/{id}/attempts` membaca histori Attempt saja. Jangan kirim ulang pembayaran dengan status `pending`/`succeeded`; setelah status tersimpan `failed`, gunakan payable dan Payment yang sama dengan Idempotency-Key baru. Setiap Attempt memuat nomor urut, status, referensi adapter, dan waktu percobaan; nominal tetap integer IDR dari snapshot server.

Detail field, status, dan error ada di [OpenAPI](../apps/api/README.md#batas-openapi-be-0016) dan [kontrak API](API_CONTRACT.md). Pembayaran/order memakai Payment yang sama pada retry; withdrawal punya satu reservasi per operasi. Adapter lokal dapat mengembalikan `pending`, `succeeded`, atau `failed`; respons mengikuti hasil yang benar-benar tersimpan.

## Sesi lintas perangkat dan batas integrasi

Backend membaca data dari PostgreSQL yang sama untuk sesi terpisah milik akun yang sama. `api:smoke` menguji switch role hanya setelah membership ada, rotasi token tanpa mengubah session ID/expiry, dan penolakan akses ke pasien yang tidak terkait. Untuk payment, satu sesi membuat Payment pada konsultasi hewan dari Farm kedua; sesi kedua membaca status/Attempt, melihat status `failed`, retry dengan key baru pada Payment yang sama, lalu kedua sesi membaca status dan histori dari database. Pembayaran paralel dengan key sama dan withdrawal paralel dengan key sama tetap diuji; hasilnya berbagi record tanpa menggandakan Attempt/reservasi. Ini membuktikan kontrak API lintas sesi, bukan QA UI pada dua perangkat fisik.

Storage SQLite mobile saat ini per instalasi. Mobile belum memakai API, offline sync produksi tidak termasuk, dan tampilan dua perangkat belum diuji. Saat adapter mobile diganti, gunakan satu sumber tulis aktif pada satu waktu; jangan menulis ke SQLite dan API sekaligus.

Semua hasil layanan pada milestone ini lokal/fiktif. Payment adapter aktif mengembalikan `pending`; tidak ada provider pembayaran/kurir/notifikasi/payout produksi, callback finansial publik, kredensial produksi, deployment, atau transaksi uang nyata. Jangan mengartikan referensi lokal sebagai transaksi nyata.
