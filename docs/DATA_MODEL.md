# Model data dan aturan status

Status per 20 Oktober 2026: kontrak domain untuk mobile lokal dan backend; BE-00–08 dan BE-10 kini memiliki schema/API aktif untuk fondasi, auth, profil/verifikasi, ternak/pasien/timeline, discovery, booking/kunjungan/completion, pembayaran, klinis, chat/media privat, dan katalog aktif. BE-09 masih menunggu. FE-22 menambahkan inbox berbasis penerima dan preferensi per akun pada frontend lokal; FE-26 menambahkan Farm jamak. Envelope SQLite/aturan dasar FE-02, autentikasi historis FE-03, profil FE-04, dashboard FE-05, ternak/riwayat/pasien FE-06/07, direktori/jadwal baca FE-08, draft/quote/booking menunggu pembayaran FE-09, respons/status/proposal/riwayat FE-10, ketersediaan dan kalender FE-11, chat lokal FE-12, tahap kunjungan FE-13, serta catatan klinis/finalisasi/penyelesaian lokal FE-14 tersedia dalam source. ID menggunakan string stabil (UUID atau ekuivalen); kode tampilan seperti `VL-001` bukan primary key. Timestamp disimpan UTC, ditampilkan menggunakan timezone lokasi layanan (fixture `Asia/Jakarta`). Rupiah disimpan integer nonnegatif, bukan string `Rp...` atau float.

Entitas memiliki `id`, `createdAt`, `updatedAt`; entitas mutable memiliki `version` untuk konflik edit. Snapshot final/transaksi tidak dapat ditulis ulang. Nullable field dinyatakan pada implementasi schema, bukan diisi string kosong untuk relasi yang tidak ada.

## Entitas

| Entitas | Field minimum / relasi |
| --- | --- |
| User | nama, email ternormalisasi unik, role memberships, status akun; credential ditangani AuthService |
| UserCredential | userId, password hash `scrypt` dengan salt acak, skema hash, updatedAt/version; raw password tidak disimpan |
| Session | userId, activeRole harus terdaftar sebagai membership, access hash/expiry, refresh hash, expiry sesi absolut 30 hari, status active/revoked; token hanya dikembalikan saat issue/rotate dan hash disimpan di backend |
| RefreshTokenHistory | sessionId, hash refresh yang telah dipakai, consumedAt; replay mencabut sesi |
| PasswordResetRequest | userId, token hash, adapter delivery status/operationId, expiresAt, deliveredAt/consumedAt; token hanya dapat dipakai satu kali setelah delivery succeeded |
| FarmerProfile | userId, `farmId` untuk Farm yang sedang dipilih pada UI, photoAttachmentId; pilihan ini tidak membatasi akses pemilik ke Farm lain |
| Farm | ownerId Peternak, nama, species[], lokasi, visitAddressId; satu owner dapat memiliki banyak Farm |
| Address | ownerId, contextId Farm, label, penerima, telepon, alamat, kota/provinsi/kode pos, optional koordinat |
| VetProfile | userId, nama profesi, nomor profesi fiktif, pengalaman, bidang layanan[], species[], lokasi praktik, wilayah kunjungan[], verificationStatus |
| VerificationSubmission | vetId, documentAttachmentIds[], status, reviewerReason, submittedAt, reviewedAt |
| ProfileDraft | userId, role, form snapshot, optional photo/document attachment IDs, status(draft/applied/submitted) |
| BookingDraft | ownerId, vetId, input(service/animalId/farmId/selectedDay/startsAt/endsAt/complaint/visitAddress/attachmentIds), status(draft/discarded/submitted), consultationId setelah submit, version |
| Availability | vetId, acceptingNewRequests, services[], timezone, weekdayRules[{weekday:0–6,start:HH:mm,end:HH:mm}], chatDurationMinutes, visitDurationMinutes |
| BlockedTime | vetId, startsAt, endsAt, reason, status(active/cancelled) |
| ServiceRate | vetId, serviceType(chat/visit), amount, currency=IDR, effectiveAt, configurationVersion |
| AvailabilityDraft | ownerId Dokter, status(draft/applied/discarded), input snapshot dan token versi konfigurasi, version |
| ConsultationQuote | farmerId, vetId, animalId, serviceType, complaint, startsAt/endsAt, fee/commission snapshots, visitAddressSnapshot, idempotencyKey/fingerprint, consumedAt optional |
| Livestock | farmerId, farmId, `contextId=farmId` pada mobile lokal, displayCode unik per farm, name, species, breed, sex, birthDate atau estimatedAgeMonths, weightKg, photoAttachmentIds[], healthSummary |
| HealthEvent | animalId, kind(examination/disease/vaccine/medication/care), occurredAt, description, actorId, clinicalNoteId/reminderId/attachment[] optional, provenance(farmer_report/clinical_note/reminder), sourceKey unik untuk proyeksi dan laporan idempotent |

