import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { and, asc, eq, gte, lt, or, sql } from 'drizzle-orm';
import { config } from '../config/index.js';
import { recordAiUsage, telemetry } from './telemetry.js';
import {
  dailyDigestDeliveries,
  dailyMotivations,
  tasks,
  userSettings,
  type DailyDigestDelivery,
  type DailyMotivation,
  type Task,
  type UserSetting,
} from '../db/schema.js';

export type MorningDigestCommand =
  | { action: 'enable' }
  | { action: 'disable' }
  | { action: 'status' }
  | { action: 'set_time'; time: string }
  | { action: 'invalid_time' };

export interface MorningDigestTask {
  id: number;
  task: string;
  deadline: Date | string | null;
}

export interface MorningMotivationGeneration {
  text: string;
  source: 'gemini' | 'local';
  model?: string | null;
  usage?: {
    promptTokens?: number | null;
    outputTokens?: number | null;
    thoughtTokens?: number | null;
    totalTokens?: number | null;
  };
}

const LOCAL_MORNING_MOTIVATIONS = [
  'Pagi cerah membuka hari,\nLangkah kecil membawa arti.\nKerjakan satu demi satu hari ini,\nSemoga lancar sampai nanti.',
  'Mentari pagi hangat berseri,\nUdara segar menenangkan hati.\nMulai agenda dengan percaya diri,\nSemoga harimu penuh energi.',
  'Burung bernyanyi di pagi hari,\nLangit cerah menambah semangat.\nJalani tugas sepenuh hati,\nSedikit demi sedikit pasti hebat.',
];

export function parseMorningDigestCommand(text: string): MorningDigestCommand | null {
  const normalized = text.trim();
  if (/^\/?pagi\s+aktif$/i.test(normalized)) return { action: 'enable' };
  if (/^\/?pagi\s+nonaktif$/i.test(normalized)) return { action: 'disable' };
  if (/^\/?pagi\s+status$/i.test(normalized)) return { action: 'status' };

  const timeMatch = normalized.match(/^\/?pagi\s+waktu(?:\s+(.+))?$/i);
  if (!timeMatch) return null;

  const value = timeMatch[1]?.trim() ?? '';
  const validTime = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return validTime ? { action: 'set_time', time: value } : { action: 'invalid_time' };
}

export function parseClockMinutes(time: string): number | null {
  const match = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function getLocalClock(now: Date, timezone: string): {
  date: string;
  time: string;
  minutes: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour);
  const minute = Number(values.minute);

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
    minutes: hour * 60 + minute,
  };
}

export function shouldDispatchMorningDigest(input: {
  enabled: boolean;
  localMinutes: number;
  scheduledTime: string;
  graceMinutes?: number;
}): boolean {
  if (!input.enabled) return false;
  const scheduledMinutes = parseClockMinutes(input.scheduledTime);
  if (scheduledMinutes === null) return false;
  const graceMinutes = input.graceMinutes ?? 360;
  const endMinutes = Math.min(1440, scheduledMinutes + graceMinutes);
  return input.localMinutes >= scheduledMinutes && input.localMinutes < endMinutes;
}

