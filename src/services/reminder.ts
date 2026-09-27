import { and, eq, lte } from 'drizzle-orm';
import { tasks, type Task } from '../db/schema.js';
import { linkTaskMessage } from './task.js';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config/index.js';
import { callAntigravityBridge } from './nlp.js';

let defaultGeminiClient: any = null;
function getGeminiClient() {
  if (!defaultGeminiClient && config.geminiApiKey) {
    defaultGeminiClient = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }
  return defaultGeminiClient;
}


export interface RemindAtOptions {
  leadMinutes?: number;
  now?: Date;
}

/**
 * Calculates adaptive remind_at timestamp based on distance to deadline:
 * - Distance > 2 hours: remind (leadMinutes || 30) minutes before
 * - Distance between 30 minutes and 2 hours: remind 15 minutes before
 * - Distance < 30 minutes: remind at exact deadline time
 */
export function calculateRemindAt(deadline: Date, options: RemindAtOptions = {}): Date {
  const now = options.now ?? new Date();
  const diffMinutes = (deadline.getTime() - now.getTime()) / (60 * 1000);
  const defaultLead = options.leadMinutes && options.leadMinutes > 0 ? options.leadMinutes : 30;

  if (diffMinutes > 120) {
    return new Date(deadline.getTime() - defaultLead * 60 * 1000);
  }

  if (diffMinutes >= 30) {
    return new Date(deadline.getTime() - 15 * 60 * 1000);
  }

  return new Date(deadline.getTime());
}

export type DispatchMessageCallback = (task: Task, isOverdue: boolean) => Promise<string | null>;

/**
 * Queries due and overdue tasks, triggers notifications, and marks them reminded.
 */
export async function checkAndDispatchReminders(
  db: any,
  dispatchMessage: DispatchMessageCallback,
  now: Date = new Date()
): Promise<number> {
  let count = 0;

  // 1. Regular reminders: pending, reminded = 0, remindAt <= now
  const dueTasks = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, 'pending'), eq(tasks.reminded, 0), lte(tasks.remindAt, now)));

  for (const task of dueTasks) {
    try {
      const messageId = await dispatchMessage(task, false);
      await db
        .update(tasks)
        .set({
          reminded: 1,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));

      if (messageId) {
        await linkTaskMessage(db, task.id, messageId);
      }
      count++;
    } catch {
      // Continue next task on individual failure
    }
  }

  // 2. Overdue alerts: pending, reminded = 1, deadline <= now
  const overdueTasks = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, 'pending'), eq(tasks.reminded, 1), lte(tasks.deadline, now)));

  for (const task of overdueTasks) {
    try {
      const messageId = await dispatchMessage(task, true);
      await db
        .update(tasks)
        .set({
          reminded: 2, // 2 = overdue alerted
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));

      if (messageId) {
        await linkTaskMessage(db, task.id, messageId);
      }
      count++;
    } catch {
      // Continue next task
    }
  }

  return count;
}

const REGULAR_FALLBACKS = [
  (task: string, deadline: string) =>
    `Hai! 👋 Waktunya meluangkan momen untuk tugas ini:\n📝 *"${task}"*\n⏰ Target: *${deadline}*\n\nYuk tuntaskan perlahan tapi pasti! ✨\n_(Beri reaksi ✅ jika sudah tuntas, atau ❌ jika mau dibatalkan)_`,
  (task: string, deadline: string) =>
    `Halo! ☕ Sekadar menyapa dan mengingatkan rencanamu:\n📝 *"${task}"*\n⏰ Sebelum: *${deadline}*\n\nFokus sebentar, pasti selesai dengan lancar! 💪\n_(Beri reaksi ✅ jika sudah beres, atau ❌ jika dibatalkan)_`,
  (task: string, deadline: string) =>
    `Semangat! 🌟 Satu langkah kecil untuk menyelesaikan:\n📝 *"${task}"*\n⏰ Target: *${deadline}*\n\nKamu pasti bisa menuntaskannya dengan baik!\n_(Beri reaksi ✅ jika sudah tuntas, atau ❌ untuk membatalkan)_`,
  (task: string, deadline: string) =>
    `Waktunya check-in santai! 🎯\n📝 *"${task}"*\n⏰ Dijadwalkan: *${deadline}*\n\nYuk mulai sekarang biar pikiran lebih lega dan rileks. ✨\n_(Beri reaksi ✅ jika sudah selesai, atau ❌ jika batal)_`,
];

