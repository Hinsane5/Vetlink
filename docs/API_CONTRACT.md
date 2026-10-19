# Kontrak integrasi backend v1

Status per 20 Oktober 2026: OpenAPI executable memuat route BE-00–08 dan BE-10: health/auth, profil/verifikasi, ternak/pasien/riwayat, vet discovery/availability, booking/request/proposal/visit/completion, payment quote/create, chat/media, note/recommendation, dan pencarian/detail katalog aktif. BE-09 dan domain setelah BE-10 tetap kontrak target tiket berikutnya. Aplikasi mobile belum memakai backend jaringan.

## Konvensi

Prefix `/v1`, JSON, ID stabil, timestamp ISO-8601 UTC, integer IDR, paginasi cursor untuk daftar. Auth memakai bearer credential opaque; token tidak menjadi query parameter. Error berbentuk `{code, message, fieldErrors?, requestId}` tanpa isi rahasia/stack trace. Client menerjemahkan pesan teknis ke bahasa Indonesia.

Mutasi concurrency-sensitive menerima `expectedVersion`. Mutasi pembayaran, order, pencairan, finalisasi dan completion menerima `Idempotency-Key`; key sama/payload sama mengembalikan hasil sebelumnya, payload berbeda ditolak. Upload media juga mewajibkan `Idempotency-Key`; pesan memakai `clientMessageId` yang unik per actor/konsultasi. Status HTTP standar: 400 validation, 401 session, 403 role/access, 404 resource tersembunyi, 409 status/version/slot conflict, 413 payload terlalu besar, 422 rule, 429 rate limit, 503 dependency unavailable, dan 500 internal error.

Gunakan action endpoint untuk transisi yang membutuhkan syarat; jangan menyediakan PATCH umum yang membolehkan client mengatur `verified`, `completed`, `paid`, `balance`, atau `finalizedAt`.

## OpenAPI executable BE-00–08 dan BE-10

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
| `GET /v1/products` | Filter opsional `name`, `category`, `species`, `minPrice`, `maxPrice`, `cursor`, `limit` | 200 `ProductPageResponseDto` berisi `items: ProductResponseDto[]`, `nextCursor`, `hasMore` | 400/401/403/503 `ApiErrorResponseDto` |
| `GET /v1/products/{id}` | ID produk UUID | 200 `ProductResponseDto` dan `unitPriceIdr` authoritative | 401/403/404/503 `ApiErrorResponseDto` |
| `POST /v1/attachments/uploads` | Multipart `consultationId`, `file`; `Idempotency-Key` | 201 `Attachment` status `uploaded` | 400/401/403/404/409/413/422/503 |
| `POST /v1/attachments/{id}/commit` | ID lampiran yang diunggah actor | 200 `Attachment` status `committed` | 401/403/404/409/422/503 |
| `GET /v1/attachments/{id}` | ID lampiran | 200 metadata dan URL content privat | 401/403/404 |
| `GET /v1/attachments/{id}/content` | ID lampiran; bearer | 200 byte media dengan MIME terdeteksi | 401/403/404/503 |
| `GET /v1/consultations/{consultationId}/messages` | `cursor` opsional; `limit` 1–100, default 20 | 200 pesan lama-ke-baru per halaman, `nextCursor`, `hasMore` | 400/401/403/404/422 |
| `POST /v1/consultations/{consultationId}/messages` | `clientMessageId`, `text?`, `attachmentIds?` | 201 record pesan dan `deliveryStatus` | 400/401/403/404/409/422/503 |
| `POST /v1/consultations/{consultationId}/messages/{messageId}/retry` | ID pesan pengirim | 200 record yang sama dan attempt terbaru | 401/403/404/422/503 |

## Profil dan verifikasi BE-02

