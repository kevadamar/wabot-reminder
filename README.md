# WhatsApp Task & Reminder Bot

Bot WhatsApp pintar berbasis **Bun** dan **Baileys (v7)** yang membantu mencatat to-do list dari pesan langsung maupun pesan yang diteruskan (*forwarded*), mengekstrak deadline menggunakan **Gemini AI** (dengan fallback lokal), memberikan pengingat adaptif otomatis, dan merayakan penyelesaian tugas dengan afirmasi positif dinamis.

---

## 🌟 Fitur Utama

- 📥 **Pencatatan Tugas Cerdas**: Cukup kirim atau *forward* pesan ke bot, contoh:
  - *"Besok jam 2 siang ada jadwal meeting dengan klien"*
  - *"Ingatkan bayar tagihan listrik nanti malam jam 8"*
- 🧠 **NLP Bahasa Indonesia**: Menggunakan Gemini 1.5 Flash (Free Tier) untuk ekstraksi terstruktur nama tugas & waktu dalam bahasa santai Indonesia, dengan fallback lokal (*Indonesian dictionary + chrono-node*) saat offline.
- ⏰ **Pengingat Adaptif**: Otomatis mengirimkan pengingat 30 menit atau 15 menit sebelum deadline, serta peringatan susulan jika tugas melewati batas waktu (*overdue*).
- ✅ **Penyelesaian Fleksibel**: Cukup beri reaksi emoji **✅** di balon pesan bot WhatsApp, balas pesan dengan emoji ✅, atau ketik `selesai <ID>`.
- 🎉 **Afirmasi Positif Dinamis**: Merayakan setiap tugas yang selesai dengan pujian gaul dan memotivasi dari AI.
- 🐘 **PostgreSQL & Drizzle ORM**: Skema database yang scalable, terstruktur, dan mudah dikelola melalui pgAdmin atau TablePlus.
- 🔒 **Akses Aman (Whitelist)**: Hanya nomor yang terdaftar di tabel `user_settings` (atau `OWNER_NUMBER` di `.env`) yang dapat menggunakan bot.

---

## 🛠️ Tech Stack

- **Runtime**: [Bun](https://bun.sh/)
- **WhatsApp Client**: `@whiskeysockets/baileys` (v7 Native WebSockets)
- **Database**: PostgreSQL (v16) via [Drizzle ORM](https://orm.drizzle.team/) & `postgres.js`
- **AI / NLP**: `@google/genai` (Gemini 1.5 Flash) + `chrono-node`

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

## 💬 Perintah & Panduan Chat WhatsApp

| Perintah | Deskripsi |
| :--- | :--- |
| `Halo`, `p`, dll | Sapaan santai (tidak akan memicu pencatatan tugas palsu) |
| `<Pesan Tugas>` | Mencatat tugas otomatis (misal: *"Kirim laporan besok jam 14:00"*) |
| `/list` atau `daftar` | Menampilkan seluruh tugas aktif yang belum selesai |
| `/selesai <ID>` | Menandai tugas telah selesai dan memicu afirmasi positif |
| `/batal <ID>` | Membatalkan/menghapus tugas |
| `Reaksi ✅` | Menandai selesai dengan mengklik reaksi emoji ✅ pada pesan bot |
| `/help` atau `bantuan` | Menampilkan pesan panduan ramah pengguna |

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
```
> **Tips Database di Dokploy:** Jika Anda menggunakan fitur *PostgreSQL Database* bawaan Dokploy, Anda bisa memasukkan koneksi internal Docker network Dokploy secara langsung ke `DATABASE_URL`.

### 4. Deploy & Scan QR Code
1. Klik **Deploy**.
2. Skema database akan otomatis diterapkan (`bun run db:push`) pada saat container pertama kali menyala.
3. Buka tab **Deployments** / **Logs** di Dokploy:
   - Anda akan melihat **QR Code WhatsApp** tercetak di log real-time Dokploy.
   - Pindai QR Code tersebut menggunakan WhatsApp di HP (*Perangkat Tertaut*).
   - Begitu terhubung, bot akan langsung aktif berjalan 24/7!
