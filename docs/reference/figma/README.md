# Bukti referensi Figma

Sumber utama: [Figma VetLink](https://www.figma.com/design/f1WBeG5S1OGXlPXyVEHjuW/Untitled), page `0:1` — `01 · VetLink / Prototype`. Diakses melalui konektor/MCP Figma pada 5 Oktober 2026. Tidak ada perubahan pada file Figma. Untuk FE-07, link terbaru dari pengguna adalah [VetLink — Dokter / Tampilan dan interaksi](https://www.figma.com/design/TPG6qZunK9EY4z1Vy0GKDx/Untitled?node-id=93-7181&t=hYv9JEpqvZmEonSz-); cakupan link itu dicatat terpisah di [Figma mapping](../../FIGMA_MAPPING.md).

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

Pada 5 Oktober 2026, konteks dan screenshot komponen berhasil diambil untuk Peternak Primary `12:1666`, Dokter Button `75:2492`, Field `75:2509`, Status `75:2614`, dan frame Dokter Chat `46:16`. Chat Peternak `12:2353` dan Logout Dialog `12:3184` sebelumnya tertunda, lalu berhasil diperiksa dari link terbaru. Referensi ini sudah terbaca, tetapi tidak tersedia screenshot Android produk untuk pixel-match kedua screen; bukti lama hanya mencakup galeri komponen development.

## Pemeriksaan FE-07 pada link terbaru

`get_design_context` untuk frame besar Dokter `93:7181` mengembalikan metadata ringkas; child nodes dipakai untuk mengambil konteks dan screenshot yang relevan. High-fidelity context serta screenshot 390 × 844 ditinjau untuk daftar pasien `80:4594`, detail `80:4726`, vaksin `80:4759`, obat `80:4786`, dan catatan final `80:4842`. Gambar diperiksa inline di sesi QA; PNG baru belum disimpan lokal.

Panggilan ke riwayat Peternak `12:2032`, `12:2068`, dan `12:2132` terkena rate limit Starter; `12:2100` sempat terbaca. `figma_whoami` menyatakan plan tier Starter dan seat View. Error rate limit berbeda dari sesi terdahulu yang mengembalikan `-32001: Unknown tool`: sesi terdahulu berarti MCP tool tidak tersedia, sedangkan link terbaru berhasil mengakses node Dokter dan tidak menunjukkan error autentikasi/izin file. Rincian error persis ada di [pemetaan FE-07](../../FIGMA_MAPPING.md).

## Keterbatasan acuan FE-06 dan riwayat Peternak

Pemeriksaan ulang FE-06 untuk node daftar `12:1889` pada file utama gagal dengan pesan izin edit file; screenshot node juga gagal. Link terbaru untuk node yang sama terkena limit panggilan Starter. Tidak ada screenshot FE-06 yang berhasil diambil. Atas arahan pengguna, UI FE-06 dan riwayat Peternak FE-07 dirancang mandiri memakai tokens dan kontrak fitur, kemudian selisih terhadap Figma dicatat di [Figma mapping](../../FIGMA_MAPPING.md). Screenshot Figma tidak digunakan sebagai UI aplikasi.

## Keterbatasan acuan FE-08

Doctor List `12:2161`, Filter Sheet `12:2215`, dan Doctor Profile `12:2245` berasal dari mapping file utama. Skill design-to-code sudah dibaca dan context/screenshot daftar diminta; file utama menolak izin edit, sedangkan request pada link terbaru berhenti karena kuota Starter. Node FE-08 pada link terbaru belum dapat dikonfirmasi. Tidak ada PNG acuan FE-08 yang berhasil diperoleh. UI direktori/profil dirancang mandiri sesuai arahan pengguna, memakai tokens/Inter/Lucide serta aturan fitur. Error persis dan perbedaan terhadap acuan dijelaskan pada [pemetaan FE-08](../../FIGMA_MAPPING.md).


## Keterbatasan acuan FE-09

Booking `12:2280` dicoba ulang melalui context dan screenshot setelah skill design-to-code dibaca. File utama menolak izin edit; link terbaru mengembalikan kuota Starter, sehingga keberadaan node pada link terbaru belum dapat dipastikan. Referensi lama farmer-booking.png ditinjau untuk struktur, tetapi tidak menggantikan inspeksi terkini. UI booking/review dibuat mandiri sesuai arahan pengguna; error persis dan selisih fungsi/visual ada di [pemetaan FE-09](../../FIGMA_MAPPING.md). Tidak ada screenshot Figma terbaru yang berhasil diperoleh.