Semua route memakai bearer; actor ID selalu berasal dari sesi. Farm dan address hanya Peternak pemilik yang dapat membaca/mengubah. Profil Dokter tidak menerima `verificationStatus`/`verified`. Dokumen profesi dibatasi PDF/JPEG/PNG/WebP, 10 MiB, signature byte harus sesuai MIME, dan disimpan melalui private media adapter; storage gagal menghasilkan 503. Submission menerima 1–5 ID dokumen milik dokter sendiri dan mengubah status ke `pending` secara transaksional. Hanya satu submission boleh pending per dokter. Revisi membuat submission baru setelah keputusan reviewer; histori review lama tidak ditimpa.

| Method / path | Request → response | Otorisasi / aturan |
| --- | --- | --- |
| `GET/PATCH /v1/me/farmer`, `/v1/me/vet` | profil; PATCH nama dan field profesi terbatas | owner sesi; status verifikasi dan owner tidak dapat diubah |
| `GET/POST /v1/me/farms`; `PATCH /v1/me/farms/{id}` | daftar banyak farm milik akun, tambah farm baru, ubah satu farm; PATCH wajib `expectedVersion` | Peternak owner, update hanya saat versi cocok; pilihan farm pada mobile tidak mengubah otoritas ownership |
| `GET/POST /v1/me/addresses`; `PATCH /v1/me/addresses/{id}`; `DELETE /v1/me/addresses/{id}` | address tersimpan; PATCH wajib `expectedVersion` | Peternak owner; arbitrary ID mendapat 404 |
| `POST /v1/me/vet/professional-documents` | multipart `file` → metadata privat | Dokter pemilik; signature MIME, ukuran dan adapter storage diperiksa |
| `POST /v1/me/vet/verification-submissions`; `GET /v1/me/vet/verification` | `documentIds[]` → riwayat submission | Dokter sendiri; verified tidak dapat submit ulang |
| `GET /v1/me/internal/reviews`; `GET /v1/me/internal/reviews/documents/{id}/content`; `POST /v1/me/internal/reviews/{id}` | queue; byte dokumen; `{status: verified|revision_required, reason?}` | Hanya user yang ada di `trusted_reviewers`; grant diadministrasikan di luar API. Dokumen disajikan privat untuk submission pending. Revisi wajib menyimpan alasan. Status pending hanya dapat diputus sekali. |

`trusted_reviewers` tidak memiliki endpoint pemberian hak. Tidak ada alat toko/katalog Dokter. Akses dokumen review memakai streaming privat dengan `no-store` dan pemeriksaan ulang trusted reviewer.

## Ternak, pasien, dan timeline kesehatan BE-03

Semua route memakai bearer dan active role membership. Ternak Peternak dibatasi `farmer_id` sesi; Dokter hanya membaca ternak yang memiliki konsultasi terkait dengan `vet_id` sesi. Pasien arbitrary-ID disembunyikan sebagai 404. Tidak ada query media pada response ternak/timeline; timeline memasukkan catatan klinis berstatus `final` saja, sehingga draft tidak bocor. Lampiran konsultasi tetap tunduk pada endpoint media privat BE-07.

| Method / path | Request → response | Otorisasi / aturan |
| --- | --- | --- |
| `GET /v1/livestock` | Array ternak | Peternak milik sendiri; Dokter pasien dari layanan terkait yang sudah terkirim saja (`draft`/`awaiting_payment` dikecualikan) |
| `POST /v1/livestock` | `{farmId,displayCode,name,species,breed?,sex,birthDate?,estimatedAgeMonths?,weightKg?}` → 201 | Peternak; farm harus milik actor dan spesies konsisten; displayCode unik per farm |
| `GET /v1/livestock/{id}` | Detail ternak | Owner Peternak atau Dokter dari layanan terkait yang sudah terkirim |
| `PATCH /v1/livestock/{id}` | Field ternak + `expectedVersion` → detail versi baru | Peternak owner; stale version/ID tidak mengubah record |
| `DELETE /v1/livestock/{id}` | `{deleted:true}` | Peternak owner; hanya bila tidak ada riwayat yang mereferensikannya |
| `GET /v1/livestock/{id}/health-events` | Timeline terurut terbaru | Owner Peternak atau Dokter terkait; final note muncul satu kali, draft tidak ditampilkan |
| `POST /v1/livestock/{id}/care-events` | `{kind,occurredAt,description,sourceKey}` → event | Peternak owner; `sourceKey` + payload sama retry mengembalikan event sama, payload berbeda 409; bukan catatan klinis Dokter |
| `GET /v1/patients` | Data ringkas pasien | Dokter; distinct pasien dari layanan terkait yang sudah terkirim |