BE-03 memetakan `health_events` pada PostgreSQL dengan `source_key` unik per provenance dan `clinical_note_id` unik. Timeline mengambil laporan non-klinis dari event dan catatan klinis langsung dari note yang final; draft tidak pernah diserialisasi dan proyeksi note tidak ditampilkan dua kali. Daftar Dokter dibentuk dari join konsultasi assigned, sedangkan detail/timeline setiap ID menjalankan pemeriksaan scope yang sama. CRUD tulis ternak terbatas ke pemilik Peternak; perubahan memakai version dan penghapusan dibatasi oleh relasi riwayat.
| Consultation | displayCode, farmerId, vetId, animalId, farmId/`contextId=farmId` pada mobile lokal, quoteId optional pada backend, type, complaint, attachmentIds[], startsAt/endsAt, status, fee/commission snapshots, visitAddressSnapshot optional, rejectionReason, refundStatus, completionAt, version |
| ScheduleProposal | consultationId, proposedByVetId, startsAt/endsAt, reason, previousStatus, status(pending/accepted/declined/superseded), respondedAt/respondedBy, version |
| ConsultationDraft | ownerId Dokter, contextId consultationId, input(reason/startsAt/endsAt), status(draft/discarded/submitted), version |
| ConsultationAction | actorId, contextId consultationId, role, action, actionScope, operationKey unik, fingerprint, fromStatus/toStatus, fromVisitStage/toVisitStage, details; append-only |
| Visit | consultationId unik, stage, departureAt, arrivalAt, examinationStartedAt, completedAt |
| ClinicalNote | consultationId unik, animalId, vetId, complaint, findings, assessment, actions, careInstructions, optional followUpPlan/attachment[], status, finalizedAt, finalizedBy, version; final hanya baca |
| Recommendation | consultationId, vetId, status(draft/sent), sentAt, version |
| RecommendationItem | recommendationId, productId optional, titleSnapshot, instructions, note; tanpa dosis nyata pada fixture |
| FollowUp | consultationId, animalId, vetId, startsAt/endsAt, kind(recheck), status, reason, followUpConsultationId optional; layanan baru memiliki parentConsultationId |
| Reminder | animalId, consultationId/followUpId optional, ownerId, kind, dueAt, instructions, careStatus, deliveryStatus, completedAt |
| ProgressReport | consultationId/followUpId, farmerId, animalId, text, attachmentIds[], submittedAt, viewedAt |
| Message | consultationId, senderId, clientMessageId unik per sender/konsultasi, text optional, attachmentIds[], deliveryStatus(pending/sent/failed), deliveryAttempt, deliveryAttemptAt, immutable fingerprint, sentAt; API BE-07 menampilkan failed/pending hanya ke sender dan penerima membaca setelah sent |
| Attachment | ownerId, consultationId/accessContext, kind(image/video), MIME terdeteksi, filename, byteSize, content hash, private storageKey, uploadKey/fingerprint, uploadAttempt/failureCode, uploadStatus(pending/uploaded/failed/committed), committedAt; tidak ada file path publik |
| Product | nama, kategori, species[], description, unitPriceIdr integer positif, imageAttachmentId opsional, active/inactive; katalog fixture, bukan inventori dokter |
| Cart / CartItem | farmerId, productId, quantity positif; total sebagai kalkulasi, bukan otoritas harga |
| Quote | ownerId, context(cart/consultation), line snapshots, shippingAmount, totalAmount, expiresAt optional |
| Order / OrderItem | farmerId, status, addressSnapshot, totalSnapshot, paymentId; item productId/name/unitPrice/quantity snapshots |
| Shipment | orderId, status, trackingCode fiktif, events[{status,time,description}] |
| Payment / PaymentAttempt | ownerId, payableType/Id, method, amount, status, operationKey, serviceReference, attemptedAt; attempts terpisah dari kewajiban bayar |
| EarningTransaction | vetId, consultationId unik, paymentId, gross, commission, net, status(pending/available), earnedAt |
| LedgerEntry | vetId, earningId/withdrawalId, kind, amount, operationKey unik, occurredAt; append-only |
| PayoutDestination | vetId, bankLabel fiktif, accountMasked, accountHolder; data rekening nyata tidak dipakai tahap lokal |
| Withdrawal | vetId, destinationSnapshot, amount, feeSnapshot, netAmount, status, operationKey, submittedAt, serviceReference |
| Review | consultationId unik, farmerId, vetId, stars integer 1–5, text opsional, submittedAt |
| Notification | recipientId, type, contextId, eventId unik per penerima, title/body, readAt, deliveryStatus |
| Preferences | userId, notification categories, enabled; bantuan berupa konten aplikasi |

