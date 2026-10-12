# Kontrak integrasi backend v1

Status: fondasi OpenAPI executable tersedia sejak BE-00. Runtime NestJS saat ini hanya mengimplementasikan healthcheck; kelompok route domain pada dokumen ini tetap kontrak target untuk tiket berikutnya. Aplikasi mobile belum memakai backend jaringan.

## Konvensi

Prefix `/v1`, JSON, ID stabil, timestamp ISO-8601 UTC, integer IDR, paginasi cursor untuk daftar. Auth session/backend memakai bearer credential sesuai provider nanti; token tidak menjadi query parameter. Error berbentuk `{code, message, fieldErrors?, requestId}` tanpa isi rahasia/stack trace. Client menerjemahkan pesan teknis ke bahasa Indonesia.

Mutasi concurrency-sensitive menerima `expectedVersion`. Mutasi pembayaran, order, pencairan, finalisasi dan completion menerima `Idempotency-Key`; key sama/payload sama mengembalikan hasil sebelumnya, payload berbeda ditolak. Status HTTP standar: 400 validation, 401 session, 403 role/access, 404 resource tersembunyi, 409 status/version/slot conflict, 422 rule, 429 rate limit, 503 dependency unavailable, dan 500 internal error.

Gunakan action endpoint untuk transisi yang membutuhkan syarat; jangan menyediakan PATCH umum yang membolehkan client mengatur `verified`, `completed`, `paid`, `balance`, atau `finalizedAt`.

## OpenAPI executable BE-00

NestJS melayani Swagger UI di `/docs` dan JSON di `/openapi.json`. Endpoint runtime yang tersedia saat ini:

| Method / path | Request | Response sukses | Error yang didokumentasikan |
| --- | --- | --- | --- |
| `GET /v1/health/live` | Tanpa body atau parameter | `LivenessResponse` (`status`, `service`, `timestamp`, `requestId`) | 500 `ApiErrorResponse` |
| `GET /v1/health/ready` | Tanpa body atau parameter | `ReadinessResponse` (`status`, pemeriksaan database, `timestamp`, `requestId`) | 503 jika PostgreSQL tidak tersedia; 500 internal |

Error menggunakan `{code, message, fieldErrors?, requestId}`. `fieldErrors` adalah object dari nama field ke daftar pesan; exception filter tidak mengirim stack trace. Setiap response juga mengirim header `X-Request-Id`. Shared error code/status, request pagination (`cursor`, `limit` 1–100), base `expectedVersion`, dan parameter header `Idempotency-Key` terdokumentasi sebagai schema/response reusable. `AdapterOperationResult` memiliki outcome `pending/succeeded/failed`; outcome gagal membawa `{code, message, retryable}`, dan pemanggil harus menyimpan hasil adapter sebelum memberi respons sukses.

Komponen enum status domain di OpenAPI diturunkan dari [Data model](DATA_MODEL.md): role, verifikasi dokter, siklus konsultasi, proposal jadwal, tahap kunjungan, catatan klinis, rekomendasi, follow-up/reminder/delivery, payment, order, earning, ledger, withdrawal, dan outcome adapter. Enum tersebut mendeskripsikan nilai kontrak; route domain belum diimplementasikan dan komponen ini tidak membuka akses atau mengubah status. Sebelum tiap tiket domain selesai, request/response endpoint-nya harus ditambahkan ke OpenAPI lalu direview bersama mobile.

Untuk menjalankan server lokal, migrasi, seed, dan smoke check, ikuti [panduan backend](../apps/api/README.md).

## Kelompok endpoint

| Modul | Endpoint usulan | Otorisasi / hasil |
| --- | --- | --- |
| Auth | POST `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/password-reset`, `/auth/refresh`; GET `/me` | Session user; reset tidak membocorkan ada/tidaknya akun |
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

OpenAPI BE-00 executable tetapi cakupannya baru healthcheck dan shared contract components; tabel endpoint usulan di atas tidak menandakan route tersebut tersedia. Request/response dan validation constraints untuk tiap domain tetap harus diturunkan dari Data model serta direview bersama mobile sebelum implementasi endpoint.
