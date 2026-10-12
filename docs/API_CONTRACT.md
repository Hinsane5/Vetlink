# Kontrak integrasi backend v1

Status: OpenAPI executable memuat healthcheck dan auth BE-01 (`/v1/auth/*`, `/v1/me`). Route domain lain tetap kontrak target untuk tiket berikutnya. Aplikasi mobile belum memakai backend jaringan.

## Konvensi

Prefix `/v1`, JSON, ID stabil, timestamp ISO-8601 UTC, integer IDR, paginasi cursor untuk daftar. Auth memakai bearer credential opaque; token tidak menjadi query parameter. Error berbentuk `{code, message, fieldErrors?, requestId}` tanpa isi rahasia/stack trace. Client menerjemahkan pesan teknis ke bahasa Indonesia.

Mutasi concurrency-sensitive menerima `expectedVersion`. Mutasi pembayaran, order, pencairan, finalisasi dan completion menerima `Idempotency-Key`; key sama/payload sama mengembalikan hasil sebelumnya, payload berbeda ditolak. Status HTTP standar: 400 validation, 401 session, 403 role/access, 404 resource tersembunyi, 409 status/version/slot conflict, 422 rule, 429 rate limit, 503 dependency unavailable, dan 500 internal error.

Gunakan action endpoint untuk transisi yang membutuhkan syarat; jangan menyediakan PATCH umum yang membolehkan client mengatur `verified`, `completed`, `paid`, `balance`, atau `finalizedAt`.

## OpenAPI executable BE-00/01

NestJS melayani Swagger UI di `/docs` dan JSON di `/openapi.json`. Endpoint runtime yang tersedia:

| Method / path | Request | Response sukses | Error yang didokumentasikan |
| --- | --- | --- | --- |
| `GET /v1/health/live` | Tanpa body atau parameter | `LivenessResponse` (`status`, `service`, `timestamp`, `requestId`) | 500 `ApiErrorResponse` |
| `GET /v1/health/ready` | Tanpa body atau parameter | `ReadinessResponse` (`status`, pemeriksaan database, `timestamp`, `requestId`) | 503 jika PostgreSQL tidak tersedia; 500 internal |
| `POST /v1/auth/register` | Email, nama, password, role | Sesi baru dan token | 400/409/429/500 |
| `POST /v1/auth/login` | Email, password, active role | Sesi baru dan token | 400/401/403/429/500 |
| `POST /v1/auth/logout` | Refresh token | 204 | 400/429; idempotent |
| `POST /v1/auth/refresh` | Refresh token | Token baru | 400/401/429/500 |
| `POST /v1/auth/password-reset` | Email | 202 generik | 400/429; tidak membocorkan keberadaan akun |
| `POST /v1/auth/password-reset/confirm` | Reset token, password baru | 204 | 400/429 |
| `GET /v1/me` | Bearer access token | Akun aktif dan memberships | 401/403 |

Error menggunakan `{code, message, fieldErrors?, requestId}`. `fieldErrors` adalah object dari nama field ke daftar pesan; exception filter tidak mengirim stack trace. Setiap response juga mengirim header `X-Request-Id`. Shared error code/status, request pagination (`cursor`, `limit` 1–100), base `expectedVersion`, dan parameter header `Idempotency-Key` terdokumentasi sebagai schema/response reusable. `AdapterOperationResult` memiliki outcome `pending/succeeded/failed`; outcome gagal membawa `{code, message, retryable}`, dan pemanggil harus menyimpan hasil adapter sebelum memberi respons sukses.

Komponen enum status domain di OpenAPI diturunkan dari [Data model](DATA_MODEL.md): role, verifikasi dokter, siklus konsultasi, proposal jadwal, tahap kunjungan, catatan klinis, rekomendasi, follow-up/reminder/delivery, payment, order, earning, ledger, withdrawal, dan outcome adapter. Enum tersebut mendeskripsikan nilai kontrak; route domain belum diimplementasikan dan komponen ini tidak membuka akses atau mengubah status. Sebelum tiap tiket domain selesai, request/response endpoint-nya harus ditambahkan ke OpenAPI lalu direview bersama mobile.

BE-01 menambahkan bearer scheme `bearer` dan operation untuk register, login, logout, refresh, reset kata sandi, dan `/me`. Detail payload auth ada di bagian berikut. Route domain lain belum diimplementasikan.

Untuk menjalankan server lokal, migrasi, seed, dan smoke check, ikuti [panduan backend](../apps/api/README.md).

## Auth BE-01

Credential memakai provider password internal VetLink. Kata sandi di-hash dengan `scrypt` dan salt acak; database hanya menyimpan verifier. Access dan refresh credential berupa token opaque acak, database hanya menyimpan SHA-256 hash. Access berlaku 15 menit; refresh berotasi sekali pakai dan sesi memiliki expiry absolut 30 hari. Replay refresh yang sudah dipakai mencabut sesi. Logout menerima refresh token dan idempotent; reset sukses mengubah password serta mencabut semua sesi akun dalam satu transaksi.

