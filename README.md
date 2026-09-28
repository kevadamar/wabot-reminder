# WhatsApp Task & Reminder Bot

Bot WhatsApp pintar berbasis **Bun** dan **Baileys (v7)** yang membantu mencatat to-do list dari pesan langsung maupun pesan yang diteruskan (*forwarded*), mengekstrak deadline menggunakan **Gemini AI** (dengan fallback lokal), memberikan pengingat adaptif otomatis, dan merayakan penyelesaian tugas dengan afirmasi positif dinamis.

---

## 🌟 Fitur Utama

- 📥 **Pencatatan Tugas Cerdas**: Cukup kirim atau *forward* pesan ke bot, contoh:
  - *"Besok jam 2 siang ada jadwal meeting dengan klien"*
  - *"Ingatkan bayar tagihan listrik nanti malam jam 8"*
- 📎 **Lampiran Dokumen & Gambar Aman (Multi-layer Security)**:
  - Dukungan melampirkan foto (JPG, PNG, WebP) atau dokumen (PDF).
  - **Layer 1 (Magic Bytes Inspection):** Memverifikasi signature biner file via `file-type`, menolak format berbahaya seperti SVG/XML (vektor XSS) dan executable.
  - **Layer 2 (Content Disarming & Reconstruction - CDR):** Sanitasi gambar via `sharp` yang menghapus metadata sensitif EXIF/GPS dan menormalkan pixel.
  - **Layer 3 (Multimodal AI Screening & OCR):** Analisis cerdas Gemini Vision untuk mendeteksi potensi scam/phishing/manipulasi bukti transfer serta ekstraksi teks otomatis (OCR).
  - **Layer 4 (S3 Rust FS & Sandboxed Storage):** Terintegrasi langsung dengan S3-compatible Object Storage (Rust FS / MinIO) antar-container Docker maupun storage lokal terisolasi berizin `0o600`.
  - **Direct Media Reminder:** Ketika jadwal pengingat tugas berbunyi di WhatsApp, bot langsung mengirimkan foto/PDF secara otomatis dengan teks pengingat sebagai caption!
- 🌿 **Hierarchical / Nested Tasks (Tugas Induk & Sub-tugas)**:
  - Buat sub-tugas mandiri di bawah tugas utama, masing-masing dengan deadline dan pengingat sendiri.
  - Tampilan daftar pohon rapi pada `/list` dan `detail <ID>`.
  - Pembatalan kaskade (*cascade cancellation*) otomatis saat tugas induk dibatalkan.
- 🔄 **Pengubahan Jadwal & Judul Fleksibel (Quoted Reply)**:
  - Cukup balas (quote) pesan pengingat/tugas dengan `ubah waktu: <waktu baru>` atau `ubah tugas: <judul baru>`.
  - Tambah sub-tugas cukup dengan membalas `subtask: <nama & waktu>`.
- 📜 **Audit Trail & Riwayat Perubahan (`task_history`)**:
  - Seluruh mutasi (pembuatan, perubahan jadwal, ganti judul, lampiran, penyelesaian) dicatat di PostgreSQL dan dapat dicek via `riwayat <ID>`.
- 🧠 **NLP Bahasa Indonesia (3-Tier Resilient Architecture)**:
  1. **Tier 1 (Cloud)**: Google Gemini Flash dengan kesadaran konteks waktu dinamis.
  2. **Tier 2 (Host CLI Fallback)**: **Antigravity CLI** (`agy`) bridge port 7860 jika API Gemini limit atau bermasalah.
  3. **Tier 3 (Local Offline Fallback)**: Mesin regex komprehensif Bahasa Indonesia + `chrono-node` dengan kesadaran timezone (WIB/WITA/WIT). Bot **tidak pernah drop pesan atau crash** meski tanpa internet ke Google AI!
- ⏰ **Pengingat Ramah & Adaptif**: Otomatis mengirimkan pengingat 30 menit atau 15 menit sebelum deadline dengan nada bersahabat (bukan gaya penagih hutang).
- ✅ **Penyelesaian Fleksibel**: Cukup beri reaksi emoji **✅** di balon pesan bot WhatsApp, balas pesan dengan emoji ✅, atau ketik `selesai <ID>`.
- 🎉 **Afirmasi Positif Dinamis**: Merayakan setiap tugas yang selesai dengan pujian gaul dan memotivasi dari AI.
- 🐘 **PostgreSQL & Drizzle ORM**: Skema database yang scalable, terstruktur, dan mudah dikelola melalui pgAdmin atau TablePlus.
- 🔒 **Akses Aman (Whitelist)**: Hanya nomor yang terdaftar di tabel `user_settings` (atau `OWNER_NUMBER` di `.env`) yang dapat menggunakan bot.

