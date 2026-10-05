# Arsitektur VetLink

Status: tahap aktif adalah frontend Android tanpa layar autentikasi dan tanpa backend jaringan. `FrontendFlow` memilih persona fixture lokal berdasarkan peran; `DashboardFlow`, `LivestockFlow`, `FarmerHealthFlow`, `PatientFlow`, dan `VetDirectoryFlow` menampilkan flow FE-05–08. Data tetap berasal dari SQLite lokal melalui service dan repository. FE-03 tetap ada sebagai implementasi historis, tetapi tidak dipasang pada root aplikasi. QA interaksi di Xiaomi tertunda karena input MIUI ditolak; acuan Peternak FE-06/07/08 terhalang izin file utama atau batas Figma Starter. Backend di bawah adalah rancangan netral framework, belum keputusan implementasi.

## Boundary aplikasi

Satu aplikasi memiliki shell Peternak dan Dokter. Root menangani bootstrap database dan provider. `FrontendPreviewService` memilih Budi atau Yuda dari fixture untuk membuat konteks peran sementara tanpa credential/sesi autentikasi; service domain tetap membatasi data menurut ID pemilik atau assignment. Tiap shell memiliki stack/tab sendiri; context layanan disimpan sebagai `consultationId` dan pasien sebagai `animalId`. Komponen bersama menggunakan tokens yang sama dengan variasi ukuran/tampilan per Figma.

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

FE-03 pernah menambahkan `AuthRepository` serta `LocalAuthService` di lapisan application. Kode dan tes historisnya masih ada, tetapi `App.tsx` sekarang memasang `FrontendFlow`; tidak ada masuk, daftar, reset, atau keluar pada UI aktif. Mode ini hanya untuk penelusuran frontend dengan persona lokal dan tidak mewakili sistem izin produksi.

FE-04 menambahkan `ProfileService` dan port `ProfileRepository`. Layar tidak mengakses SQLite; adapter `SqliteProfileRepository` memuat owner/profile/farm/alamat/lampiran dan melakukan batch create/update dengan optimistic version dalam satu exclusive transaction. Adapter media memilih foto/dokumen melalui Expo dan menyalin berkas ke direktori privat aplikasi; belum ada upload/sinkronisasi. Dokter hanya dapat mengajukan dokumen sehingga submission menjadi `pending`; tidak ada use case/aksi produk untuk menetapkan `verified` atau `revision_required`. Guard FE-02 `assertCanAcceptConsultation` tetap mewajibkan status verified.

FE-05 menambahkan `DashboardService` yang menyusun snapshot peran dari `DomainRepository` dan `ProfileService`. Selector domain menghitung ternak/konsultasi/reminder, agenda/request dan saldo dari entitas yang sama; halaman detail memuat ulang menggunakan ID serta memeriksa owner/assignment. Availability disimpan melalui repository dengan optimistic version, membutuhkan status verified untuk menerima layanan baru, dan tidak mengubah konsultasi yang telah diterima.

FE-06 menambahkan `LivestockFlow` sebagai layar Peternak untuk daftar, pencarian, filter species/sex, detail berbasis ID, tambah/edit, dan pemilihan foto. Layar memanggil `LivestockService`/`ProfileService`; ia tidak mengakses SQLite langsung. Tab Ternak membuka daftar, sementara aksi tambah pada dashboard membuka form. `LivestockService` membatasi owner/farm, memvalidasi input, dan mengikat attachment privat hanya setelah commit berhasil. Detail ternak membuka `FarmerHealthFlow` dengan `animalId` yang sama.

FE-07 menambahkan `HealthRecordService` serta `PatientService`. Riwayat Peternak memuat laporan owner dan catatan klinis final berdasarkan `animalId`; draft klinis tidak dipublikasikan dan laporan owner dibuat sebagai event terpisah yang idempotent. `FarmerHealthFlow` menampilkan filter kategori, detail final hanya baca, viewer lampiran, dan form laporan Peternak yang disimpan dengan operation key. Daftar pasien Dokter hanya dibentuk dari konsultasi yang relasi farmer/vet/animal-nya tervalidasi; lookup detail memakai scope yang sama. `PatientFlow` menyediakan pencarian, filter species, detail pasien, filter riwayat, dan catatan final hanya baca. Viewer kedua peran memeriksa ulang izin sebelum membuka URI. Pengujian interaksi layar pada HP masih tertunda setelah MIUI menolak `adb shell input tap` dengan `INJECT_EVENTS`.

