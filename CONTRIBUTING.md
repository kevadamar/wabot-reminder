# Panduan Kontribusi

Terima kasih sudah tertarik berkontribusi! Proyek ini terbuka untuk perbaikan bug, fitur baru, dokumentasi, dan terjemahan. Dengan berkontribusi, Anda setuju kontribusi Anda dirilis di bawah [Lisensi MIT](LICENSE) dan mengikuti [Kode Etik](CODE_OF_CONDUCT.md).

## Sebelum mulai

- **Bug atau ide fitur**: buka [issue](https://github.com/kevadamar/wabot-reminder/issues) dulu supaya bisa didiskusikan sebelum Anda menulis banyak kode.
- **Celah keamanan**: jangan buka issue publik. Ikuti [SECURITY.md](SECURITY.md).
- **Perubahan kecil** (typo, dokumentasi): langsung kirim pull request.

## Setup lokal

Prasyarat: [Bun](https://bun.sh/) v1.2+ dan PostgreSQL 16.

```bash
git clone https://github.com/kevadamar/wabot-reminder.git
cd wabot-reminder
bun install
cp .env.example .env        # isi DATABASE_URL; GEMINI_API_KEY opsional
bun run db:push             # terapkan skema ke database
bun test                    # jalankan seluruh test
bun run typecheck
```

Test memakai database dari `DATABASE_URL`. Pakai database khusus pengembangan, karena test menulis dan menghapus data. Tanpa `GEMINI_API_KEY`, bot dan test memakai parser lokal, jadi API key tidak wajib untuk berkontribusi.

## Alur kerja

1. Fork repo, lalu buat branch dari `main` (`feat/nama-fitur`, `fix/nama-bug`, `docs/...`).
2. **Tulis test dulu** untuk perubahan logika bisnis (Red → Green → Refactor). Letakkan di `test/` mengikuti struktur `src/`.
3. Pastikan `bun test` dan `bun run typecheck` lulus.
4. Perbarui dokumentasi yang terdampak: `README.md`, `.env.example` untuk env baru, `docs/ARCHITECTURE.md` untuk perubahan alur, atau ADR baru di `docs/adr/` untuk keputusan arsitektur.
5. Kirim pull request dengan deskripsi apa yang berubah dan alasannya.

## Konvensi kode

Baca [AGENTS.md](AGENTS.md) (seam arsitektur dan aturan) dan [CONTEXT.md](CONTEXT.md) (istilah domain) sebelum menamai konsep baru. Ringkasnya:

- TypeScript strict, ESM, API Bun lebih diutamakan daripada padanan Node.js.
- Perubahan skema lewat `src/db/schema.ts` (Drizzle), timestamp selalu `withTimezone: true`.
- Panggilan AI selalu punya fallback lokal; bot tidak boleh berhenti karena provider AI gagal.
- Handler socket Baileys dibungkus `try/catch`; scheduler tidak boleh terblokir oleh satu task yang gagal.
- Jangan pernah mencetak atau meng-commit secret, nomor telepon asli, atau isi pesan pengguna. Gunakan nomor contoh seperti `628123456789` di test.

## Pesan commit

Gunakan format [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, dengan scope opsional, misalnya `fix(reminder): ...`.

## Review

Maintainer akan meninjau PR secepatnya. CI (typecheck + test dengan PostgreSQL) harus hijau sebelum merge.
