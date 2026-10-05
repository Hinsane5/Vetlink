# Model data dan aturan status

Status: kontrak domain untuk mobile lokal lalu backend; envelope SQLite/aturan dasar FE-02, autentikasi FE-03, profil FE-04, proyeksi dashboard FE-05, serta lapisan awal FE-06 tersedia. ID menggunakan string stabil (UUID atau ekuivalen); kode tampilan seperti `VL-001` bukan primary key. Timestamp disimpan UTC, ditampilkan menggunakan timezone lokasi layanan (fixture `Asia/Jakarta`). Rupiah disimpan integer nonnegatif, bukan string `Rp...` atau float.

Entitas memiliki `id`, `createdAt`, `updatedAt`; entitas mutable memiliki `version` untuk konflik edit. Snapshot final/transaksi tidak dapat ditulis ulang. Nullable field dinyatakan pada implementasi schema, bukan diisi string kosong untuk relasi yang tidak ada.

## Entitas

| Entitas | Field minimum / relasi |
| --- | --- |
| User | nama, email ternormalisasi unik, role memberships, status akun; credential ditangani AuthService |
| Session | userId, activeRole, local session expiry (30 hari), status active/revoked; session ID di secure storage |
| FarmerProfile | userId, photoAttachmentId, farmId |
| Farm | ownerId, nama, species[], lokasi, visitAddressId |
| Address | ownerId, label, penerima, telepon, alamat, kota/provinsi/kode pos, optional koordinat |
| VetProfile | userId, nama profesi, nomor profesi fiktif, pengalaman, bidang layanan[], species[], lokasi praktik, wilayah kunjungan[], verificationStatus |
| VerificationSubmission | vetId, documentAttachmentIds[], status, reviewerReason, submittedAt, reviewedAt |
| ProfileDraft | userId, role, form snapshot, optional photo/document attachment IDs, status(draft/applied/submitted) |
| Availability | vetId, acceptingNewRequests, weekday rules(start/end/timezone), chatDurationMinutes, visitDurationMinutes |
| BlockedTime | vetId, startsAt, endsAt, reason |
| ServiceRate | vetId, serviceType(chat/visit), amount, currency=IDR, effectiveAt |
| Livestock | farmerId, farmId, displayCode unik per farm, name, species, breed, sex, birthDate atau estimatedAgeMonths, weightKg, photoAttachmentIds[], healthSummary |
| HealthEvent | animalId, kind(examination/disease/vaccine/medication/care), occurredAt, description, actorId, clinicalNoteId/reminderId optional, provenance |
| Consultation | displayCode, farmerId, vetId, animalId, type, complaint, attachmentIds[], startsAt/endsAt, status, paymentId, feeSnapshot, commissionSnapshot, visitAddressSnapshot optional, completionAt |
| ScheduleProposal | consultationId, proposedByVetId, startsAt/endsAt, reason, status, respondedAt |
| Visit | consultationId unik, stage, departureAt, arrivalAt, examinationStartedAt, completedAt |
| ClinicalNote | consultationId unik, animalId, vetId, complaint, findings, assessment, actions, careInstructions, optional followUpPlan, status, finalizedAt, finalizedBy, version |
| Recommendation | consultationId, vetId, status(draft/sent), sentAt, version |
| RecommendationItem | recommendationId, productId optional, titleSnapshot, instructions, note; tanpa dosis nyata pada fixture |
| FollowUp | consultationId, animalId, vetId, startsAt/endsAt, kind(recheck), status, reason, followUpConsultationId optional; layanan baru memiliki parentConsultationId |
| Reminder | animalId, consultationId/followUpId optional, ownerId, kind, dueAt, instructions, careStatus, deliveryStatus, completedAt |
| ProgressReport | consultationId/followUpId, farmerId, animalId, text, attachmentIds[], submittedAt, viewedAt |
| Message | consultationId, senderId, clientMessageId, text optional, attachmentIds[], deliveryStatus, sentAt |
| Attachment | ownerId, kind(image/video/document), MIME, filename, byteSize, localUri atau storageKey, accessContext, uploadStatus |
| Product | nama, kategori, species[], description, unitPrice, imageAttachmentId, active; katalog fixture, bukan inventori dokter |
| Cart / CartItem | farmerId, productId, quantity positif; total sebagai kalkulasi, bukan otoritas harga |
| Quote | ownerId, context(cart/consultation), line snapshots, shippingAmount, totalAmount, expiresAt optional |
| Order / OrderItem | farmerId, status, addressSnapshot, totalSnapshot, paymentId; item productId/name/unitPrice/quantity snapshots |
| Shipment | orderId, status, trackingCode fiktif, events[{status,time,description}] |
| Payment / PaymentAttempt | ownerId, payableType/Id, method, amount, status, operationKey, serviceReference, attemptedAt; attempts terpisah dari kewajiban bayar |
| EarningTransaction | vetId, consultationId unik, paymentId, gross, commission, net, status(pending/available), earnedAt |
| LedgerEntry | vetId, earningId/withdrawalId, kind, amount, operationKey unik, occurredAt; append-only |
| PayoutDestination | vetId, bankLabel fiktif, accountMasked, accountHolder; data rekening nyata tidak dipakai tahap lokal |
| Withdrawal | vetId, destinationSnapshot, amount, feeSnapshot, netAmount, status, operationKey, submittedAt, serviceReference |
| Review | consultationId unik, farmerId, vetId, stars integer 1–5, text, submittedAt |
| Notification | recipientId, type, contextId, eventId unik per penerima, title/body, readAt, deliveryStatus |
| Preferences | userId, notification categories, enabled; bantuan berupa konten aplikasi |