Selector dashboard, jadwal, riwayat, pasien dan saldo membaca entitas yang sama. Setelah transaksi domain commit, modul penerima event memperbarui inbox/health projection secara konsisten, lalu query yang terpengaruh di-refresh. Event lokal mempunyai ID unik agar restart/retry tidak menggandakan notification atau health record.

Port event menyimpan event, effect, notification, dan health projection dalam satu SQLite transaction. Constraint unik melindungi `(recipient_id, event_id)` untuk notification, `source_key` untuk health event, dan `(event_id, effect_key)` untuk effect. Tes perangkat FE-02 menjalankan retry event yang sama lalu memeriksa satu proyeksi per jenis sebelum membersihkan record probe development.

FE-12 `ChatService` membaca/menulis Message dan Attachment lewat repository bersama dalam transaction queue SQLite. Kedua persona melihat percakapan dari data yang sama pada satu instalasi; participant, payment/status, pemilik file, relasi attachment, MIME dan URI diperiksa di service. Adapter lokal mengembalikan delivery `sent` tanpa jaringan; pending/failed dapat diuji dan retry memperbarui pesan yang sama memakai `clientMessageId`. Tidak ada realtime/sinkronisasi antar perangkat atau playback video. Jika backend diperkenalkan, adapter API menjadi otoritas write untuk modul yang dipindahkan; cache lokal tidak boleh mengubah status finansial atau final note secara independen.

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

## Implementasi direktori FE-08

`VetDirectoryFlow` memanggil `VetDirectoryService`, bukan SQLite langsung. Service menyusun profil publik dokter aktif, tarif terakhir yang sudah efektif, availability verified, dan ulasan yang berelasi dengan konsultasi selesai. Filter murni dan proyeksi slot berada pada `domain/directory.ts`; detail menyimpan `vetId` pada navigasi dan memuat ulang record. Daftar kembali mempertahankan query/filter saat pengguna menutup profil.

`DomainRepository.listByKind` mengekspos query yang sebelumnya sudah ada pada adapter SQLite untuk katalog dokter dan proyeksi terkait. API produksi nanti perlu adapter katalog/profil publik yang membatasi data di server; frontend lokal ini tidak memberikan akses produksi. Slot adalah proyeksi baca, bukan reservasi; command booking dan validasi konflik terakhir tersedia pada FE-09. Bootstrap seed menambahkan ekstensi fixture FE-08 secara atomik/idempotent pada database fixture, mengisi hanya field yang belum ada dan menjaga satu sumber data.

Inset frontend aktif diperoleh dari `react-native-safe-area-context ~5.7.0`. `SafeAreaProvider` berada di luar bootstrap/fonts sehingga tidak remount saat layar berubah; shell menggunakan satu SafeAreaView dan Modal filter mempunyai provider sendiri. Keyboard avoidance tetap berada di dalam shell/sheet, sedangkan bottom navigation menempati area layout tersendiri di atas inset bawah. Screenshot startup membuktikan inset atas pada Xiaomi; verifikasi detail/modal/font besar masih menunggu interaksi perangkat.


## Implementasi booking FE-09

`BookingFlow` hanya memanggil use case `BookingService` dan jadwal publik `VetDirectoryService`; tidak mengakses SQLite. Route membawa vetId dan hasil konsultasi dibuka memakai ID dari submit. Form menyimpan input sementara; BookingDraft, Attachment, Quote dan Consultation berada pada repository bersama. Detail/dashboard membaca consultation yang sama dan biaya snapshot.

`BookingRepository` menyediakan unit repository/profile baca dan callback transaksi. `SqliteBookingRepository` mengantrikan command booking pada objek database bersama dan menjalankan callback pada exclusive transaction; repository domain dalam unit menulis langsung ke transaction tersebut sehingga tidak membuat nested transaction. Validasi memakai service profil, ternak dan direktori dengan unit transaksi yang sama. Reservasi slot, pemeriksaan tarif, penulisan konsultasi/quote dan penanda submitted menjadi satu operasi atomik; foreign key serta unique operation key tetap berlaku. Tidak ada backend/auth UI aktif, database kedua atau otoritas tulis paralel.
