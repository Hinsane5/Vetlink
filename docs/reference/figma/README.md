# Bukti referensi Figma

Sumber: [Figma VetLink](https://www.figma.com/design/f1WBeG5S1OGXlPXyVEHjuW/Untitled), page `0:1` — `01 · VetLink / Prototype`. Diakses melalui konektor/MCP Figma pada 5 Oktober 2026. Tidak ada perubahan pada file Figma.

| Artefak | Isi / batas |
| --- | --- |
| [inventory.json](inventory.json) | Top-level frames/components, tiga reusable buttons Peternak dan 283 named screen variants; bukan seluruh layer tree |
| [prototype-links.json](prototype-links.json) | Maksimum 9 navigation actions pada tiap screen pilihan; variable actions tidak termasuk |
| [design-specs.json](design-specs.json) | Tokens non-prototype, dimensi komponen pilihan, destination primary tabs |

## Screenshot yang diambil dan diperiksa

Semua PNG berikut berasal dari export MCP, berukuran 390 × 844, dan disimpan lokal agar tidak bergantung pada URL aset sementara. Dua dashboard juga diperiksa melalui `get_design_context`; screenshot lain melalui `get_screenshot` dan peninjauan gambar lokal.

| Layar | Node | File |
| --- | --- | --- |
| Peternak Dashboard | `12:1833` | [farmer-dashboard.png](screenshots/farmer-dashboard.png) |
| Peternak Booking | `12:2280` | [farmer-booking.png](screenshots/farmer-booking.png) |
| Dokter Dashboard | `46:7` | [vet-dashboard.png](screenshots/vet-dashboard.png) |
| Catatan Pemeriksaan | `46:19` | [vet-examination-note.png](screenshots/vet-examination-note.png) |
| Catatan Final | `46:21` | [vet-final-note.png](screenshots/vet-final-note.png) |
| Ketersediaan | `46:11` | [vet-availability.png](screenshots/vet-availability.png) |
| Pendapatan | `46:28` | [vet-earnings.png](screenshots/vet-earnings.png) |
| Tinjau Pencairan | `46:31` | [vet-withdrawal-review.png](screenshots/vet-withdrawal-review.png) |

Ini referensi dokumentasi, bukan assets untuk menggantikan UI screen. Gambar panjang/scroll hanya mencakup viewport. Tidak semua layar dan koneksi sudah diperiksa high-fidelity; pemeriksaan tiap layar dilakukan saat implementasi.

## Pemeriksaan saat FE-01

Pada 5 Oktober 2026, konteks dan screenshot komponen berhasil diambil untuk Peternak Primary `12:1666`, Dokter Button `75:2492`, Field `75:2509`, Status `75:2614`, dan frame Dokter Chat `46:16`. Konteks/screenshot Peternak Chat `12:2353` serta Logout Dialog `12:3184` tidak tersedia: Figma MCP mengembalikan batas panggilan Starter plan. Komponen Android kemudian diuji secara fisik pada HP; pembandingan dengan dua node yang tak terbaca tetap terbuka. Hasil perangkat dan batas viewport ada di [pemetaan FE-01](../../FIGMA_MAPPING.md).
