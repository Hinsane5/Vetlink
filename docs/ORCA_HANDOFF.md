# Handoff workflow Orca VetLink

Catatan ini diperbarui pada **20 Oktober 2026, sekitar 06.16 WIB** agar pekerjaan dapat dilanjutkan setelah pergantian akun GPT. Ini snapshot, bukan pengganti status Orca/Git terkini. **Jangan membuat Run atau worker baru sebelum memeriksa state yang hidup.** Jangan menyimpan token, password, atau secret di dokumen ini.

## Identitas dan aturan tetap

- Repo utama: `/Users/howardgoh/Documents/KULIAH SEMESTER 5/VC/Vetlink`; branch integrasi `main`.
- Run Orca: `run_d18f19c5df52`. Gunakan CLI `orca` di host macOS ini; muat `orca skills get orchestration` dan `orca skills get orca-cli` sebelum mutasi siklus kerja.
- Maksimal **satu worker frontend dan satu worker backend** aktif, masing-masing di child worktree. Peluncuran worker harus eksplisit `--agent codex --model gpt-6-luna --effort max`. Jangan mengganti ke OpenCode/Claude.
- Jangan push kecuali pengguna meminta lagi. Jangan deploy, memakai provider produksi, membuat/mengirim secret, melakukan transaksi finansial nyata, atau memulai BE-17 tanpa arahan khusus. FE-03 tetap ditunda menurut DEC-23.
- Pengguna melarang emulator. Proses Pixel_7 sudah ditutup; jangan jalankan emulator, AVD, `adb` ke emulator, atau `npm run android` yang bisa memulainya. QA yang memerlukan sentuhan/perangkat tetap menjadi gate perangkat fisik. Jangan panggil Figma MCP; gunakan referensi lokal dan catat QA visual yang tertunda.
- Ikuti `AGENTS.md`, `docs/PRD.md`, `docs/TECH.md`, `docs/DATA_MODEL.md`, `docs/API_CONTRACT.md`, `docs/DECISIONS.md`, serta backlog. Khususnya jaga izin Dokter, catatan final imutabel, urutan kunjungan, konfirmasi completion, rupiah integer, idempotensi pembayaran/pencairan, dan fixture fiktif. Satu Peternak dapat memiliki banyak Farm (DEC-27).

## Snapshot integrasi

- `main` bersih setelah merge FE-23 dan BE-12 `8b21c27` serta review FE-23 `5aa839e`; saat itu 45 commit di depan `origin/main`. Periksa ulang angka terkini dengan `git status --short --branch`. Merge FE-22 adalah `da22073`; BE-11 `7b96d05`. Tidak ada push pada rangkaian ini.
- FE-15–20 terintegrasi. Kode FE-21 review, FE-22 inbox/pengaturan, FE-23 penghasilan/pencairan, dan FE-26 banyak Farm sudah digabungkan, tetapi tiketnya terblokir gate QA perangkat; jangan klaim acceptance Android lulus. Pemeriksaan lokal FE-24 mulai dicatat; FE-25 menunggu BE-16 dan FE-24.
- BE-00–08 dan BE-10–12 terintegrasi. BE-12 mempunyai shipment timeline owner-only dan adapter fiktif. BE-15 sedang dikerjakan; BE-09/13 siap. BE-14 bergantung BE-09/11/15; BE-16 bergantung seluruh slice BE-01–15 dalam scope.
- Bukti terbaru: FE-23 `npm run check` lulus 126 tes setelah cache npm dibersihkan dari kegagalan `ENOSPC`; QA perangkat belum ada. BE-12 `npm run check` dan `npm run api:smoke` lulus pada PostgreSQL 17.4 lokal, lalu DB dihentikan. Pemeriksaan lokal FE-24 mencakup `git diff --check` dan pencarian kontrol contoh di folder UI; perangkat/visual tetap gate. Rincian aktual di `docs/TESTING.md`. Node tersedia 24.10.0, sedangkan `.nvmrc` API meminta 24.15.0.

## Worker dan gate saat snapshot

| Lane | Tiket | Task | Dispatch | Worktree | Keadaan |
| --- | --- | --- | --- | --- | --- |
| Frontend | Tidak ada worker aktif | — | — | — | FE-24 lokal dikerjakan koordinator; perangkat fisik tetap gate |
| Backend | BE-15 | `task_45ba083200ce` | `ctx_32b5e9090cac` | `/Users/howardgoh/orca/workspaces/Vetlink/vetlink-be15` | Codex GPT-6 Luna max aktif setelah retry pada worktree yang sama |

