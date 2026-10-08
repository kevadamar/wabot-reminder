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
- 🧠 **NLP Bahasa Indonesia (rantai provider yang bisa diatur)**:
  1. Urutan provider dibaca dari env (`LLM_CHAIN_NLP`). Default-nya tetap Gemini, lalu Antigravity bridge jika URL-nya diisi, lalu parser lokal.
  2. Provider lain yang bicara Chat Completions (OpenAI, OpenRouter, Groq, Ollama) masuk lewat `OPENAI_BASE_URL`. Anthropic opsional.
  3. **Fallback lokal**: regex Bahasa Indonesia + `chrono-node` dengan timezone (WIB/WITA/WIT). Bot tetap memproses pesan kalau semua provider gagal.
- ⏰ **Pengingat Ramah, Adaptif & Fleksibel**:
  - Secara default mengingatkan sesuai konfigurasi pengguna (default 10–30 menit sebelum deadline).
  - Mendukung penentuan waktu pengingat khusus per tugas langsung dari bahasa alami (contoh: *"ingatkan 30 menit sebelumnya"*, *"ingatkan 1 jam sebelum"*, *"ingatkan H-1"*).
  - Pengingat darurat otomatis (*overdue alert*) jika tugas melewati deadline tanpa diselesaikan.
  - Nada pengingat bersahabat dan memotivasi (bukan gaya penagih hutang).
- ✅ **Penyelesaian Fleksibel**: Cukup beri reaksi emoji **✅** di balon pesan bot WhatsApp, balas pesan dengan emoji ✅, atau ketik `selesai <ID>`.
- 🎉 **Afirmasi Positif Dinamis**: Merayakan setiap tugas yang selesai dengan pujian gaul dan memotivasi dari AI.
- 🐘 **PostgreSQL & Drizzle ORM**: Skema database yang scalable, terstruktur, dan mudah dikelola melalui pgAdmin atau TablePlus.
- 🔒 **Akses Aman (Whitelist)**: Hanya nomor yang terdaftar di tabel `user_settings` (atau `OWNER_NUMBER` di `.env`) yang dapat menggunakan bot.

---

## 🛠️ Tech Stack