Relasi utama: Peternak → banyak Farm → banyak Livestock → Consultation ← Dokter. Setiap Farm memiliki satu owner Peternak dan satu Address kunjungan; `farmId` pada Livestock, BookingDraft, dan Consultation harus menunjuk Farm yang sama dengan relasi dan konteks record. Saat membuat Livestock, Peternak memilih Farm. Daftar, detail, dan edit Livestock membaca semua Farm milik akun; pilihan Farm aktif hanya konteks UI. Booking menyalin farmId serta alamat Farm dari animal terpilih dan memeriksa kecocokannya saat review/submit. Konsultasi Dokter tetap terbatas pada layanan assigned dan relasi owner Farm/animal yang valid. Consultation → ClinicalNote/Visit/Messages/Recommendation/FollowUp/Payment. Message → MessageAttachment → Attachment dengan FK composite pada consultation dan sender/owner. RecommendationItem → Product → Cart → Order → Payment/Shipment. Consultation → EarningTransaction → Ledger → Withdrawal.

Review FE-21 hanya dibuat oleh Peternak pemilik setelah Consultation `completed`; setiap Consultation memiliki paling banyak satu Review. Record immutable menyimpan integer stars 1–5, komentar opsional yang dinormalisasi maksimal 1.000 karakter, serta relasi ke Consultation, Peternak, dan Dokter. Retry dengan isi yang sama mengembalikan Review tersimpan; payload kedua yang berbeda ditolak. Agregat rating profil Dokter dihitung dari Review tersimpan yang masih cocok dengan owner/Dokter dan Consultation selesai.

## Penerapan penyimpanan FE-02

SQLite menggunakan schema version `4` pada `vetlink.db`. Migrasi v2 menambah unique index untuk email user yang dinormalisasi dan mengabaikan kapitalisasi/spasi tepi. Migrasi v3 bersifat aditif: memilih Farm dari relasi profil lama, melengkapi owner/address link, mengaitkan Address dan Livestock ke Farm, serta menambahkan farmId, contextId, dan relasi Farm pada Consultation dan booking draft lama berdasarkan data yang sudah ada. Migrasi v4 menegakkan satu record Preferences per akun melalui unique index parsial `owner_id` untuk entity berjenis `preferences`. Record domain lama tidak dihapus atau diganti. Baris `entities` menyimpan envelope (`id`, `kind`, owner/context IDs, payload JSON, timestamps, version, dan key deduplikasi); `entity_relations` menyimpan hubungan dengan foreign key; `domain_events` dan `event_effects` menyimpan hasil event atomik; `app_metadata` dan `schema_migrations` melacak versi. Repository bersama membatasi query lewat `kind`, `owner_id` dan relasi, menggunakan update dengan expected version, dan menolak edit catatan klinis yang sudah final.

Adapter FE-03 historis menyimpan verifier lokal di `expo-secure-store`; alur UI autentikasi itu tidak aktif sesuai DEC-23. BE-01 memakai auth internal PostgreSQL: password `scrypt` (salt 16 byte, derived key 64 byte, parameter N=16384/r=8/p=1), token opaque acak dengan SHA-256 hash, access 15 menit, dan refresh/session 30 hari absolut. Refresh token sebelumnya disimpan sebagai hash di riwayat replay. Logout mencabut satu sesi; reset sukses mencabut semua sesi. Fixture seed tidak memiliki credential login.

BE-01 tidak memilih provider email/OTP produksi. Reset request selalu menghasilkan 202 generik; adapter lokal yang aktif mengembalikan `failed`, tidak mengirim pesan atau membuka token. PasswordResetRequest baru dapat dikonfirmasi setelah adapter terpilih mengembalikan `succeeded`. Rate limit saat ini in-memory per proses dan harus diganti shared store sebelum runtime multi-instance.