Data timeline BE-03 memakai `health_events` dengan provenance dan unique key. `clinical_note_id` unik memastikan proyeksi note tidak tertaut ganda; query timeline menampilkan sumber clinical note langsung dari record final dan mengabaikan baris proyeksi clinical_note agar tidak menduplikasi tampilan. Endpoint note/finalisasi tetap cakupan BE-08.

Error menggunakan `{code, message, fieldErrors?, requestId}`. `fieldErrors` adalah object dari nama field ke daftar pesan; exception filter tidak mengirim stack trace. Setiap response juga mengirim header `X-Request-Id`. Shared error code/status, request pagination (`cursor`, `limit` 1–100), base `expectedVersion`, dan parameter header `Idempotency-Key` terdokumentasi sebagai schema/response reusable. `AdapterOperationResult` memiliki outcome `pending/succeeded/failed`; outcome gagal membawa `{code, message, retryable}`, dan pemanggil harus menyimpan hasil adapter sebelum memberi respons sukses.

Komponen enum status domain di OpenAPI diturunkan dari [Data model](DATA_MODEL.md): role, verifikasi dokter, siklus konsultasi, proposal jadwal, tahap kunjungan, upload/media, delivery pesan, catatan klinis, rekomendasi, follow-up/reminder, payment, order, earning, ledger, withdrawal, dan outcome adapter. Enum tidak membuka akses atau mengubah status.

BE-01 menambahkan bearer scheme `bearer` dan operation untuk register, login, logout, refresh, reset kata sandi, dan `/me`. BE-07 menambahkan operation multipart untuk upload privat, commit, metadata/content, daftar/kirim pesan, dan retry. Detail payload auth dan BE-07 ada di bagian berikut.

### BE-06 payment slice

`GET /v1/payment-quotes/{payableType}/{payableId}` dan `POST /v1/payments` memerlukan sesi Peternak. Jenis payable hanya `consultation` atau `order`; ID konsultasi harus dimiliki Peternak dan masih `awaiting_payment`, sedangkan order ditolak sebagai not found sampai schema/use case BE-11 tersedia. Quote mengambil `fee_snapshot_idr` dari konsultasi; body create tidak menerima amount. POST memakai `Idempotency-Key` 8–128 karakter, menyimpan satu Payment per payable dan PaymentAttempt sebelum memanggil `PaymentService`, lalu mengembalikan status tersimpan (`pending/succeeded/failed`) dan referensi lokal tanpa credential/provider. Key yang sama tidak membuat attempt baru; setelah gagal, key baru membuat attempt pada Payment yang sama dengan metode dan nominal yang sama. Adapter lokal saat ini hanya membuat hasil `pending`; pending tidak mengubah status konsultasi/order.

Callback service internal mengunci Payment/Attempt, memeriksa amount integer, referensi adapter dan event ID unik; event yang sama dengan hasil sama idempotent, event conflict ditolak, dan status final tidak dapat ditimpa. Callback bukan route publik/customer dan tidak mengklaim refund; kebutuhan refund tetap `refund_needed`, bukan `refunded`. Route quote/create sudah executable; callback internal belum menjadi route atau bagian OpenAPI. Perubahan status konsultasi setelah pembayaran sukses termasuk alur booking BE-05.

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

## Chat dan media BE-07