Semua endpoint auth dibatasi per proses: register 5/IP/jam; login 20/IP/15 menit dan 5/email/15 menit; reset request 10/IP/jam dan 3/email/jam; reset confirm 10/IP/jam dan 5 token/jam; refresh/logout 30/IP/menit. Identifier dibatasi memakai HMAC dengan pepper acak proses dan tidak disimpan sebagai bucket mentah. Limiter ini sesuai proses backend lokal tunggal; deployment multi-instance memerlukan store rate-limit bersama.

| Method / path | Request | Response sukses | Error / aturan |
| --- | --- | --- | --- |
| `POST /v1/auth/register` | `email`, `fullName`, `password`, `role` (`farmer`/`vet`) | 201 `AuthSessionResponse` dengan token, peran, akun, dan expiry | 400 validasi; 409 email sudah digunakan; buat membership/profile awal/sesi atomik |
| `POST /v1/auth/login` | `email`, `password`, `activeRole` | 200 `AuthSessionResponse` | 400 validasi; 401 email/password tidak cocok atau akun nonaktif; 403 role tidak dimiliki |
| `POST /v1/auth/logout` | `refreshToken` | 204 | Mencabut sesi yang diketahui; token tak dikenal tetap 204 agar retry logout aman |
| `POST /v1/auth/refresh` | `refreshToken` | 200 `AuthSessionResponse` baru | 400 validasi; 401 token invalid/expired/replay; refresh lama dan access sebelumnya dicabut saat rotasi |
| `POST /v1/auth/password-reset` | `email` | 202 `{message}` | Status/body generik tanpa token untuk akun ada/tidak ada dan kegagalan dependency; 429 rate limit |
| `POST /v1/auth/password-reset/confirm` | `token`, `newPassword` | 204 | Token sekali pakai, berlaku 1 jam, hanya aktif setelah adapter melaporkan `succeeded`; sukses mencabut seluruh sesi |
| `GET /v1/me` | `Authorization: Bearer <accessToken>` | 200 identitas, memberships, active role, session ID | 401 session; 403 role guard; identitas selalu diambil dari token, bukan ID client |

`AuthSessionResponse` mengembalikan `accessToken`, `refreshToken`, `tokenType`, `accessExpiresAt`, `sessionExpiresAt`, `sessionId`, `activeRole`, dan ringkasan user. Client menyimpan token di secure storage. Ganti peran harus memilih membership yang sudah ada; auth tidak menambah membership atau memberikan hak akses resource. Role guard memeriksa active role dan membership pada backend.

Adapter reset bernama `PasswordResetDeliveryAdapter` mengembalikan `pending/succeeded/failed`; token reset hanya dapat dikonfirmasi bila hasil persisted adalah `succeeded`. Adapter BE-01 yang aktif `UnconfiguredPasswordResetDeliveryAdapter` selalu gagal tertutup dan tidak mengirim pesan, mengembalikan token, atau mencatat token/password. Karena belum ada provider pengiriman yang dipilih, alur permintaan reset aman dan siap disambungkan, tetapi reset yang dapat digunakan pengguna menunggu adapter pengiriman berikutnya. Hasil gagal tetap mendapat response generik 202 untuk mencegah account enumeration.

Body request/response tidak pernah ditulis ke log. Error menggunakan envelope standar tanpa nilai request, token, password atau stack. Endpoint jaringan pada deployment wajib memakai HTTPS; konfigurasi proxy dan distributed rate-limit tetap keputusan operasional sebelum multi-instance.

## Kelompok endpoint