FE-04 menambahkan `ProfileDraft` sebagai entity fleksibel pada envelope SQLite; tidak diperlukan tabel khusus. `ProfileService` memvalidasi form, sedangkan `SqliteProfileRepository` menyimpan user/profile/farm/alamat/submission melalui exclusive transaction dan optimistic version. Lampiran dimiliki user, menyimpan metadata serta URI lokal, dan file disalin ke direktori dokumen privat aplikasi; isi file tidak disimpan base64 atau dikirim jaringan. Picker membatasi dokumen verifikasi ke PDF/gambar. `uploadStatus=local` berarti hanya tersimpan pada perangkat.

Payload JSON memberi bentuk fleksibel bagi entitas yang belum memiliki layar/use case; validasi wajib tetap berada pada domain/use case. Kolom relasional inti, foreign key, constraint unik, dan `validateFixtureGraph` menjaga owner, konteks, jenis relasi serta idempotency. Seed penuh fiktif `fe02-v1` hanya ditulis jika database belum berisi entitas. FE-08 menambah ekstensi sekali dengan marker `fixture_directory_version=fe08-v1` untuk instalasi seed tersebut: menambah field yang belum ada pada lima record profil/availability fixture, dan satu Review atas konsultasi completed bila belum punya ulasan. Field yang sudah ada, termasuk array kosong, tidak diganti. Perubahan dan marker dikomit dalam satu transaksi; kegagalan rollback dan retry tidak menambah ulasan atau versi lagi. Database non-fixture tidak diperluas. Jumlah default menjadi 62 entitas/82 relasi; bukti lama 61/79 tetap merepresentasikan run FE-02–07.

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

Satu konsultasi memiliki satu catatan final pada baseline. Perubahan setelah final, bila kelak diperlukan, menjadi amendment terpisah dengan audit; jangan membuka ulang snapshot final. Catatan Peternak terpisah dari ClinicalNote dokter. HealthEvent yang berasal dari note final ditautkan dengan `clinicalNoteId`/relasi note sebagai proyeksi yang dapat dideduplikasi, bukan salinan klinis yang dapat berbeda. FE-14 menyimpan note dan proyeksi ini pada satu SQLite transaction; dokter/Peternak membaca ClinicalNote yang sama dengan akses berdasarkan assignment/ownership.

## Jadwal dan tindak lanjut

Waktu mulai < waktu selesai; slot harus berada dalam jam layanan, tidak overlap janji atau blocked time. End eksklusif memungkinkan slot berikut mulai tepat saat sebelumnya selesai. Perubahan jam/available tidak membatalkan janji yang sudah diterima. Proposal jadwal tidak mengganti jadwal aktif sebelum disetujui; ulangi cek konflik ketika persetujuan disimpan.

FE-08 memproyeksikan slot baca untuk 7 tanggal lokal mulai hari ini. `weekday=0` berarti Minggu dan `6` Sabtu; start/end memakai HH:mm pada `Availability.timezone`. Durasi integer 5–240 menit dipakai untuk menghasilkan slot di dalam interval, tanpa menulis Slot baru. Dokter harus verified, accepting, menawarkan layanan tersebut pada profil/availability, dan punya tarif aktif. Slot yang lewat atau overlap dengan konsultasi `awaiting_payment/requested/scheduled/in_progress`, BlockedTime aktif, atau FollowUp `scheduled` disisihkan. Aturan kosong/invalid menghasilkan empty state. FE-11 menyediakan editor availability dan kalender, serta FE-09 memvalidasi ulang slot dalam transaksi sebelum booking. Tampilan slot tidak mereservasi jadwal dan belum menentukan kebijakan expiry hold produksi.

FE-11 menyimpan waktu blok sebagai UTC setelah mengurai input `YYYY-MM-DD HH:mm` menurut zona waktu dokter. Jam kerja menggunakan weekday dan HH:mm lokal; interval harus valid, tidak overlap pada hari yang sama, dan jam mulai sebelum selesai. Blok baru/perubahan blok harus berada di masa depan, beralasan, tidak overlap blok lain, serta tidak berbenturan dengan booking, janji, atau FollowUp terjadwal. Pembatalan blok mengubah status menjadi `cancelled` agar jejak tetap ada; slot hanya mengabaikan blok yang masih aktif. Mengubah tarif membuat snapshot ServiceRate baru dengan waktu efektif dan versi konfigurasi, sehingga quote/layanan lama mempertahankan tarifnya. Mengubah penerimaan, jam, atau tarif tidak menghapus appointment yang telah diterima.

