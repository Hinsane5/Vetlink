# Arsitektur VetLink

Status: scaffold FE-00, komponen UI FE-01, fondasi lokal FE-02, autentikasi FE-03, profil FE-04, dan dashboard FE-05 tersedia di `apps/mobile`. FE-03/04/05 masih menunggu QA perangkat penuh; inspeksi visual terbaru tertahan kuota MCP Figma. Mobile React Native + Expo + TypeScript dipilih; Android dan data lokal terlebih dahulu. Backend di bawah adalah rancangan netral framework, dengan NestJS/PostgreSQL sebagai kandidat, belum keputusan.

## Boundary aplikasi

Satu aplikasi memiliki shell Peternak dan Dokter. Root menangani bootstrap database, session, role guard dan providers. Tiap shell memiliki stack/tab sendiri; context layanan disimpan sebagai `consultationId` dan pasien sebagai `animalId`. Komponen bersama menggunakan tokens yang sama dengan variasi ukuran/tampilan per Figma.

Aliran dependensi:

```text
Screen / reusable UI
        ↓
Controller / hook (input, loading, error, dialog)
        ↓
Application use case (otorisasi, transaksi, aksi pengguna)
        ↓
Domain model + aturan status
        ↓
Repository interfaces + service ports
        ↓
SQLite repositories + local service adapters [tahap pertama]
API repositories + backend/provider adapters [tahap berikutnya]
```

UI tidak mengetahui tabel SQL, transport HTTP, komisi hardcoded atau fixture outcome. Domain tidak mengimport React Native/Expo. Binding React adalah satu arah: aksi → hasil use case → refresh/invalidate proyeksi data → UI.

## Modul dan tanggung jawab

| Modul | Isi | Port utama |
| --- | --- | --- |
| Identity | Session, profil, peran, verifikasi | AuthService, ProfileRepository, VerificationService |
| Farm & livestock | Peternakan, alamat, ternak, kesehatan | LivestockRepository, HealthRepository |
| Discovery & availability | Dokter, tarif, jadwal kerja, slot/blok | VetRepository, AvailabilityRepository |
| Consultations | Request, usulan jadwal, appointment, kunjungan, completion | ConsultationRepository, BookingPolicy |
| Clinical | Draft/final note, rekomendasi, hasil | ClinicalRepository |
| Follow-up | Pemeriksaan ulang, reminder, laporan | FollowUpRepository, ReminderDeliveryService |
| Messaging & media | Message, attachment, viewer | MessageRepository, ChatDeliveryService, MediaService |
| Commerce | Produk, cart, quote, order, shipment | CatalogRepository, CartRepository, OrderRepository, ShippingService |
| Payments & earnings | Payment attempt, ledger, withdrawal | PaymentService, PaymentRepository, LedgerRepository, PayoutService |
| Notifications | Event inbox, preferensi | NotificationRepository, NotificationDeliveryService |

## Struktur yang diusulkan

Struktur ini rencana, bukan folder source yang sudah tersedia:

```text
apps/mobile/
  app/                     # routing tipis dan shell per peran
  src/
    ui/                    # tokens, komponen, icon, layout
    features/<feature>/    # screens, controllers/hooks
    application/           # use cases dan port transaksi
    domain/                # model, policies, state transitions
    data/local/            # SQLite, migrations, seed, repositories
    data/api/              # adapter API saat backend tersedia
    services/local/        # simulasi dan fixture outcomes
    services/api/          # auth/media/realtime/provider client
    testing/               # fixtures dan factories khusus tes
apps/api/                  # dibuat setelah stack backend disepakati
packages/contracts/        # kontrak API bila monorepo dipilih
docs/
```

Monorepo ini usulan; backend tidak perlu dibuat pada FE-00. Domain mobile/backend harus tunduk pada contract tests yang sama; sharing implementasi TypeScript opsional jika backend akhirnya TypeScript. Jangan menaruh secret/provider logic backend ke bundle mobile.

## Satu sumber data lokal

