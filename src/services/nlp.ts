import * as chrono from 'chrono-node';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config/index.js';
import { recordAiUsage, telemetry } from './telemetry.js';

export interface ParseResult {
  isTask: boolean;
  taskTitle: string;
  deadline: Date | null;
  needsDeadline: boolean;
  rawText: string;
  reminderLeadMinutes?: number | null;
}

export interface ParseOptions {
  now?: Date;
  timezone?: string;
  isForwarded?: boolean;
  geminiClient?: any;
}

const GREETINGS_REGEX = /^(halo|hai|hey|p|ping|assalamualaikum|tes|test|pagi|siang|sore|malam|selamat pagi|selamat siang|selamat sore|selamat malam|makasih|terima kasih|thanks|thank you|ok|oke|siap|baik)\b/i;

const TASK_VERBS_REGEX = /\b(beli|bayar|kirim|kerjakan|rapat|meeting|telpon|telepon|hubungi|call|transfer|catat|ingat|ingatkan|bikin|buat|periksa|cek|bereskan|beresin|ambil|jemput|selesaikan|baca|tulis|submit|upload|download|presentasi|facial|service|servis|olahraga|gym|lari|belanja|jadwal)\b/i;

/**
 * Returns timezone offset in minutes for a given timezone name (e.g. Asia/Jakarta -> 420).
 */
export function getTimezoneOffsetMinutes(timezone = 'Asia/Jakarta', date: Date = new Date()): number {
  try {
    const tzString = date.toLocaleString('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' });
    const match = tzString.match(/GMT([+-]\d{1,2})(:(\d{2}))?/);
    if (match && match[1]) {
      const hours = parseInt(match[1], 10);
      const mins = match[3] ? parseInt(match[3], 10) : 0;
      return hours * 60 + (hours < 0 ? -mins : mins);
    }
  } catch {}
  return 420; // Default to UTC+7 (Asia/Jakarta / WIB)
}

/**
 * Normalizes all Indonesian relative and absolute time phrases into English equivalents for chrono-node.
 */
