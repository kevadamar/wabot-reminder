import { eq } from 'drizzle-orm';
import { botSettings } from '../db/schema.js';
import { config } from '../config/index.js';

export interface NlpTimePhraseRule {
  phrase: string;
  replacement: string;
}

export interface NlpCustomRules {
  customTaskVerbs: string[];
  customTimePhrases: NlpTimePhraseRule[];
  customTimeKeywords: string[];
  customStopwords: string[];
}

export const DEFAULT_NLP_CUSTOM_RULES: NlpCustomRules = {
  customTaskVerbs: [
    'minum obat',
    'minum vitamin',
    'coding',
    'code review',
    'briefing',
    'evaluasi',
    'setor',
    'nyetor',
    'rekap',
    'bimbingan',
    'solat',
    'shalat',
  ],
  customTimePhrases: [
    { phrase: "ba'da isya", replacement: 'at 19:30' },
    { phrase: "bada isya", replacement: 'at 19:30' },
    { phrase: "ba'da maghrib", replacement: 'at 18:30' },
    { phrase: "bada maghrib", replacement: 'at 18:30' },
    { phrase: "ba'da ashar", replacement: 'at 15:30' },
    { phrase: "bada ashar", replacement: 'at 15:30' },
    { phrase: "ba'da dzuhur", replacement: 'at 12:30' },
    { phrase: "bada dzuhur", replacement: 'at 12:30' },
    { phrase: "ba'da subuh", replacement: 'at 05:00' },
    { phrase: "bada subuh", replacement: 'at 05:00' },
    { phrase: 'subuh', replacement: 'at 04:30' },
    { phrase: 'pulang kantor', replacement: 'at 17:00' },
    { phrase: 'jam pulang kerja', replacement: 'at 17:00' },
    { phrase: 'tengah malam', replacement: 'at 00:00' },
    { phrase: 'siang bolong', replacement: 'at 12:00' },
  ],
  customTimeKeywords: [
    'weekend',
    'akhir pekan',
    'subuh',
    'fajar',
    'senja',
    'maghrib',
    'isya',
    'ashar',
    'dzuhur',
  ],
  customStopwords: [
    'tolong dong',
    'tolong',
    'dong',
    'plis',
    'please',
    'ya',
    'yah',
    'bantu',
  ],
};

let memoryCachedNlpRules: NlpCustomRules = { ...DEFAULT_NLP_CUSTOM_RULES };
let nlpRulesCacheTimestamp = 0;
const NLP_CACHE_TTL_MS = 60_000;

/**
 * Returns currently loaded NLP rules synchronously from memory.
 */
export function getLoadedNlpRules(): NlpCustomRules {
  return memoryCachedNlpRules;
}

/**
 * Overrides memory cached NLP rules directly (useful for tests or immediate sync).
 */
export function setLoadedNlpRules(rules: NlpCustomRules): void {
  memoryCachedNlpRules = sanitizeNlpCustomRules(rules);
  nlpRulesCacheTimestamp = Date.now();
}

/**
 * Sanitizes and validates arbitrary input into clean NlpCustomRules structure.
 */
export function sanitizeNlpCustomRules(input: any): NlpCustomRules {
  const sanitizeList = (arr: any): string[] => {
    if (!Array.isArray(arr)) return [];
    const unique = new Set<string>();
    for (const item of arr) {
      if (typeof item === 'string') {
        const trimmed = item.trim().toLowerCase();
        if (trimmed) unique.add(trimmed);
      }
    }
    return Array.from(unique);
  };

  const sanitizePhrases = (arr: any): NlpTimePhraseRule[] => {
    if (!Array.isArray(arr)) return [];
    const seen = new Set<string>();
    const result: NlpTimePhraseRule[] = [];
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const phrase = typeof item.phrase === 'string' ? item.phrase.trim().toLowerCase() : '';
      const replacement = typeof item.replacement === 'string' ? item.replacement.trim() : '';
      if (phrase && replacement && !seen.has(phrase)) {
        seen.add(phrase);
        result.push({ phrase, replacement });
      }
    }
    return result;
  };

  return {
    customTaskVerbs: input?.customTaskVerbs ? sanitizeList(input.customTaskVerbs) : [...DEFAULT_NLP_CUSTOM_RULES.customTaskVerbs],
    customTimePhrases: input?.customTimePhrases ? sanitizePhrases(input.customTimePhrases) : [...DEFAULT_NLP_CUSTOM_RULES.customTimePhrases],
    customTimeKeywords: input?.customTimeKeywords ? sanitizeList(input.customTimeKeywords) : [...DEFAULT_NLP_CUSTOM_RULES.customTimeKeywords],
    customStopwords: input?.customStopwords ? sanitizeList(input.customStopwords) : [...DEFAULT_NLP_CUSTOM_RULES.customStopwords],
  };
}

