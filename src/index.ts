import { client, db, initDb } from './db/index.js';
import { userSettings } from './db/schema.js';
import { startBot, stopBot } from './bot/client.js';
import { eq } from 'drizzle-orm';
import { config } from './config/index.js';
import { startDashboardServer } from './dashboard/server.js';
import { flushTelemetry, telemetry } from './services/telemetry.js';

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

  // 3. Start optional read-only dashboard. Invalid credentials fail closed without stopping the bot.
  let dashboard: ReturnType<typeof Bun.serve> | null = null;
  try {
    dashboard = startDashboardServer({
      enabled: config.dashboardEnabled,
      host: config.dashboardHost,
      port: config.dashboardPort,
      username: config.dashboardUsername,
      password: config.dashboardPassword,
      db,
    });
    if (dashboard) console.log(`📊 Dashboard monitoring aktif di ${dashboard.url}`);
  } catch (err) {
    console.error('⚠️ Dashboard dinonaktifkan karena konfigurasi tidak aman:', err);
  }

  // 4. Start WhatsApp Bot and lightweight telemetry flush loop.
  await startBot();
  const telemetryInterval = setInterval(() => {
    flushTelemetry(db).catch((err) => {
      console.error('⚠️ Gagal flush telemetry; data tetap berada di buffer:', err);
    });
  }, config.telemetryFlushIntervalMs);
  telemetryInterval.unref?.();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n🛑 Menghentikan bot...');
    clearInterval(telemetryInterval);
    stopBot();
    dashboard?.stop(true);
    try {
      await flushTelemetry(db, telemetry);
    } catch (err) {
      console.error('⚠️ Telemetry terakhir gagal disimpan saat shutdown:', err);
    }
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