export function validateMorningMotivation(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 20 || trimmed.length > 240) return false;
  if (/```|<\/?[a-z][^>]*>|https?:\/\/|\[[^\]]+\]|\{[^}]+\}/i.test(trimmed)) return false;

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length >= 2 && lines.length <= 4;
}

function safeWhatsappText(text: string, maxLength: number): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function formatTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function formatOverdueDeadline(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function formatMorningDigestMessages(input: {
  displayName?: string | null;
  timezone: string;
  now: Date;
  localDate: string;
  motivation: string;
  tasks: MorningDigestTask[];
  overdueTasks?: MorningDigestTask[];
  totalOverdueCount?: number;
  yesterdayResolvedCount?: number;
  maxTasksPerMessage?: number;
}): string[] {
  const displayName = safeWhatsappText(input.displayName || '', 80);
  const greeting = displayName ? `🌤️ Selamat pagi, ${displayName}!` : '🌤️ Selamat pagi!';
  const dateLabel = new Intl.DateTimeFormat('id-ID', {
    timeZone: input.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(input.now);
  const motivation = input.motivation.trim().slice(0, 240);

  let yesterdaySection = '';
  if (input.yesterdayResolvedCount && input.yesterdayResolvedCount > 0) {
    yesterdaySection = `📊 *Kemarin:* ${input.yesterdayResolvedCount} tugas berhasil kamu selesaikan 🎉 Mantap!\n\n`;
  }

  let overdueSection = '';
  const overdueList = input.overdueTasks ?? [];
  const totalOverdue = input.totalOverdueCount ?? overdueList.length;

  if (overdueList.length > 0) {
    const topOverdue = overdueList.slice(0, 3);
    const overdueLines = topOverdue.map((t) => {
      const timeStr = t.deadline ? formatOverdueDeadline(new Date(t.deadline), input.timezone) : 'tanpa tenggat';
      return `• [ID: ${t.id}] *${safeWhatsappText(t.task, 150)}* _(${timeStr})_`;
    });

    const moreNotice = totalOverdue > 3 ? `\n_...dan ${totalOverdue - 3} tugas terlewat lainnya._` : '';

    overdueSection =
      `⚠️ *Tugas Terlewat (Perlu Perhatian):*\n${overdueLines.join('\n')}${moreNotice}\n\n` +
      `_Santai aja, bukan lomba lari kok! Yuk cicil pelan-pelan biar harimu makin plong dan happy:_\n` +
      `• Ketik *selesai <ID>* jika kemarin sudah beres ✨\n` +
      `• Ketik *ubah waktu <ID> hari ini* untuk lanjut gas hari ini 🎯\n` +
      `• Ketik *list* untuk intip semua tugas aktifmu kapan saja 🚀\n\n`;
  }

  const sortedTasks = [...input.tasks]
    .filter((task) => task.deadline)
    .sort((left, right) => {
      const deadlineDiff = new Date(left.deadline!).getTime() - new Date(right.deadline!).getTime();
      return deadlineDiff || left.id - right.id;
    });

  if (sortedTasks.length === 0) {
    if (yesterdaySection || overdueSection) {
      return [
        `${greeting}\n\n${yesterdaySection}${overdueSection}📋 *Agenda Hari Ini (${dateLabel}):*\nBelum ada task terjadwal untuk hari ini. Nikmati pagi dan atur harimu dengan tenang. ✨\n\n${motivation}`,
      ];
    }
    return [
      `${greeting}\nBelum ada task terjadwal untuk ${dateLabel}. Nikmati pagi dan atur harimu dengan tenang. ✨\n\n${motivation}`,
    ];
  }

  const maxTasks = Math.max(1, Math.min(input.maxTasksPerMessage ?? 20, 50));
  const messages: string[] = [];
  for (let offset = 0; offset < sortedTasks.length; offset += maxTasks) {
    const chunk = sortedTasks.slice(offset, offset + maxTasks);
    const lines = chunk.map((task, index) => {
      const deadline = new Date(task.deadline!);
      const overdue = deadline.getTime() < input.now.getTime() ? ' ⚠️ terlewat' : '';
      return `${offset + index + 1}. [ID: ${task.id}] ${formatTime(deadline, input.timezone)} — ${safeWhatsappText(task.task, 300)}${overdue}`;
    });
    const header = offset === 0
      ? `${greeting}\n\n${yesterdaySection}${overdueSection}📋 *Agenda Hari Ini (${dateLabel}):*`
      : `📋 Lanjutan agenda ${dateLabel}:`;
    const footer = offset === 0 ? `\n\n${motivation}` : '';
    messages.push(`${header}\n\n${lines.join('\n')}${footer}`);
  }

  return messages;
}

export async function updateMorningDigestSettings(
  db: any,
  userJid: string,
  settings: { enabled?: boolean; time?: string; now?: Date }
): Promise<UserSetting | null> {
  if (settings.time !== undefined && parseClockMinutes(settings.time) === null) {
    throw new Error('INVALID_MORNING_DIGEST_TIME');
  }

  const currentRows = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userJid, userJid))
    .limit(1);
  const current = currentRows[0] as UserSetting | undefined;
  if (!current) return null;

  const enabledChanged = settings.enabled !== undefined && settings.enabled !== current.morningDigestEnabled;
  const timeChanged = settings.time !== undefined && settings.time !== current.morningDigestTime;
  if (!enabledChanged && !timeChanged) return current;

  const now = settings.now ?? new Date();
  const values: Record<string, unknown> = { updatedAt: now, morningDigestUpdatedAt: now };
  if (settings.enabled !== undefined) values.morningDigestEnabled = settings.enabled;
  if (settings.time !== undefined) values.morningDigestTime = settings.time;

  const updated = await db
    .update(userSettings)
    .set(values)
    .where(eq(userSettings.userJid, userJid))
    .returning();
  return updated[0] ?? null;
}

export async function listTasksForLocalDate(
  db: any,
  userJid: string,
  localDate: string,
  timezone: string
): Promise<Task[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new Error('INVALID_LOCAL_DATE');

  const start = sql`(${localDate}::date::timestamp AT TIME ZONE ${timezone})`;
  const end = sql`((${localDate}::date + 1)::timestamp AT TIME ZONE ${timezone})`;
  return db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userJid, userJid),
        eq(tasks.status, 'pending'),
        gte(tasks.deadline, start),
        lt(tasks.deadline, end)
      )
    )
    .orderBy(asc(tasks.deadline), asc(tasks.id));
}

export async function listOverdueTasks(
  db: any,
  userJid: string,
  localDate: string,
  timezone: string
): Promise<Task[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new Error('INVALID_LOCAL_DATE');

  const start = sql`(${localDate}::date::timestamp AT TIME ZONE ${timezone})`;
  return db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userJid, userJid),
        eq(tasks.status, 'pending'),
        lt(tasks.deadline, start)
      )
    )
    .orderBy(asc(tasks.deadline), asc(tasks.id));
}

export async function countYesterdayResolvedTasks(
  db: any,
  userJid: string,
  localDate: string,
  timezone: string
): Promise<number> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new Error('INVALID_LOCAL_DATE');

  const yesterdayStart = sql`(${localDate}::date - 1)::timestamp AT TIME ZONE ${timezone}`;
  const todayStart = sql`${localDate}::date::timestamp AT TIME ZONE ${timezone}`;

  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.userJid, userJid),
        eq(tasks.status, 'resolved'),
        gte(tasks.updatedAt, yesterdayStart),
        lt(tasks.updatedAt, todayStart)
      )
    );

  return Number(result[0]?.count ?? 0);
}

export async function claimMorningDigestDelivery(
  db: any,
  input: { userJid: string; localDate: string; timezone: string; now?: Date }
): Promise<DailyDigestDelivery | null> {
  const now = input.now ?? new Date();
  const inserted = await db
    .insert(dailyDigestDeliveries)
    .values({
      userJid: input.userJid,
      localDate: input.localDate,
      timezone: input.timezone,
      status: 'processing',
      attemptCount: 1,
      claimedAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [dailyDigestDeliveries.userJid, dailyDigestDeliveries.localDate],
    })
    .returning();
  if (inserted[0]) return inserted[0];

  const staleBefore = new Date(now.getTime() - 5 * 60 * 1000);
  const reclaimed = await db
    .update(dailyDigestDeliveries)
    .set({
      status: 'processing',
      attemptCount: sql`${dailyDigestDeliveries.attemptCount} + 1`,
      claimedAt: now,
      errorCode: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(dailyDigestDeliveries.userJid, input.userJid),
        eq(dailyDigestDeliveries.localDate, input.localDate),
        lt(dailyDigestDeliveries.attemptCount, 3),
        or(
          eq(dailyDigestDeliveries.status, 'failed'),
          and(
            eq(dailyDigestDeliveries.status, 'processing'),
            lt(dailyDigestDeliveries.claimedAt, staleBefore)
          )
        )
      )
    )
    .returning();
  return reclaimed[0] ?? null;
}

function localMotivationForDate(localDate: string): MorningMotivationGeneration {
  const hash = [...localDate].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return {
    text: LOCAL_MORNING_MOTIVATIONS[hash % LOCAL_MORNING_MOTIVATIONS.length]!,
    source: 'local',
    model: null,
  };
}

function mapMotivation(row: DailyMotivation): MorningMotivationGeneration {
  return {
    text: row.text || '',
    source: row.source === 'gemini' ? 'gemini' : 'local',
    model: row.model,
    usage: {
      promptTokens: row.promptTokens,
      outputTokens: row.outputTokens,
      thoughtTokens: row.thoughtTokens,
      totalTokens: row.totalTokens,
    },
  };
}

export async function getOrCreateMorningMotivation(
  db: any,
  localDate: string,
  generate: () => Promise<MorningMotivationGeneration>,
  now: Date = new Date()
): Promise<MorningMotivationGeneration> {
  const existing = await db
    .select()
    .from(dailyMotivations)
    .where(
      and(
        eq(dailyMotivations.localDate, localDate),
        eq(dailyMotivations.locale, 'id-ID'),
        eq(dailyMotivations.style, 'pantun')
      )
    )
    .limit(1);
  if (existing[0]?.status === 'ready' && existing[0].text) return mapMotivation(existing[0]);

  let claimed: DailyMotivation[];
  if (existing[0]?.status === 'generating') {
    const staleBefore = new Date(now.getTime() - 5 * 60 * 1000);
    claimed = await db
      .update(dailyMotivations)
      .set({ claimedAt: now, updatedAt: now })
      .where(
        and(
          eq(dailyMotivations.id, existing[0].id),
          eq(dailyMotivations.status, 'generating'),
          lt(dailyMotivations.claimedAt, staleBefore)
        )
      )
      .returning();
  } else {
    claimed = await db
      .insert(dailyMotivations)
      .values({
        localDate,
        locale: 'id-ID',
        style: 'pantun',
        status: 'generating',
        claimedAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [dailyMotivations.localDate, dailyMotivations.locale, dailyMotivations.style],
      })
      .returning();
  }

  if (!claimed[0]) {
    const fallback = localMotivationForDate(localDate);
    return fallback;
  }

  let generated: MorningMotivationGeneration;
  try {
    const candidate = await generate();
    generated = validateMorningMotivation(candidate.text) ? candidate : localMotivationForDate(localDate);
  } catch {
    generated = localMotivationForDate(localDate);
  }

  const usage = generated.usage ?? {};
  const updated = await db
    .update(dailyMotivations)
    .set({
      status: 'ready',
      text: generated.text,
      source: generated.source,
      model: generated.model ?? null,
      promptTokens: usage.promptTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      thoughtTokens: usage.thoughtTokens ?? null,
      totalTokens: usage.totalTokens ?? null,
      updatedAt: new Date(),
    })
    .where(eq(dailyMotivations.id, claimed[0].id))
    .returning();

  return mapMotivation(updated[0]!);
}

export async function generateMorningMotivation(options: {
  client?: any;
  model?: string;
  timeoutMs?: number;
} = {}): Promise<MorningMotivationGeneration> {
  const client = options.client ?? (config.geminiApiKey ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : null);
  if (!client) throw new Error('MORNING_MOTIVATION_AI_UNAVAILABLE');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 1800);
  const startedAt = performance.now();
  try {
    const model = options.model ?? config.geminiModel;
    const response: any = await client.models.generateContent({
      model,
      contents:
        'Buat satu pantun penyemangat pagi Bahasa Indonesia, 4 baris, hangat dan natural. Maksimal 220 karakter. Hindari kutipan, markdown, URL, nasihat panjang, dan klaim tentang agenda pengguna. Balas hanya isi pantun.',
      config: {
        abortSignal: controller.signal,
        candidateCount: 1,
        maxOutputTokens: 128,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      },
    });
    const text = response.text?.trim() || '';
    if (!validateMorningMotivation(text)) throw new Error('INVALID_MORNING_MOTIVATION');
    const usage = response.usageMetadata ?? {};
    const result: MorningMotivationGeneration = {
      text,
      source: 'gemini',
      model: response.modelVersion || model,
      usage: {
        promptTokens: usage.promptTokenCount ?? null,
        outputTokens: usage.candidatesTokenCount ?? null,
        thoughtTokens: usage.thoughtsTokenCount ?? null,
        totalTokens: usage.totalTokenCount ?? null,
      },
    };
    recordAiUsage(telemetry, {
      operation: 'morning_motivation',
      provider: 'gemini',
      outcome: 'success',
      durationMs: performance.now() - startedAt,
      usage: result.usage,
    });
    return result;
  } catch (error) {
    recordAiUsage(telemetry, {
      operation: 'morning_motivation',
      provider: 'gemini',
      outcome: controller.signal.aborted ? 'timeout' : 'failed',
      durationMs: performance.now() - startedAt,
    });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function completeMorningDigestDelivery(
  db: any,
  id: number,
  input: { messageId?: string | null; taskCount: number; motivationSource: string; now?: Date }
): Promise<void> {
  const now = input.now ?? new Date();
  await db
    .update(dailyDigestDeliveries)
    .set({
      status: 'sent',
      sentAt: now,
      messageId: input.messageId ?? null,
      taskCount: input.taskCount,
      motivationSource: input.motivationSource,
      errorCode: null,
      updatedAt: now,
    })
    .where(eq(dailyDigestDeliveries.id, id));
}

export async function failMorningDigestDelivery(
  db: any,
  id: number,
  errorCode: string,
  now: Date = new Date()
): Promise<void> {
  await db
    .update(dailyDigestDeliveries)
    .set({ status: 'failed', errorCode: errorCode.slice(0, 64), updatedAt: now })
    .where(eq(dailyDigestDeliveries.id, id));
}

export async function dispatchMorningDigests(
  db: any,
  options: {
    sendMessage: (userJid: string, text: string) => Promise<string | null>;
    generateMotivation?: () => Promise<MorningMotivationGeneration>;
    now?: Date;
    graceMinutes?: number;
    concurrency?: number;
  }
): Promise<{ due: number; sent: number; failed: number }> {
  const now = options.now ?? new Date();
  const users: UserSetting[] = await db
    .select()
    .from(userSettings)
    .where(and(eq(userSettings.isAllowed, true), eq(userSettings.morningDigestEnabled, true)));

  const claims: Array<{ user: UserSetting; localDate: string; delivery: DailyDigestDelivery }> = [];
  for (const user of users) {
    let localClock;
    try {
      localClock = getLocalClock(now, user.timezone);
    } catch {
      continue;
    }
    if (!shouldDispatchMorningDigest({
      enabled: user.morningDigestEnabled,
      localMinutes: localClock.minutes,
      scheduledTime: user.morningDigestTime,
      graceMinutes: options.graceMinutes,
    })) continue;

    const settingClock = getLocalClock(new Date(user.morningDigestUpdatedAt), user.timezone);
    const scheduledMinutes = parseClockMinutes(user.morningDigestTime)!;
    if (settingClock.date === localClock.date && settingClock.minutes > scheduledMinutes) continue;

    const delivery = await claimMorningDigestDelivery(db, {
      userJid: user.userJid,
      localDate: localClock.date,
      timezone: user.timezone,
      now,
    });
    if (delivery) claims.push({ user, localDate: localClock.date, delivery });
  }

  if (claims.length === 0) return { due: 0, sent: 0, failed: 0 };

  const motivations = new Map<string, MorningMotivationGeneration>();
  for (const localDate of new Set(claims.map((claim) => claim.localDate))) {
    motivations.set(
      localDate,
      await getOrCreateMorningMotivation(
        db,
        localDate,
        options.generateMotivation ?? (() => generateMorningMotivation())
      )
    );
    telemetry.increment('morning_motivation_total', {
      source: motivations.get(localDate)?.source ?? 'local',
      outcome: 'selected',
    });
  }

  let sent = 0;
  let failed = 0;
  const processClaim = async (claim: (typeof claims)[number]) => {
    try {
      const dailyTasks = await listTasksForLocalDate(
        db,
        claim.user.userJid,
        claim.localDate,
        claim.user.timezone
      );
      const overdueTasks = await listOverdueTasks(
        db,
        claim.user.userJid,
        claim.localDate,
        claim.user.timezone
      );
      const yesterdayResolvedCount = await countYesterdayResolvedTasks(
        db,
        claim.user.userJid,
        claim.localDate,
        claim.user.timezone
      );
      const motivation = motivations.get(claim.localDate) ?? localMotivationForDate(claim.localDate);
      const messages = formatMorningDigestMessages({
        displayName: claim.user.name,
        timezone: claim.user.timezone,
        now,
        localDate: claim.localDate,
        motivation: motivation.text,
        tasks: dailyTasks,
        overdueTasks,
        totalOverdueCount: overdueTasks.length,
        yesterdayResolvedCount,
      });

      let messageId: string | null = null;
      for (const message of messages) {
        messageId = await options.sendMessage(claim.user.userJid, message);
      }
      await completeMorningDigestDelivery(db, claim.delivery.id, {
        messageId,
        taskCount: dailyTasks.length,
        motivationSource: motivation.source,
        now,
      });
      sent++;
    } catch {
      failed++;
      await failMorningDigestDelivery(db, claim.delivery.id, 'DISPATCH_FAILED', now);
    }
  };

  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 5));
  for (let offset = 0; offset < claims.length; offset += concurrency) {
    await Promise.all(claims.slice(offset, offset + concurrency).map(processClaim));
  }

  return { due: claims.length, sent, failed };
}