Database SQLite menjadi sumber persisten; [Data model](DATA_MODEL.md) mendefinisikan entitas. Satu instance repository container di-root-kan menurut environment dan session. Data akun berbeda tetap diberi owner ID, bukan database terpisah yang membuat interaksi Peternak/Dokter kehilangan hubungan.

Seed hanya saat database kosong, dengan versi fixture, tidak menimpa data setiap startup. Migration mempunyai schema version. Media disalin ke lokasi aplikasi yang persisten; database menyimpan metadata/URI, bukan base64 video. Session material kecil menggunakan storage yang sesuai, terpisah dari data domain.

Implementasi FE-02 membuka `vetlink.db` melalui `expo-sqlite`. Envelope lokal menyimpan `id`, `kind`, `owner_id`, `context_id`, JSON payload, timestamp, version, dan idempotency/event keys; `entity_relations` menyimpan link ber-foreign-key antarentitas. Port repository menyediakan query pemilik/relasi serta update optimistic-version di dalam exclusive transaction. Tabel metadata menyimpan `PRAGMA user_version` dan marker seed `fe02-v1`; database nonkosong tidak di-seed ulang. Field payload yang akan menerima aturan transaksi tetap divalidasi domain/use case, bukan oleh komponen UI.

FE-03 menambahkan `AuthRepository` serta `LocalAuthService` di lapisan application. Pendaftaran membuat `User` dan profil role-specific secara atomik; SQLite migration v2 menegakkan uniqueness email yang dinormalisasi. `expo-secure-store` memisahkan verifier lokal dan session ID dari data domain, sementara pemeriksaan membership/profile berada di service. Reset lokal hanya mengganti verifier yang telah dibuat pada perangkat ini; tidak ada email atau verifikasi identitas. Adapter ini adalah simulator pengembangan satu perangkat, bukan identitas produksi.

FE-04 menambahkan `ProfileService` dan port `ProfileRepository`. Layar tidak mengakses SQLite; adapter `SqliteProfileRepository` memuat owner/profile/farm/alamat/lampiran dan melakukan batch create/update dengan optimistic version dalam satu exclusive transaction. Adapter media memilih foto/dokumen melalui Expo dan menyalin berkas ke direktori privat aplikasi; belum ada upload/sinkronisasi. Dokter hanya dapat mengajukan dokumen sehingga submission menjadi `pending`; tidak ada use case/aksi produk untuk menetapkan `verified` atau `revision_required`. Guard FE-02 `assertCanAcceptConsultation` tetap mewajibkan status verified.

FE-05 menambahkan `DashboardService` yang menyusun snapshot peran dari `DomainRepository` dan `ProfileService`. Selector domain menghitung ternak/konsultasi/reminder, agenda/request dan saldo dari entitas yang sama; halaman detail memuat ulang menggunakan ID serta memeriksa owner/assignment. Availability disimpan melalui repository dengan optimistic version, membutuhkan status verified untuk menerima layanan baru, dan tidak mengubah konsultasi yang telah diterima.

Selector dashboard, jadwal, riwayat, pasien dan saldo membaca entitas yang sama. Setelah transaksi domain commit, modul penerima event memperbarui inbox/health projection secara konsisten, lalu query yang terpengaruh di-refresh. Event lokal mempunyai ID unik agar restart/retry tidak menggandakan notification atau health record.

Port event menyimpan event, effect, notification, dan health projection dalam satu SQLite transaction. Constraint unik melindungi `(recipient_id, event_id)` untuk notification, `source_key` untuk health event, dan `(event_id, effect_key)` untuk effect. Tes perangkat FE-02 menjalankan retry event yang sama lalu memeriksa satu proyeksi per jenis sebelum membersihkan record probe development.

Simulasi chat dua peran beroperasi pada instalasi yang sama. Tidak ada janji sinkronisasi antar perangkat atau realtime produksi. Jika backend diperkenalkan, API menjadi otoritas write untuk modul yang dipindahkan; cache lokal tidak boleh mengubah status finansial atau final note secara independen.