Relasi utama: Peternak → Farm → Livestock → Consultation ← Dokter. Consultation → ClinicalNote/Visit/Messages/Recommendation/FollowUp/Payment. RecommendationItem → Product → Cart → Order → Payment/Shipment. Consultation → EarningTransaction → Ledger → Withdrawal.

## Penerapan penyimpanan FE-02

SQLite menggunakan schema version `2` pada `vetlink.db`. Migrasi v2 menambah unique index untuk email user yang dinormalisasi dan mengabaikan kapitalisasi/spasi tepi. Baris `entities` menyimpan envelope (`id`, `kind`, owner/context IDs, payload JSON, timestamps, version, dan key deduplikasi); `entity_relations` menyimpan hubungan dengan foreign key; `domain_events` dan `event_effects` menyimpan hasil event atomik; `app_metadata` dan `schema_migrations` melacak versi. Repository bersama membatasi query lewat `kind`, `owner_id` dan relasi, menggunakan update dengan expected version, dan menolak edit catatan klinis yang sudah final.

Pada adapter FE-03, AuthService menyimpan verifier kata sandi bersalt di `expo-secure-store`, terpisah dari SQLite; fixture seed tidak mempunyai credential. Ini hanya verifier SHA-256 untuk simulasi lokal dan bukan KDF/password auth produksi. Session ID serta verifier tidak dikirim ke server; reset lokal tidak mengirim email dan hanya berlaku pada credential lokal yang sudah ada.

FE-04 menambahkan `ProfileDraft` sebagai entity fleksibel pada envelope SQLite v2; tidak diperlukan perubahan tabel. `ProfileService` memvalidasi form, sedangkan `SqliteProfileRepository` menyimpan user/profile/farm/alamat/submission melalui exclusive transaction dan optimistic version. Lampiran dimiliki user, menyimpan metadata serta URI lokal, dan file disalin ke direktori dokumen privat aplikasi; isi file tidak disimpan base64 atau dikirim jaringan. Picker membatasi dokumen verifikasi ke PDF/gambar. `uploadStatus=local` berarti hanya tersimpan pada perangkat.

Payload JSON memberi bentuk fleksibel bagi entitas yang belum memiliki layar/use case; validasi wajib tetap berada pada domain/use case. Kolom relasional inti, foreign key, constraint unik, dan `validateFixtureGraph` menjaga owner, konteks, jenis relasi serta idempotency. Seed fiktif `fe02-v1` hanya ditulis jika database belum berisi entitas, sehingga instalasi yang sudah mempunyai data tidak tertimpa saat startup.

## Siklus konsultasi

| Dari | Aksi / syarat | Ke |
| --- | --- | --- |
| draft | Booking valid, quote tersimpan | awaiting_payment |
| awaiting_payment | PaymentService hasil succeeded | requested |
| awaiting_payment | Gagal/pending | Tetap awaiting_payment; payment status terpisah |
| requested | Dokter verified, slot valid, accept | scheduled |
| requested | Dokter menolak + alasan | rejected |
| requested/scheduled | Dokter membuat proposal valid | reschedule_pending, simpan previousStatus |
| reschedule_pending | Peternak setuju, slot tersedia | scheduled dengan jadwal baru |
| reschedule_pending | Peternak menolak | Kembali previousStatus; jadwal lama tidak hilang |
| scheduled | Dokter mulai chat, atau Visit mulai pemeriksaan | in_progress |
| in_progress | Note final + explicit completion confirmation | completed |
| requested/scheduled | Pembatalan diizinkan policy; simpan alasan | cancelled |