export function normalizeIndonesianTimePhrases(text: string): string {
  let normalized = text;

  // Day references
  normalized = normalized.replace(/\bbesok lusa\b/gi, 'in 2 days');
  normalized = normalized.replace(/\blusa\b/gi, 'in 2 days');
  normalized = normalized.replace(/\bbesok\b/gi, 'tomorrow');
  normalized = normalized.replace(/\bkemarin\b/gi, 'yesterday');
  normalized = normalized.replace(/\bhari ini\b/gi, 'today');
  normalized = normalized.replace(/\bmalam ini\b/gi, 'tonight');
  normalized = normalized.replace(/\bnanti malam\b/gi, 'tonight');
  normalized = normalized.replace(/\bnanti sore\b/gi, 'this afternoon at 17:00');
  normalized = normalized.replace(/\bnanti siang\b/gi, 'this noon at 12:00');
  normalized = normalized.replace(/\bnanti pagi\b/gi, 'this morning at 09:00');

  // Relative durations (e.g. "30 menit lagi", "2 jam lagi")
  normalized = normalized.replace(/\b(\d+)\s*menit\s*lagi\b/gi, 'in $1 minutes');
  normalized = normalized.replace(/\b(\d+)\s*jam\s*lagi\b/gi, 'in $1 hours');
  normalized = normalized.replace(/\b(\d+)\s*hari\s*lagi\b/gi, 'in $1 days');

  // Days of week with "depan" (e.g. "senin depan" -> "next monday")
  normalized = normalized.replace(/\bsenin\s+depan\b/gi, 'next monday');
  normalized = normalized.replace(/\bselasa\s+depan\b/gi, 'next tuesday');
  normalized = normalized.replace(/\brabu\s+depan\b/gi, 'next wednesday');
  normalized = normalized.replace(/\bkamis\s+depan\b/gi, 'next thursday');
  normalized = normalized.replace(/\bjum'?at\s+depan\b/gi, 'next friday');
  normalized = normalized.replace(/\bsabtu\s+depan\b/gi, 'next saturday');
  normalized = normalized.replace(/\bminggu\s+depan\b/gi, 'next sunday');

  // Regular days of week
  normalized = normalized.replace(/\bsenin\b/gi, 'monday');
  normalized = normalized.replace(/\bselasa\b/gi, 'tuesday');
  normalized = normalized.replace(/\brabu\b/gi, 'wednesday');
  normalized = normalized.replace(/\bkamis\b/gi, 'thursday');
  normalized = normalized.replace(/\bjum'?at\b/gi, 'friday');
  normalized = normalized.replace(/\bsabtu\b/gi, 'saturday');
  normalized = normalized.replace(/\bminggu\b/gi, 'sunday');

  // Jam 2 siang, jam 14.30, pukul 15.00 (with colon or dot separator)
  normalized = normalized.replace(/\b(jam|pukul|pk)\s*(\d{1,2})[:.](\d{2})\s*(siang|sore|malam)\b/gi, (_, _k, h, m, p) => {
    let hour = parseInt(h, 10);
    if ((p.toLowerCase() === 'siang' && hour < 12) || p.toLowerCase() === 'sore' || p.toLowerCase() === 'malam') {
      if (hour < 12) hour += 12;
    }
    return `at ${hour}:${m}`;
  });

  normalized = normalized.replace(/\b(jam|pukul|pk)\s*(\d{1,2})\s*(siang|sore|malam)\b/gi, (_, _k, h, p) => {
    let hour = parseInt(h, 10);
    if ((p.toLowerCase() === 'siang' && hour < 12) || p.toLowerCase() === 'sore' || p.toLowerCase() === 'malam') {
      if (hour < 12) hour += 12;
    }
    return `at ${hour}:00`;
  });

  normalized = normalized.replace(/\b(jam|pukul|pk)\s*(\d{1,2})[:.](\d{2})\s*(pagi|subuh)?\b/gi, (_, _k, h, m) => {
    return `at ${h}:${m}`;
  });

  normalized = normalized.replace(/\b(jam|pukul|pk)\s*(\d{1,2})\s*(pagi|subuh)\b/gi, (_, _k, h) => {
    return `at ${h}:00 AM`;
  });

  normalized = normalized.replace(/\b(jam|pukul|pk)\s*(\d{1,2})\b/gi, (_, _k, h) => {
    return `at ${h}:00`;
  });

  // Standalone 14.00 or 14:00 without "jam" prefix
  normalized = normalized.replace(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(wib|wita|wit)?\b/gi, 'at $1:$2');

  return normalized;
}

/**
 * Extracts explicit reminder lead time in minutes from task input text if present,
 * e.g. "ingatkan 30 menit sebelumnya", "ingatkan 1 jam sebelum", "ingatkan H-1".
 * Returns { leadMinutes: number | null, cleanedText: string }.
 */
export function extractExplicitReminderLead(text: string): { leadMinutes: number | null; cleanedText: string } {
  let cleanedText = text;
  let leadMinutes: number | null = null;

  // 1. Pattern: "ingatkan H-1" or "H-1" (1 day before = 1440 mins)
  const hPattern = /\b(?:ingatkan|remind\s*me|remind)?\s*h-(\d+)\b/i;
  const hMatch = text.match(hPattern);
  if (hMatch && hMatch[1]) {
    const days = parseInt(hMatch[1], 10);
    if (!isNaN(days) && days > 0 && days <= 7) {
      leadMinutes = days * 1440;
      cleanedText = cleanedText.replace(hPattern, '').trim();
    }
  }

  // 2. Pattern: "ingatkan 30 menit sebelum(nya)", "ingatkan 1 jam sebelum", "remind me 15 mins before", etc.
  if (leadMinutes === null) {
    const durationPattern = /\b(?:ingatkan|remind\s*me|remind|notif)\s*(?:sebelumnya\s*|sebelum\s*|sblm\s*)?(\d+)\s*(menit|jam|hari|mins?|minutes?|hours?|hrs?|days?)(?:\s*(?:sebelumnya|sebelum|sblm|before))?\b/i;
    const durMatch = text.match(durationPattern);
    if (durMatch && durMatch[1] && durMatch[2]) {
      const val = parseInt(durMatch[1], 10);
      const unit = durMatch[2].toLowerCase();
      if (!isNaN(val) && val > 0) {
        if (unit.startsWith('menit') || unit.startsWith('min')) {
          leadMinutes = val;
        } else if (unit.startsWith('jam') || unit.startsWith('hour') || unit.startsWith('hr')) {
          leadMinutes = val * 60;
        } else if (unit.startsWith('hari') || unit.startsWith('day')) {
          leadMinutes = val * 1440;
        }
        cleanedText = cleanedText.replace(durationPattern, '').trim();
      }
    }
  }

  // 3. Pattern: "(30 menit|1 jam) sebelum(nya)" without "ingatkan" keyword when at the end or separated by comma
  if (leadMinutes === null) {
    const standalonePattern = /[,(]?\s*(\d+)\s*(menit|jam|hari|mins?|minutes?|hours?|hrs?|days?)\s*(?:sebelumnya|sebelum|sblm|before)\s*[)]?/i;
    const standMatch = text.match(standalonePattern);
    if (standMatch && standMatch[1] && standMatch[2]) {
      const val = parseInt(standMatch[1], 10);
      const unit = standMatch[2].toLowerCase();
      if (!isNaN(val) && val > 0) {
        if (unit.startsWith('menit') || unit.startsWith('min')) {
          leadMinutes = val;
        } else if (unit.startsWith('jam') || unit.startsWith('hour') || unit.startsWith('hr')) {
          leadMinutes = val * 60;
        } else if (unit.startsWith('hari') || unit.startsWith('day')) {
          leadMinutes = val * 1440;
        }
        cleanedText = cleanedText.replace(standalonePattern, '').trim();
      }
    }
  }

  if (leadMinutes !== null) {
    leadMinutes = Math.min(Math.max(leadMinutes, 1), 10080);
    cleanedText = cleanedText.replace(/\s+/g, ' ').replace(/^[-:., ]+|[-:., ]+$/g, '').trim();
  }

  return { leadMinutes, cleanedText };
}

/**
 * Local fallback parser combining regex & chrono.en with timezone awareness
 */
export function parseLocalTask(text: string, now: Date = new Date(), timezone = 'Asia/Jakarta'): ParseResult {
  const trimmed = text.trim();

  // Strip /todo command prefix if present
  let cleanInput = trimmed.replace(/^\/todo\s+/i, '').replace(/^todo:\s*/i, '').trim();

  // Extract explicit per-task reminder lead time if requested (e.g. "ingatkan 30 menit sebelumnya")
  const { leadMinutes: explicitLeadMinutes, cleanedText: textWithoutLead } = extractExplicitReminderLead(cleanInput);
  cleanInput = textWithoutLead;

  const normalized = normalizeIndonesianTimePhrases(cleanInput);
  const tzOffsetMinutes = getTimezoneOffsetMinutes(timezone, now);
  const parsedDates = chrono.en.parse(normalized, { instant: now, timezone: tzOffsetMinutes });

  if (parsedDates.length > 0 && parsedDates[0]) {
    const parsed = parsedDates[0];
    const deadline = parsed.date();

    // Clean temporal string out of the task title
    let taskTitle = cleanInput;

    // Clean Indonesian temporal keywords
    taskTitle = taskTitle.replace(
      /\b(besok\s+lusa|besok|lusa|kemarin|hari\s+ini|malam\s+ini|siang\s+ini|sore\s+ini|pagi\s+ini|nanti\s+malam|nanti\s+sore|nanti\s+siang|nanti\s+pagi|nanti)\b/gi,
      ''
    );
    taskTitle = taskTitle.replace(
      /\b(senin|selasa|rabu|kamis|jum'?at|sabtu|minggu)(\s+depan)?\b/gi,
      ''
    );
    taskTitle = taskTitle.replace(
      /\b(jam|pukul|pk)\s*\d{1,2}([:.]\d{2})?(\s*(siang|sore|malam|pagi|subuh))?(\s*wib|\s*wita|\s*wit)?\b/gi,
      ''
    );
    taskTitle = taskTitle.replace(
      /\b([01]?\d|2[0-3])[:.][0-5]\d(\s*(siang|sore|malam|pagi|subuh))?(\s*wib|\s*wita|\s*wit)?\b/gi,
      ''
    );
    taskTitle = taskTitle.replace(/\b\d+\s*(menit|jam|hari)\s*lagi\b/gi, '');
    taskTitle = taskTitle.replace(/\b(pada|di|untuk|tgl|tanggal)\b/gi, '');

    // Clean extra punctuation, leading dots, commas, colons, and extra whitespace
    taskTitle = taskTitle.replace(/^[-:., ]+|[-:., ]+$/g, '').replace(/\s+/g, ' ').trim();

    return {
      isTask: true,
      taskTitle: taskTitle || cleanInput,
      deadline,
      needsDeadline: false,
      rawText: text,
      reminderLeadMinutes: explicitLeadMinutes,
    };
  }

  return {
    isTask: true,
    taskTitle: cleanInput,
    deadline: null,
    needsDeadline: true,
    rawText: text,
    reminderLeadMinutes: explicitLeadMinutes,
  };
}

let defaultGeminiClient: any = null;
function getGeminiClient() {
  if (!defaultGeminiClient && config.geminiApiKey) {
    defaultGeminiClient = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }
  return defaultGeminiClient;
}

/**
 * Calls host Antigravity CLI Bridge (if configured via ANTIGRAVITY_BRIDGE_URL)
 */
export async function callAntigravityBridge(prompt: string): Promise<string | null> {
  if (!config.antigravityBridgeUrl) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch(`${config.antigravityBridgeUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });

    if (res.ok) {
      const data = (await res.json()) as { text?: string };
      return data?.text?.trim() || null;
    }
  } catch (err: any) {
    console.warn(`[Antigravity Bridge] Error calling bridge at ${config.antigravityBridgeUrl}:`, err?.message || err);
  } finally {
    clearTimeout(timeout);
  }

  return null;
}

/**
 * Main public interface for parsing task messages
 */
export async function parseTaskMessage(text: string, options: ParseOptions = {}): Promise<ParseResult> {
  const trimmed = text.trim();
  const now = options.now ?? new Date();

  // 1. Explicit /todo command always counts as a task
  const isExplicitTodo = /^\/todo\b|^todo:/i.test(trimmed);

  // 2. Check for casual chat / greetings
  if (!isExplicitTodo && !options.isForwarded) {
    if (GREETINGS_REGEX.test(trimmed) && trimmed.split(/\s+/).length <= 4) {
      return {
        isTask: false,
        taskTitle: '',
        deadline: null,
        needsDeadline: false,
        rawText: text,
      };
    }

    // If not forwarded and no explicit /todo, check for task verbs or temporal words
    const hasTaskVerb = TASK_VERBS_REGEX.test(trimmed);
    const hasTimeKeyword = /\b(besok|nanti|jam\s*\d|pukul|deadline|hari ini|minggu depan|lusa)\b/i.test(trimmed);

    if (!hasTaskVerb && !hasTimeKeyword) {
      return {
        isTask: false,
        taskTitle: '',
        deadline: null,
        needsDeadline: false,
        rawText: text,
      };
    }
  }

  const prompt = `Kamu adalah asisten pengurai tugas to-do list WhatsApp dalam Bahasa Indonesia.
Waktu saat ini (Reference Time ISO): "${now.toISOString()}" (Zona Waktu: ${options.timezone || config.defaultTimezone}).
Analisis pesan berikut: "${trimmed}"

Instruksi:
1. Tentukan apakah pesan ini adalah sebuah tugas (isTask: true/false).
2. Bersihkan judul tugas dari kata penunjuk waktu serta frasa permintaan pengingat (taskTitle).
3. Jika pengguna menyebutkan waktu/tenggat waktu (deadline) baik spesifik maupun relatif, ekstrak dan hitung menjadi format ISO 8601 UTC string (contoh: "2026-09-27T07:00:00.000Z").
4. ATURAN WAJIB: Jika pengguna TIDAK menyebutkan keterangan tanggal, hari, jam, atau waktu sama sekali, JANGAN PERNAH berasumsi, menebak, atau menentukan sendiri batas waktunya! Isi deadline: null dan needsDeadline: true.
5. Jika pengguna secara eksplisit meminta waktu pengingat awal (contoh: "ingatkan 30 menit sebelumnya", "ingatkan 1 jam sebelum", "remind me 15 mins before", "ingatkan H-1"), hitung dan ekstrak durasinya dalam satuan menit integer (contoh: 30, 60, 120, 1440) ke field reminderLeadMinutes. Jika pengguna TIDAK meminta waktu pengingat khusus, isi reminderLeadMinutes: null.

Balas HANYA dengan JSON valid tanpa markdown formatting:
{"isTask": boolean, "taskTitle": string, "deadline": string | null, "needsDeadline": boolean, "reminderLeadMinutes": number | null}`;

  // 3. Tier 1: Try Gemini Structured Extraction if client is configured
  const gemini = options.geminiClient !== undefined ? options.geminiClient : getGeminiClient();
  if (gemini) {
    const startedAt = performance.now();
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gemini API timeout (3s)')), 3000)
      );

      const response: any = await Promise.race([
        gemini.models.generateContent({
          model: config.geminiModel,
          contents: prompt,
          config: {
            thinkingConfig: {
              thinkingLevel: config.geminiThinkingLevel as any,
            },
          },
        }),
        timeoutPromise,
      ]);

      const responseText = response.text?.trim() || '';
      const cleanedJson = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanedJson);

      const usage = response.usageMetadata ?? {};
      recordAiUsage(telemetry, {
        operation: 'nlp_parse',
        provider: 'gemini',
        outcome: 'success',
        durationMs: performance.now() - startedAt,
        usage: {
          promptTokens: usage.promptTokenCount,
          outputTokens: usage.candidatesTokenCount,
          thoughtTokens: usage.thoughtsTokenCount,
          totalTokens: usage.totalTokenCount,
        },
      });

      let explicitLead: number | null = null;
      if (typeof parsed.reminderLeadMinutes === 'number' && parsed.reminderLeadMinutes > 0) {
        explicitLead = Math.min(Math.max(Math.round(parsed.reminderLeadMinutes), 1), 10080);
      }

      return {
        isTask: Boolean(parsed.isTask),
        taskTitle: parsed.taskTitle || trimmed,
        deadline: parsed.deadline ? new Date(parsed.deadline) : null,
        needsDeadline: Boolean(parsed.needsDeadline),
        rawText: text,
        reminderLeadMinutes: explicitLead,
      };
    } catch (err: any) {
      recordAiUsage(telemetry, {
        operation: 'nlp_parse',
        provider: 'gemini',
        outcome: String(err?.message || '').includes('timeout') ? 'timeout' : 'failed',
        durationMs: performance.now() - startedAt,
      });
      console.warn(`[NLP] Gemini error (${err?.message || err}), mencoba opsi fallback...`);
    }
  }

  // 4. Tier 2: Try Antigravity CLI Host Bridge if configured
  if (config.antigravityBridgeUrl) {
    const startedAt = performance.now();
    const bridgeText = await callAntigravityBridge(prompt);
    if (bridgeText) {
      try {
        const jsonMatch = bridgeText.match(/\{[\s\S]*\}/);
        const cleaned = jsonMatch ? jsonMatch[0] : bridgeText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        recordAiUsage(telemetry, {
          operation: 'nlp_parse',
          provider: 'antigravity',
          outcome: 'success',
          durationMs: performance.now() - startedAt,
        });
        console.log(`✨ [NLP] Berhasil diproses menggunakan Antigravity CLI Bridge!`);
        let explicitLead: number | null = null;
        if (typeof parsed.reminderLeadMinutes === 'number' && parsed.reminderLeadMinutes > 0) {
          explicitLead = Math.min(Math.max(Math.round(parsed.reminderLeadMinutes), 1), 10080);
        }

        return {
          isTask: Boolean(parsed.isTask),
          taskTitle: parsed.taskTitle || trimmed,
          deadline: parsed.deadline ? new Date(parsed.deadline) : null,
          needsDeadline: Boolean(parsed.needsDeadline),
          rawText: text,
          reminderLeadMinutes: explicitLead,
        };
      } catch (parseErr: any) {
        recordAiUsage(telemetry, {
          operation: 'nlp_parse',
          provider: 'antigravity',
          outcome: 'failed',
          durationMs: performance.now() - startedAt,
        });
        console.warn(`[NLP] Gagal mem-parse JSON dari Antigravity Bridge:`, parseErr?.message || parseErr);
      }
    }
  }

  // 5. Tier 3: Local Offline Parser
  telemetry.increment('ai_fallback_total', { operation: 'nlp_parse', provider: 'local', outcome: 'selected' });
  return parseLocalTask(text, now, options.timezone || config.defaultTimezone);
}
