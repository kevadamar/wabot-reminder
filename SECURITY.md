# Kebijakan Keamanan

## Versi yang didukung

Perbaikan keamanan hanya dirilis untuk branch `main` terbaru.

## Melaporkan celah keamanan

**Jangan laporkan celah keamanan lewat issue publik.**

Gunakan [GitHub Private Vulnerability Reporting](https://github.com/kevadamar/wabot-reminder/security/advisories/new) (tab **Security** → **Report a vulnerability**). Sertakan:

- Deskripsi celah dan dampaknya.
- Langkah reproduksi atau proof of concept.
- Versi/commit yang terdampak dan konfigurasi yang relevan (tanpa secret asli).

Kami akan merespons dalam 7 hari, memberi kabar perkembangan perbaikan, dan mencantumkan nama Anda di catatan rilis jika Anda menginginkannya.

## Ruang lingkup

Yang termasuk:

- Kode di repo ini: bot, dashboard (`src/dashboard/`), dan Antigravity bridge (`scripts/antigravity-bridge.ts`).
- Bypass whitelist pengguna, kebocoran data antarpengguna, injeksi SQL/command, SSRF lewat URL provider, atau lolosnya file berbahaya dari pemeriksaan lampiran.

Yang tidak termasuk:

- Celah di dependency pihak ketiga (laporkan ke proyek aslinya; kami akan memperbarui versinya).
- Pemblokiran nomor oleh WhatsApp akibat pemakaian klien tidak resmi.
- Konfigurasi deployment yang tidak mengikuti panduan di bawah.

## Panduan deployment aman

- Jangan pernah meng-commit `.env` atau folder `auth_info/` (berisi sesi login WhatsApp). Keduanya sudah ada di `.gitignore`.
- Isi `DASHBOARD_PASSWORD` dengan string acak minimal 16 karakter, dan letakkan dashboard di belakang HTTPS reverse proxy atau VPN.
- Jalankan Antigravity bridge di `127.0.0.1` atau gateway Docker, jangan `0.0.0.0` yang terbuka ke internet, dan pasang `ANTIGRAVITY_BRIDGE_TOKEN` (`openssl rand -hex 32`).
- URL provider LLM ke host publik wajib `https`; `http` hanya otomatis diizinkan untuk host lokal/jaringan privat.
- Batasi pengguna lewat whitelist (`OWNER_NUMBER` dan tabel `user_settings`), dan rotasi API key jika ada dugaan bocor.