Completed/rejected/cancelled adalah terminal pada baseline. Tidak ada edit langsung enum oleh layar. Request yang sudah dibatalkan tidak dapat diterima walau layar dokter belum refresh. Kebijakan pembatalan selama perjalanan/pemeriksaan dan refund produksi masih terbuka; jangan menambahkan transisi tersebut tanpa policy.

Filter Terjadwal mencakup scheduled; Berlangsung mencakup in_progress; Selesai completed; Dibatalkan cancelled. Request/rejected/reschedule_pending punya daftar/status sendiri; jangan menyamarkan rejected sebagai completed. Permintaan terbayar yang rejected/cancelled menandai kebutuhan refund sebagai data terpisah (`refund_needed`), tidak mengklaim uang sudah kembali.

Usulan DEC-11 memakai pembayaran sebelum request untuk milestone lokal. Opsi “Bayar nanti” Figma belum aktif sampai kebijakannya disepakati. Payment sukses tidak langsung membuat scheduled/in_progress.

## Kunjungan dan catatan

Visit: `scheduled → en_route → arrived → examining → completed`. `examining` mengubah Consultation menjadi in_progress. En_route dan arrived tetap berada pada Consultation scheduled; detail Peternak menampilkan visit stage terpisah. Tidak boleh complete Visit sebelum note final dan confirmation; completion Visit/Consultation harus satu transaksi.

ClinicalNote: `draft → final`. Simpan Draft menerima input parsial yang valid dan mempertahankan isi nyata. Finalisasi mensyaratkan complaint, findings, assessment, actions dan careInstructions tidak kosong. Review bukan status persisten baru: menampilkan draft/version yang sedang ditinjau. Konfirmasi finalisasi menggunakan version tersebut; bila sudah berubah, minta tinjau ulang. Final tidak otomatis complete Consultation.

Satu konsultasi memiliki satu catatan final pada baseline. Perubahan setelah final, bila kelak diperlukan, menjadi amendment terpisah dengan audit; jangan membuka ulang snapshot final. Catatan Peternak terpisah dari ClinicalNote dokter. HealthEvent yang berasal dari note final direferensikan, bukan disalin ke beberapa record yang bisa berbeda.

## Jadwal dan tindak lanjut

Waktu mulai < waktu selesai; slot harus berada dalam jam layanan, tidak overlap janji atau blocked time. End eksklusif memungkinkan slot berikut mulai tepat saat sebelumnya selesai. Perubahan jam/available tidak membatalkan janji yang sudah diterima. Proposal jadwal tidak mengganti jadwal aktif sebelum disetujui; ulangi cek konflik ketika persetujuan disimpan.

FollowUp.status: `scheduled/completed/cancelled` untuk pemeriksaan ulang. Reminder.careStatus: `scheduled/done`; deliveryStatus: `pending/sent/failed`. ProgressReport memiliki submittedAt/viewedAt. Pengingat terkirim tidak berarti vaksin/obat sudah dilakukan; laporan dibaca tidak berarti layanan selesai.

Perawatan done dapat membuat HealthEvent satu kali dengan unique reminder reference. FollowUp yang menimbulkan layanan baru harus memakai Consultation baru dengan parent link ke konsultasi asal, bukan menimpa layanan completed.

## Finansial dan pesanan

Payment.status: `pending/succeeded/failed/expired`; status berbayar berdasarkan hasil adapter. Percobaan retry mempunyai PaymentAttempt baru; operationKey yang sama harus mengembalikan hasil yang sama. Consultation dan Order memiliki payable ID berbeda.

Order: `awaiting_payment → paid → processing → shipped → delivered`. Payment gagal tidak menaikkan order menjadi paid. Shipment mempunyai timeline yang disimpan adapter. Alamat, harga dan nama produk disnapshot pada order; perubahan profil/katalog tidak mengubah order lama. Total = Σ(unitPrice × quantity) + shipping; tanpa diskon/pajak tambahan sebelum ada spesifikasi.

EarningTransaction.net = gross − commission. Amount integer IDR; komisi disnapshot saat booking/accept policy dan contoh 10% bukan tarif produksi. Earning hanya dibuat sekali untuk consultation completed dengan payment succeeded. Dana dapat berada pada pending sebelum settlement adapter memindahkannya ke available.

Ledger entry kinds: `earn_pending`, `release_pending`, `credit_available`, `reserve_withdrawal`, `release_withdrawal`, `payout_paid`. Setiap entry mempunyai amount positif dan unique operation reference. `release_pending` dan `credit_available` merupakan pasangan perpindahan saldo atomik. Agregasi bucket:

```text
pending   = Σ earn_pending − Σ release_pending
available = Σ credit_available − Σ reserve_withdrawal + Σ release_withdrawal
reserved  = Σ reserve_withdrawal − Σ release_withdrawal − Σ payout_paid
paidOut   = Σ payout_paid
```

`payout_paid` hanya mengurangi reserved; available sudah berkurang saat reserve. Saldo 600.000, pencairan 200.000 memberi available 400.000/reserved 200.000 saat submitted, lalu available 400.000/reserved 0 saat paid. Ini mencegah pengurangan available dua kali. Pending earnings dan reserved withdrawals ditampilkan terpisah.

Withdrawal: `submitted → processing → paid`, atau `submitted/processing → rejected/failed`. Pada hasil submit berhasil, reservasi amount dilakukan atomik; pending submit tidak mengaku diajukan. Paid memindahkan reservasi menjadi debit settled, bukan debit tambahan. Rejected/failed melepaskan reservasi satu kali. Pengajuan kedua harus melihat saldo setelah reservasi pertama. Saldo nol/jumlah nol/negatif/di atas available ditolak; biaya/minimum produksi belum disepakati (fixture fee=0).

## Kontrol akses

Peternak memiliki akses ternaknya, konsultasinya, cart/orders/payments/reviews miliknya. Dokter mengakses konsultasi assigned dan pasien yang terkait permintaan/layanan yang ditujukan kepadanya; riwayat kesehatan pasien tersebut dapat dibaca, tetapi dokter hanya menulis catatan layanannya sendiri. Endpoint dan query harus membatasi owner/assignment, termasuk lampiran.

Verifikasi: `not_submitted → pending → verified` atau `revision_required`; revisi mengirim submission baru → pending. FE-04 mengimplementasikan pengajuan pemilik dokter menjadi `pending`, menampilkan seluruh state status dan menyimpan submission baru tanpa menulis ulang snapshot review sebelumnya. Dokter tidak memiliki use case self-verify maupun kontrol UI untuk menandai verified/revision. Pada tahap lokal belum ada reviewer tepercaya yang memberikan keputusan baru; status selain pending hanya berasal dari data otoritatif yang sudah ada (misalnya fixture). Produksi memerlukan reviewer/admin trusted yang belum menjadi app role baru dalam scope mobile.

## Fixture minimum

Sediakan Peternak Budi dan Sari, dokter Rani verified dan dokter kedua pending, minimal sapi/kambing milik berbeda, dua dokter layanan berbeda, request/chat/visit, final note dan completed history, proposal jadwal, reminder pending/sent/done, produk non-dosis, cart kosong/berisi, payment pending/failed/succeeded, shipment dan saldo pending/available/zero.

Relasi fixture harus valid. Seed FE-02 yang terpasang berisi Budi/Sari, tiga dokter dengan status verifikasi berbeda, sapi/kambing lintas pemilik, enam konsultasi, proposal/kunjungan, draft dan final note, reminder tiga status, katalog, cart kosong/berisi, pembayaran, order/shipment, serta ledger. Dari ledger saat ini saldo dokter Yuda adalah tersedia Rp88.000, pending Rp81.000, reserved Rp20.000; dokter Rani belum memiliki entri dan saldo hasil hitungnya Rp0. Tanggal UI harus berasal dari data/clock, bukan teks “3 Oktober” hardcoded. Agregat dashboard dan saldo dihitung dari record terkait, bukan angka Figma.

FE-05 tidak menambah jenis entitas dashboard: `DashboardService` dan selector merupakan proyeksi query owner/assignment atas `Livestock`, `Consultation`, `Reminder`, `Availability`, dan `LedgerEntry`. Status jadwal tidak ditulis ulang saat availability berubah. Detail selalu dimuat ulang dengan ID konsultasi/pengingat dan diperiksa terhadap owner serta relasi assignment sebelum ditampilkan.

FE-06 memakai entitas `Livestock` dan `Attachment` yang sama. `LivestockService` memeriksa owner dan relasi farmer/farm sebelum membaca atau mengubah ternak; `displayCode` dinormalisasi huruf besar dan unik per farm. Nama, species yang tercatat pada profil farm, ras, sex, estimasi umur bulan (0–1200), dan berat positif divalidasi sebelum commit. `selectLivestock` menggabungkan pencarian kode/nama/species/ras dengan filter species dan sex. Foto disalin ke direktori privat aplikasi; attachment `accessContext=livestock` dan relasi `photo` dikomit atomik bersama ternak. Service awal menyimpan `estimatedAgeMonths`; dukungan tanggal lahir menunggu inspeksi field Figma. UI belum dikerjakan karena konteks visual terbaru dibatasi kuota Starter.
