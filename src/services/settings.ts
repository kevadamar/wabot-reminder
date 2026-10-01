import { eq } from 'drizzle-orm';
import { botSettings } from '../db/schema.js';
import { config } from '../config/index.js';

/**
 * Reads a global bot setting from the bot_settings table with fallback.
 */
export async function getBotSetting(db: any, key: string, defaultValue = ''): Promise<string> {
  try {
    const row = await db.select().from(botSettings).where(eq(botSettings.key, key)).limit(1);
    if (row.length > 0 && row[0]?.value !== undefined && row[0]?.value !== null) {
      return row[0].value;
    }
  } catch (err: any) {
    console.warn(`[BotSettings] Gagal membaca key "${key}":`, err?.message || err);
  }
  return defaultValue;
}

/**
 * Saves or updates a global bot setting in the bot_settings table.
 */
export async function setBotSetting(db: any, key: string, value: string): Promise<void> {
  const existing = await db.select().from(botSettings).where(eq(botSettings.key, key)).limit(1);
  if (existing.length > 0) {
    await db
      .update(botSettings)
      .set({ value, updatedAt: new Date() })
      .where(eq(botSettings.key, key));
  } else {
    await db.insert(botSettings).values({ key, value, updatedAt: new Date() });
  }
}

/**
 * Retrieves the configured Admin Instagram handle.
 */
export async function getAdminInstagram(db: any): Promise<string> {
  return await getBotSetting(db, 'admin_instagram', config.adminInstagram || '@kevadamar');
}

/**
 * Updates the Admin Instagram handle, ensuring the leading '@' prefix.
 */
export async function setAdminInstagram(db: any, handle: string): Promise<string> {
  let cleaned = handle.trim();
  if (cleaned && !cleaned.startsWith('@')) {
    cleaned = `@${cleaned}`;
  }
  if (!cleaned) {
    cleaned = config.adminInstagram || '@kevadamar';
  }
  await setBotSetting(db, 'admin_instagram', cleaned);
  return cleaned;
}
