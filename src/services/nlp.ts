import * as chrono from 'chrono-node';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config/index.js';

export interface ParseResult {
  isTask: boolean;
  taskTitle: string;
  deadline: Date | null;
  needsDeadline: boolean;
  rawText: string;
}

export interface ParseOptions {
  now?: Date;
  timezone?: string;
  isForwarded?: boolean;
  geminiClient?: any;
}

const GREETINGS_REGEX = /^(halo|hai|hey|p|ping|assalamualaikum|tes|test|pagi|siang|sore|malam|selamat pagi|selamat siang|selamat sore|selamat malam|makasih|terima kasih|thanks|thank you|ok|oke|siap|baik)\b/i;

const TASK_VERBS_REGEX = /\b(beli|bayar|kirim|kerjakan|rapat|meeting|telpon|telepon|hubungi|call|transfer|catat|ingat|ingatkan|bikin|buat|periksa|cek|bereskan|beresin|ambil|jemput|selesaikan|baca|tulis|submit|upload|download|presentasi)\b/i;

/**
 * Normalizes Indonesian relative time phrases into English equivalents for chrono-node.
 */
export function normalizeIndonesianTimePhrases(text: string): string {
  let normalized = text;

  // Day references
  normalized = normalized.replace(/\bbesok lusa\b/gi, 'in 2 days');
  normalized = normalized.replace(/\bbesok\b/gi, 'tomorrow');
  normalized = normalized.replace(/\bkemarin\b/gi, 'yesterday');
  normalized = normalized.replace(/\bhari ini\b/gi, 'today');
  normalized = normalized.replace(/\bmalam ini\b/gi, 'tonight');
  normalized = normalized.replace(/\bnanti malam\b/gi, 'tonight');
  normalized = normalized.replace(/\bnanti sore\b/gi, 'this afternoon at 17:00');
  normalized = normalized.replace(/\bnanti siang\b/gi, 'this noon at 12:00');
  normalized = normalized.replace(/\bnanti pagi\b/gi, 'this morning at 09:00');

  // Days of week
  normalized = normalized.replace(/\bsenin\b/gi, 'monday');
  normalized = normalized.replace(/\bselasa\b/gi, 'tuesday');
  normalized = normalized.replace(/\brabu\b/gi, 'wednesday');
  normalized = normalized.replace(/\bkamis\b/gi, 'thursday');
  normalized = normalized.replace(/\bjum'?at\b/gi, 'friday');
  normalized = normalized.replace(/\bsabtu\b/gi, 'saturday');
  normalized = normalized.replace(/\bminggu\b/gi, 'sunday');

  // Time qualifiers: "jam 2 siang" -> "2:00 PM"
  normalized = normalized.replace(/\bjam\s*(\d{1,2})[:.](\d{2})\s*(siang|sore|malam)\b/gi, (_, h, m, p) => {
    let hour = parseInt(h, 10);
    if ((p.toLowerCase() === 'siang' && hour < 12) || p.toLowerCase() === 'sore' || p.toLowerCase() === 'malam') {
      if (hour < 12) hour += 12;
    }
    return `at ${hour}:${m}`;
  });

  normalized = normalized.replace(/\bjam\s*(\d{1,2})\s*(siang|sore|malam)\b/gi, (_, h, p) => {
    let hour = parseInt(h, 10);
    if ((p.toLowerCase() === 'siang' && hour < 12) || p.toLowerCase() === 'sore' || p.toLowerCase() === 'malam') {
      if (hour < 12) hour += 12;
    }
    return `at ${hour}:00`;
  });

  normalized = normalized.replace(/\bjam\s*(\d{1,2})[:.](\d{2})\s*(pagi)?\b/gi, 'at $1:$2');
  normalized = normalized.replace(/\bjam\s*(\d{1,2})\s*pagi\b/gi, 'at $1:00 AM');
  normalized = normalized.replace(/\bjam\s*(\d{1,2})\b/gi, 'at $1:00');

  return normalized;
}

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
 * Local fallback parser combining regex & chrono.en with timezone awareness
 */
export function parseLocalTask(text: string, now: Date = new Date(), timezone = 'Asia/Jakarta'): ParseResult {
  const trimmed = text.trim();

  // Strip /todo command prefix if present
  let cleanInput = trimmed.replace(/^\/todo\s+/i, '').replace(/^todo:\s*/i, '').trim();

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
      /\b(besok\s+lusa|besok|lusa|kemarin|hari\s+ini|malam\s+ini|nanti\s+malam|nanti\s+sore|nanti\s+siang|nanti\s+pagi|nanti)\b/gi,
      ''
    );
    taskTitle = taskTitle.replace(
      /\bjam\s*\d{1,2}([:.]\d{2})?(\s*(siang|sore|malam|pagi))?\b/gi,
      ''
    );
    taskTitle = taskTitle.replace(
      /\b(senin|selasa|rabu|kamis|jum'?at|sabtu|minggu)(\s+depan)?\b/gi,
      ''
    );

    // Clean extra punctuation, leading dots, commas, colons, and extra whitespace
    taskTitle = taskTitle.replace(/^[-:., ]+|[-:., ]+$/g, '').replace(/\s+/g, ' ').trim();

    return {
      isTask: true,
      taskTitle: taskTitle || cleanInput,
      deadline,
      needsDeadline: false,
      rawText: text,
    };
  }

  return {
    isTask: true,
    taskTitle: cleanInput,
    deadline: null,
    needsDeadline: true,
    rawText: text,
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
    const hasTimeKeyword = /\b(besok|nanti|jam\s*\d|deadline|hari ini)\b/i.test(trimmed);

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

  // 3. Try Gemini Structured Extraction if client is configured
  const gemini = options.geminiClient !== undefined ? options.geminiClient : getGeminiClient();
  if (gemini) {
    try {
      const prompt = `Kamu adalah asisten pengurai tugas to-do list WhatsApp dalam Bahasa Indonesia.
Waktu saat ini (Reference Time ISO): "${now.toISOString()}" (Zona Waktu: ${options.timezone || config.defaultTimezone}).
Analisis pesan berikut: "${trimmed}"

Instruksi:
1. Tentukan apakah pesan ini adalah sebuah tugas (isTask: true/false).
2. Bersihkan judul tugas dari kata penunjuk waktu (taskTitle).
3. Jika ada tenggat waktu (deadline), ekstrak dan hitung menjadi format ISO 8601 UTC string (contoh: "2026-09-27T07:00:00.000Z"). Jika tidak ada waktu, isi null.
4. Set needsDeadline ke true jika isTask=true tetapi deadline=null.

Balas HANYA dengan JSON valid tanpa markdown formatting:
{"isTask": boolean, "taskTitle": string, "deadline": string | null, "needsDeadline": boolean}`;

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gemini API timeout (3s)')), 3000)
      );

      const response: any = await Promise.race([
        gemini.models.generateContent({
          model: config.geminiModel,
          contents: prompt,
        }),
        timeoutPromise,
      ]);

      const responseText = response.text?.trim() || '';
      const cleanedJson = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanedJson);

      return {
        isTask: Boolean(parsed.isTask),
        taskTitle: parsed.taskTitle || trimmed,
        deadline: parsed.deadline ? new Date(parsed.deadline) : null,
        needsDeadline: Boolean(parsed.needsDeadline),
        rawText: text,
      };
    } catch (err: any) {
      console.warn(`[NLP] Gemini error (${err?.message || err}), beralih ke parser lokal.`);
    }
  }

  // 4. Local fallback parser
  return parseLocalTask(text, now, options.timezone || config.defaultTimezone);
}