| Modul | Endpoint usulan | Otorisasi / hasil |
| --- | --- | --- |
| Auth | POST `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/refresh`, `/auth/password-reset`, `/auth/password-reset/confirm`; GET `/me` | Session user; reset tidak membocorkan ada/tidaknya akun |
| Profil | GET/PATCH `/me/farmer`, `/me/vet`; CRUD `/me/addresses` | Owner; vet verified field tidak dapat diubah lewat profile |
| Verifikasi | POST `/me/vet/verification-submissions`; GET `/me/vet/verification` | Dokter submit/revisi; hasil review hanya trusted reviewer |
| Ternak | GET/POST `/livestock`; GET/PATCH `/livestock/{id}` | Peternak own CRUD; dokter read sesuai assignment |
| Kesehatan | GET `/livestock/{id}/health-events`; POST `/livestock/{id}/care-events`; GET `/patients` | Dokter daftar scoped; Peternak tidak menulis clinical note |
| Dokter | GET `/vets`, `/vets/{id}`, `/vets/{id}/slots`, `/vets/{id}/reviews` | Filter name/species/service/location/available/minFee/maxFee |
| Ketersediaan | GET/PUT `/me/vet/availability`; CRUD `/me/vet/blocked-times`; GET `/me/vet/schedule` | Owner dokter; preserve accepted appointments |
| Booking | POST `/consultation-quotes`, `/consultations`; GET `/consultations`, `/consultations/{id}` | Peternak owner, doctor assigned; fee dari server |
| Request | POST `/consultations/{id}/accept`, `/reject`, `/schedule-proposals` | Dokter assigned verified untuk accept; reject reason wajib |
| Reschedule | POST `/consultations/{id}/schedule-proposals/{proposalId}/respond` | Peternak owner; accepted/rejected + version |
| Mulai/selesai | POST `/consultations/{id}/start`, `/complete`, `/cancel` | Explicit role/state guard; complete butuh note final dan confirmation |
| Kunjungan | GET `/consultations/{id}/visit`; POST `.../visit/depart`, `/arrive`, `/start-examination` | Dokter assigned, stage berurutan; complete melalui complete consultation |
| Chat | GET/POST `/consultations/{id}/messages`; GET `/attachments/{id}` | Kedua pihak; clientMessageId idempotent; private media |
| Media | POST `/attachments/uploads`; POST `/attachments/{id}/commit` | Type/size/ownership check; URL/storageKey, bukan base64 video JSON |
| Note | GET/PUT `/consultations/{id}/note`; POST `.../note/finalize` | Dokter draft write; owner farmer read final; final immutable |
| Rekomendasi | GET/PUT `/consultations/{id}/recommendation`; POST `.../recommendation/send` | Dokter related writes; Peternak reads sent; linked product optional |
| Follow-up | GET/POST `/consultations/{id}/follow-ups`; PATCH `/follow-ups/{id}` | Dokter related schedules; konflik slot divalidasi |
| Laporan | GET/POST `/follow-ups/{id}/progress-reports` | Peternak related submit, dokter related read |
| Reminder | GET/POST `/reminders`; PATCH `/reminders/{id}`; POST `.../complete` | Owner atau dokter terkait create; care done berbeda delivery sent |
| Katalog | GET `/products`, `/products/{id}` | Peternak beli; dokter hanya browse untuk rekomendasi |
| Cart/checkout | GET `/me/cart`; PUT/DELETE `/me/cart/items/{productId}`; POST `/checkout-quotes`, `/orders` | Peternak saja; quantities, address, quote checked |
| Bayar | POST `/payments`; GET `/payments`, `/payments/{id}` | Owner payable; result provider atau adapter, bukan client claimed paid |
| Orders | GET `/orders`, `/orders/{id}`, `/orders/{id}/shipment` | Owner Peternak |
| Ulasan | POST `/consultations/{id}/review` | Owner, consultation completed, satu review per consultation |
| Pendapatan | GET `/me/vet/earnings?from=&to=`, `/me/vet/transactions/{id}` | Dokter own ledger projections |
| Pencairan | GET/POST `/me/vet/withdrawals`; GET `.../{id}` | Positive ≤ available; reservation transaction |
| Notifikasi | GET `/me/notifications`; POST `.../{id}/read`; GET/PATCH `/me/preferences` | Recipient/owner |

Tooling admin review, catalog management dan provider callbacks adalah internal backend/operasional berikutnya, bukan fitur mobile dokter atau toko dokter. Integrasi callbacks nyata diblokir sampai provider/security contract tersedia.

## Contoh command domain

```json
{
  "consultationId": "consultation-uuid",
  "expectedVersion": 4,
  "confirmation": true
}
```

Payload completion tidak berisi `status: completed`, harga, komisi atau identitas pasien yang bisa ditukar. Server/use case mengambilnya dari consultation terkait. Hasil memuat consultation terbaru, version baru dan operationId setelah commit.

Finalisasi: payload noteId/consultationId, expectedVersion, confirmation. Pencairan: amount, destinationId, expectedBalanceVersion bila diperlukan, confirmation; server menghitung fee/net/reservasi. Booking: animalId, vetId, serviceType, slot/startsAt, complaint, attachmentIds, quoteId, addressId untuk visit.

## Event dan efek samping

Nama event usulan: `ConsultationRequested`, `RequestAccepted`, `ScheduleProposed`, `ScheduleResponded`, `VisitStageChanged`, `MessageCreated`, `NoteFinalized`, `RecommendationSent`, `FollowUpScheduled`, `CareCompleted`, `PaymentUpdated`, `OrderUpdated`, `WithdrawalSubmitted`.

Payload event minimal: eventId, aggregateId, actorId, occurredAt, version. Efek notification/inbox dan health projection harus idempotent. Callback provider payment/shipping/payout mengubah status hanya setelah signature, reference, amount dan duplicate event tervalidasi.

## Contract tests wajib

Jalankan suite yang sama terhadap repository lokal dan API: scope ownership, verified guard, slot conflicts, final-note immutability, complete guard, sequence visit, computed totals, earning once, withdrawal reservation/retry, notification recipient. Perbedaan teknis error harus dinormalisasi ke domain error yang sama.

OpenAPI BE-00/01 executable memuat healthcheck, auth dan `/me`; endpoint domain lain pada tabel masih usulan dan belum tersedia. Request/response serta validation constraints untuk tiap domain tetap harus diturunkan dari Data model dan direview bersama mobile sebelum implementasi.