const OVERDUE_FALLBACKS = [
  (task: string, deadline: string) =>
    `Hai! Masih ingat dengan rencana ini? 😊\n📝 *"${task}"*\n⏰ Rencana sebelumnya: *${deadline}*\n\nTak apa jika sempat tertunda, yuk luangkan waktu sejenak untuk menuntaskannya! 🌟\n_(Beri reaksi ✅ jika sudah tuntas, atau ❌ jika ingin dibatalkan)_`,
  (task: string, deadline: string) =>
    `Halo! 🌼 Cuma mau menyapa terkait tugas ini:\n📝 *"${task}"*\n⏰ Target: *${deadline}*\n\nSantai saja, belum terlambat untuk menyelesaikannya sekarang. Kamu hebat! ✨\n_(Beri reaksi ✅ jika sudah selesai, atau ❌ jika dibatalkan)_`,
  (task: string, deadline: string) =>
    `Hai! Rencana ini belum sempat kamu selesaikan:\n📝 *"${task}"*\n\nYuk selesaikan pelan-pelan agar harimu makin produktif dan tenang. Semangat! 💪\n_(Beri reaksi ✅ jika sudah beres, atau ❌ jika ingin dibatalkan)_`,
  (task: string, _deadline: string) =>
    `Check-in tugas sejenak! 🌿\n📝 *"${task}"*\n\nKalau masih relevan, yuk tuntaskan hari ini. Kalau sudah tidak perlu, santai saja bisa langsung dibatalkan ya. ✨\n_(Beri reaksi ✅ jika sudah selesai, atau ❌ jika dibatalkan)_`,
];

/**
 * Generates an engaging, warm, human reminder message using Gemini (or fallback templates).
 * Strictly avoids cold debt-collection tone like "jatuh tempo" or "telah melewati batas waktu".
 */
export async function generateReminderMessage(
  task: { task: string; id?: number; deadline?: Date | string | null },
  isOverdue: boolean,
  deadlineStr: string,
  customClient?: any
): Promise<string> {
  const prompt = `Kamu adalah asisten pribadi WhatsApp yang ramah, hangat, perhatian, dan natural.
Tugas: Buat pesan pengingat ramah untuk tugas: "${task.task}".
Waktu target: "${deadlineStr}".
Status: ${isOverdue ? 'Target waktu sudah terlewat sedikit (tetap santai dan jangan menuntut)' : 'Mendekati waktu target'}.

Panduan Bahasa & Tone of Voice:
1. Bersahabat, suportif, dan menyenangkan (seperti teman dekat yang mengingatkan).
2. DILARANG KERAS menggunakan kata kaku bernada menagih hutang, seperti: "jatuh tempo", "peringatan tenggat waktu", "telah melewati batas waktu", "menagih", atau kalimat dingin semacamnya.
3. DILARANG terdengar seperti template robot AI yang klise.
4. Tampilkan nama tugas dengan format *"${task.task}"* dan waktu deadline secara natural.
5. Akhiri dengan ajakan santai untuk memberi reaksi ✅ jika sudah beres, atau ❌ jika dibatalkan.
6. Buat ringkas (maksimal 3-4 baris). Balas langsung dengan isi pesannya saja tanpa tanda kutip di awal/akhir.`;

  const gemini = customClient !== undefined ? customClient : getGeminiClient();
  if (gemini) {
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

      const text = response.text?.trim();
      if (text) {
        return text.replace(/^["']|["']$/g, '');
      }
    } catch (err: any) {
      console.warn(`[ReminderMessage] Gemini error (${err?.message || err}), beralih ke fallback template...`);
    }
  }

  // Tier 2: Try Antigravity Bridge if configured
  if (config.antigravityBridgeUrl) {
    try {
      const bridgeText = await callAntigravityBridge(prompt);
      if (bridgeText) {
        return bridgeText.replace(/^["']|["']$/g, '').trim();
      }
    } catch {}
  }

  // Tier 3: Curated Warm Fallbacks
  const pool = isOverdue ? OVERDUE_FALLBACKS : REGULAR_FALLBACKS;
  const picked = pool[Math.floor(Math.random() * pool.length)]!;
  return picked(task.task, deadlineStr);
}