## Use case yang memerlukan transaksi

| Aksi | Pemeriksaan | Perubahan atomik |
| --- | --- | --- |
| AcceptRequest | Session dokter, verified, request aktif, payment sesuai kebijakan, slot tidak konflik | Consultation scheduled, slot committed, event/notification |
| AcceptReschedule | Pemilik, proposal pending, slot valid, version sama | Jadwal baru + proposal accepted; jadwal lama dilepas setelah sukses |
| FinalizeClinicalNote | Dokter terkait, draft version sama, wajib lengkap | Final snapshot immutable + health event; layanan tetap berlangsung |
| CompleteConsultation | Dokter terkait, note final, in_progress, explicit confirmation | Completed timestamp + event; earning dicatat satu kali bila payment settled |
| ConfirmOrder | Peternak, cart valid, quote/address valid | Order dan item snapshot; cart berubah hanya setelah commit |
| SubmitWithdrawal | Pemilik saldo, amount >0, available cukup, tujuan valid | Withdrawal submitted + ledger reservation + event |

Local SQLite transaction menggantikan backend transaction pada milestone lokal. Operation key dan unique constraints melindungi ketuk ganda. Endpoint server pada fase berikutnya harus mengulang validasi ini; client tidak dapat menjadi otoritas keamanan produksi.

## Simulasi dengan hasil layanan

Service port mengembalikan `operationId`, hasil/status, waktu, dan error bila gagal. Use case menyimpan hasil tersebut sebelum UI menampilkan sukses. Pending berbeda dari succeeded; `submitted` berbeda dari paid/received. Fixture failure/latency/duplicate outcome diinjeksikan hanya pada development/test composition root.

Pengiriman notifikasi atau reminder dicatat sebagai `sent` hanya bila adapter delivery memberi hasil berhasil. Ini adalah keberhasilan adapter lokal, bukan konfirmasi push/email/provider produksi. Tidak ada tombol pengujian dalam layar produk.

## Backend berikutnya

Usulan bentuk: modular monolith, REST JSON `/v1`, relational database, object storage untuk media, event/outbox untuk efek samping, serta adapter provider. Backend menyimpan otorisasi, konflik jadwal, immutable note dan ledger. Provider callbacks hanya diterima setelah verifikasi signature dan deduplikasi; schema event dan status ditentukan pada kontrak integrasi.

WebSocket/realtime dapat ditambahkan untuk chat setelah basic message API/persistence berhasil. Retry tetap memakai client message ID. Queue/worker dipilih saat delivery/push/provider nyata diperlukan, bukan dipasang hanya untuk milestone lokal.

## Keamanan dan pengelolaan data

Mode lokal menggunakan data fiktif; tidak boleh dipresentasikan sebagai autentikasi produksi. Jangan simpan password plaintext atau log isi clinical note/dokumen profesi. Auth produksi, password reset, token refresh/revocation dan verifikasi reviewer dilakukan server-side.

Media privat hanya dapat dilihat pihak terkait; backend nanti memakai URL akses terbatas. Dokter tidak dapat memperluas patient access dengan mengganti route ID. Audit actor/time/from/to untuk finalisasi, perubahan jadwal, completion dan pencairan. Kebijakan retensi/export/delete produksi masih terbuka; jangan menghapus final note sebagai bagian dari logout.

## Migrasi ke API

1. Finalkan stack backend dan kontrak; implementasikan server tests otorisasi/status.
2. Jalankan repository contract tests untuk adapter lokal dan API.
3. Ganti adapter per modul dengan ownership write eksplisit; jangan fallback dari payment API gagal menjadi payment lokal berhasil.
4. Seed data uji backend yang konsisten; data lokal fiktif tidak otomatis diimpor ke akun produksi.
5. Uji flow dua perangkat, network failure dan retry sebelum mengklaim integrasi lintas perangkat.

Sync offline dengan merge queue/conflict resolution perlu rancangan tambahan jika diminta; tidak termasuk baseline Android lokal ini.