Semua route memerlukan bearer session, active role membership, dan identitas actor dari sesi. Konsultasi harus merupakan layanan `chat`, peserta harus sama dengan `farmer_id` atau `vet_id` sesuai active role, pembayaran konsultasi harus berstatus `succeeded` dengan amount sama dengan snapshot server, dan chat harus sudah diterima (`scheduled`/`in_progress`) atau tersedia read-only untuk status `reschedule_pending`, `completed`, dan `cancelled`. ID konsultasi yang tidak terkait dikembalikan sebagai 404 agar keberadaannya tidak bocor. Bila dokter terkait belum terverifikasi, kedua pihak tidak dapat mengirim pesan atau mengunggah/commit media; dokter yang terhubung tetap dapat membaca percakapan terkait.

| Method / path | Request dan respons | Otorisasi/aturan |
| --- | --- | --- |
| `POST /v1/attachments/uploads` | `multipart/form-data`: `consultationId` UUID + satu `file`; header `Idempotency-Key` 8–128 karakter. 201 `Attachment` berstatus `uploaded` | Pengirim terverifikasi bila active role dokter; file hanya milik actor dan konteks konsultasi; retry memakai key dan fingerprint payload yang sama |
| `POST /v1/attachments/{id}/commit` | Tanpa body. 200 `Attachment` berstatus `committed` | Hanya pemilik upload; operasi idempotent dan memeriksa kembali file privat sebelum commit |
| `GET /v1/attachments/{id}` | 200 metadata `id`, `kind`, MIME, filename, `byteSize`, status, dan URL content | Pemilik dapat membaca upload committed miliknya; peserta lain hanya sesudah attachment masuk pesan yang terkirim |
| `GET /v1/attachments/{id}/content` | 200 byte file dengan `Content-Type` hasil deteksi; `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` | Otorisasi hubungan konsultasi dan relasi lampiran diperiksa ulang pada setiap download; tidak ada path/storage key pada response |
| `GET /v1/consultations/{consultationId}/messages?cursor=&limit=` | `{items, nextCursor, hasMore}`; item diurutkan lama-ke-baru dalam halaman | Sender melihat status pending/failed miliknya; penerima baru melihat pesan setelah polling transport mencatat status `sent` |
| `POST /v1/consultations/{consultationId}/messages` | `{clientMessageId, text?, attachmentIds?}` → 201 message | Teks maksimal 4.000 karakter; teks atau lampiran harus ada; maks. lima lampiran committed milik sender untuk konsultasi yang sama. clientMessageId + payload sama tidak menambah record; payload berbeda mendapat 409. Status `failed` adalah record tersimpan yang bisa dicoba lagi, bukan sukses delivery |
| `POST /v1/consultations/{consultationId}/messages/{messageId}/retry` | Tanpa body → 200 message yang sama | Hanya pengirim; retry memperbarui attempt pada record yang sama, sukses sebelumnya tidak dikirim ulang |

BE-07 memakai adapter filesystem privat lokal di luar static web root dan adapter polling PostgreSQL sebagai transport awal; tidak memerlukan realtime atau provider media/chat eksternal. Upload menerima `image/jpeg`, `image/png`, `image/webp`, dan `video/mp4`; MIME multipart harus cocok dengan signature byte. Guardrail default development adalah 10 MiB per gambar dan 50 MiB per video, dapat diubah lewat `MEDIA_IMAGE_MAX_BYTES` dan `MEDIA_VIDEO_MAX_BYTES` (masing-masing dibatasi sampai 100 MiB oleh parser transport). Guardrail ini bukan kebijakan produksi dan tidak menutup DEC-17. File tidak dikirim sebagai base64 JSON. Gagal storage/delivery menghasilkan status adapter `failed`; upload dapat diulang dengan `Idempotency-Key` yang sama, pesan dengan clientMessageId/messageId yang sama.

## Kelompok endpoint