`AvailabilityDraft` menyimpan input parsial dan token yang merujuk versi availability, profil/verifikasi, tarif, serta blok. Simpan draft dan pengaturan final memakai transaksi repository bersama; stale token ditolak, dan save tanpa perubahan tidak menulis record konfigurasi/rate/block baru. Draft diterapkan atau ditandai discarded setelah aksi berhasil. Kalender harian/mingguan membaca appointment scoped, tindak lanjut yang terkait, dan blok aktif dari repository; hold `awaiting_payment` tidak dirinci kepada Dokter. Ini entitas pada envelope lokal schema 3, bukan tabel/layanan atau backend baru.

FollowUp.status: `scheduled/completed/cancelled` untuk pemeriksaan ulang. Reminder.careStatus: `scheduled/done`; deliveryStatus: `pending/sent/failed`. ProgressReport memiliki submittedAt/viewedAt. Pengingat terkirim tidak berarti vaksin/obat sudah dilakukan; laporan dibaca tidak berarti layanan selesai.

Perawatan done dapat membuat HealthEvent satu kali dengan unique reminder reference. FollowUp yang menimbulkan layanan baru harus memakai Consultation baru dengan parent link ke konsultasi asal, bukan menimpa layanan completed.

## Finansial dan pesanan

Payment.status: `pending/succeeded/failed/expired`; status berbayar berdasarkan hasil adapter. Percobaan retry mempunyai PaymentAttempt baru; operationKey yang sama harus mengembalikan hasil yang sama. Consultation dan Order memiliki payable ID berbeda.

BE-06 backend menurunkan quote konsultasi dari `consultations.fee_snapshot_idr` dan membatasi baca/buat ke farmer pemilik. `POST /payments` mengabaikan amount dari client, merekam Payment dan PaymentAttempt sebelum adapter; adapter lokal hanya menghasilkan `pending`. Order belum tersedia hingga BE-11 dan payable order fail-closed. `payment_callback_events.event_id` unik; callback internal memvalidasi payment/attempt, referensi dan amount integer sebelum menerima outcome, serta tidak mengganti hasil final atau menduplikasi event. Tidak ada refund otomatis.

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

FE-06 memakai entitas `Livestock` dan `Attachment` yang sama. `LivestockService` memeriksa owner dan relasi farmer/farm sebelum membaca atau mengubah ternak; `displayCode` dinormalisasi huruf besar dan unik per farm. Nama, species yang tercatat pada profil farm, ras, sex, estimasi umur bulan (0–1200), dan berat positif divalidasi sebelum commit. `selectLivestock` menggabungkan pencarian kode/nama/species/ras dengan filter species dan sex. Foto disalin ke direktori privat aplikasi; attachment `accessContext=livestock` dan relasi `photo` dikomit atomik bersama ternak. UI `LivestockFlow` memakai service untuk daftar, filter species/sex, detail berdasarkan ID, tambah/edit, dan pemilihan foto. Service awal menyimpan `estimatedAgeMonths`; dukungan tanggal lahir menunggu inspeksi field Figma. QA interaksi layar dan pixel-match masih tertunda; rincian keterbatasan Figma ada di [Figma mapping](FIGMA_MAPPING.md).

## Realisasi FE-26: banyak Farm

`FarmService` menyediakan list/detail/create/update/select Farm pada repository SQLite yang sama. `FarmerProfile.farmId` menyimpan pilihan konteks aktif; setiap Farm tetap dimiliki langsung oleh user dan memiliki relasi `owner`, alamat ber-konteks farm, serta relasi `visitAddress`. Menyimpan atau memilih Farm lain tidak memindahkan ternak lama. `LivestockService.list` menelusuri seluruh Farm milik user, detail/edit mengambil Farm dari livestockId yang diminta, dan pembuatan ternak mewajibkan farmId terpilih secara eksplisit. Kode ternak unik di dalam satu Farm, sehingga kode yang sama boleh dipakai di Farm milik akun yang sama.

Review booking memeriksa bahwa animal dan farmId cocok, keduanya dimiliki Peternak, dan alamat visit sama dengan alamat kunjungan Farm terkait. Consultation menyimpan farmId, address snapshot, serta relasi `farm`; akses Farmer/Dokter ke consultation juga memeriksa relasi Farm dan animal. Dokter hanya membaca pasien yang terkait dengan layanan assigned dan tidak memperoleh hak melalui pilihan peran.

Migrasi SQLite v3 tidak menghapus entity atau relasi lama. Migrasi mengambil Farm aktif dari relasi `FarmerProfile`, lalu mengisi owner/address/farm link, konteks Farm untuk livestock, dan farmId pada consultation/draft yang dapat diturunkan dari animal lama. Tes SQLite in-memory membandingkan record lama dan hasil backfill; peninjauan Android visual/interaksi tetap menjadi gate penerimaan.

