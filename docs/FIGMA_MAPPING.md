# Pemetaan Figma → aplikasi

Sumber: [VetLink prototype](https://www.figma.com/design/f1WBeG5S1OGXlPXyVEHjuW/Untitled), key `f1WBeG5S1OGXlPXyVEHjuW`, halaman `01 · VetLink / Prototype` (`0:1`). Inspeksi MCP: 5 Oktober 2026. Tidak ada page Peternak/Dokter terpisah: kedua area berada dalam page yang sama.

Metadata menemukan 97 top-level frame layar 390 × 844 dan component set Dokter `93:7181` dengan 283 variants. Jumlah frame/variant bukan jumlah route. [Inventory](reference/figma/inventory.json) mencatat ID/nama/dimensi; [sample prototype links](reference/figma/prototype-links.json) mencatat koneksi pilihan; [design specs](reference/figma/design-specs.json) mencatat tokens dan navigasi utama.

Route di dokumen ini merupakan usulan identifier navigasi Expo Router; belum file route implementasi. `:id` harus berisi entity ID dan tidak mengambil pasien/konsultasi default. Suffix `/review` digunakan untuk langkah tinjau; dialog/modal umumnya state pada route asal.

## Visual dan komponen

| Token | Nilai teramati / kebutuhan |
| --- | --- |
| color.cream / background | `#F6EDCE` |
| color.brown / primary & navigation | `#5C2F27` |
| color.dark / text | `#3A170D` |
| color.gold / selected & divider | `#DBA75B` |
| color.orange / accent | `#C3883D` |
| color.white / surface | `#FFFFFF` |
| text.muted Peternak | `#7B665E`, terlihat pada dashboard |
| Font | Inter Regular, Medium, Semi Bold, Bold |
| Spacing variables Dokter | 4, 8, 12, 16, 20, 24, 32, 48 |
| Spacing Peternak | Dashboard memakai gap 14, action gap 10; jangan dipaksa seragam 16 |
| Radius variables Dokter | 12 untuk button, 16 untuk card |
| Radius Peternak | Button 12, card 14, badge pill 999 pada dashboard |
| Content | Margin horizontal 20; Dokter 350 wide; Peternak wrapper 350, sebagian card 342 |
| Typography Peternak dashboard | Heading 24 Bold, section 18 Semi Bold, body/card 12–15, nav label 10; line-height 1.35 |
| Typography Dokter dashboard | App bar 20 Bold, nama 27 Bold, section 17 Semi Bold, body 14, label 12–13; line-height 1.45 |
| Button Dokter | Tinggi 48, radius 12; primary/secondary/pressed/disabled/loading/selected |
| Field Dokter | Default/focused/error/readonly; komponen total 350 × 104 termasuk label |
| Navigation | Peternak 70 tinggi; Dokter 80 termasuk padding bottom pada acuan |
| Icon / target | Dokter tab icon 24; target interaksi implementasi minimum 44 × 44 dp |

Node reusable: Peternak Primary `12:1666`, Secondary `12:1668`, Disabled `12:1670` (220 × 52 pada library; layar dapat lebar fluid). Dokter Button `75:2492`, Field `75:2509`, Navigation `75:2590`, Availability `75:2595`, Date `75:2605`, Status `75:2614`.

Komponen kode: `Screen`, `AppBar`, `Button`, `TextField`, `TextArea`, `BottomTabs`, `StatusBadge`, `AppointmentRow`, `SummaryCard`, `Avatar`, `ChatBubble`, `AttachmentViewer`, `FilterSheet`, `ConfirmationDialog`, `DateTimePicker`, `EmptyState`, `LoadingState`, `ErrorState`.

Tokens mempertahankan perbedaan peran melalui semantic/component tokens. Dimensi acuan diterjemahkan ke layout mobile fluid; jangan mengunci seluruh screen pada absolute coordinates. Jangan menggambar status bar 09:41 dalam app; gunakan bar OS/safe area.

### Implementasi FE-01

Tokens mobile ada di `apps/mobile/src/ui/theme/tokens.ts`; Inter Regular/Medium/Semi Bold/Bold dimuat lokal. Satu keluarga ikon Lucide dibungkus oleh `Icon` agar layar tidak memakai campuran glyph. Komponen FE-01 ada di `apps/mobile/src/ui/components`: `Button`, `TextField`/`TextArea`, `StatusBadge`, `AppointmentRow`, `ChatBubble`, `ConfirmationDialog`, dan state feedback kosong/memuat/error.

| Komponen | Acuan Figma | Penerapan FE-01 |
| --- | --- | --- |
| Button Peternak | `12:1666`, `12:1668`, `12:1670` | Fluid; minimum 52 dp; primary/secondary/aksen, pressed, disabled, loading, selected |
| Button Dokter | `75:2492` | Minimum 48 dp; primary/secondary/pressed/disabled/loading/selected |
| Field Dokter | `75:2509` | State default/focus/error/read-only; area input minimal 74 dp dan dapat tumbuh |
| Status Dokter | `75:2614` | Pill 32 dp dengan label dinamis dan state semantik |
| Chat Dokter | `46:16` | Incoming putih, outgoing cokelat, metadata, retry state; teks membungkus |
| Appointment row | Dashboard Peternak `12:1833` dan Dokter `46:7` | Card fluid dari screenshot referensi lokal; tap hanya aktif bila handler diberikan |
| Dialog | Logout Peternak `12:3184`; pola konfirmasi Dokter pada layar flow | Modal native dengan tombol nyata, Back Android, cancel/confirm, dan konten panjang yang dapat di-scroll |

Selisih yang disengaja: varian status di Figma menampilkan glyph cek yang sama; komponen menggunakan Lucide `check`, `clock-3`, atau `circle-alert` agar berhasil/menunggu/gagal dapat dibedakan. Field error tetap memakai border gold dari desain dan menambah pesan validasi warna orange. Button mempertahankan tinggi minimum per peran dan mengembang untuk label/font besar.

Konteks dan screenshot high-fidelity berhasil diperiksa untuk `12:1666`, `75:2492`, `75:2509`, `75:2614`, dan chat Dokter `46:16`. Pengambilan konteks/screenshot untuk Peternak Chat `12:2353` dan Logout Dialog `12:3184` ditolak oleh Figma MCP karena batas panggilan Starter plan. Karena itu, komponen dialog menggunakan tokens/pola konfirmasi bersama; kecocokan terhadap dua node yang tidak terbaca belum dapat dipastikan.

Pemeriksaan perangkat FE-01 pada 5 Oktober 2026: Xiaomi `2311DRK48G`, 1220 × 2712 px, density 480 dpi atau sekitar 407 × 904 dp. Tombol Peternak/Dokter terukur 52/48 dp; TextInput memiliki area sentuh 44 dp; aksi retry chat 44 dp. Teks berhasil diketik dan dibaca kembali, keyboard membuka pada field aktif, teks bantuan membungkus, katalog dapat discroll, retry merespons, serta dialog panjang tetap menampilkan kedua aksi dan tertutup melalui Back Android. Font Xiaomi diuji pada pilihan 125% (langkah terdekat ke 130%) dan 145%; dikembalikan ke 100% sesudahnya dan nilai akhir `font_scale`/`device_font_scale` diverifikasi 1.0. Screenshot bukti: [field dan keyboard pada font 125%](reference/android/fe01-component-keyboard-font125.png) dan [dialog panjang pada font 125%](reference/android/fe01-component-dialog-font125.png).

Pemeriksaan visual bersifat kualitatif pada perangkat asli, bukan pixel-match 390 × 844 dp. Xiaomi menolak override resolusi Android melalui ADB karena membutuhkan `WRITE_SECURE_SETTINGS`; ukuran 390 × 844 dan 360 × 800 dp karena itu belum diuji. UI font OEM tidak menyediakan pilihan tepat 130%. Jangan anggap FE-01 selesai sebelum viewport acuan serta node Figma yang belum dapat diperiksa ditinjau atau batasannya disepakati.

## Navigasi utama yang terverifikasi

Peternak: Beranda → dashboard; Ternak → Livestock List; Konsultasi → Doctor List; Pesanan → Orders; Profil → Profile. Dengan demikian tab Konsultasi mempertahankan direktori dokter; daftar request/riwayat dijangkau dari dashboard dan entry “Konsultasi Saya” di area konsultasi.

Dokter: Beranda → dashboard; Jadwal → schedule; Konsultasi → history; Pasien → patients; Profil → profile. Pendapatan dijangkau dari dashboard/profil, bukan tab baru.

## Autentikasi / peran

| Fitur | Layar Figma / node | Route usulan | Komponen | Data/state |
| --- | --- | --- | --- | --- |
| Splash/onboarding | Splash `12:1672`, Onboarding `12:1683`, `12:1697`, `12:1711` | `/start`, `/onboarding` | Branding, paging, Button | onboardingCompleted, step |
| Pilih/Ganti Peran | Dokter roles `46:2` | `/roles` | RoleCard | session, permittedRoles, entryContext |
| Login/reset | Login `12:1723`, Reset `12:1746`, Dokter login `46:3` | `/auth/login`, `/auth/reset-password` | TextField, Button | activeRole, form, submitting/error |
| Daftar | Farmer `12:1763`, Vet `12:1798`, Dokter register `46:4` | `/auth/register/:role` | Form, MediaPicker | profile draft, validation |
| Verifikasi | Dokter verification `46:5` | `/vet/verification` | DocumentPicker, StatusBadge | submission, pending/revision/verified |

Implementasi FE-03 menggunakan node Splash `12:1672`, Onboarding `12:1683`/`12:1697`/`12:1711`, Pilih/Ganti Peran `46:2`, Login `12:1723`, Reset `12:1746`, Daftar Peternak `12:1763`, Daftar Dokter `12:1798`, dan dialog Keluar `12:3184` sebagai tujuan pemetaan. Screenshot high-fidelity baru untuk node-node tersebut tidak berhasil diambil pada sesi ini karena Figma MCP mengembalikan batas panggilan Starter. Implementasi mengikuti tokens/komponen FE-01 yang sudah didokumentasikan; karena konteks visual baru tidak tersedia, kecocokan piksel layar FE-03 belum diverifikasi.

Selisih implementasi awal yang perlu ditinjau pada pemeriksaan Figma berikutnya: onboarding memakai ilustrasi ikon Lucide yang disusun di kode, bukan aset screenshot; role/login/register memakai layout scroll satu stack tanpa Expo Router; reset lokal langsung mengganti verifier di perangkat dan menjelaskan bahwa email tidak dikirim. Logout memakai `ConfirmationDialog` FE-01. Ini pemetaan sementara yang mengikuti aturan PRD/data model dan belum klaim visual akhir.

## Peternak

| Fitur | Layar Figma / node | Route usulan | Komponen | Data/state |
| --- | --- | --- | --- | --- |
| Dashboard F-03 | Dashboard `12:1833` | `/farmer/home` | SummaryCard, AppointmentRow | counts, reminders, active appointments |
| Ternak F-04 | List `12:1889`, Filtered `12:1934`, Empty `12:3196` | `/farmer/livestock` | SearchField, FilterSheet, AnimalRow | livestock, query, filters, empty |
| Tambah/edit F-04 | Add `12:1980`, Success `12:2019` | `/farmer/livestock/new`, `/farmer/livestock/:id/edit` | AnimalForm, PhotoPicker | fields, validation, save outcome |
| Detail F-04/05 | Detail `12:2032`, Vaccine `12:2068`, Medicine `12:2100`, Health Note `12:2132` | `/farmer/livestock/:id`, `/farmer/livestock/:id/care/new` | DetailHeader, HealthTabs | animalId, health events, selectedTab |
| Dokter F-06/07 | List `12:2161`, Filter Sheet `12:2215`, Profile `12:2245` | `/farmer/doctors`, `/farmer/doctors/:id` | DoctorCard, FilterSheet, SlotList | vets, query, filters, rates, reviews |
| Booking F-08 | Booking `12:2280` | `/farmer/booking/:vetId` | ServiceSelector, AnimalPicker, DateTimePicker | selectedAnimalId, service, slot, complaint, media, quote |
| Bayar F-16 | Payment Consult `12:2325`, Payment Order `12:2889` | `/farmer/payments/:paymentId` | MethodPicker, PaymentSummary | payable, method, pending/succeeded/failed |
| Jadwal/riwayat F-09/18 | History `12:2459`, Done `12:2497`, Empty `12:3225`, Detail `12:2545` | `/farmer/consultations`, `/farmer/consultations/:id` | StatusTabs, AppointmentRow | requests, proposal, consultation status |
| Chat F-10 | Chat `12:2353`, Sent `12:2375`, Attachment `12:2394` | `/farmer/consultations/:id/chat` | ChatBubble, Composer, AttachmentViewer | messages, input, media, send/error |
| Kunjungan F-11 | Belum ada frame Peternak khusus yang teridentifikasi; pakai Detail `12:2545` dan struktur Dokter visit `46:14` sebagai referensi konteks | `/farmer/consultations/:id/visit` | VisitTimeline, AddressCard | visit.stage, addressSnapshot |
| Hasil F-12 | Detail `12:2545`; clinical final Dokter `46:21` untuk isi | `/farmer/consultations/:id/result` | ReadonlyNote, RecommendationList | final note, sent recommendations, followUp |
| Pengingat F-13 | Reminders `12:2581`, Done `12:2618`, Add `12:2650` | `/farmer/reminders`, `/farmer/reminders/new` | ReminderRow, Form | careStatus, deliveryStatus, dueAt |
| Marketplace F-14 | Marketplace `12:2681`, Added `12:2738`, Product `12:2777` | `/farmer/products`, `/farmer/products/:id` | ProductCard, Search/Filter | catalog, query, category/species, added feedback |
| Cart/checkout F-15 | Cart `12:2796`, Two `12:2819`, Empty `12:2847`, Checkout `12:2862` | `/farmer/cart`, `/farmer/checkout` | QuantityControl, AddressPicker, Summary | cart items, quote, shipping, total |
| Orders F-17 | Success `12:2910`, Orders `12:2925`, Done `12:2963`, Detail `12:2997`, Tracking `12:3032` | `/farmer/orders`, `/farmer/orders/:id`, `/farmer/orders/:id/tracking` | OrderRow, Timeline | order, payment, shipment |
| Ulasan F-19 | Review `12:2425`, Success `12:2446` | `/farmer/consultations/:id/review` | RatingInput, TextArea | stars, text, eligible/submitting |
| Profil F-02 | Profile `12:3066`, Edit `12:3103` | `/farmer/profile`, `/farmer/profile/edit` | ProfileForm, AddressList | identity, farm, species, photo, address |
| Pengaturan F-20 | Settings `12:3130`, Help `12:3162`, Logout `12:3184` | `/farmer/settings`, `/farmer/help` | SettingsRow, Dialog | prefs, session, help |
| Inbox F-20 | Belum ada frame inbox Peternak khusus yang teridentifikasi; gunakan pola Dokter notifications `46:33` | `/farmer/notifications` | NotificationList | recipient scoped events/read |

Alamat/farm editor, respons proposal jadwal, riwayat pembayaran, dan form laporan Peternak belum mempunyai dedicated frame Peternak yang teridentifikasi. Gunakan komponen input/list/dialog teramati dan susunan konteks fitur; perbedaan visual harus direview sebelum acceptance.

## Dokter

| Fitur | Layar Figma / node | Route usulan | Komponen | Data/state |
| --- | --- | --- | --- | --- |
| Dashboard V-04 | dashboard `46:7` | `/vet/home` | PriorityCard, AppointmentRow, AvailabilitySwitch | requests, today, follow-ups, availableBalance |
| Permintaan V-06 | requests `46:8`, request `46:9` | `/vet/requests`, `/vet/requests/:id` | ComplaintCard, Dialog, ProposalForm | requested, accept/reject/reschedule pending |
| Jadwal V-07 | schedule `46:10`, appointment `46:13` | `/vet/schedule`, `/vet/consultations/:id` | Calendar, AppointmentRow | date/week selection, consultation |
| Ketersediaan V-05 | availability `46:11` | `/vet/availability` | WorkdayPicker, TimeFields, BlockSheet | hours/durations/rates, dirty/saving/blocked |
| Kunjungan V-09 | visit `46:14`, location `46:15` | `/vet/consultations/:id/visit`, `/vet/consultations/:id/location` | VisitActions, AddressCard | scheduled/en_route/arrived/examining |
| Chat V-08 | chat `46:16` | `/vet/consultations/:id/chat` | Composer, ChatBubble | messages, send status, related patient |
| Pasien V-10 | patients `46:17`, patient `46:18` | `/vet/patients`, `/vet/patients/:animalId` | Search/Filter, HealthTabs | assignment scoped patients, history tabs |
| Catatan V-11 | note `46:19`, noteVisit `63:422` | `/vet/consultations/:id/note` | ClinicalForm, DraftActions | actual typed draft; chat/visit context |
| Review/final V-11 | review `46:20`, reviewVisit `63:423`, final `46:21`, finalVisit `63:424` | `/vet/consultations/:id/note/review`, `/vet/consultations/:id/note/final` | NoteSummary, ConfirmDialog | draft version, validation, final read-only |
| Rekomendasi V-12 | recommendations `46:22`, products `46:12` | `/vet/consultations/:id/recommendations`, `/vet/products` | RecommendationEditor, ProductPicker | items, instructions, draft/sent |
| Tindak lanjut V-13 | followup `46:24`, progress `46:25`; afterFinal variants `94:6955` onward | `/vet/consultations/:id/follow-up`, `/vet/consultations/:id/progress` | DateTimePicker, ReminderRow, ReportViewer | scheduled followUp, delivery, reports |
| Selesai/riwayat V-14 | history `46:26`, done `46:27`, doneVisit `46:23`, historyDone `63:425` | `/vet/history`, `/vet/consultations/:id/result` | StatusTabs, CompletionDialog, Result | status filters, final note, complete outcome |
| Pendapatan V-15 | earnings `46:28`, transaction `46:29` | `/vet/earnings`, `/vet/earnings/transactions/:id` | BalanceCard, PeriodSheet | gross/commission/net, pending/available |
| Pencairan V-16 | withdraw `46:30`, review `46:31`, submitted `46:32` | `/vet/withdrawals/new`, `/vet/withdrawals/review`, `/vet/withdrawals/:id` | AmountForm, Review, ConfirmDialog | amount/destination, reservation, submitted |
| Profil V-03 | profile `46:34`, editProfile `46:35`, ratings `46:6` | `/vet/profile`, `/vet/profile/edit`, `/vet/ratings` | ProfileForm, ReviewList | professional profile, verification, rating |
| Notifikasi V-17 | notifications `46:33` | `/vet/notifications` | NotificationRow | events, unread/read, context destination |
| Pengaturan V-18 | settings `46:36`, help `46:37` | `/vet/settings`, `/vet/help` | SettingsRow, Dialog | preferences, help, logout |

### Implementasi awal FE-04: profil dan verifikasi

Pemetaan profil tetap memakai node yang telah tercatat: Profil Peternak `12:3066` dan Edit `12:3103`; Profil Dokter `46:34`, Edit `46:35`, serta Verifikasi Dokter `46:5`. Sebelum implementasi, permintaan `get_design_context` terbaru untuk node profil `12:3066` dan `46:34` ditolak Figma MCP dengan pesan batas panggilan Starter plan. UI FE-04 karena itu menggunakan tokens/komponen FE-01 dan susunan field sesuai data model; screenshot high-fidelity dan perbandingan visual Android belum diverifikasi. Selisih ini dicatat untuk review saat kuota tersedia.

## Mengubah variants menjadi state

`note, State=0…15` dan `noteVisit, State=0…15` menyimulasikan kombinasi field terisi. Implementasikan satu clinical form dengan nilai input/validation dan dirty state; jangan memakai angka variant sebagai data klinis. `draft/error/cancel/confirm` menjadi dialog/feedback lokal.

`requests/rejected`, `requests/rescheduledLate`, `appointment/final`, `visit/travel`, `visit/arrived`, `history/done`, `earnings/zero`, `withdraw/error` dihasilkan oleh data/status domain. `recommendations/edited/sentEdited` harus membaca isi yang benar-benar diedit. `availability/savedOriginal` mengingatkan bahwa menyimpan tanpa mengubah jam tidak boleh menghasilkan jam baru hardcoded.

Prototype dokter memakai banyak `CHANGE_TO` di dalam instance. Aplikasi memakai navigasi nyata dan route params; BACK berasal dari navigation stack/context, bukan selalu berpindah ke appointment contoh.

## Perbedaan referensi dan penyelesaian

| Temuan terverifikasi / gap | Keputusan implementasi | Alasan |
| --- | --- | --- |
| Payment Consult: tap metode → Chat (`12:2353`) | Pemilihan hanya mengubah method; bayar mengirim command; request menunggu acceptance | Payment result dan status dokter harus valid |
| Opsi “Bayar nanti” tidak memiliki policy rinci | Belum aktif pada milestone lokal; keputusan tercatat DEC-11/12 | Tidak mengasumsikan utang/refund/layanan tanpa pembayaran |
| Tombol “Catatan Pemeriksaan” appointment default → chat | Gunakan note route ketika pemeriksaan aktif; sebelum aktif tampilkan aksi Mulai | Tujuan aksi mengikuti fungsi dan guard layanan |
| Sebagian followup memiliki tombol selesai → blocked meski ada final | Guard membaca note/state konsultasi yang sama | Final tidak otomatis selesai, tetapi pengguna harus dapat menyelesaikan flow setelah syarat valid |
| Withdrawal Submitted → earnings zero | Hitung saldo setelah amount aktual direservasi | Pencairan parsial tidak selalu menjadikan saldo nol |
| Angka, pasien dan tanggal antar variant berbeda | Fixture terkait dan kalkulasi shared | Single source of truth lebih penting daripada angka contoh independen |
| Glyph/emoji Peternak dan icon Dokter berbeda keluarga | Satu keluarga icon dengan makna/slot yang sama; dokumentasikan aset pengganti | Kebutuhan konsistensi icon pengguna |
| Beberapa back icon 40 × 40 | Hit area minimal 44 × 44 tanpa mengubah makna/tata letak utama | Kebutuhan touch target pengguna |
| Onboarding memakai Next/Skip/Get Started | “Lanjut”/“Lewati”/“Mulai” | Bahasa antarmuka Indonesia |
| Form prototype diisi dengan tap/variant | TextInput nyata, schema validation, persistent draft | Perilaku aplikasi yang diminta |
| Dedicated frame beberapa fungsi Peternak belum ditemukan | Susun dari komponen Figma dan kebutuhan fitur; review gap visual | Tidak menyatakan layar yang belum diperiksa sebagai referensi lengkap |

## Cakupan inspeksi dan pekerjaan berikutnya

Hierarchy seluruh page dan nama variants diperiksa. High-fidelity context dan screenshot dashboard Peternak/Dokter diperiksa. Screenshot booking, note, final note, availability, earnings dan withdrawal review juga diperiksa. Sampel prototype transitions diperiksa untuk request, appointment, visit, clinical, recommendation, follow-up, availability, withdraw, payment dan checkout; ini bukan audit setiap koneksi variant.

Sebelum coding setiap layar: ambil high-fidelity context subtree dan screenshot terkini, periksa visible assets, validasi states utama. Screenshots note/availability hanya viewport; konten di bawahnya tetap perlu diperiksa melalui hierarchy/context dan scroll. Saat baseline dokumentasi belum ada screenshot aplikasi; bukti smoke test shell FE-00 pada perangkat tersedia di [screenshot Android](reference/android/fe00-phone-launch.png), tetapi bukan perbandingan visual terhadap layar Figma.

## Implementasi awal FE-05: dashboard

Dashboard Peternak memakai node `12:1833` dan Dokter `46:7`; screenshot referensi lokal `screenshots/farmer-dashboard.png` serta `screenshots/vet-dashboard.png` telah diperiksa ulang sebelum implementasi. Figma MCP tidak dapat mengambil konteks/screenshot terbaru karena batas Starter yang juga menahan inspeksi FE-04, sehingga perubahan desain setelah snapshot ini belum diverifikasi.

Penerapan menampilkan metrics dan kartu dari `DashboardService`, membuka detail dengan ID konsultasi/pengingat yang dibaca ulang, dan memisahkan peran melalui query owner/assignment. Availability memakai record tersimpan dan mensyaratkan verified untuk menerima layanan baru; janji terjadwal tetap terlihat setelah toggle off. Selisih saat ini: tombol cepat Peternak diarahkan ke profil peternakan/konsultasi sendiri karena alur tambah ternak dan booking berada pada FE-06/09; tab Ternak, Pesanan, dan Pasien nonaktif hingga layar masing-masing tersedia. QA screenshot Android FE-05 belum dilakukan.

## Implementasi awal FE-06: data ternak

Node yang sudah dipetakan untuk FE-06: daftar `12:1889`, daftar dengan filter `12:1934`, empty `12:3196`, tambah `12:1980`, konfirmasi tersimpan `12:2019`, dan detail `12:2032`. Pada 5 Oktober 2026, `get_design_context` dengan screenshot diwajibkan dicoba untuk keenam node; seluruh permintaan ditolak karena batas panggilan MCP plan Starter. `figma_whoami` mengonfirmasi tim masih memakai Starter. Tidak ada screenshot lokal untuk layar ternak ini, sehingga UI FE-06 belum diimplementasikan dan belum ada klaim kecocokan visual.

Lapisan domain awal menggunakan `LivestockService` dan `selectLivestock`: baca/tulis melalui repository, scope farmer/farm dan detail ID, ID tampilan unik per farm, validasi field dari kontrak data, kombinasi pencarian/filter, serta attachment foto privat dengan commit satu transaksi. Setelah konteks Figma tersedia, inspeksi hierarchy/assets/screenshot diperlukan sebelum implementasi list, sheet filter, empty state, form, konfirmasi, dan detail sebagai state interaktif; screenshot layar tidak boleh menjadi aset aplikasi.

## Implementasi shell FE-03

`apps/mobile/App.tsx` sekarang memuat `AuthFlow` setelah bootstrap SQLite dan Inter. Splash/onboarding memandu ke Pilih Peran; akun masuk ke landing sesi sederhana yang menyediakan Ganti Peran dan Keluar. Landing ini akan digantikan shell/dashboard fitur pada tiket berikutnya. Screenshot layar Mulai pada HP ada di [fe03-start-screen.png](reference/android/fe03-start-screen.png); ini bukti app asli, bukan screenshot desain Figma. Gear Expo development menu yang terlihat di sudut kanan atas hanya milik development build. Pemeriksaan pixel-match terhadap ukuran 390 × 844 dan visual Figma untuk node autentikasi masih tertunda.