| Modul | Endpoint usulan | Otorisasi / hasil |
| --- | --- | --- |
| Auth | POST `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/refresh`, `/auth/password-reset`, `/auth/password-reset/confirm`; GET `/me` | Session user; reset tidak membocorkan ada/tidaknya akun |
| Profil | GET/PATCH `/me/farmer`, `/me/vet`; CRUD `/me/addresses` | Owner; vet verified field tidak dapat diubah lewat profile |
| Verifikasi | POST `/me/vet/verification-submissions`; GET `/me/vet/verification` | Dokter submit/revisi; hasil review hanya trusted reviewer |
| Ternak | GET/POST `/livestock`; GET/PATCH `/livestock/{id}` | Peternak own CRUD; dokter read sesuai assignment |
| Kesehatan | GET `/livestock/{id}/health-events`; POST `/livestock/{id}/care-events`; GET `/patients` | Dokter daftar scoped; Peternak tidak menulis clinical note |
| Dokter | GET `/vets`, `/vets/{id}`, `/vets/{id}/slots`, `/vets/{id}/reviews` | Filter name/species/service/location/available/minFee/maxFee; only verified profiles with configured availability and rates are discoverable |
| Ketersediaan | GET/PUT `/me/vet/availability`; CRUD `/me/vet/blocked-times`; GET `/me/vet/schedule` | Owner dokter; preserve accepted appointments; half-open interval conflict checks |
| Booking | POST `/consultation-quotes`, `/consultations`; GET `/consultations`, `/consultations/{id}` | Peternak owner, doctor assigned; fee dari server |
| Request | POST `/consultations/{id}/accept`, `/reject`, `/schedule-proposals` | Dokter assigned verified untuk accept; reject reason wajib |
| Reschedule | POST `/consultations/{id}/schedule-proposals/{proposalId}/respond` | Peternak owner; accepted/rejected + version |
| Mulai/selesai | POST `/consultations/{id}/start`, `/complete` | Dokter assigned; complete butuh catatan final dan confirmation. Cancellation menunggu kebijakan produk |
| Kunjungan | GET `/consultations/{id}/visit`; POST `.../visit/depart`, `/arrive`, `/start-examination` | Dokter assigned, stage berurutan; complete melalui complete consultation |
| Chat | GET/POST `/consultations/{id}/messages`; GET `/attachments/{id}` | Kedua pihak; clientMessageId idempotent; private media |
| Media | POST `/attachments/uploads`; POST `/attachments/{id}/commit` | Type/size/ownership check; URL/storageKey, bukan base64 video JSON |
| Note | GET/PUT `/consultations/{id}/note`; POST `.../note/finalize` | Dokter draft write; owner farmer read final; final immutable |
| Rekomendasi | GET/PUT `/consultations/{id}/recommendation`; POST `.../recommendation/send` | Dokter related writes; Peternak reads sent; linked product optional |
| Follow-up | GET/POST `/consultations/{id}/follow-ups`; PATCH `/follow-ups/{id}` | Dokter related schedules; konflik slot divalidasi |
| Laporan | GET/POST `/follow-ups/{id}/progress-reports` | Peternak related submit, dokter related read |
| Reminder | GET/POST `/reminders`; PATCH `/reminders/{id}`; POST `.../complete` | Owner atau dokter terkait create; care done berbeda delivery sent |
| Katalog | GET `/products`, `/products/{id}` | Peternak melihat produk untuk pembelian; Dokter hanya browse untuk rekomendasi; produk nonaktif tersembunyi |
| Cart/checkout | GET `/me/cart`; PUT/DELETE `/me/cart/items/{productId}`; POST `/checkout-quotes`, `/orders` | Peternak saja; quantities, address, quote checked |
| Bayar | POST `/payments`; GET `/payments`, `/payments/{id}` | Owner payable; result provider atau adapter, bukan client claimed paid |
| Orders | GET `/orders`, `/orders/{id}`, `/orders/{id}/shipment` | Owner Peternak |
| Ulasan | POST `/consultations/{id}/review` | Owner, consultation completed, satu review per consultation |
| Pendapatan | GET `/me/vet/earnings?from=&to=`, `/me/vet/transactions/{id}` | Dokter own ledger projections |
| Pencairan | GET/POST `/me/vet/withdrawals`; GET `.../{id}` | Positive ≤ available; reservation transaction |
| Notifikasi | GET `/me/notifications`; POST `.../{id}/read`; GET/PATCH `/me/preferences` | Recipient/owner |

