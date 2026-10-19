# Backlog backend

Status keseluruhan saat ini: BE-00–08 **Selesai**; BE-09–17 **Belum mulai**. Stack backend dipilih melalui DEC-10; hosting/provider produksi dan integrasi mobile tetap belum dipilih.

Status setiap tiket: **Selesai** berarti seluruh acceptance criteria terpenuhi dan buktinya dicatat; **Sedang dikerjakan** berarti ada progres tetapi acceptance belum lengkap; **Belum mulai** berarti implementasi belum dimulai.

P0 = fondasi dan aturan kritis integrasi; P1 = kelengkapan fitur backend; P2 = penggantian simulasi dengan provider produksi. Referensi: [API contract](../API_CONTRACT.md), [Data model](../DATA_MODEL.md), [Architecture](../ARCHITECTURE.md).

## Fondasi dan domain

| ID | Status | P | Keluaran | Dependensi | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| BE-00 | Selesai | P0 | NestJS + PostgreSQL modular monolith; scaffold, migration, config, OpenAPI, CI, healthcheck | DEC-10 | Versi Node/Nest/PostgreSQL dicatat; langkah lokal diverifikasi; `.env.example` hanya memakai nilai lokal terbuka; OpenAPI mendokumentasikan route aktif, error, request/response generik, dan enum status; seed fiktif idempoten/non-destruktif. Bukti run ada di [Testing](../TESTING.md). |
| BE-01 | Selesai | P0 | Register/login/logout/refresh/reset dan authorization | BE-00 | Provider password internal dipilih (`scrypt`); password/token hanya tersimpan sebagai hash; logout, refresh replay, dan reset sukses mencabut sesi; reset request enumeration-safe; active role dibatasi membership lewat guard; auth rate-limit; tidak log password/token. Adapter email reset lokal gagal tertutup sampai provider dipilih; [bukti](../TESTING.md#bukti-be-01-13-oktober-2026). |
| BE-02 | Selesai | P0 | Profil, Farm/Address, upload profesi, review/revision | BE-01/07 media foundation | Owner scoped; dokter tidak self-verify; verified hanya trusted reviewer; alasan revisi tersimpan; alat reviewer minimal internal, bukan toko dokter. Implementasi lokal dan batas pemeriksaannya di [Testing](../TESTING.md#bukti-be-02-19-oktober-2026). |
| BE-03 | Selesai | P0 | Livestock CRUD, health timeline, doctor patient scope | BE-01/02 | Semua field/ownership validated; pasien terkait saja; arbitrary ID denied; draft/private media tidak bocor; note klinis terhubung sekali ke history. [Bukti BE-03](../TESTING.md#bukti-be-03-19-oktober-2026). |
| BE-04 | Selesai | P0 | Vet discovery, availability/rates/blocked intervals, slots | BE-02 | Filters lengkap; half-open intervals; timezone; overlap ditolak; availability change tidak menghapus accepted appointments; tarif/slot bukan dari client. Route/migrasi dan bukti [BE-04](../TESTING.md#bukti-be-04-19-oktober-2026). |
| BE-05 | Selesai | P0 | Booking/request/accept/reject/proposals, visit progression, completion/history | BE-03/04/06/08 | Transisi valid saja; verified accept; rejection reason; concurrent slot acceptance tidak ganda; proposal consent rechecks; final/confirmation complete guard; role assignment. [Bukti BE-05](../TESTING.md#bukti-be-05-19-oktober-2026). |
| BE-06 | Selesai | P0 | Payable quotes, payment attempts dan PaymentService adapter | BE-01/00 | Amount dihitung server; tipe consultation/order terpisah dan order fail-closed sampai BE-11; pending bukan succeeded; same idempotency key deduped; retry setelah gagal memakai Payment sama; callback lokal diuji tanpa route publik; refund_needed bukan refunded. Lihat [bukti BE-06](../TESTING.md#hasil-pemeriksaan-be-06-19-oktober-2026). |
| BE-07 | Selesai | P0 | Private media storage, message persistence, chat delivery | BE-01 + consultation schema BE-00 | Owner/related access; MIME dari byte signature dan ukuran tervalidasi; clientMessageId fingerprint/dedupe; cursor pagination; upload/send failure dapat di-retry tanpa record ganda; polling PostgreSQL executable tanpa realtime. [Bukti BE-07](../TESTING.md#bukti-be-07-13-oktober-2026). |
| BE-08 | Selesai | P0 | Clinical note draft/version/final, recommendation CRUD/review/send | BE-03/07 | Required validation; stale review conflict; final snapshot immutable; final bukan completion; recommendation edits benar; empty send denied; doctor tak checkout. API/migrasi dan pemeriksaan tercatat di [bukti BE-08](../TESTING.md#bukti-be-08-19-oktober-2026). |
| BE-09 | Belum mulai | P1 | Follow-ups, reminders/care done, progress reports | BE-05/08 | Follow-up slots divalidasi; reminder delivery vs care completion terpisah; care HealthEvent sekali; farmer report ownership; notifications actor/recipient benar |

BE-05/06/08 diimplementasikan sebagai slice kontrak bertahap: schema consultation dari BE-00, payment dan clinical primitives terlebih dahulu, kemudian completion/acceptance lengkap. Jangan membuat dependensi melingkar pada runtime; billing/clinical expose domain ports dan tidak mengimport controller consultation.

## Commerce, keuangan dan operasional

| ID | Status | P | Keluaran | Dependensi | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| BE-10 | Belum mulai | P1 | Catalog search/filter/detail, link recommendations | BE-00/01 | Produk active/inactive, harga authoritative; catalog seed/internal admin; tidak menambah stok/toko ke role dokter |
| BE-11 | Belum mulai | P1 | Cart, checkout quote, order and snapshots | BE-02/06/10 | Farmer only; qty positive; stale price/address recalculated; total/unit snapshots; idempotent create; cart/order atomic |
| BE-12 | Belum mulai | P1 | Shipment adapter dan order timelines | BE-11 | Transisi status dari hasil adapter; duplicate events ignored; read owner only; pending/failed bukan delivered |
| BE-13 | Belum mulai | P1 | Review eligibility/uniqueness, profile aggregation | BE-05 | Completed own consultation only, 1–5, one per consultation; aggregate matches records |
| BE-14 | Belum mulai | P1 | Event/outbox, inbox/read/preferences, notification delivery | BE-05/07/09/11/15 | Unique event/recipient; retry tidak menduplikasi; prefs respected; resource access checked on link; sent based on delivery adapter |
| BE-15 | Belum mulai | P0 | Earnings ledger, period/detail, withdrawals/destination/reservation | BE-05/06 | Net calculation exact; earning once after paid+completed; available/pending; concurrent withdrawal cannot overspend; reserve atomically; paid no double debit; failure releases once |
| BE-16 | Belum mulai | P0 | Integration/contract/security/concurrency tests, mobile API handover | BE-01…15 sesuai scope integrasi | Local/API contract suites pass; OpenAPI conforms; cross-account access negative tests; payment/withdrawal duplicate/concurrency; flow A–D dan Peternak dua perangkat; README/evidence |
| BE-17 | Belum mulai | P2 | Provider nyata auth verification/payment/shipping/push/payout, deployment and operations | BE-16 + pilihan provider/kebijakan dan arahan deployment | Signature/reconciliation/retry rules; secret server only; observability/backup/restore; success from provider; testing sandbox sebelum produksi |

BE-17 bukan izin deploy atau menjalankan transaksi uang nyata. Implementasi provider memerlukan keputusan komersial/refund/commission/retention yang belum disepakati. Tooling reviewer/catalog internal tetap terpisah dari fitur dokter mobile.

## Kriteria integrasi lintas mobile/backend

- OpenAPI v1 dan domain error menjadi kontrak; perubahan breaking dibahas dan dipetakan ke adapter mobile.
- Tidak ada mutation status yang menerima klaim client untuk verified/final/completed/paid/balance.
- Transaksi/unique constraint melindungi slot, earning, event, order dan withdrawal dari race/retry.
- Media tidak public; dokter hanya pasien terkait; tenant owner scoping diuji lewat arbitrary ID.
- Provider asynchronous events memakai outbox/deduplication dan audit reference.
- Catatan perubahan menyebut integrasi mana sudah berjalan dan mana masih simulator, dengan bukti build/tests yang nyata.