FE-07 memakai `animalId` dari detail ternak/pasien untuk membaca riwayat. `FarmerHealthFlow` menampilkan pemeriksaan, penyakit, vaksin, obat, dan perawatan dari `HealthRecordService`; hanya catatan klinis final yang tampak. Laporan yang ditulis Peternak menjadi `HealthEvent` dengan `sourceKey`/`operationKey` stabil agar retry tidak menggandakan catatan dan tidak mengubah `ClinicalNote` Dokter. Viewer lampiran kedua peran memeriksa lagi scope owner/assignment sebelum membuka URI. Mode frontend saat ini memilih persona fixture lokal tanpa autentikasi; pembatasan service tetap berlaku pada ID persona tersebut, tetapi mode ini tidak memberikan kontrol akses produksi.


## Penerapan booking FE-09

`bookingDraft` memakai envelope SQLite schema 3; tidak ada reset seed atau migrasi tabel baru. Draft parsial dimiliki Peternak dan terkait dokter; input menyimpan farmId yang mengikuti animal terpilih, sedangkan alamat kunjungan harus sama dengan alamat Farm tersebut. Save memakai expected version. Simpan draft, impor lampiran, atau Tinjau biaya menyimpan input. Menutup aplikasi sebelum menyimpan perubahan teks tidak menjamin input sementara bertahan. Buang draft menandai discarded dan membersihkan file terkait; draft submitted tidak dapat diedit/dibuang.

Review biaya adalah hasil baca tervalidasi dengan draftId/version, input ternormalisasi dan total integer rupiah. Submit memeriksa ulang kondisi terkini serta kecocokan versi/input/tarif pada satu exclusive transaction, kemudian membuat Consultation `awaiting_payment`, Quote, relasi farmer/veterinarian/animal/farm/attachment, dan menandai draft submitted. Consultation menyimpan `farmId`, `contextId=farmId`, dan snapshot alamat kunjungan dari Farm animal. Quote menyimpan satu baris tarif layanan serta total; shippingAmount=0 karena bukan pengiriman produk. Komisi snapshot 10% mengikuti fixture fiktif DEC-13, bukan kebijakan produksi. `paymentId=null`; tidak membuat Payment, Visit, Message, ledger atau event pembayaran. Retry draft yang sama mengembalikan consultationId yang tersimpan. Slot awaiting_payment diperlakukan terisi sampai waktu berlalu/status berubah; masa hold/expiry produksi masih DEC-17 yang terbuka.

Attachment image/video dipilih pengguna, disalin privat ke document storage dan metadata dimiliki akun dengan contextId draft. Submit hanya menerima lampiran dari draft itu. MIME/kind diperiksa; belum menetapkan batas ukuran/jumlah media bisnis. Kegagalan transaksi impor membersihkan file baru dan rollback metadata. Penghapusan file bersifat best effort dengan kanal diagnostik; tidak ada upload/backend jaringan atau ACL produksi.

## Realisasi lokal FE-10

`ConsultationService` memakai transaction unit dan antrean SQLite yang sama dengan booking. Akses berdasarkan owner/penugasan dan relasi akun/ternak; Dokter tidak melihat awaiting_payment. Semua tindakan memeriksa versi konsultasi dan operationKey, menyimpan status bersama audit append-only. Terima butuh pembayaran succeeded dengan payable/owner/amount cocok, dokter verified, waktu future sesuai aturan dan tidak konflik; Visit dibuat scheduled sekali. Tidak ada tindakan menyelesaikan/chat/visit-stage dalam FE-10.

Propose menyimpan previousStatus dan waktu baru pada ScheduleProposal tanpa mengganti waktu layanan. Konsultasi menjadi reschedule_pending dan waktu lama masih direservasi. Approve Peternak memeriksa ulang konflik/verifikasi/pembayaran, lalu mengganti waktu dan menjadi scheduled; decline mengembalikan requested/scheduled. Fixture FE-02 yang punya proposal pending pada scheduled ditangani sebagai previousStatus scheduled, tanpa menulis ulang pada bootstrap. Cancel sebelum visit dimulai menyupersede proposal. Reject/cancel berbayar menandai refundStatus=refund_needed; Payment succeeded dan ledger tetap utuh. Kebijakan refund produksi belum dipilih.

