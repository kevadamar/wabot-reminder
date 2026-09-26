import { client, db, initDb } from './db/index.js';
import { userSettings } from './db/schema.js';
import { startBot } from './bot/client.js';
import { eq } from 'drizzle-orm';

async function bootstrap() {
  console.log('🚀 Memulai WhatsApp To-Do Reminder Bot...');

  // 1. Check DB connectivity & auto-initialize tables
  try {
    await client`SELECT 1`;
    console.log('✅ Terhubung ke database PostgreSQL.');
    await initDb();
    console.log('✅ Skema tabel database PostgreSQL terverifikasi/diinisialisasi.');
  } catch (err) {
    console.error('❌ Gagal terhubung ke PostgreSQL atau inisialisasi tabel:', err);
    process.exit(1);
  }

  // 2. Auto-whitelist OWNER_NUMBER if provided
  const rawOwner = process.env.OWNER_NUMBER?.trim();
  if (rawOwner) {
    const cleanNumber = rawOwner.replace(/[^0-9]/g, '');
    const ownerJid = `${cleanNumber}@s.whatsapp.net`;

    const existing = await db.select().from(userSettings).where(eq(userSettings.userJid, ownerJid)).limit(1);
    if (existing.length === 0) {
      await db.insert(userSettings).values({
        userJid: ownerJid,
        name: 'Owner',
        isAllowed: true,
      });
      console.log(`✅ Nomor Owner [${cleanNumber}] otomatis didaftarkan dan diizinkan.`);
    } else if (!existing[0]?.isAllowed) {
      await db.update(userSettings).set({ isAllowed: true }).where(eq(userSettings.userJid, ownerJid));
      console.log(`✅ Hak akses Nomor Owner [${cleanNumber}] diaktifkan.`);
    }
  }

  // 3. Start WhatsApp Bot
  const { sock, reminderInterval } = await startBot();

  const shutdown = async () => {
    console.log('\n🛑 Menghentikan bot...');
    clearInterval(reminderInterval);
    try {
      sock.end(undefined);
    } catch {}
    await client.end();
    console.log('👋 Bot berhasil dihentikan dengan aman.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