Tooling admin review, pengelolaan katalog, dan provider callbacks tetap merupakan operasi internal, bukan fitur mobile dokter atau toko dokter. Seed katalog hanya menambahkan fixture tanpa menimpa record. Integrasi callbacks nyata diblokir sampai provider/security contract tersedia.

### BE-05 executable contract

Semua route booking memerlukan bearer dan active role membership. Quote dan booking hanya Peternak; detail/list dibatasi ke farmer owner atau dokter assigned, dan dokter tidak menerima status `draft`/`awaiting_payment`. Ganti active role tidak mengubah predicate owner/assignment yang dipakai service.

`POST /consultation-quotes` menerima `vetId`, `animalId`, `serviceType`, `startsAt`, `complaint`, serta `addressId` wajib untuk `visit`. `Idempotency-Key` 8–128 karakter mengulang quote yang sama; payload berbeda memakai key yang sama mendapat 409. Server memvalidasi ownership ternak/alamat, alamat kunjungan yang tertaut pada Farm ternak (`PATCH /me/farms/{id}` menerima `visitAddressId` milik akun), status verified, layanan, accepting flag, tarif integer rupiah aktif, timezone, slot masa depan dan konflik interval. Durasi/akhir slot dihitung server. Quote disimpan sebagai snapshot tetapi belum mereservasi slot; submit mengulang validasi Farm/alamat dan jadwal.

`POST /consultations` menerima `quoteId` dan `Idempotency-Key`. Satu transaksi mengunci quote dan advisory lock dokter, memeriksa ulang slot terhadap konsultasi, proposal, dan blocked time aktif, membuat konsultasi `awaiting_payment`, mengonsumsi quote, menyimpan audit, dan menandai operation idempoten. Booking yang berhasil menahan slot sampai statusnya berubah; kebijakan expiry hold tetap terbuka. Tarif pada quote dan konsultasi tetap integer rupiah. Karena DEC-13 belum menetapkan komisi, BE-05 lokal menyimpan `commission_snapshot_idr=0`; ini bukan kebijakan tarif produksi.

Saat hasil `PaymentService` menjadi `succeeded`, `ConsultationPaymentSucceededPort` dipanggil dalam transaksi pembayaran yang sama. Hanya pembayaran dengan owner, payable dan amount yang cocok mengubah `awaiting_payment → requested`; pending/failed tidak mengaktifkan request. Callback tetap internal, tanpa route publik. Accept memerlukan Dokter assigned dan verified, request `requested`, payment succeeded sesuai snapshot, versi terkini, slot future yang masih sesuai availability, serta tidak ada overlap. Advisory lock per Dokter mencegah dua mutation menerima slot yang sama; Visit dibuat satu kali bila service `visit`.

Reject hanya berlaku untuk request `requested` dan memerlukan `reason` 1–500 karakter setelah trim. Jika pembayaran sudah sukses, respons menyimpan `refundStatus=refund_needed`; uang tidak diklaim sudah kembali. Dokter verified dapat membuat satu proposal pending dari status `requested`/`scheduled`; jadwal lama tetap dipakai dan slot proposal ikut ditahan. Peternak harus mengirim `decision=accept|decline`, `expectedVersion`, dan `consent`. Accept mensyaratkan `consent=true`, payment dan verifikasi aktif, serta menjalankan ulang cek slot/konflik saat transaksi; decline mengembalikan status sebelumnya. Kedua keputusan menggunakan proposal pending dan version guard yang sama.

