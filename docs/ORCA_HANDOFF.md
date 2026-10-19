# Handoff workflow Orca VetLink

Catatan ini dibuat pada **20 Oktober 2026, sekitar 00.12 WIB** agar pekerjaan dapat dilanjutkan setelah pergantian akun GPT. Ini snapshot, bukan pengganti status Orca/Git terkini. **Jangan membuat Run atau worker baru sebelum memeriksa state yang hidup.** Jangan menyimpan token, password, atau secret di dokumen ini.

## Identitas dan aturan tetap

- Repo utama: `/Users/howardgoh/Documents/KULIAH SEMESTER 5/VC/Vetlink`; branch integrasi `main`.
- Run Orca: `run_d18f19c5df52`. Gunakan CLI `orca` di host macOS ini; muat `orca skills get orchestration` dan `orca skills get orca-cli` sebelum mutasi siklus kerja.
- Maksimal **satu worker frontend dan satu worker backend** aktif, masing-masing di child worktree. Peluncuran worker harus eksplisit `--agent codex --model gpt-6-luna --effort max`. Jangan mengganti ke OpenCode/Claude.
- Jangan push kecuali pengguna meminta lagi. Jangan deploy, memakai provider produksi, membuat/mengirim secret, melakukan transaksi finansial nyata, atau memulai BE-17 tanpa arahan khusus. FE-03 tetap ditunda menurut DEC-23.
- Pengguna melarang emulator. Proses Pixel_7 sudah ditutup; jangan jalankan emulator, AVD, `adb` ke emulator, atau `npm run android` yang bisa memulainya. QA yang memerlukan sentuhan/perangkat tetap menjadi gate perangkat fisik. Jangan panggil Figma MCP; gunakan referensi lokal dan catat QA visual yang tertunda.
- Ikuti `AGENTS.md`, `docs/PRD.md`, `docs/TECH.md`, `docs/DATA_MODEL.md`, `docs/API_CONTRACT.md`, `docs/DECISIONS.md`, serta backlog. Khususnya jaga izin Dokter, catatan final imutabel, urutan kunjungan, konfirmasi completion, rupiah integer, idempotensi pembayaran/pencairan, dan fixture fiktif. Satu Peternak dapat memiliki banyak Farm (DEC-27).

## Snapshot integrasi

- `main` bersih setelah merge `396f5b8` (**BE-10 product catalog**). Sebelum merge, `main` berada 29 commit di depan `origin/main`; periksa ulang angka terkini dengan `git status --short --branch`. Merge FE-21 adalah `fabafbf`; merge BE-05 adalah `3ebc7db`. Tidak ada push pada rangkaian ini.
- FE-15–20 terintegrasi. Kode FE-21 review dan FE-26 banyak Farm telah digabungkan, tetapi tiketnya terblokir gate QA perangkat; jangan klaim acceptance Android lulus. FE-22 sedang dikerjakan. FE-23 masih siap dikerjakan; FE-24 adalah gate QA; FE-25 menunggu BE-16 dan FE-24.
- BE-00–08 serta BE-10 terintegrasi. BE-10 mempunyai katalog aktif, filter/cursor, harga rupiah dari DB, seed fiktif, dan validasi link rekomendasi. BE-09 dan BE-13/15 siap; BE-11 terbuka setelah BE-10. BE-12 bergantung BE-11; BE-14 bergantung BE-09/11/15; BE-16 bergantung seluruh slice BE-01–15 dalam scope.
- Bukti terbaru: FE-21 `npm run check` lulus 114 tes; build Android berhenti ketika unduhan Gradle 9.3.1 timeout, sehingga QA perangkat belum ada. BE-10 `npm run check`, 11 migrasi, seed tiga kali, dan `npm run api:smoke` lulus pada PostgreSQL 17.4 lokal sementara; kontainer dihentikan. Rincian aktual di `docs/TESTING.md`. Node tersedia 24.10.0, sedangkan `.nvmrc` API meminta 24.15.0 dan npm menampilkan peringatan engine.

## Worker dan gate saat snapshot

