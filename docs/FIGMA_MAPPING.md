# Pemetaan Figma → aplikasi

Sumber: [VetLink prototype](https://www.figma.com/design/f1WBeG5S1OGXlPXyVEHjuW/Untitled), key `f1WBeG5S1OGXlPXyVEHjuW`, halaman `01 · VetLink / Prototype` (`0:1`). Inspeksi MCP: 5 Oktober 2026. Tidak ada page Peternak/Dokter terpisah: kedua area berada dalam page yang sama.

Metadata menemukan 97 top-level frame layar 390 × 844 dan component set Dokter `93:7181` dengan 283 variants. Jumlah frame/variant bukan jumlah route. [Inventory](reference/figma/inventory.json) mencatat ID/nama/dimensi; [sample prototype links](reference/figma/prototype-links.json) mencatat koneksi pilihan; [design specs](reference/figma/design-specs.json) mencatat tokens dan navigasi utama.

Inspeksi FE-07 juga menggunakan link terbaru dari pengguna ke file [VetLink — Dokter / Tampilan dan interaksi](https://www.figma.com/design/TPG6qZunK9EY4z1Vy0GKDx/Untitled?node-id=93-7181&t=hYv9JEpqvZmEonSz-), key `TPG6qZunK9EY4z1Vy0GKDx`, node `93:7181`. Node ini relevan: metadata component set memuat `Screen=patients` (`80:4594`) dan `Screen=patient` (`80:4726`) beserta variants. File ini dipakai sebagai acuan visual FE-07 saja; pemetaan layar lain tetap menunjuk file sumber yang tercatat di atas.

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

Konteks dan screenshot high-fidelity berhasil diperiksa untuk `12:1666`, `75:2492`, `75:2509`, `75:2614`, chat Dokter `46:16`, serta—pada link terbaru—Peternak Chat `12:2353` dan Logout Dialog `12:3184`. Kedua node FE-01 yang sebelumnya tertunda kini terbaca; screenshot referensinya menampilkan chat pada 390 × 844 dan modal logout pada viewport yang sama. Frame Logout menampilkan tombol konfirmasi lalu batal secara vertikal. `ConfirmationDialog` saat ini menampilkan Batal lalu Konfirmasi dalam satu baris; catat sebagai selisih implementasi yang perlu ditinjau. Screenshot Android komponen lama adalah galeri diagnostik, bukan layar Chat/Logout produk, sehingga ukuran/posisi layar produk dan pixel-match belum terverifikasi.

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

Implementasi FE-03 menggunakan node Splash `12:1672`, Onboarding `12:1683`/`12:1697`/`12:1711`, Pilih/Ganti Peran `46:2`, Login `12:1723`, Reset `12:1746`, Daftar Peternak `12:1763`, Daftar Dokter `12:1798`, dan dialog Keluar `12:3184` sebagai tujuan pemetaan. Dari link terbaru, Logout `12:3184` berhasil diperiksa; konteks autentikasi lain belum dapat diambil karena limit Starter. Implementasi mengikuti tokens/komponen FE-01 yang sudah didokumentasikan; kecocokan piksel layar FE-03 belum diverifikasi.

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

Dashboard Peternak memakai node `12:1833` dan Dokter `46:7`; screenshot referensi lokal `screenshots/farmer-dashboard.png` serta `screenshots/vet-dashboard.png` telah diperiksa ulang sebelum implementasi. Figma MCP belum dapat mengambil konteks dashboard terbaru karena batas Starter; tampilan implementasi dashboard pada perangkat masih menunggu QA.

Penerapan menampilkan metrics dan kartu dari `DashboardService`, membuka detail dengan ID konsultasi/pengingat yang dibaca ulang, dan memisahkan peran melalui query owner/assignment. Availability memakai record tersimpan dan mensyaratkan verified untuk menerima layanan baru; janji terjadwal tetap terlihat setelah toggle off. Tombol cepat Peternak “Tambah ternak” kini membuka form FE-06. Tab Ternak dan tab Pasien Dokter aktif; Pesanan masih nonaktif karena layar FE-19 belum dibuat. QA screenshot Android FE-05 belum dilakukan.

## Implementasi awal FE-06: data ternak

Node yang dipetakan untuk FE-06: daftar `12:1889`, daftar dengan filter `12:1934`, empty `12:3196`, tambah `12:1980`, konfirmasi tersimpan `12:2019`, dan detail `12:2032`. Panggilan `get_design_context` serta `get_screenshot` untuk `12:1889` pada file utama `f1WBeG5S1OGXlPXyVEHjuW` mengembalikan pesan persis `Looks like you don't have edit access to this file. The file owner can share it with you and make you an editor.` dengan kode `INVALID_ARGUMENT`. Itu kegagalan izin file. Pada link terbaru `TPG6qZunK9EY4z1Vy0GKDx`, `get_design_context` untuk node yang sama mengembalikan `You've reached the Figma MCP tool call limit on the Starter plan. Upgrade your plan for more tool calls: https://www.figma.com/files/team/1688904264667270127/all-projects?upgrade=mcp_rate_limit_paywall`. Itu batas kuota, bukan kegagalan autentikasi. `figma_whoami` berhasil dan menampilkan tier Starter serta seat View. Tool MCP tersedia pada sesi ini; error sesi sebelumnya `-32001: Unknown tool` adalah kondisi berbeda. Konteks detail dan screenshot FE-06 tidak berhasil diperoleh, sehingga tidak ada klaim kesesuaian pixel.

`LivestockFlow` sekarang menyediakan daftar, pencarian dan filter species/sex, empty/error/loading, detail berdasarkan `livestockId`, form tambah/edit, foto lokal, serta konfirmasi setelah commit berhasil. Susunan layar memakai tokens, Inter, dan Lucide yang telah diperiksa sebelumnya; ini rancangan frontend mandiri sesuai instruksi pengguna ketika node tidak dapat diakses. `LivestockService` tetap menjaga owner/farm dan validasi. Selisih visual detail terhadap Figma akan ditinjau saat konteks/screenshot node kembali tersedia. Screenshot layar Figma tidak digunakan sebagai aset aplikasi.

## Implementasi awal FE-07: riwayat kesehatan dan pasien

Node FE-07 pada link terbaru: Dokter patients `80:4594`; patient detail `80:4726`; variants vaksin `80:4759`, obat `80:4786`, kambing `80:4809`, dan catatan final `80:4842`. Node `93:7181` mengembalikan metadata ringkas karena frame besar; sesuai prasyarat design-to-code, screenshot dan high-fidelity context kemudian diambil dari child nodes. Screenshot `80:4594` dan `80:4726` berukuran 390 × 844; variants `80:4759`, `80:4786`, dan `80:4842` juga diperiksa. Daftar menunjukkan pencarian ID/nama pemilik dan filter Semua/Sapi/Kambing. Detail memakai tab Periksa/Vaksin/Obat, riwayat bertanggal, status final, dan back action.

Konteks Peternak `12:2032`, `12:2068`, dan `12:2132` terkena error persis `You've reached the Figma MCP tool call limit on the Starter plan. Upgrade your plan for more tool calls: https://www.figma.com/files/team/1688904264667270127/all-projects?upgrade=mcp_rate_limit_paywall`. Konteks/screenshot `12:2100` sempat berhasil sebelum limit tercapai. `figma_whoami` berhasil dan mengembalikan plan tier `starter` dengan seat `View`; karena beberapa node di file yang sama berhasil dibaca, kegagalan ini adalah rate limit Starter, bukan MCP tool yang tidak tersedia atau error autentikasi/izin file. Sesi sebelumnya yang mengembalikan `-32001: Unknown tool` adalah kondisi MCP tool tidak tersedia sebelum akun/izin file dapat diperiksa. Tidak ada kegagalan autentikasi atau permission error pada pemeriksaan link terbaru.

`PatientFlow` memasang daftar pasien, filter species, dan pencarian berbasis `PatientService`; detail dimuat memakai `animalId` route dan menampilkan riwayat final serta laporan terkait assignment. Catatan dibuka hanya baca; lampiran diotorisasi ulang oleh `HealthRecordService`. Selisih dari prototype: UI menambah tab “Lainnya” agar disease/care tidak tersembunyi; draft klinis tidak ditampilkan karena aturan final-only; tombol “Catatan Pemeriksaan” menunggu FE-14; back hit area menjadi 44 dp dan glyph diganti Lucide.

`FarmerHealthFlow` sekarang dibuka dari detail ternak menggunakan `livestockId`/`animalId` yang sama. Riwayat menampilkan Semua/Periksa/Penyakit/Vaksin/Obat/Perawatan, sumber catatan, detail final hanya baca, dan lampiran dengan pemeriksaan akses ulang. Form laporan Peternak menyimpan kategori, keterangan, dan waktu saat simpan; tidak mengubah catatan Dokter. Karena node Peternak tidak dapat diambil, susunan ini dirancang dari tokens dan aturan fitur, bukan salinan visual Figma. Screenshot Android layar riwayat, input, modal, viewer, dan visual comparison belum diperoleh; MIUI menolak ADB input dengan `INJECT_EVENTS`.

## Implementasi shell FE-03

`apps/mobile/App.tsx` sekarang memuat `FrontendFlow` setelah bootstrap SQLite dan Inter. Pilih Peran membuka persona fixture lokal tanpa daftar/masuk/reset/keluar; menu menyediakan Ganti Peran. `AuthFlow` FE-03 masih ada di source historis tetapi tidak dipasang pada alur aktif. Ini keputusan tahap frontend dari pengguna, bukan perubahan pada prototipe Figma. Screenshot lama [fe03-start-screen.png](reference/android/fe03-start-screen.png) hanya bukti tahap FE-03 terdahulu. Pemeriksaan visual Android untuk flow baru pada 390 × 844 dan font besar belum dilakukan.

## Implementasi FE-08: direktori dan profil dokter

Node nyata yang sudah dipetakan pada file utama adalah Doctor List `12:2161`, Filter Sheet `12:2215`, dan Doctor Profile `12:2245`, untuk fitur F-06/F-07. Skill `figma-design-to-code` dibaca sebelum permintaan konteks desain beserta screenshot node daftar. Panggilan ke `f1WBeG5S1OGXlPXyVEHjuW`, node `12:2161`, mengembalikan pesan persis:

```text
Looks like you don't have edit access to this file. The file owner can share it with you and make you an editor.Figma Debug UUID: 10656066-aa9f-49dd-a732-75119a243224
```

Kode terstruktur `INVALID_ARGUMENT` pada respons tersebut menunjukkan penolakan izin file. Percobaan pada key link terbaru `TPG6qZunK9EY4z1Vy0GKDx` mengembalikan pesan persis:

```text
You've reached the Figma MCP tool call limit on the Starter plan. Upgrade your plan for more tool calls: https://www.figma.com/files/team/1688904264667270127/all-projects?upgrade=mcp_rate_limit_paywall
```

Respons kuota juga memakai `INVALID_ARGUMENT`; maknanya dibedakan lewat pesan. `figma_whoami` dapat dipanggil pada sesi ini (Starter, seat View). Tool MCP tersedia; kegagalan lama `-32001: Unknown tool` adalah kondisi berbeda sebelum akun/izin bisa diperiksa. Pemeriksaan FE-08 tidak memperoleh konteks/screenshot desain, dan tidak menunjukkan error autentikasi. Keberadaan node daftar pada file terbaru belum dapat dikonfirmasi karena request berhenti pada batas kuota.

Sesuai arahan pengguna, UI FE-08 dibuat mandiri dari tokens yang sudah terinspeksi dan kontrak F-06/F-07: daftar kartu, search, filter sheet, profil, tarif, jadwal 7 hari, serta ulasan. Foto memakai lampiran profil bila tersedia, dengan fallback Lucide `stethoscope`; badge verifikasi memakai `badge-check`; pencarian/filter/back/clock memakai keluarga ikon yang sama. Semua aksi utama minimal 44 dp, konten membungkus dan dapat discroll, filter menyediakan keyboard avoidance dan dialog nyata. Ini rancangan kode, belum bukti QA sentuh/visual pada Android.

Tab Konsultasi Peternak kini membuka direktori dokter sesuai pemetaan navigasi; tombol Konsultasi saya pada dashboard membuka konsultasi milik akun. Profil dibuka berdasarkan `vetId`, bukan dokter fixture pertama. Jadwal membaca data repository dan menolak slot untuk dokter non-verified/tidak menerima, tarif yang belum aktif, atau waktu terisi. Slot ditampilkan untuk dibaca; pemesanan masuk FE-09. Tidak ada angka rating, tanggal, atau screenshot penuh yang dijadikan UI hardcoded. Pixel-match dan perbandingan viewport/font besar belum diperoleh karena akses Figma gagal dan input ADB ditolak MIUI.

Shell aktif dan filter FE-08 kemudian memakai `react-native-safe-area-context ~5.7.0` untuk inset nyata. Ini perbaikan terhadap pola SafeAreaView lama, bukan token visual Figma baru. Screenshot startup akhir di [Testing](TESTING.md) hanya membuktikan inset layar awal; ukuran/visual direktori, profil, dan filter tetap belum dibandingkan.


## Implementasi FE-09: booking

Skill wajib `figma-design-to-code` dibaca sebelum memanggil get_design_context; node Booking nyata dari mapping file utama adalah `12:2280`. Pada 5 Oktober 2026, context file utama `f1WBeG5S1OGXlPXyVEHjuW` gagal dengan pesan persis:

```text
Looks like you don't have edit access to this file. The file owner can share it with you and make you an editor.Figma Debug UUID: e33f6896-aaab-42a1-9929-98cd13154859
```

Get_screenshot langsung untuk node yang sama juga gagal:

```text
Looks like you don't have edit access to this file. The file owner can share it with you and make you an editor.Figma Debug UUID: 11ed444c-8cbf-4a8b-96ab-1e59d23cb161
```

Percobaan context serta screenshot node `12:2280` pada link terbaru `TPG6qZunK9EY4z1Vy0GKDx` mengembalikan pesan persis:

```text
You've reached the Figma MCP tool call limit on the Starter plan. Upgrade your plan for more tool calls: https://www.figma.com/files/team/1688904264667270127/all-projects?upgrade=mcp_rate_limit_paywall
```

Tool MCP tersedia; file utama gagal izin edit, link terbaru gagal kuota Starter. Tidak memperoleh konteks/screenshot baru, tidak membuktikan error autentikasi, dan keberadaan node Booking pada file terbaru belum dapat dikonfirmasi. Kondisi ini berbeda dari error lama `-32001: Unknown tool`. Status akun terakhir yang benar-benar terbaca pada FE-08 adalah Starter dengan seat View; tidak ada akun Figma lain yang digunakan untuk mencoba bypass akses.

Referensi lokal lama [farmer-booking.png](reference/figma/screenshots/farmer-booking.png) (390 × 844) sudah ditinjau: header cokelat, pilihan layanan, tanggal/jam, ternak, keluhan/media, biaya dan tombol lanjut pembayaran. PNG itu membantu memahami struktur layar, bukan pemeriksaan ulang desain terkini dan bukan asset UI. Sesuai izin fallback pengguna, form dan review FE-09 dirancang mandiri menggunakan cream/brown/gold, Inter, Lucide, kartu, area sentuh minimal 44 dp, teks membungkus, scroll, inset shell/Modal dan keyboard avoidance shell.

Selisih fungsi/visual: waktu berasal dari slot nyata dalam repository, bukan chips waktu statis; ternak dibatasi owner/farm serta species yang dilayani; kunjungan mewajibkan alamat; review biaya dipisah agar dapat ditinjau sebelum penulisan. Tombol prototype lanjut pembayaran menjadi Tinjau biaya → Konfirmasi booking karena pembayaran FE-19 belum tersedia. Hasil hanya awaiting_payment, tidak melompati requested/scheduled/chat. Draft tersimpan dan dialog tiga pilihan ditambahkan sesuai kontrak PRD. Video memakai glyph Lucide file-text sebagai penanda berkas; foto ditampilkan sebagai thumbnail. Belum ada playback video dalam form. Pixel-match, visual form Android 390 × 844, viewport kecil dan font besar belum dibuktikan; input ADB Xiaomi ditolak MIUI.

## Implementasi FE-10: permintaan, jadwal dan riwayat

Skill wajib `figma-design-to-code` dibaca sebelum get_design_context dengan screenshot diminta. Node nyata pada mapping file utama: Requests `46:8`, Request Detail `46:9`, Schedule `46:10`, Appointment Detail `46:13`, History `46:26`/`46:27`, serta riwayat Peternak `12:2459`/`12:2497`/`12:3225`/`12:2545`. Node tersebut relevan untuk FE-10; belum ditemukan frame khusus respons usulan Peternak. Context `46:8` pada `f1WBeG5S1OGXlPXyVEHjuW` gagal persis:

```text
Looks like you don't have edit access to this file. The file owner can share it with you and make you an editor.Figma Debug UUID: ada51865-c6a7-405f-a618-adf1d6416ac3
```

Screenshot langsung node tersebut juga gagal:

```text
Looks like you don't have edit access to this file. The file owner can share it with you and make you an editor.Figma Debug UUID: 990bcc4f-6342-40c7-b56f-4266c4ea4b2e
```

Context dan screenshot link terbaru memakai root nyata yang diberikan pengguna `93:7181`, bukan menebak ID child FE-10. Keduanya gagal persis:

```text
You've reached the Figma MCP tool call limit on the Starter plan. Upgrade your plan for more tool calls: https://www.figma.com/files/team/1688904264667270127/all-projects?upgrade=mcp_rate_limit_paywall
```

Respons berkode `INVALID_ARGUMENT`; pesan menunjukkan izin file utama dan kuota link terbaru. Tool MCP tersedia, bukan `-32001: Unknown tool` dan tidak ada bukti kegagalan autentikasi. Status akun terakhir yang berhasil diperiksa tetap Starter/seat View; tidak beralih ke akun lain. Konteks/screenshot FE-10 terbaru tidak diperoleh dan lokasi frame pada link terbaru belum dapat dipastikan.

Sesuai izin pengguna, FE-10 dirancang mandiri memakai tokens Inter/cream/brown/gold, radius masing-masing peran, Lucide arrow-left, kartu, tombol minimal 44 dp dan scrolling. Tab Permintaan/Jadwal/Riwayat mencakup seluruh data scoped, termasuk booking awaiting_payment hanya untuk Peternak. Form alasan dan waktu baru, konfirmasi nyata, draft/back tiga pilihan, respons usulan, alasan pembatalan/penolakan dan timeline status ditambahkan sesuai fungsi PRD. Jadwal lama tidak berubah sampai Peternak menyetujui; pembayaran/refund tidak diberi tombol untuk melompati status. Foto dapat dibuka dengan pemeriksaan akses ulang; video dilabeli berkas dengan playback belum tersedia.

Ini implementasi mandiri, bukan klaim pixel-match. [Screenshot Xiaomi](reference/android/fe10-ui-startup-metro.png) hanya menunjukkan layar Pilih Peran/inset shell; gear Tools adalah Expo development client. Daftar/detail/form/modal FE-10, viewport 390 × 844, ukuran kecil, font besar dan pembandingan visual belum diuji akibat penolakan input MIUI.

## Implementasi FE-11: ketersediaan dan kalender

Skill wajib `figma-design-to-code` dibaca sebelum meminta context/screenshot. Mapping prototype lokal menunjuk Schedule `46:10`, Availability `46:11`, overlay pemilihan hari `82:7031`, dan overlay jam `82:6982`; subtree itu relevan untuk jadwal serta pengaturan Dokter. Pada file utama `f1WBeG5S1OGXlPXyVEHjuW`, `get_design_context` Schedule `46:10` gagal dengan pesan persis:

```text
Looks like you don't have edit access to this file. The file owner can share it with you and make you an editor.Figma Debug UUID: 2da64378-dd40-4685-bb7c-d04df8e54fde
```

`get_screenshot` untuk node yang sama mengembalikan:

```text
Looks like you don't have edit access to this file. The file owner can share it with you and make you an editor.Figma Debug UUID: bf44300a-96ad-43a0-bc8e-80c803173e45
```

Context dan screenshot Availability `46:11` pada file utama juga gagal dengan pesan izin edit yang sama, masing-masing Debug UUID `49b21eb7-0d87-4ca9-be3c-3ed63f36db13` dan `da6f16a3-02e5-4e6a-af49-6b7364b897fb`. Untuk link terbaru pengguna, context dan screenshot diminta dari root node nyata `93:7181`; keduanya mengembalikan error Starter yang persis:

```text
You've reached the Figma MCP tool call limit on the Starter plan. Upgrade your plan for more tool calls: https://www.figma.com/files/team/1688904264667270127/all-projects?upgrade=mcp_rate_limit_paywall
```

Tool MCP berjalan dan membalas permintaan; file utama melaporkan izin edit, sedangkan link terbaru melaporkan kuota. Ini bukan bukti kegagalan autentikasi dan berbeda dari `-32001: Unknown tool` pada sesi lama. Context/screenshot desain terbaru tidak berhasil diperoleh. Screenshot referensi lokal [vet-availability.png](reference/figma/screenshots/vet-availability.png) ditinjau untuk hierarki isi, tetapi cache tersebut tidak menggantikan pemeriksaan ulang Figma terkini.

Sesuai arahan fallback pengguna, UI dibangun dari tokens lokal dan aturan produk: editor layanan/jam/tarif/durasi, timezone, blok, draft/back dialog, dan kalender harian/mingguan. Kalender menampilkan data scoped dan navigasi mengikuti timezone; persetujuan/availability off tidak menghapus appointment. Selisih fungsi dari prototype belum dibandingkan pada context terkini. Android screenshot produk, 390 × 844, layar kecil, font besar, dan pixel-match belum tersedia; startup Xiaomi hanya mencapai Pilih/Ganti Peran karena MIUI menolak tap `INJECT_EVENTS`.