/**
 * Reads a global bot setting from the bot_settings table with fallback.
 */
export async function getBotSetting(db: any, key: string, defaultValue = ''): Promise<string> {
  try {
    if (!db) return defaultValue;
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
  if (!db) return;
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
 * Retrieves NLP custom rules from database with caching.
 */
export async function getNlpCustomRules(db?: any, forceRefresh = false): Promise<NlpCustomRules> {
  const isCacheFresh = Date.now() - nlpRulesCacheTimestamp < NLP_CACHE_TTL_MS;
  if (!forceRefresh && isCacheFresh && memoryCachedNlpRules) {
    return memoryCachedNlpRules;
  }

  if (!db) {
    return memoryCachedNlpRules || DEFAULT_NLP_CUSTOM_RULES;
  }

  const rawJson = await getBotSetting(db, 'nlp_custom_rules', '');
  if (!rawJson) {
    memoryCachedNlpRules = { ...DEFAULT_NLP_CUSTOM_RULES };
    nlpRulesCacheTimestamp = Date.now();
    return memoryCachedNlpRules;
  }

  try {
    const parsed = JSON.parse(rawJson);
    const sanitized = sanitizeNlpCustomRules(parsed);
    memoryCachedNlpRules = sanitized;
    nlpRulesCacheTimestamp = Date.now();
    return sanitized;
  } catch (err: any) {
    console.warn('[BotSettings] Format JSON nlp_custom_rules tidak valid, menggunakan default:', err?.message || err);
    return memoryCachedNlpRules || DEFAULT_NLP_CUSTOM_RULES;
  }
}

/**
 * Saves or updates NLP custom rules in the database and updates cache.
 */
export async function setNlpCustomRules(db: any, rules: Partial<NlpCustomRules>): Promise<NlpCustomRules> {
  const sanitized = sanitizeNlpCustomRules(rules);
  const serialized = JSON.stringify(sanitized);
  await setBotSetting(db, 'nlp_custom_rules', serialized);
  memoryCachedNlpRules = sanitized;
  nlpRulesCacheTimestamp = Date.now();
  return sanitized;
}

/**
 * Resets NLP custom rules in the database back to DEFAULT_NLP_CUSTOM_RULES.
 */
export async function resetNlpCustomRules(db: any): Promise<NlpCustomRules> {
  return await setNlpCustomRules(db, DEFAULT_NLP_CUSTOM_RULES);
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

/**
 * Generates an engaging, fun, and warm WhatsApp message for unauthorized contacts.
 */
export function buildRestrictedAccessMessage(igHandle: string): string {
  return `Hai! Senang banget deh kamu udah chat ke sini ✨👋

Tapi maaf ya kalau responnya agak selow, adminnya mungkin lagi sibuk recharge energi atau rebahan manja dulu nih 🛋️☕

Daripada pesan kamu menggantung atau bertepuk sebelah tangan (eh maksudnya kelamaan nunggu hehe 🙈), mending langsung colek admin lewat DM Instagram *${igHandle}* ya!

Pasti dibalas dan disambut hangat kok. Sampai ketemu di DM ya! 🙌✨`;
}