- **Runtime**: [Bun](https://bun.sh/)
- **WhatsApp Client**: `@whiskeysockets/baileys` (v7 Native WebSockets)
- **Database**: PostgreSQL (v16) via [Drizzle ORM](https://orm.drizzle.team/) & `postgres.js`
- **AI / NLP**: rantai provider (Gemini, OpenAI-compatible, Anthropic, Antigravity CLI) + `chrono-node`

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
DEFAULT_REMINDER_LEAD_MINUTES=10

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
| `<Pesan Tugas>` | Mencatat tugas baru otomatis (mendukung lead time pengingat kustom) | *"Besok jam 2 siang meeting dengan vendor, ingatkan 30 menit sebelumnya"* atau *"Lusa jam 10 pagi kirim berkas, ingatkan H-1"* |
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
| `/setting reminder <menit>` | Mengatur lead time pengingat awal default sebelum deadline (1–1440 m) | `/setting reminder 10` |
| `/setting reminder` | Mengecek lead time pengingat yang aktif saat ini | `/setting reminder` |
| `/setting media` | Mengecek status kualitas gambar lampiran saat ini | `/setting media` |
| `/setting media tinggi` | Kualitas tinggi (Maks 4K / 4096px, default, quality 85) | `/setting media tinggi` |
| `/setting media hemat` | Kualitas hemat (Maks 2K / 2048px, quality 85) | `/setting media hemat` |
| `/help` atau `bantuan` | Menampilkan panduan lengkap interaksi | `bantuan` |

Ringkasan pagi bersifat **opt-in** (default-nya nonaktif). Saat aktif, bot mengirimkan sapaan personal sesuai nama pengguna (`/username`), rekap tugas selesai kemarin (`📊 Kemarin: X tugas selesai 🎉`), pengingat ramah untuk tugas terlewat/overdue (maksimal 3 tugas teratas dengan saran aksi cepat dan ajakan cek `list`), serta agenda tugas hari ini lengkap dengan ID tugas. Bot hanya memanggil AI ketika minimal satu user aktif benar-benar due. Satu pantun pendek di-cache per tanggal dan dipakai ulang; jika AI timeout atau gagal, bot langsung memakai pantun lokal.

Lead time pengingat awal default-nya adalah **10 menit** sebelum deadline (dapat disesuaikan secara dinamis via `/setting reminder <menit>` atau melalui `DEFAULT_REMINDER_LEAD_MINUTES` di environment). Selain itu, pengguna dapat menentukan waktu pengingat **khusus per tugas** langsung dalam bahasa alami, misalnya:
- *"ingatkan 15 menit sebelumnya"* / *"ingatkan 45 menit sebelum"* (satuan menit)
- *"ingatkan 1 jam sebelumnya"* / *"ingatkan 2 jam sebelum"* (satuan jam)
- *"ingatkan H-1"* / *"ingatkan 1 hari sebelumnya"* (satuan hari)

Jika sisa waktu ke deadline kurang dari atau sama dengan lead time pengingat, pengingat akan dikirim tepat pada waktu deadline. Jika lead time diatur ke 30 menit atau lebih dan jarak tugas 30–120 menit tanpa spesifikasi eksplisit, bot adaptif mengirimkan pengingat 15 menit sebelum deadline.

Nama tugas, sub-tugas, dan judul baru (`ubah tugas:`) minimal berisi **3 huruf** (angka, emoji, dan tanda baca tidak dihitung). Jika kurang, bot tidak menyimpannya dan meminta pengguna mengirim ulang dengan nama yang lebih jelas.

Jika tugas baru punya jadwal yang **sama persis (sampai menit)** dengan tugas aktif lain, bot tidak langsung menyimpannya, tapi menanyakan dulu dengan santai karena dua pengingat bakal datang barengan. Balas *gas* / *ya* untuk tetap mencatat, kirim jam lain (cth: *jam 14:30*) untuk menggeser, atau *batal* jika tidak jadi. Pengingat yang jatuh di menit yang sama dikirim berurutan dengan jeda acak 20–30 detik per chat (atur via `REMINDER_PACING_MIN_MS` / `REMINDER_PACING_MAX_MS`) agar tidak terdeteksi sebagai spam oleh WhatsApp.

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
DEFAULT_REMINDER_LEAD_MINUTES=10

# Dashboard monitoring & whitelist manager (opsional)
DASHBOARD_ENABLED=true
DASHBOARD_HOST=0.0.0.0
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

### 📊 Dashboard Monitoring & Admin Control Room

Bot dilengkapi dengan web dashboard internal (`src/dashboard/`) yang aman, ringan (native ESM tanpa framework eksternal), dan responsif untuk pemantauan serta manajemen operasional:

1. **Aktivasi & Keamanan**:
   * Dashboard hanya aktif jika `DASHBOARD_ENABLED=true` dan dilindungi oleh **HTTP Basic Authentication** (`DASHBOARD_USERNAME` & `DASHBOARD_PASSWORD`, minimal 16 karakter).
   * Dilengkapi header keamanan ketat: `Content-Security-Policy` (`default-src 'self'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, dan `Cache-Control: no-store`.
   * Di lingkungan production/Dokploy, atur `DASHBOARD_HOST=0.0.0.0` dan tempatkan endpoint di belakang HTTPS reverse proxy (Traefik / Nginx / Cloudflare Access / VPN).

2. **Fitur & Bagian Dashboard**:
   * **01 Runtime & Bot Health**: Status koneksi WhatsApp socket, uptime proses, RSS memory usage, dan siklus loop background scheduler.
   * **02 Task & Pipeline Status**: Metrik agregat jumlah tugas per status (`pending`, `pending_deadline`, `resolved`, `cancelled`).
   * **03 User Adoption**: Jumlah pengguna terdaftar yang diizinkan (*allowed*) serta pengguna yang mengaktifkan ringkasan pagi (*morning digest*).
   * **04 Storage & Attachment**: Jumlah berkas lampiran serta total kapasitas disk/S3 yang terpakai.
   * **05 24h Operational Telemetry & Error Audit**: Ringkasan operasi sistem per jam dan log error tersanitasi terbaru tanpa membocorkan data pribadi.
   * **06 User Whitelist & Access Manager**:
     * Melihat daftar pengguna WhatsApp yang tersimpan di database beserta setelan waktu reminder dan jumlah tugas.
     * Mengubah izin akses (*Izinkan* / *Cabut Akses*) secara instan.
     * Menambahkan nomor WhatsApp baru ke whitelist secara manual.
     * Menghapus kontak dan seluruh data terkait dari sistem.
   * **07 Task Explorer & Interactive Detail View**:
     * Eksplorasi seluruh daftar tugas bot dengan filter status (*Aktif*, *Semua*, *Pending*, *No Deadline*, *Selesai*, *Batal*) dan pencarian teks *real-time*.
     * **Default Filter "Aktif" & Paginasi Cepat**: Default menampilkan tugas aktif untuk efisiensi beban render dan query database, dilengkapi kontrol paginasi (20 item per halaman, tombol *Sebelumnya* / *Berikutnya*, indikator halaman dan total data).
     * Indikator visual jumlah sub-tugas (`☑`) dan berkas lampiran (`📎`).
     * **Modal Detail Tugas**: Pop-up interaktif menampilkan rincian tugas induk, daftar sub-tugas, berkas gambar/PDF, preview teks hasil OCR AI, dan jejak audit perubahan lengkap (*audit trail* dengan rincian trigger `raw_input`).
     * **Panel Atur Ulang Jadwal & Pengingat (Admin Reschedule)**: Admin dapat mengubah deadline dan lead time pengingat (menit) secara langsung dari dashboard, lengkap dengan preview tanggal/jam baru serta dialog konfirmasi sadar-admin. Jadwal `remind_at` dikalkulasikan ulang otomatis dan status pengingat direset ke belum terkirim.
   * **08 Cron & Automation Monitoring**:
     * **Background Cron Dispatchers**: Memantau status engine scheduler (*Task Reminder Dispatcher* dan *Morning Digest Dispatcher*) dengan tombol jeda/aktifkan untuk mencegah lonjakan beban atau spam.
     * **Antrean Pengingat yang Belum Berjalan**: Melihat daftar reminder tugas yang akan dieksekusi di masa depan, dilengkapi tombol matikan pengingat sebelum dikirim ke WhatsApp.
     * **Jadwal Morning Digest Pengguna**: Memantau dan mengatur status pengiriman ringkasan harian pengguna.
     * **Safety Confirmation Popups**: Setiap aksi pemutusan, penonaktifan, atau penghapusan selalu menampilkan dialog konfirmasi terlebih dahulu agar admin sadar penuh (*aware*) sebelum tindakan dieksekusi.

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
   Bridge mendengarkan `127.0.0.1:7860` secara default. Kalau container harus menjangkaunya, jalankan dengan `HOST` yang mengarah ke gateway Docker (bukan `0.0.0.0` yang terbuka ke internet) dan tutup port itu di firewall.

2. **Pasang token yang sama di host dan di container**:
   ```bash
   openssl rand -hex 32
   ```
   Set `ANTIGRAVITY_BRIDGE_TOKEN` pada proses bridge dan pada env bot.

3. **Hubungkan Container Dokploy ke Host**:
   Di tab **Environment** Dokploy, tambahkan:
   ```env
   ANTIGRAVITY_BRIDGE_URL=http://host.docker.internal:7860
   ANTIGRAVITY_BRIDGE_TOKEN=token-yang-sama
   ```
   Container memanggil bridge ini ketika provider sebelumnya di rantai gagal.