FE-23 dan BE-12: `worker_done` sukses, commit `87dad31` dan `abe7b91` ditinjau, digabung ke `main`, terminal dilepas dan delivery di-ack. FE-23 mempunyai gate QA `gate_9ce874fa0861`. Start BE-15 pertama `ctx_ba21381bcc31` gagal pada `agent_readiness: timeout`; receipt menyatakan Task belum berjalan. Terminal dilepas, worktree diperiksa bersih, lalu retry sukses sebagai `ctx_32b5e9090cac`. Jangan meluncurkan duplikat lain.

Keputusan koordinasi BE-11 (`msg_5f02a1775a30`, dijawab): gunakan route cart/quote/order dalam `docs/API_CONTRACT.md`. Quote dan order membaca ulang cart, produk aktif/harga integer, dan alamat milik Peternak. Jika quote stale, API mengembalikan 409 tanpa membuat order; client membuat quote baru untuk meninjau harga/alamat/ongkir terbaru. `Idempotency-Key` mengikat actor dan payload; retry identik mengembalikan order sama, payload berbeda ditolak. Snapshot order dan pengosongan cart atomik. Tanpa provider atau uang nyata.

Keputusan koordinasi BE-12 (`msg_8fc677b52428`, dijawab): ikuti route kontrak yang sudah ada `GET /v1/orders/{id}/shipment` untuk owner, dengan timeline dalam respons. Adapter pengiriman lokal hanya berjalan setelah pembayaran sukses tersimpan; pending/failed tidak menaikkan status order. Status sukses harus berurutan dan event ID dideduplikasi. Event adapter internal, tanpa callback publik atau kurir/provider produksi.

Gate pending: FE-24 `gate_4f4a203373eb`, FE-26 `gate_a45625245c55`, FE-21 `gate_cd625efb4b2d`, FE-22 `gate_87b5163ee1f1`, FE-23 `gate_9ce874fa0861`. Semua memerlukan bukti perangkat/visual yang belum ada. Opsi emulator yang tercatat pada gate FE-24 sudah tidak berlaku karena instruksi pengguna terbaru melarangnya.

## Melanjutkan setelah pergantian akun

1. Buka repo utama; baca file ini dan dokumen acuan. Jalankan `git status --short --branch`, `orca status --json`, `orca skills get orchestration`, lalu `orca orchestration task-list --run run_d18f19c5df52 --json`, `orca orchestration worker-list --run run_d18f19c5df52 --include-remote --json`, dan `orca orchestration gate-list --run run_d18f19c5df52 --json`. Pastikan Run dan worker lama masih ada; **jangan meluncurkan duplikat** berdasarkan snapshot ini.
2. Baca inbox dengan `orca orchestration check --run run_d18f19c5df52 --json` atau tunggu dengan `--wait --types worker_done,escalation,question --timeout-ms 55000`. Proses setiap pesan pada delivery sebelum `--ack <delivery_id>`: jawab `question` via `orca orchestration reply --id ...`, tangani `escalation`, dan verifikasi `worker_done` terhadap Dispatch yang aktif.
3. Untuk worker selesai: cek `git status` di worktree, review diff/commit dan bukti, perbaiki temuan, gabungkan lokal ke `main`, lalu `orca orchestration worker-release --dispatch <dispatch_id> --json` dan ack delivery. Jika release/status tidak pasti, ikuti receipt dan referensi recovery Orca; jangan menebak proses sudah mati. Pertahankan perubahan worktree apa pun.
4. Setelah lane kosong, mulai tiket **ready** berikutnya di child worktree baru dengan `orca orchestration worker-start --run run_d18f19c5df52 --task <task_id> --worktree new-child --name vetlink-<tiket> --repo 'path:/Users/howardgoh/Documents/KULIAH SEMESTER 5/VC/Vetlink' --base-branch main --agent codex --model gpt-6-luna --effort max --json`. Konfirmasi receipt `state: ready` dan `launch.effective`. Kirim instruksi larangan emulator kepada setiap worker frontend baru melalui `orca orchestration send --to dispatch:<id> ...`.
5. Setelah BE-15, lanjutkan BE-09 (`task_1f55b8a55dda`), BE-13 (`task_e783529b0f95`), BE-14, lalu BE-16 sesuai dependency Orca. FE-24 lokal sudah dimulai, tetapi QA perangkat fisik tetap gate. FE-25 (`task_207a4c28c6dd`) baru setelah BE-16 dan FE-24 siap. Pilih ulang berdasarkan `task-list` aktual, bukan urutan ini bila state berubah.
6. Jalankan hanya script pemeriksaan yang ada pada manifest dan laporkan output yang benar-benar didapat. Perbarui backlog, README, `docs/TESTING.md`, serta file ini pada checkpoint bermakna. Jangan tandai QA perangkat lulus tanpa bukti.

Jika Orca tidak dapat diakses dari akun baru, **jangan membuat Run pengganti atau membuka worker duplikat**. Cek runtime/status dan worktree secara read-only, pertahankan perubahan, lalu laporkan kondisi tepatnya.