Ekstensi fiktif `fixture_consultations_version=fe10-v1` menambahkan request kunjungan Budi→Yuda/Mawar 7 Oktober 2026 11:00–12:00 Asia/Jakarta dan payment succeeded Rp150.000 sekali, agar frontend persona Dokter mempunyai request. Base fixture tetap terpisah; keputusan yang disimpan tidak di-reset saat bootstrap. Booking baru FE-09 tetap awaiting_payment sampai FE-19 dibuat. Database fleksibel schema 3 dipakai kembali; tidak ada migrasi destruktif atau otoritas data baru.

## Realisasi chat FE-12

`ChatService` membatasi percakapan ke consultation bertipe chat dengan relasi farmer/veterinarian/animal valid dan Payment succeeded yang payable/owner/amount cocok. Status accepted/scheduled/in_progress membuka penulisan; terminal dibaca saja. Akses selalu diperiksa ulang lewat owner/assignment dan ID konteks; retry hanya untuk pesan pemiliknya. Lampiran `Attachment` terkait ke `Message`, memiliki `contextId=messageId`, `accessContext=consultation`, `uploadStatus=local`, dan URI dalam document storage privat. UI hanya menerima image/video, teks maksimal 4.000 karakter dan lima lampiran per pesan.

Pada adapter mobile lokal FE-12, Message menyimpan `clientMessageId` dan fingerprint input untuk dedupe di SQLite, dan retry memperbarui record pesan lama. Adapter BE-07 terpisah memakai PostgreSQL: `clientMessageId` unik per sender/konsultasi, status `pending/sent/failed`, attempt tersimpan, dan penerima membaca via polling setelah `sent`. Media lokal FE-12 tetap berada di perangkat mobile; backend BE-07 menyediakan unggah/download privat dengan `storageKey` lokal server. Mobile belum diintegrasikan dengan API, dan backend belum menyediakan realtime.

Marker `fixture_chat_version=fe12-v1` menambahkan konsultasi chat fiktif Budi→Yuda/Mawar, payment lokal succeeded, dan pesan awal agar flow dapat dijangkau oleh persona aktif kedua peran. Ekstensi berjalan satu kali di instalasi seed FE-02, transaction rollback bila ada kegagalan, tidak mengganti isi atau status record lain, dan tidak me-reset keputusan fixture.

## Realisasi kunjungan FE-13

`ConsultationService.advanceVisit` menerima tindakan Dokter berurutan `depart`, `arrive`, `start_examination` yang memetakan Visit dari `scheduled → en_route → arrived → examining`. Setiap perintah memeriksa role/assignment, profil dokter `verified`, pembayaran succeeded dengan payable/owner/amount cocok, `visitAddressSnapshot` tersedia, Consultation/Visit version terkini dan status pasangan yang konsisten. Update Visit, timestamp `departureAt/arrivalAt/examinationStartedAt`, Consultation (`scheduled → in_progress` saat berangkat), dan ConsultationAction audit berlangsung dalam satu transaksi SQLite. `operationKey`/fingerprint mencegah retry ganda atau pemakaian ulang untuk tindakan berbeda.

Frontend membaca alamat dari snapshot kunjungan. Aksi opsional `geo:` meneruskan string alamat ke aplikasi peta perangkat setelah pengguna memilih tombol; VetLink tidak membaca GPS atau menyimpan lokasi perjalanan. Peternak melihat tahap/timestamp read-only dari entity Visit yang sama. FE-14 menyediakan catatan final serta konfirmasi terpisah untuk melanjutkan Visit dari `examining` ke `completed`; finalisasi catatan sendiri tetap membiarkan Consultation `in_progress`. Tidak ada sinkronisasi backend/lintas perangkat.

## Realisasi backend BE-04

Backend memakai `vet_directory_profiles`, `vet_availabilities`, `vet_service_rates`, dan `vet_blocked_times`. Tarif adalah bigint integer IDR dengan record efektif-dated; konfigurasi availability memakai version dan transaksi/advisory lock per dokter. Timezone diverifikasi sebagai IANA, weekday 0=Minggu dan jam aturan dibaca sebagai waktu lokal dokter. Slot bukan record/reservasi; query menghasilkan `[starts_at, ends_at)` dari durasi/availability dan menyingkirkan konsultasi aktif serta blokir aktif. Blokir overlap ditolak terhadap blokir aktif dan consultation aktif menggunakan syarat `existing.start < new.end AND existing.end > new.start`; appointment accepted tetap dipertahankan ketika availability berubah. Profil verified saja yang tampil; availability/tarif bukan data yang dipercaya dari request booking.