| Lane | Tiket | Task | Dispatch | Worktree | Keadaan |
| --- | --- | --- | --- | --- | --- |
| Frontend | FE-22 | `task_4418ed7eed12` | `ctx_9591da6d1daf` | `/Users/howardgoh/orca/workspaces/Vetlink/vetlink-fe22` | Codex GPT-6 Luna max aktif; sudah menerima larangan emulator |
| Backend | BE-10 | `task_da375d8dc451` | `ctx_87b786139d50` | `/Users/howardgoh/orca/workspaces/Vetlink/vetlink-be10` | `worker_done` sukses, diff ditinjau, commit `3981b5a` digabung ke `main`, terminal sudah dilepas dan delivery di-ack |

Gate pending: FE-24 `gate_4f4a203373eb`, FE-26 `gate_a45625245c55`, FE-21 `gate_cd625efb4b2d`. Semua memerlukan bukti perangkat/visual yang belum ada. Opsi emulator yang tercatat pada gate FE-24 sudah tidak berlaku karena instruksi pengguna terbaru melarangnya.

## Melanjutkan setelah pergantian akun

1. Buka repo utama; baca file ini dan dokumen acuan. Jalankan `git status --short --branch`, `orca status --json`, `orca skills get orchestration`, lalu `orca orchestration task-list --run run_d18f19c5df52 --json`, `orca orchestration worker-list --run run_d18f19c5df52 --include-remote --json`, dan `orca orchestration gate-list --run run_d18f19c5df52 --json`. Pastikan Run dan worker lama masih ada; **jangan meluncurkan duplikat** berdasarkan snapshot ini.
2. Baca inbox dengan `orca orchestration check --run run_d18f19c5df52 --json` atau tunggu dengan `--wait --types worker_done,escalation,question --timeout-ms 55000`. Proses setiap pesan pada delivery sebelum `--ack <delivery_id>`: jawab `question` via `orca orchestration reply --id ...`, tangani `escalation`, dan verifikasi `worker_done` terhadap Dispatch yang aktif.
3. Untuk worker selesai: cek `git status` di worktree, review diff/commit dan bukti, perbaiki temuan, gabungkan lokal ke `main`, lalu `orca orchestration worker-release --dispatch <dispatch_id> --json` dan ack delivery. Jika release/status tidak pasti, ikuti receipt dan referensi recovery Orca; jangan menebak proses sudah mati. Pertahankan perubahan worktree apa pun.
4. Setelah lane kosong, mulai tiket **ready** berikutnya di child worktree baru dengan `orca orchestration worker-start --run run_d18f19c5df52 --task <task_id> --worktree new-child --name vetlink-<tiket> --repo 'path:/Users/howardgoh/Documents/KULIAH SEMESTER 5/VC/Vetlink' --base-branch main --agent codex --model gpt-6-luna --effort max --json`. Konfirmasi receipt `state: ready` dan `launch.effective`. Kirim instruksi larangan emulator kepada setiap worker frontend baru melalui `orca orchestration send --to dispatch:<id> ...`.
5. Prioritas setelah BE-10: BE-11 (`task_bc53eed8aea0`) untuk membuka BE-12, lalu BE-09 (`task_1f55b8a55dda`), BE-15 (`task_45ba083200ce`), BE-13 (`task_e783529b0f95`), BE-12, BE-14, BE-16 sesuai dependency Orca. Setelah FE-22, FE-23 (`task_d0c73c0aa284`). FE-25 (`task_207a4c28c6dd`) baru setelah BE-16 dan FE-24 siap. Pilih ulang berdasarkan `task-list` aktual, bukan urutan ini bila state berubah.
6. Jalankan hanya script pemeriksaan yang ada pada manifest dan laporkan output yang benar-benar didapat. Perbarui backlog, README, `docs/TESTING.md`, serta file ini pada checkpoint bermakna. Jangan tandai QA perangkat lulus tanpa bukti.

Jika Orca tidak dapat diakses dari akun baru, **jangan membuat Run pengganti atau membuka worker duplikat**. Cek runtime/status dan worktree secara read-only, pertahankan perubahan, lalu laporkan kondisi tepatnya.