`POST /consultations/{id}/start` hanya memulai chat dari `scheduled`. Untuk Visit, `depart`, `arrive`, dan `start-examination` hanya menerima urutan `scheduled → en_route → arrived → examining`; payload menyertakan `expectedVersion` dan `expectedVisitVersion`. `en_route`/`arrived` mempertahankan status Consultation `scheduled`; mulai pemeriksaan mengubahnya menjadi `in_progress`.

`POST /consultations/{id}/complete` menerima `confirmation=true`, `expectedVersion`, `Idempotency-Key`, dan `expectedVisitVersion` untuk Visit. Server menolak jika Dokter tidak assigned/verified, payment tidak cocok, layanan belum `in_progress`, catatan belum final, atau Visit belum `examining`. Penyelesaian Consultation dan Visit, audit action, serta completion time ditulis dalam satu transaksi. Finalisasi catatan tetap tidak mengubah status layanan; note final membuat satu `HealthEvent` yang dapat dibaca pemilik ternak dan dokter assigned. Earnings/ledger menunggu BE-15.

Semua mutasi BE-05 menggunakan `expectedVersion` dan idempotency key; replay payload sama mengembalikan hasil tersimpan, payload berbeda mendapat 409. `PostgresConsultationActionAdapter` menyimpan audit/outbox lokal sebagai append-only dalam transaksi; hasil adapter `failed`/`pending` menjadi 503 dan rollback, sehingga status tidak sukses sebelum action tersimpan. Adapter ini tidak mengirim notifikasi. Route cancel belum diaktifkan karena aturan pembatalan/refund pada DEC-17 masih terbuka; attachment upload sebelum request juga belum menjadi bagian payload quote/create.

### BE-08 executable contract

BE-08 mengaktifkan route note dan recommendation di atas. PUT note menerima `expectedVersion` dan field clinical parsial; versi awal adalah `1`, lalu setiap simpan berikutnya menaikkan versi. Penulisan dan finalisasi hanya tersedia saat Consultation `in_progress`. Finalisasi mensyaratkan complaint, findings, assessment, actions, dan careInstructions non-whitespace, serta expectedVersion yang sedang ditinjau. Konfirmasi stale mengembalikan 409; trigger PostgreSQL membuat snapshot final tidak dapat diubah/dihapus. Finalisasi hanya mengubah note dan tidak menyelesaikan Consultation.

Recommendation PUT mengganti item sesuai payload (termasuk daftar kosong untuk draft), memakai `expectedVersion`, dan menyimpan snapshot judul/instruksi/catatan serta productId opsional. Penulisan dan send hanya saat Consultation `in_progress`. Farmer hanya dapat membaca recommendation berstatus sent; Dokter harus menjadi vet konsultasi dan tidak memperoleh aksi cart/checkout. Send menolak daftar kosong; adapter delivery lokal mengembalikan outcome succeeded/failed, dan status sent hanya disimpan setelah succeeded. Adapter bukan provider notifikasi produksi.

### BE-10 executable contract

`GET /products` dan `GET /products/{id}` memerlukan bearer dan active role `farmer` atau `vet`; membership dijaga guard session. Filter `name` (substring tanpa membedakan kapital), `category` (pencocokan kategori tanpa membedakan kapital), `species`, `minPrice`, dan `maxPrice` dapat digabungkan. Hasil daftar hanya memuat produk `active=true`, diurutkan stabil menurut `lower(name), id`, dan memakai cursor opaque serta `limit` 1–100 (default 20). Detail produk nonaktif dan ID yang tidak dikenal sama-sama menghasilkan 404.