## Realisasi backend BE-05

`consultation_quotes` menyimpan quote owner-scoped yang dihitung server dari tarif dan durasi terbaru, slot dokter, keluhan, ternak, serta snapshot alamat untuk Visit. `Idempotency-Key`/fingerprint membedakan replay dari payload berbeda. Quote adalah preview non-reservasi tanpa expiry yang belum dipilih. `POST /consultations` mengunci quote dan advisory lock dokter yang sama dengan BE-04, memeriksa ulang schedule/rate/slot/blocked-time/proposal, lalu membuat Consultation `awaiting_payment` dan mengonsumsi quote secara atomik. Status `awaiting_payment` menahan slot sampai status layanan berubah.

BE-06 tetap menjadi otoritas hasil pembayaran. Setelah payment callback internal atau hasil adapter `succeeded` tersimpan, payment service memanggil port BE-05 dalam transaksi yang sama. Owner, payable, jumlah rupiah, dan status konsultasi dicocokkan; status berubah `awaiting_payment → requested`. Pending/failed tidak mengubah Consultation. Accept menuntut Dokter assigned dan verified, Payment succeeded sesuai snapshot, versi terbaru, jadwal valid, dan tidak ada interval overlap. Advisory lock per Dokter menserialisasi create/accept/proposal response; slot menggunakan `[start,end)` dan konflik dicek terhadap appointment, proposal pending, serta blocked time.

Penolakan menyimpan alasan dan `refund_status=refund_needed` ketika payment sudah succeeded; ini tidak berarti refund telah dikirim. Proposal menyimpan waktu baru terpisah dan mempertahankan jadwal lama sampai Peternak memberikan consent; saat accept, server mengulang pemeriksaan status proposal, version, consent, verifikasi, pembayaran, schedule dan konflik dalam transaksi. Proposal pending turut menahan interval barunya dan dikecualikan dari hasil slot BE-04.

Visit dibuat sekali saat accept dan hanya dapat bergerak `scheduled → en_route → arrived → examining → completed`. `en_route` dan `arrived` menjaga Consultation tetap `scheduled`; pemeriksaan mengubahnya menjadi `in_progress`. Complete memerlukan pembayaran cocok, Dokter assigned/verified, Consultation `in_progress`, catatan klinis final dan `confirmation=true`; Visit harus `examining`. Consultation, Visit, completion time, action append-only dan guard idempotensi disimpan dalam satu transaksi. Finalisasi catatan membuat satu proyeksi HealthEvent unik yang tampil pada timeline; completion mengisi proyeksi yang mungkin belum ada untuk catatan final lama.

Action adapter PostgreSQL menulis event/audit lokal dalam transaksi dan mengembalikan `AdapterResult`; `failed`/`pending` menjadi service unavailable dan membatalkan mutasi. Belum ada delivery notifikasi. DEC-13 belum menetapkan komisi komersial, sehingga quote BE-05 lokal menyimpan commission `0` integer rupiah. Pembatalan, expiry/hold policy, attachment upload sebelum request, earning/ledger BE-15, refund aktual, dan provider produksi belum diaktifkan.

## Realisasi backend BE-10: katalog dan rekomendasi

`products` menyimpan nama, kategori, spesies yang didukung, deskripsi, harga rupiah integer, referensi gambar nullable, serta flag active. Harga dibatasi pada integer yang dapat direpresentasikan aman sebagai number JSON. Route baca `/products` dan `/products/{id}` tersedia untuk Peternak dan Dokter melalui session/role guard; daftar menggabungkan pencarian nama, kategori, spesies, dan rentang harga, hanya mengembalikan produk aktif, serta memakai cursor stabil `lower(name), id`. Produk tidak dikenal maupun nonaktif disembunyikan dengan 404 pada detail. Tidak ada stok, katalog dokter, atau route tulis/admin publik.

Seed menambahkan tiga produk fiktif (dua aktif, satu nonaktif) secara idempotent dan non-destruktif. RecommendationItem tertaut harus mengacu ke Product aktif yang dikunci `FOR SHARE` dalam transaksi edit rekomendasi yang sama; judul snapshot tertaut berasal dari nama produk di backend. Trigger rekomendasi terkirim tetap mencegah perubahan snapshot walaupun Product kemudian dinonaktifkan atau harganya berubah. Relasi FK ditambahkan `NOT VALID` untuk mempertahankan ID produk lama pada draft BE-08, tetapi constraint berlaku untuk tautan baru.