---

## 🛠️ Tech Stack

- **Runtime**: [Bun](https://bun.sh/)
- **WhatsApp Client**: `@whiskeysockets/baileys` (v7 Native WebSockets)
- **Database**: PostgreSQL (v16) via [Drizzle ORM](https://orm.drizzle.team/) & `postgres.js`
- **AI / NLP**: `@google/genai` (Gemini 1.5 Flash) + Antigravity CLI (`agy`) + `chrono-node`

---

## 📚 Dokumentasi Lengkap

- 🏛️ **[Arsitektur Sistem & Diagram Data Flow](docs/ARCHITECTURE.md)**: Diagram arsitektur Mermaid, sequence diagram, data flow, dan ERD PostgreSQL.
- 📖 **[Glosarium & Domain Model](CONTEXT.md)**: Istilah kanonik domain (`Task`, `Deadline`, `Reminder Time`, `User Settings`).
- 🤖 **[Panduan AI Agent (AGENTS.md)](AGENTS.md)**: Petunjuk pengembangan, standard coding, dan seam pengujian untuk AI developer.
- 📝 **[Product Requirements Document (PRD)](docs/PRD-to-do-bot-reminder.md)**: Spesifikasi fungsional dan teknis awal.
- 📐 **Architecture Decision Records (ADR)**:
  - [ADR 0001: Penggunaan PostgreSQL menggantikan SQLite](docs/adr/0001-postgresql-for-task-storage.md)
  - [ADR 0002: Penyimpanan Konfigurasi Dinamis di Database](docs/adr/0002-database-backed-settings.md)

---

## 🚀 Panduan Memulai

### 1. Prasyarat
- [Bun](https://bun.sh/) (v1.2+)
- PostgreSQL yang sedang berjalan (misal Docker container `postgres_16`)

### 2. Konfigurasi Lingkungan (`.env`)
Salin file `.env.example` ke `.env`:
```bash
cp .env.example .env
```
Sesuaikan nilainya:
```env
# Koneksi Database
DATABASE_URL=postgres://postgres:postgres@localhost:5432/todo_bot

# API Key Google Gemini (Dapatkan gratis di https://aistudio.google.com/)
GEMINI_API_KEY=your_gemini_api_key_here

# Nomor WhatsApp Anda (Format internasional tanpa '+', contoh: 628123456789)
OWNER_NUMBER=628123456789

# Zona Waktu
TIMEZONE=Asia/Jakarta

# Lead Time Pengingat Default (Menit)
DEFAULT_REMINDER_LEAD_MINUTES=30

# Dashboard read-only (opsional, default nonaktif)
DASHBOARD_ENABLED=false
DASHBOARD_HOST=127.0.0.1
DASHBOARD_PORT=3080
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=use-a-random-password-at-least-16-chars
```

### 3. Migrasi Database
Terapkan skema tabel ke PostgreSQL:
```bash
bun run db:push
```

### 4. Menjalankan Bot
Jalankan bot:
```bash
bun run start
```
Atau dalam mode development dengan hot reload:
```bash
bun run dev
```

Saat pertama kali dijalankan, **QR Code** akan muncul di terminal. Pindai (scan) QR code tersebut menggunakan aplikasi WhatsApp di HP Anda (*Perangkat Tertaut / Linked Devices*). Sesi login akan disimpan secara aman di folder `./auth_info`.

---

## 💬 Perintah & Panduan Interaksi WhatsApp

### 📌 1. Format Perintah Langsung
| Perintah | Deskripsi | Contoh |
| :--- | :--- | :--- |
| `<Pesan Tugas>` | Mencatat tugas baru otomatis | *"Besok jam 2 siang meeting dengan vendor"* |
| `<Kirim Foto / PDF>` | Lampirkan file (disaring & di-OCR aman) | Kirim dokumen proposal + caption *"Review proposal lusa jam 10"* |
| `/list` atau `daftar` | Menampilkan seluruh tugas aktif & pohon sub-tugas | `daftar` |
| `detail <ID>` / `tree <ID>` | Melihat detail tugas, lampiran, dan daftar sub-tugas | `detail 5` |
| `riwayat <ID>` | Melihat audit trail / riwayat perubahan tugas | `riwayat 5` |
| `subtask <ID> <teks>` | Menambahkan sub-tugas langsung ke ID tugas utama | `subtask 5 Siapkan materi slide jam 9 pagi` |
| `/selesai <ID>` | Menandai tugas telah selesai & afirmasi positif | `selesai 5` |
| `/batal <ID>` | Membatalkan tugas beserta sub-tugas aktifnya | `batal 5` |
| `/pagi aktif` | Mengaktifkan ringkasan task harian (default 06:00 lokal) | `/pagi aktif` |
| `/pagi nonaktif` | Menonaktifkan ringkasan pagi tanpa menghapus waktu pilihan | `/pagi nonaktif` |
| `/pagi waktu HH:mm` | Mengatur waktu lokal ringkasan pagi | `/pagi waktu 06:30` |
| `/pagi status` | Melihat status, waktu, dan timezone ringkasan pagi | `/pagi status` |
| `/username <Nama>` | Mengatur nama panggilan agar sistem mengenali pengguna | `/username Keva` |
| `/username` | Mengecek nama panggilan yang tersimpan saat ini | `/username` |
| `/setting media` | Mengecek status kualitas gambar lampiran saat ini | `/setting media` |
| `/setting media tinggi` | Kualitas tinggi (Maks 4K / 4096px, default, quality 85) | `/setting media tinggi` |
| `/setting media hemat` | Kualitas hemat (Maks 2K / 2048px, quality 85) | `/setting media hemat` |
| `/help` atau `bantuan` | Menampilkan panduan lengkap interaksi | `bantuan` |

Ringkasan pagi bersifat **opt-in** (default-nya nonaktif). Saat aktif, bot mengirimkan sapaan personal sesuai nama pengguna (`/username`), rekap tugas selesai kemarin (`📊 Kemarin: X tugas selesai 🎉`), pengingat ramah untuk tugas terlewat/overdue (maksimal 3 tugas teratas dengan saran aksi cepat dan ajakan cek `list`), serta agenda tugas hari ini lengkap dengan ID tugas. Bot hanya memanggil AI ketika minimal satu user aktif benar-benar due. Satu pantun pendek di-cache per tanggal dan dipakai ulang; jika AI timeout atau gagal, bot langsung memakai pantun lokal.

Kualitas gambar lampiran default-nya adalah **tinggi (high / 4K max)** dengan sanitasi CDR (menghapus GPS/EXIF dan proteksi pixel flood). Pengguna dapat mengubahnya menjadi hemat (2K max) kapan saja via `/setting media hemat`.

### 🔄 2. Format Balas Pesan (Quoted Reply)
Pengguna dapat langsung mengutip (quote/reply) balon pesan bot untuk melakukan perubahan cepat:
- **Pengingat Terakhir (15 Menit Setelah Deadline)**:
  > Jika target waktu terlewat 15 menit, bot mengirimkan pengingat terakhir bernada empati dengan saran tindakan:
  > - Balas `1` / `1️⃣` ➔ Tambah waktu ekstra +30 menit.
  > - Balas `2` / `2️⃣` ➔ Tambah waktu ekstra +1 jam.
  > - Balas `3` / `3️⃣` ➔ Tunda ke besok pagi (09:00).
  > - Balas `buat lagi` ➔ Menampilkan pilihan perpanjangan waktu agar tugas tidak ke-skip.
  > - Balas `selesai` (atau reaksi ✅) ➔ Tandai selesai.
  > - Balas `batal` (atau reaksi ❌) ➔ Batalkan tugas.
- **Mengubah Waktu / Jadwal Bebas**:
  > Balas pesan tugas: `ubah waktu: besok jam 15:00` atau `reschedule: lusa jam 10 pagi`
  > *(Sistem otomatis menghitung ulang alarm pengingat dan me-reset status pengingat)*
- **Mengubah Judul / Nama Tugas**:
  > Balas pesan tugas: `ubah tugas: Revisi Pitch Deck Presentasi`
- **Menambahkan Sub-Tugas**:
  > Balas pesan tugas: `subtask: Kirim tautan zoom besok jam 09:30`
- **Menyelesaikan / Membatalkan Cepat**:
  > Beri reaksi emoji **✅** (selesai) atau **❌** (batal) pada pesan pengingat, atau balas pesan dengan teks `selesai` / `batal`.

---

## 🧪 Menjalankan Pengujian (TDD)

Proyek ini dibangun mengikuti prinsip TDD pada 5 seam publik:
```bash
# Jalankan seluruh test suite
bun test

# Pengecekan tipe TypeScript
bun run typecheck
```

---

## 🐳 Menjalankan dengan Docker

```bash
docker compose up -d --build
```
Log dan QR code dapat dilihat melalui:
```bash
docker compose logs -f bot
```

---

## 🚀 Panduan Deployment di Dokploy

Codebase ini **100% didukung dan kompatibel dengan Dokploy**. Berikut langkah mudah men-deploy-nya di dashboard Dokploy Anda:

### 1. Buat Service di Dokploy
1. Buka dashboard Dokploy Anda -> Pilih **Projects** -> Buat/Pilih Project.
2. Tambahkan **Application** baru:
   - **Source:** Git (hubungkan repositori GitHub/GitLab Anda).
   - **Build Type:** Pilih **Dockerfile** (otomatis mendeteksi `Dockerfile` dan `.dockerignore` di root proyek).

### 2. Atur Persistent Volume (Sangat Penting! ⚠️)
Agar sesi login WhatsApp tidak hilang saat container di-*restart* atau di-*redeploy*:
1. Di menu aplikasi Dokploy, buka tab **Volumes**.
2. Tambahkan Volume:
   - **Mount Path:** `/app/auth_info`
   - **Host Path / Named Volume:** `todo-bot-auth` (atau path direktori di host VPS Anda).

### 3. Konfigurasi Environment Variables
Buka tab **Environment** di Dokploy dan masukkan variabel berikut:
```env
DATABASE_URL=postgres://user:password@host:5432/todo_bot
GEMINI_API_KEY=your_gemini_api_key
OWNER_NUMBER=628123456789
TIMEZONE=Asia/Jakarta
DEFAULT_REMINDER_LEAD_MINUTES=30

# Dashboard monitoring read-only (opsional)
DASHBOARD_ENABLED=false
DASHBOARD_HOST=127.0.0.1
DASHBOARD_PORT=3080
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=replace-with-a-random-password-at-least-16-chars
TELEMETRY_FLUSH_INTERVAL_MS=60000

# Konfigurasi Storage Lampiran (S3 Rust FS / MinIO)
STORAGE_DRIVER=s3
S3_ENDPOINT=http://rust-s3:9000
S3_BUCKET=todo-attachments
S3_ACCESS_KEY=your_s3_access_key
S3_SECRET_KEY=your_s3_secret_key
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
```
> **Tips S3 Rust FS di Dokploy / Docker Network:** Karena container bot dan container S3 Rust Anda berada di mesin VPS yang sama dalam Docker network, Anda cukup menggunakan hostname container S3 (misal: `http://rust-s3:9000`). Latensi akses file instan (<5ms) dan data 100% aman di server sendiri.
> **Tips Database di Dokploy:** Jika Anda menggunakan fitur *PostgreSQL Database* bawaan Dokploy, Anda bisa memasukkan koneksi internal Docker network Dokploy secara langsung ke `DATABASE_URL`.

### Dashboard monitoring

Dashboard tidak aktif sampai `DASHBOARD_ENABLED=true` dan username/password valid tersedia. Default bind `127.0.0.1` hanya cocok bila tunnel/proxy berjalan di host atau network namespace yang sama. Untuk container yang diakses melalui private reverse proxy, gunakan `DASHBOARD_HOST=0.0.0.0`, jangan publish port langsung ke internet, dan tempatkan endpoint di belakang HTTPS serta Cloudflare Access/VPN.

Dashboard hanya menyediakan aggregate task status, adoption, storage, runtime health, telemetry 24 jam, dan error code tersanitasi. JID, isi task/pesan, prompt/response AI, OCR text, nama file, serta storage path tidak dikirim ke UI.

### 4. Deploy & Scan QR Code
1. Klik **Deploy**.
2. Skema database akan otomatis diterapkan (`initDb()` dan migrasi) pada saat container pertama kali menyala.
3. Buka tab **Deployments** / **Logs** di Dokploy:
   - Anda akan melihat **QR Code WhatsApp** tercetak di log real-time Dokploy.
   - Pindai QR Code tersebut menggunakan WhatsApp di HP (*Perangkat Tertaut*).
   - Begitu terhubung, bot akan langsung aktif berjalan 24/7!

---

## ⚡ Setup Antigravity CLI Host Bridge (Opsional)

Jika Anda sudah menginstal **Antigravity CLI** (`agy`) di VPS/Host server (di luar Docker container) dan ingin menggunakannya sebagai fallback cerdas saat API Gemini terkena kuota/limit:

1. **Jalankan Bridge Script di Host OS**:
   ```bash
   bun run scripts/antigravity-bridge.ts
   ```
   *Atau jalankan sebagai background service menggunakan PM2:*
   ```bash
   pm2 start scripts/antigravity-bridge.ts --name agy-bridge --interpreter bun
   ```
   Bridge ini akan mendengarkan request HTTP di `http://0.0.0.0:7860`.

2. **Hubungkan Container Dokploy ke Host**:
   Di tab **Environment** Dokploy, tambahkan:
   ```env
   ANTIGRAVITY_BRIDGE_URL=http://host.docker.internal:7860
   ```
   *(Container akan otomatis memanggil bridge ini jika Gemini API tidak tersedia atau error)*.