`unitPriceIdr` dibaca dari `products.unit_price_idr` sebagai rupiah integer yang aman direpresentasikan pada JSON; client tidak memasok atau menetapkan harga. Produk memiliki active/inactive, kategori, spesies, deskripsi, dan referensi gambar opsional yang saat ini null. Tidak ada route katalog tulis/admin publik, stok, atau toko Dokter. Penambahan katalog saat ini melalui seed idempotent dan tooling internal; seed menggunakan `ON CONFLICT DO NOTHING` serta menggagalkan transaksi bila ID fixture sudah berisi nilai berbeda.

Saat Dokter menulis Recommendation, productId opsional harus menunjuk produk aktif. Produk dibaca dengan row lock `FOR SHARE` dalam transaksi penyimpanan yang sama; jika produk hilang/nonaktif, seluruh edit ditolak. Untuk item tertaut, `titleSnapshot` diturunkan dari nama katalog server, bukan teks judul client. Rekomendasi terkirim tetap immutable dan dapat dibaca melalui snapshot meski produk kemudian nonaktif atau harganya berubah. Harga produk tidak disnapshot sebagai otoritas pembayaran; pembelian/checkout adalah BE-11 milik Peternak.

### BE-04 executable contract

Semua route BE-04 memerlukan bearer dan active role membership. Discovery/slot dapat dibaca Peternak maupun Dokter; konfigurasi, block dan kalender hanya Dokter pemilik. Vet discovery hanya mengembalikan profil `verified` dengan profil direktori, availability dan tarif yang telah dikonfigurasi. Query `name`, `species`, `service`, `location`, `available`, `minFee`, `maxFee` dapat digabungkan; biaya adalah integer rupiah dan sedikitnya satu tarif layanan aktif harus berada dalam seluruh batas tarif yang diminta.

`PUT /me/vet/availability` menerima `expectedVersion`, accepting flag, layanan, IANA timezone, aturan weekday lokal (Minggu=0), durasi, metadata direktori serta tarif integer rupiah per layanan. Server mengunci konfigurasi dokter, menolak versi basi/jam invalid/aturan weekday ganda, menyimpan konfigurasi dan rate efektif-dated; tarif pada consultation lama tetap snapshot. Mengubah availability tidak menghapus atau mengubah consultation yang sudah ada. Hasil mutasi berisi operationId/status/occurredAt dan nilai tersimpan.

`GET /vets/{id}/slots?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&service=chat|visit` menghasilkan slot dalam timezone dokter, maksimal 32 tanggal inklusif. Kandidat dimulai dari aturan lokal dan durasi layanan; interval memakai `[start,end)`, sehingga dua slot yang bersebelahan tidak konflik. Slot lampau, layanan tanpa rate, dokter non-verified/tidak menerima permintaan, consultation berstatus awaiting_payment/requested/scheduled/reschedule_pending/in_progress, dan blokir aktif tidak dikembalikan. Slot hasil baca tidak mereservasi jadwal; BE-05 tetap harus mengulang cek saat menerima/menetapkan layanan.

Blokir dibuat atau diubah hanya di masa depan. Pemeriksaan konflik yang diserialisasi per dokter menolak overlap dengan blok aktif dan consultation aktif, tetapi mengizinkan batas interval bersebelahan. Penghapusan blok adalah soft delete (`status=cancelled`); appointment yang diterima tidak pernah dihapus. `GET /me/vet/schedule` menampilkan consultation dan blokir pada rentang UTC yang diminta, tanpa expose hold `awaiting_payment` sebagai appointment.

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

OpenAPI executable BE-00–08 dan BE-10 memuat healthcheck, auth, profil/verifikasi, livestock/patient, vet discovery/availability/slots/blocked-times/schedule, booking/request/proposal/visit/completion, payment quote/create, chat/media, note/recommendation, dan katalog produk aktif. Follow-up BE-09, cart/checkout, order, ledger, payout, dan domain lain pada tabel tetap menunggu tiket backend berikutnya. Perubahan kontrak BE-10 telah dikoordinasikan lewat Orca sebelum implementasi.
