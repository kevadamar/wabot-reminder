import { timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, gte, ilike, inArray, lte, notInArray, sql } from 'drizzle-orm';
import {
  taskAttachments,
  taskHistory,
  taskMessages,
  tasks,
  telemetryEvents,
  telemetryHourly,
  userSettings,
} from '../db/schema.js';
import { runtimeHealth } from '../services/telemetry.js';
import { getLlmConfig } from '../config/llm.js';
import { getSharedBreaker } from '../services/llm/breaker.js';
import { rescheduleTask } from '../services/task.js';
import { triggerTaskReminder } from '../bot/client.js';
import { config } from '../config/index.js';
import {
  DASHBOARD_CSS,
  DASHBOARD_HTML,
  DASHBOARD_JS,
  ACTIVITY_CSS,
  ACTIVITY_HTML,
  ACTIVITY_JS,
  SETTINGS_CSS,
  SETTINGS_HTML,
  SETTINGS_JS,
} from './assets.js';
import { getAdminInstagram, setAdminInstagram } from '../services/settings.js';
import { LLM_CSS, LLM_HTML, LLM_JS } from './llm-assets.js';
import { llmCallLog, type LlmCallSummary } from '../services/llm/call-log.js';

function matchesOutcomeGroup(call: LlmCallSummary, group: string): boolean {
  if (group === 'success') return call.outcome === 'success';
  if (group === 'fallback') return call.outcome === 'fallback';
  if (group === 'skipped') return call.outcome.startsWith('skipped');
  if (group === 'error') return call.outcome !== 'success' && call.outcome !== 'fallback' && !call.outcome.startsWith('skipped');
  return true;
}

export function listLlmCalls(params: URLSearchParams): { payloadLogging: boolean; calls: LlmCallSummary[] } {
  const limit = Math.min(300, Math.max(1, Number(params.get('limit')) || 100));
  const operation = params.get('operation');
  const provider = params.get('provider');
  const outcome = params.get('outcome');
  const calls = llmCallLog
    .list()
    .filter((call) => (!operation || call.operation === operation) && (!provider || call.provider === provider))
    .filter((call) => !outcome || matchesOutcomeGroup(call, outcome))
    .slice(0, limit);
  return { payloadLogging: getLlmConfig().logging.payloads, calls };
}

const ACTIVE_TASK_STATUSES = ['pending', 'pending_deadline', 'pending_confirmation', 'pending_risk_confirmation'];

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

function secureHeaders(contentType?: string): Headers {
  const headers = new Headers(SECURITY_HEADERS);
  if (contentType) headers.set('content-type', contentType);
  return headers;
}

function safeEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isAuthorized(request: Request, username: string, password: string): boolean {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 1) return false;
    return safeEqual(decoded.slice(0, separator), username) && safeEqual(decoded.slice(separator + 1), password);
  } catch {
    return false;
  }
}

export async function buildDashboardSnapshot(db: any) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const now = new Date();
  const [taskRows, overdueRows, userRows, storageRows, usageRows, errorRows] = await Promise.all([
    db
      .select({ status: tasks.status, count: sql<number>`count(*)::int` })
      .from(tasks)
      .groupBy(tasks.status),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.status, 'pending'), lte(tasks.deadline, now))),
    db
      .select({
        allowed: sql<number>`count(*) FILTER (WHERE ${userSettings.isAllowed} = true)::int`,
        morningDigestEnabled: sql<number>`count(*) FILTER (WHERE ${userSettings.isAllowed} = true AND ${userSettings.morningDigestEnabled} = true)::int`,
      })
      .from(userSettings),
    db
      .select({
        attachments: sql<number>`count(*)::int`,
        bytes: sql<string>`coalesce(sum(${taskAttachments.fileSize}), 0)::bigint`,
      })
      .from(taskAttachments),
    db
      .select({
        metric: telemetryHourly.metric,
        dimension: telemetryHourly.dimension,
        count: sql<number>`sum(${telemetryHourly.count})::int`,
        sumValue: sql<number>`sum(${telemetryHourly.sumValue})::int`,
        maxValue: sql<number>`max(${telemetryHourly.maxValue})::int`,
      })
      .from(telemetryHourly)
      .where(gte(telemetryHourly.bucketAt, since))
      .groupBy(telemetryHourly.metric, telemetryHourly.dimension)
      .orderBy(desc(sql`sum(${telemetryHourly.count})`)),
    db
      .select({
        occurredAt: telemetryEvents.occurredAt,
        component: telemetryEvents.component,
        operation: telemetryEvents.operation,
        outcome: telemetryEvents.outcome,
        provider: telemetryEvents.provider,
        errorCode: telemetryEvents.errorCode,
        durationMs: telemetryEvents.durationMs,
      })
      .from(telemetryEvents)
      .where(
        notInArray(telemetryEvents.outcome, [
          'success',
          'selected',
          'skipped_breaker_open',
          'skipped_unconfigured',
          'skipped_budget',
        ])
      )
      .orderBy(desc(telemetryEvents.occurredAt))
      .limit(20),
  ]);

  const taskCounts = Object.fromEntries(taskRows.map((row: any) => [row.status, Number(row.count)]));
  taskCounts.overdue = Number(overdueRows[0]?.count ?? 0);
  const users = userRows[0] ?? { allowed: 0, morningDigestEnabled: 0 };
  const storage = storageRows[0] ?? { attachments: 0, bytes: '0' };
  const memory = process.memoryUsage();

  return {
    generatedAt: new Date().toISOString(),
    health: {
      whatsappStatus: runtimeHealth.whatsappStatus,
      whatsappChangedAt: runtimeHealth.whatsappChangedAt.toISOString(),
      lastReminderCycleAt: runtimeHealth.lastReminderCycleAt?.toISOString() ?? null,
      lastMorningDigestCycleAt: runtimeHealth.lastMorningDigestCycleAt?.toISOString() ?? null,
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - runtimeHealth.startedAt.getTime()) / 1000)),
      rssBytes: memory.rss,
    },
    tasks: taskCounts,
    users: {
      allowed: Number(users.allowed),
      morningDigestEnabled: Number(users.morningDigestEnabled),
    },
    storage: {
      attachments: Number(storage.attachments),
      bytes: Number(storage.bytes),
    },
    usage: usageRows.map((row: any) => ({
      metric: row.metric,
      dimension: row.dimension,
      count: Number(row.count),
      sumValue: Number(row.sumValue),
      maxValue: Number(row.maxValue),
    })),
    recentErrors: errorRows,
    llm: {
      chains: getLlmConfig().chains,
      breakers: getSharedBreaker(getLlmConfig().breaker).snapshot(),
    },
  };
}

export interface HttpRequestLog {
  timestamp: number;
  path: string;
  status: number;
  durationMs: number;
}

const httpLogs: HttpRequestLog[] = [];
const MAX_HTTP_LOGS = 2000;

export function recordHttpRequest(path: string, status: number, durationMs: number) {
  if (httpLogs.length >= MAX_HTTP_LOGS) {
    httpLogs.shift();
  }
  httpLogs.push({ timestamp: Date.now(), path, status, durationMs });
}

export function clearHttpRequestLogs() {
  httpLogs.length = 0;
}

export async function buildDashboardActivity(db: any, filter: string = 'all') {
  const now = Date.now();
  const since = new Date(now - 24 * 60 * 60 * 1000);

  // 1. Query telemetry_hourly and telemetry_events from DB
  const [hourlyRows, eventRows] = await Promise.all([
    db
      ? db
          .select({
            bucketAt: telemetryHourly.bucketAt,
            metric: telemetryHourly.metric,
            dimension: telemetryHourly.dimension,
            count: telemetryHourly.count,
            sumValue: telemetryHourly.sumValue,
            maxValue: telemetryHourly.maxValue,
          })
          .from(telemetryHourly)
          .where(gte(telemetryHourly.bucketAt, since))
      : Promise.resolve([]),
    db
      ? db
          .select({
            occurredAt: telemetryEvents.occurredAt,
            component: telemetryEvents.component,
            operation: telemetryEvents.operation,
            outcome: telemetryEvents.outcome,
            errorCode: telemetryEvents.errorCode,
            durationMs: telemetryEvents.durationMs,
          })
          .from(telemetryEvents)
          .where(gte(telemetryEvents.occurredAt, since))
          .limit(2000)
      : Promise.resolve([]),
  ]);

  // 2. Generate 24 hourly buckets
  const buckets: {
    startMs: number;
    endMs: number;
    label: string;
    timestamp: string;
    status2xx: number;
    status4xx: number;
    status5xx: number;
    durations: number[];
  }[] = [];

  const startOfCurrentHour = new Date(now);
  startOfCurrentHour.setMinutes(0, 0, 0);

  for (let i = 23; i >= 0; i--) {
    const bTime = new Date(startOfCurrentHour.getTime() - i * 60 * 60 * 1000);
    const endMs = bTime.getTime() + 60 * 60 * 1000;
    const hours = String(bTime.getHours()).padStart(2, '0');
    const label = `${hours}:00`;
    buckets.push({
      startMs: bTime.getTime(),
      endMs,
      label,
      timestamp: bTime.toISOString(),
      status2xx: 0,
      status4xx: 0,
      status5xx: 0,
      durations: [],
    });
  }

  // 3. Populate HTTP logs into buckets
  for (const log of httpLogs) {
    if (log.timestamp < since.getTime()) continue;
    if (filter === 'bot') continue;
    const bucket = buckets.find((b) => log.timestamp >= b.startMs && log.timestamp < b.endMs);
    if (!bucket) continue;

    if (log.status >= 200 && log.status < 400) bucket.status2xx++;
    else if (log.status >= 400 && log.status < 500) bucket.status4xx++;
    else if (log.status >= 500) bucket.status5xx++;

    if (log.durationMs > 0) bucket.durations.push(log.durationMs);
  }

  // 4. Populate bot metrics from DB into buckets
  if (filter !== 'http') {
    for (const row of hourlyRows) {
      const rowMs = new Date(row.bucketAt).getTime();
      const bucket = buckets.find((b) => rowMs >= b.startMs && rowMs < b.endMs);
      if (!bucket) continue;

      const cnt = Number(row.count) || 0;
      const dim = row.dimension || '';
      const isError = dim.includes('outcome=failed') || row.metric.includes('failed');
      const isClientErr = dim.includes('outcome=blocked') || dim.includes('outcome=unauthorized') || dim.includes('outcome=invalid');

      if (isError) {
        bucket.status5xx += cnt;
      } else if (isClientErr) {
        bucket.status4xx += cnt;
      } else {
        bucket.status2xx += cnt;
      }

      if (row.metric.endsWith('_duration_ms') && cnt > 0 && row.sumValue > 0) {
        const avg = Math.round(row.sumValue / cnt);
        bucket.durations.push(avg);
        if (row.maxValue > 0) bucket.durations.push(row.maxValue);
      }
    }

    for (const ev of eventRows) {
      const evMs = new Date(ev.occurredAt).getTime();
      const bucket = buckets.find((b) => evMs >= b.startMs && evMs < b.endMs);
      if (!bucket) continue;

      if (ev.durationMs && ev.durationMs > 0) {
        bucket.durations.push(ev.durationMs);
      }
    }
  }

  function calcPercentile(arr: number[], p: number, defaultVal: number): number {
    if (!arr.length) return defaultVal;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
    return sorted[idx]!;
  }

  // Convert buckets to series
  const series = buckets.map((b) => {
    const total = b.status2xx + b.status4xx + b.status5xx;
    const p50 = b.durations.length ? calcPercentile(b.durations, 50, 15) : 0;
    const p95 = b.durations.length ? calcPercentile(b.durations, 95, 30) : 0;
    return {
      label: b.label,
      timestamp: b.timestamp,
      status2xx: b.status2xx,
      status4xx: b.status4xx,
      status5xx: b.status5xx,
      total,
      p50,
      p95,
    };
  });

  // Calculate totals and summary
  const total2xx = series.reduce((acc, s) => acc + s.status2xx, 0);
  const total4xx = series.reduce((acc, s) => acc + s.status4xx, 0);
  const total5xx = series.reduce((acc, s) => acc + s.status5xx, 0);
  const totalRequests = total2xx + total4xx + total5xx;
  const totalErrors = total4xx + total5xx;
  const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

  const activeSeries = series.filter((s) => s.total > 0 || s.p50 > 0);
  const latestBucket = activeSeries.length > 0 ? activeSeries[activeSeries.length - 1] : null;
  const latestP50 = latestBucket ? latestBucket.p50 : 0;
  const latestP95 = latestBucket ? latestBucket.p95 : 0;

  // 5. Aggregate Paths & Operations
  const pathMap = new Map<string, { requests: number; errors: number; durations: number[]; isHttp: boolean }>();

  const defaultPaths = [
    { path: '/api/snapshot', isHttp: true },
    { path: '/api/tasks', isHttp: true },
    { path: '/api/users', isHttp: true },
    { path: '/api/crons', isHttp: true },
    { path: '/api/activity', isHttp: true },
    { path: '/health', isHttp: true },
    { path: 'bot.message_handler', isHttp: false },
    { path: 'nlp.parse_task', isHttp: false },
    { path: 'ai.gemini_generate', isHttp: false },
    { path: 'reminder.dispatch', isHttp: false },
    { path: 'morning_digest.dispatch', isHttp: false },
  ];

  for (const p of defaultPaths) {
    pathMap.set(p.path, { requests: 0, errors: 0, durations: [], isHttp: p.isHttp });
  }

  for (const log of httpLogs) {
    if (log.timestamp < since.getTime()) continue;
    const cleanPath = log.path.split('?')[0] || log.path;
    let entry = pathMap.get(cleanPath);
    if (!entry) {
      entry = { requests: 0, errors: 0, durations: [], isHttp: true };
      pathMap.set(cleanPath, entry);
    }
    entry.requests++;
    if (log.status >= 400) entry.errors++;
    if (log.durationMs > 0) entry.durations.push(log.durationMs);
  }

  for (const ev of eventRows) {
    const opKey = `${ev.component}.${ev.operation}`;
    let entry = pathMap.get(opKey);
    if (!entry) {
      entry = { requests: 0, errors: 0, durations: [], isHttp: false };
      pathMap.set(opKey, entry);
    }
    entry.requests++;
    if (ev.outcome === 'failed') entry.errors++;
    if (ev.durationMs && ev.durationMs > 0) entry.durations.push(ev.durationMs);
  }

  let paths = Array.from(pathMap.entries()).map(([path, data]) => {
    const errRate = data.requests > 0 ? (data.errors / data.requests) * 100 : 0;
    const p95 = calcPercentile(data.durations, 95, data.isHttp ? 15 : 45);
    return {
      path,
      requests: data.requests,
      errorRate: Number(errRate.toFixed(2)),
      p95Latency: p95,
      isHttp: data.isHttp,
    };
  });

  if (filter === 'http') {
    paths = paths.filter((p) => p.isHttp);
  } else if (filter === 'bot') {
    paths = paths.filter((p) => !p.isHttp);
  }

  paths.sort((a, b) => b.requests - a.requests);

  return {
    generatedAt: new Date(now).toISOString(),
    filter,
    summary: {
      totalRequests,
      errorRate: Number(errorRate.toFixed(2)),
      latestP50,
      latestP95,
    },
    series,
    paths,
  };
}

export function normalizePhoneNumberToJid(phone: string): string | null {
  if (!phone || typeof phone !== 'string') return null;
  let clean = phone.trim().replace(/[^0-9]/g, '');
  if (clean.startsWith('0')) {
    clean = '62' + clean.slice(1);
  }
  if (clean.length < 9 || clean.length > 16) {
    return null;
  }
  return `${clean}@s.whatsapp.net`;
}

export async function listDashboardUsers(db: any) {
  if (!db) return [];
  const rows = await db
    .select({
      userJid: userSettings.userJid,
      name: userSettings.name,
      timezone: userSettings.timezone,
      leadReminderMinutes: userSettings.leadReminderMinutes,
      isAllowed: userSettings.isAllowed,
      morningDigestEnabled: userSettings.morningDigestEnabled,
      morningDigestTime: userSettings.morningDigestTime,
      imageQualityMode: userSettings.imageQualityMode,
      createdAt: userSettings.createdAt,
      updatedAt: userSettings.updatedAt,
      taskCount: sql<number>`count(${tasks.id})::int`,
    })
    .from(userSettings)
    .leftJoin(tasks, eq(tasks.userJid, userSettings.userJid))
    .groupBy(userSettings.userJid)
    .orderBy(desc(userSettings.updatedAt));

  return rows.map((u: any) => ({
    userJid: u.userJid,
    phoneNumber: u.userJid.replace('@s.whatsapp.net', ''),
    name: u.name ?? null,
    timezone: u.timezone,
    leadReminderMinutes: u.leadReminderMinutes,
    isAllowed: Boolean(u.isAllowed),
    morningDigestEnabled: Boolean(u.morningDigestEnabled),
    morningDigestTime: u.morningDigestTime,
    imageQualityMode: u.imageQualityMode,
    createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
    updatedAt: u.updatedAt ? new Date(u.updatedAt).toISOString() : null,
    taskCount: Number(u.taskCount || 0),
  }));
}

export async function toggleUserAllowed(db: any, userJid: string, isAllowed?: boolean) {
  if (!db) throw new Error('Database not configured');
  const existing = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userJid, userJid))
    .limit(1);

  if (!existing.length || !existing[0]) {
    return null;
  }

  const nextAllowed = typeof isAllowed === 'boolean' ? isAllowed : !existing[0].isAllowed;
  const updated = await db
    .update(userSettings)
    .set({
      isAllowed: nextAllowed,
      updatedAt: new Date(),
    })
    .where(eq(userSettings.userJid, userJid))
    .returning();

  return updated[0] ? { ...updated[0], phoneNumber: userJid.replace('@s.whatsapp.net', '') } : null;
}

export async function addUserToWhitelist(db: any, phone: string, name?: string) {
  if (!db) throw new Error('Database not configured');
  const userJid = normalizePhoneNumberToJid(phone);
  if (!userJid) {
    throw new Error('Format nomor WhatsApp tidak valid. Gunakan format contoh: 08123456789 atau 628123456789');
  }

  const existing = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userJid, userJid))
    .limit(1);

  const cleanName = name?.trim() || null;

  if (existing.length > 0 && existing[0]) {
    const updated = await db
      .update(userSettings)
      .set({
        isAllowed: true,
        ...(cleanName ? { name: cleanName } : {}),
        updatedAt: new Date(),
      })
      .where(eq(userSettings.userJid, userJid))
      .returning();

    return { ...updated[0], phoneNumber: userJid.replace('@s.whatsapp.net', '') };
  }

  const inserted = await db
    .insert(userSettings)
    .values({
      userJid,
      name: cleanName,
      isAllowed: true,
      timezone: config.defaultTimezone,
      leadReminderMinutes: config.defaultReminderLeadMinutes,
    })
    .returning();

  return { ...inserted[0], phoneNumber: userJid.replace('@s.whatsapp.net', '') };
}

export async function updateUserLeadReminderMinutes(db: any, userJid: string, leadMinutes: number) {
  if (!db) throw new Error('Database not configured');
  if (isNaN(leadMinutes) || leadMinutes < 1 || leadMinutes > 1440) {
    throw new Error('Lead time pengingat harus berupa angka antara 1 sampai 1440 menit (maks 24 jam)');
  }
  const updated = await db
    .update(userSettings)
    .set({
      leadReminderMinutes: leadMinutes,
      updatedAt: new Date(),
    })
    .where(eq(userSettings.userJid, userJid))
    .returning();

  if (!updated.length || !updated[0]) {
    return null;
  }
  return { ...updated[0], phoneNumber: userJid.replace('@s.whatsapp.net', '') };
}

export async function deleteDashboardUser(db: any, userJid: string) {
  if (!db) throw new Error('Database not configured');
  await db.delete(tasks).where(eq(tasks.userJid, userJid));
  const deleted = await db
    .delete(userSettings)
    .where(eq(userSettings.userJid, userJid))
    .returning();

  return deleted.length > 0;
}

export async function listDashboardTasks(
  db: any,
  query: { status?: string; search?: string; userJid?: string; limit?: number; offset?: number } = {}
) {
  if (!db) return [];
  const limit = Math.min(Math.max(query.limit || 50, 1), 200);
  const offset = Math.max(query.offset || 0, 0);

  const baseQuery = db
    .select({
      id: tasks.id,
      parentId: tasks.parentId,
      userJid: tasks.userJid,
      userName: userSettings.name,
      task: tasks.task,
      deadline: tasks.deadline,
      remindAt: tasks.remindAt,
      status: tasks.status,
      reminded: tasks.reminded,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      attachmentCount: sql<number>`(SELECT count(*)::int FROM ${taskAttachments} WHERE ${taskAttachments.taskId} = ${tasks.id})`,
      subtaskCount: sql<number>`(SELECT count(*)::int FROM ${tasks} sub WHERE sub.parent_id = ${tasks.id})`,
    })
    .from(tasks)
    .leftJoin(userSettings, eq(userSettings.userJid, tasks.userJid));

  const conditions = [];
  if (query.userJid) {
    conditions.push(eq(tasks.userJid, query.userJid));
  }
  if (query.status && query.status !== 'all') {
    if (query.status === 'active') {
      conditions.push(inArray(tasks.status, ACTIVE_TASK_STATUSES));
    } else if (query.status === 'overdue') {
      conditions.push(eq(tasks.status, 'pending'));
      conditions.push(lte(tasks.deadline, new Date()));
    } else {
      conditions.push(eq(tasks.status, query.status));
    }
  }
  if (query.search && query.search.trim()) {
    conditions.push(ilike(tasks.task, `%${query.search.trim()}%`));
  }

  const finalQuery = conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;

  const rows = await finalQuery
    .orderBy(
      sql`CASE WHEN ${tasks.status} IN ('pending', 'pending_deadline', 'pending_confirmation', 'pending_risk_confirmation') THEN 0 ELSE 1 END`,
      asc(tasks.deadline),
      desc(tasks.createdAt)
    )
    .limit(limit)
    .offset(offset);

  return rows.map((r: any) => ({
    id: r.id,
    parentId: r.parentId,
    userJid: r.userJid,
    phoneNumber: r.userJid.replace('@s.whatsapp.net', ''),
    userName: r.userName || null,
    task: r.task,
    deadline: r.deadline ? new Date(r.deadline).toISOString() : null,
    remindAt: r.remindAt ? new Date(r.remindAt).toISOString() : null,
    status: r.status,
    reminded: r.reminded,
    attachmentCount: Number(r.attachmentCount || 0),
    subtaskCount: Number(r.subtaskCount || 0),
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
    updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
  }));
}

export async function countDashboardTasks(
  db: any,
  query: { status?: string; search?: string; userJid?: string } = {}
): Promise<number> {
  if (!db) return 0;
  const conditions = [];
  if (query.userJid) {
    conditions.push(eq(tasks.userJid, query.userJid));
  }
  if (query.status && query.status !== 'all') {
    if (query.status === 'active') {
      conditions.push(inArray(tasks.status, ACTIVE_TASK_STATUSES));
    } else if (query.status === 'overdue') {
      conditions.push(eq(tasks.status, 'pending'));
      conditions.push(lte(tasks.deadline, new Date()));
    } else {
      conditions.push(eq(tasks.status, query.status));
    }
  }
  if (query.search && query.search.trim()) {
    conditions.push(ilike(tasks.task, `%${query.search.trim()}%`));
  }

  const countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks);

  const finalQuery = conditions.length > 0 ? countQuery.where(and(...conditions)) : countQuery;
  const res = await finalQuery;
  return Number(res[0]?.count || 0);
}

export async function getDashboardTaskDetail(db: any, taskId: number) {
  if (!db || !taskId) return null;

  const mainTask = await db
    .select({
      id: tasks.id,
      parentId: tasks.parentId,
      userJid: tasks.userJid,
      userName: userSettings.name,
      userTimezone: userSettings.timezone,
      task: tasks.task,
      deadline: tasks.deadline,
      remindAt: tasks.remindAt,
      status: tasks.status,
      reminded: tasks.reminded,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .leftJoin(userSettings, eq(userSettings.userJid, tasks.userJid))
    .where(eq(tasks.id, taskId))
    .limit(1);

  if (!mainTask.length || !mainTask[0]) {
    return null;
  }

  const task = mainTask[0];

  let parentTask = null;
  if (task.parentId) {
    const parentRows = await db
      .select({ id: tasks.id, task: tasks.task, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, task.parentId))
      .limit(1);
    parentTask = parentRows[0] || null;
  }

  const subtasks = await db
    .select({
      id: tasks.id,
      task: tasks.task,
      status: tasks.status,
      deadline: tasks.deadline,
      reminded: tasks.reminded,
    })
    .from(tasks)
    .where(eq(tasks.parentId, taskId))
    .orderBy(asc(tasks.id));

  const attachments = await db
    .select({
      id: taskAttachments.id,
      fileName: taskAttachments.fileName,
      fileType: taskAttachments.fileType,
      mimeType: taskAttachments.mimeType,
      fileSize: taskAttachments.fileSize,
      safetyStatus: taskAttachments.safetyStatus,
      ocrExtractedText: taskAttachments.ocrExtractedText,
      createdAt: taskAttachments.createdAt,
    })
    .from(taskAttachments)
    .where(eq(taskAttachments.taskId, taskId))
    .orderBy(desc(taskAttachments.createdAt));

  const history = await db
    .select({
      id: taskHistory.id,
      changeType: taskHistory.changeType,
      fieldChanged: taskHistory.fieldChanged,
      oldValue: taskHistory.oldValue,
      newValue: taskHistory.newValue,
      rawInput: taskHistory.rawInput,
      createdAt: taskHistory.createdAt,
    })
    .from(taskHistory)
    .where(eq(taskHistory.taskId, taskId))
    .orderBy(asc(taskHistory.createdAt));

  const messages = await db
    .select({
      id: taskMessages.id,
      messageId: taskMessages.messageId,
      createdAt: taskMessages.createdAt,
    })
    .from(taskMessages)
    .where(eq(taskMessages.taskId, taskId))
    .orderBy(desc(taskMessages.createdAt));

  return {
    task: {
      id: task.id,
      parentId: task.parentId,
      userJid: task.userJid,
      phoneNumber: task.userJid.replace('@s.whatsapp.net', ''),
      userName: task.userName || null,
      userTimezone: task.userTimezone || 'Asia/Jakarta',
      task: task.task,
      deadline: task.deadline ? new Date(task.deadline).toISOString() : null,
      remindAt: task.remindAt ? new Date(task.remindAt).toISOString() : null,
      status: task.status,
      reminded: task.reminded,
      createdAt: task.createdAt ? new Date(task.createdAt).toISOString() : null,
      updatedAt: task.updatedAt ? new Date(task.updatedAt).toISOString() : null,
    },
    parentTask,
    subtasks: subtasks.map((s: any) => ({
      id: s.id,
      task: s.task,
      status: s.status,
      deadline: s.deadline ? new Date(s.deadline).toISOString() : null,
      reminded: s.reminded,
    })),
    attachments: attachments.map((a: any) => ({
      id: a.id,
      fileName: a.fileName,
      fileType: a.fileType,
      mimeType: a.mimeType,
      fileSize: a.fileSize,
      safetyStatus: a.safetyStatus,
      ocrExtractedText: a.ocrExtractedText,
      createdAt: a.createdAt ? new Date(a.createdAt).toISOString() : null,
    })),
    history: history.map((h: any) => ({
      id: h.id,
      changeType: h.changeType,
      fieldChanged: h.fieldChanged,
      oldValue: h.oldValue,
      newValue: h.newValue,
      rawInput: h.rawInput,
      createdAt: h.createdAt ? new Date(h.createdAt).toISOString() : null,
    })),
    messages: messages.map((m: any) => ({
      id: m.id,
      messageId: m.messageId,
      createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : null,
    })),
  };
}

export async function rescheduleDashboardTask(
  db: any,
  params: { taskId: number; newDeadline: Date; leadMinutes?: number }
) {
  if (!db) throw new Error('Database not configured');
  const existing = await db.select().from(tasks).where(eq(tasks.id, params.taskId)).limit(1);
  if (!existing || !existing[0]) return null;
  const task = existing[0];
  let leadMinutes = params.leadMinutes;
  if (!leadMinutes) {
    const userRow = await db
      .select({ lead: userSettings.leadReminderMinutes })
      .from(userSettings)
      .where(eq(userSettings.userJid, task.userJid))
      .limit(1);
    if (userRow[0]?.lead) {
      leadMinutes = userRow[0].lead;
    }
  }
  return rescheduleTask(db, {
    taskId: params.taskId,
    userJid: task.userJid,
    newDeadline: params.newDeadline,
    leadMinutes,
    rawInput: 'Dashboard Admin Reschedule',
  });
}

export async function listScheduledCrons(db: any) {
  const engine = [
    {
      id: 'reminder_dispatcher',
      name: 'Task Reminder Dispatcher',
      description: 'Memeriksa dan mengirimkan notifikasi pengingat WhatsApp untuk tugas yang jatuh tempo.',
      interval: 'Setiap 60 detik',
      enabled: runtimeHealth.reminderCronEnabled && !runtimeHealth.schedulerPaused,
      isPaused: !runtimeHealth.reminderCronEnabled || runtimeHealth.schedulerPaused,
      lastRunAt: runtimeHealth.lastReminderCycleAt?.toISOString() ?? null,
    },
    {
      id: 'morning_digest_dispatcher',
      name: 'Morning Digest Dispatcher',
      description: 'Menyusun ringkasan tugas harian dan pantun motivasi pagi hari bagi pengguna terdaftar.',
      interval: 'Setiap 60 detik',
      enabled: runtimeHealth.morningDigestCronEnabled && !runtimeHealth.schedulerPaused,
      isPaused: !runtimeHealth.morningDigestCronEnabled || runtimeHealth.schedulerPaused,
      lastRunAt: runtimeHealth.lastMorningDigestCycleAt?.toISOString() ?? null,
    },
  ];

  let upcomingReminders: any[] = [];
  let upcomingDigests: any[] = [];

  if (db) {
    const reminderRows = await db
      .select({
        id: tasks.id,
        task: tasks.task,
        userJid: tasks.userJid,
        userName: userSettings.name,
        deadline: tasks.deadline,
        remindAt: tasks.remindAt,
        status: tasks.status,
        reminded: tasks.reminded,
      })
      .from(tasks)
      .leftJoin(userSettings, eq(userSettings.userJid, tasks.userJid))
      .where(
        and(
          eq(tasks.status, 'pending'),
          eq(tasks.reminded, 0),
          sql`${tasks.remindAt} IS NOT NULL`
        )
      )
      .orderBy(asc(tasks.remindAt))
      .limit(50);

    const now = new Date();
    upcomingReminders = reminderRows.map((r: any) => ({
      id: r.id,
      task: r.task,
      userJid: r.userJid,
      phoneNumber: r.userJid.replace('@s.whatsapp.net', ''),
      userName: r.userName || null,
      deadline: r.deadline ? new Date(r.deadline).toISOString() : null,
      remindAt: r.remindAt ? new Date(r.remindAt).toISOString() : null,
      isDue: r.remindAt ? new Date(r.remindAt) <= now : false,
      status: r.status,
      reminded: r.reminded,
    }));

    const digestRows = await db
      .select({
        userJid: userSettings.userJid,
        name: userSettings.name,
        timezone: userSettings.timezone,
        morningDigestTime: userSettings.morningDigestTime,
      })
      .from(userSettings)
      .where(and(eq(userSettings.isAllowed, true), eq(userSettings.morningDigestEnabled, true)))
      .orderBy(asc(userSettings.morningDigestTime));

    upcomingDigests = digestRows.map((d: any) => ({
      userJid: d.userJid,
      phoneNumber: d.userJid.replace('@s.whatsapp.net', ''),
      name: d.name || null,
      timezone: d.timezone,
      morningDigestTime: d.morningDigestTime,
    }));
  }

  return {
    engine,
    upcomingReminders,
    upcomingDigests,
    schedulerPaused: runtimeHealth.schedulerPaused,
  };
}

export function toggleCronEngine(cronId: string, enabled?: boolean) {
  if (cronId === 'scheduler') {
    runtimeHealth.schedulerPaused = typeof enabled === 'boolean' ? !enabled : !runtimeHealth.schedulerPaused;
  } else if (cronId === 'reminder_dispatcher') {
    runtimeHealth.reminderCronEnabled = typeof enabled === 'boolean' ? enabled : !runtimeHealth.reminderCronEnabled;
  } else if (cronId === 'morning_digest_dispatcher') {
    runtimeHealth.morningDigestCronEnabled = typeof enabled === 'boolean' ? enabled : !runtimeHealth.morningDigestCronEnabled;
  } else {
    throw new Error('UNKNOWN_CRON_ID');
  }

  return {
    cronId,
    schedulerPaused: runtimeHealth.schedulerPaused,
    reminderCronEnabled: runtimeHealth.reminderCronEnabled,
    morningDigestCronEnabled: runtimeHealth.morningDigestCronEnabled,
  };
}

export async function disableTaskReminder(db: any, taskId: number) {
  if (!db || !taskId) throw new Error('Database and taskId are required');
  const existing = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!existing.length || !existing[0]) {
    return null;
  }
  const task = existing[0];
  const updated = await db
    .update(tasks)
    .set({
      reminded: 2,
      remindAt: null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId))
    .returning();

  await db.insert(taskHistory).values({
    taskId,
    userJid: task.userJid,
    changeType: 'cancel_reminder',
    fieldChanged: 'remind_at',
    oldValue: task.remindAt ? new Date(task.remindAt).toISOString() : null,
    newValue: 'DISABLED_BY_ADMIN',
    rawInput: 'Admin disabled reminder from dashboard to prevent spam/load',
  });

  return updated[0];
}

export async function toggleUserMorningDigest(db: any, userJid: string, enabled: boolean) {
  if (!db || !userJid) throw new Error('Database and userJid are required');
  const existing = await db.select().from(userSettings).where(eq(userSettings.userJid, userJid)).limit(1);
  if (!existing.length || !existing[0]) {
    return null;
  }
  const updated = await db
    .update(userSettings)
    .set({
      morningDigestEnabled: enabled,
      morningDigestUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(userSettings.userJid, userJid))
    .returning();

  return updated[0];
}

export function createDashboardHandler(options: {
  username: string;
  password: string;
  snapshot: () => Promise<unknown>;
  db?: any;
  sendReminder?: (taskId: number) => Promise<{ success: boolean; messageId?: string; error?: string }>;
}): (request: Request) => Promise<Response> {
  const dispatch = async (request: Request, pathname: string, url: URL): Promise<Response> => {
    if (request.method === 'GET') {
      if (pathname === '/') {
        return new Response(DASHBOARD_HTML, { headers: secureHeaders('text/html; charset=utf-8') });
      }
      if (pathname === '/dashboard.css') {
        return new Response(DASHBOARD_CSS, { headers: secureHeaders('text/css; charset=utf-8') });
      }
      if (pathname === '/dashboard.js') {
        return new Response(DASHBOARD_JS, { headers: secureHeaders('text/javascript; charset=utf-8') });
      }
      if (pathname === '/activity') {
        return new Response(ACTIVITY_HTML, { headers: secureHeaders('text/html; charset=utf-8') });
      }
      if (pathname === '/activity.css') {
        return new Response(ACTIVITY_CSS, { headers: secureHeaders('text/css; charset=utf-8') });
      }
      if (pathname === '/activity.js') {
        return new Response(ACTIVITY_JS, { headers: secureHeaders('text/javascript; charset=utf-8') });
      }
      if (pathname === '/settings') {
        return new Response(SETTINGS_HTML, { headers: secureHeaders('text/html; charset=utf-8') });
      }
      if (pathname === '/llm') {
        return new Response(LLM_HTML, { headers: secureHeaders('text/html; charset=utf-8') });
      }
      if (pathname === '/llm.css') {
        return new Response(LLM_CSS, { headers: secureHeaders('text/css; charset=utf-8') });
      }
      if (pathname === '/llm.js') {
        return new Response(LLM_JS, { headers: secureHeaders('text/javascript; charset=utf-8') });
      }
      if (pathname === '/api/llm-calls') {
        return Response.json(listLlmCalls(url.searchParams), { headers: secureHeaders('application/json; charset=utf-8') });
      }
      if (pathname === '/api/llm-calls/detail') {
        const call = llmCallLog.get(url.searchParams.get('id') || '');
        if (!call) {
          return Response.json({ error: 'CALL_NOT_FOUND' }, { status: 404, headers: secureHeaders('application/json; charset=utf-8') });
        }
        return Response.json(call, { headers: secureHeaders('application/json; charset=utf-8') });
      }
      if (pathname === '/settings.css') {
        return new Response(SETTINGS_CSS, { headers: secureHeaders('text/css; charset=utf-8') });
      }
      if (pathname === '/settings.js') {
        return new Response(SETTINGS_JS, { headers: secureHeaders('text/javascript; charset=utf-8') });
      }
      if (pathname === '/api/settings') {
        try {
          const adminInstagram = await getAdminInstagram(options.db);
          return Response.json({ adminInstagram }, { headers: secureHeaders('application/json; charset=utf-8') });
        } catch (err: any) {
          return Response.json(
            { error: err?.message || 'FAILED_TO_GET_SETTINGS' },
            { status: 500, headers: secureHeaders('application/json; charset=utf-8') }
          );
        }
      }
      if (pathname === '/api/activity') {
        try {
          const filter = url.searchParams.get('filter') || 'all';
          const activity = await buildDashboardActivity(options.db, filter);
          return Response.json(activity, { headers: secureHeaders('application/json; charset=utf-8') });
        } catch (err: any) {
          return Response.json(
            { error: err?.message || 'FAILED_TO_BUILD_ACTIVITY' },
            { status: 500, headers: secureHeaders('application/json; charset=utf-8') }
          );
        }
      }
      if (pathname === '/api/snapshot') {
        try {
          return Response.json(await options.snapshot(), { headers: secureHeaders('application/json; charset=utf-8') });
        } catch {
          return Response.json(
            { error: 'DASHBOARD_SNAPSHOT_UNAVAILABLE' },
            { status: 503, headers: secureHeaders('application/json; charset=utf-8') }
          );
        }
      }
      if (pathname === '/api/users') {
        try {
          const users = await listDashboardUsers(options.db);
          return Response.json(users, { headers: secureHeaders('application/json; charset=utf-8') });
        } catch (err: any) {
          return Response.json(
            { error: err?.message || 'FAILED_TO_LIST_USERS' },
            { status: 500, headers: secureHeaders('application/json; charset=utf-8') }
          );
        }
      }
      if (pathname === '/api/tasks') {
        try {
          const status = url.searchParams.get('status') || undefined;
          const search = url.searchParams.get('search') || undefined;
          const userJid = url.searchParams.get('userJid') || undefined;
          const limit = url.searchParams.has('limit') ? parseInt(url.searchParams.get('limit')!, 10) : undefined;
          const offset = url.searchParams.has('offset') ? parseInt(url.searchParams.get('offset')!, 10) : undefined;
          const [tasksList, totalCount] = await Promise.all([
            listDashboardTasks(options.db, { status, search, userJid, limit, offset }),
            countDashboardTasks(options.db, { status, search, userJid }),
          ]);
          const headers = secureHeaders('application/json; charset=utf-8');
          headers.set('x-total-count', String(totalCount));
          headers.set('x-limit', String(limit || 50));
          headers.set('x-offset', String(offset || 0));
          return Response.json(tasksList, { headers });
        } catch (err: any) {
          return Response.json(
            { error: err?.message || 'FAILED_TO_LIST_TASKS' },
            { status: 500, headers: secureHeaders('application/json; charset=utf-8') }
          );
        }
      }
      if (pathname === '/api/tasks/detail') {
        try {
          const rawId = url.searchParams.get('id');
          const taskId = rawId ? parseInt(rawId, 10) : NaN;
          if (isNaN(taskId) || taskId <= 0) {
            return Response.json({ error: 'INVALID_TASK_ID' }, { status: 400, headers: secureHeaders('application/json; charset=utf-8') });
          }
          const detail = await getDashboardTaskDetail(options.db, taskId);
          if (!detail) {
            return Response.json({ error: 'TASK_NOT_FOUND' }, { status: 404, headers: secureHeaders('application/json; charset=utf-8') });
          }
          return Response.json(detail, { headers: secureHeaders('application/json; charset=utf-8') });
        } catch (err: any) {
          return Response.json(
            { error: err?.message || 'FAILED_TO_GET_TASK_DETAIL' },
            { status: 500, headers: secureHeaders('application/json; charset=utf-8') }
          );
        }
      }
      if (pathname === '/api/crons') {
        try {
          const crons = await listScheduledCrons(options.db);
          return Response.json(crons, { headers: secureHeaders('application/json; charset=utf-8') });
        } catch (err: any) {
          return Response.json(
            { error: err?.message || 'FAILED_TO_LIST_CRONS' },
            { status: 500, headers: secureHeaders('application/json; charset=utf-8') }
          );
        }
      }
      return new Response('Not found', { status: 404, headers: secureHeaders('text/plain; charset=utf-8') });
    }

    if (request.method === 'POST') {
      if (pathname === '/api/crons/engine/toggle') {
        try {
          const body = (await request.json().catch(() => ({}))) as any;
          if (!body?.cronId) {
            return Response.json({ error: 'MISSING_CRON_ID' }, { status: 400, headers: secureHeaders('application/json; charset=utf-8') });
          }
          const result = toggleCronEngine(body.cronId, body.enabled);
          return Response.json({ success: true, ...result }, { headers: secureHeaders('application/json; charset=utf-8') });
        } catch (err: any) {
          return Response.json({ error: err?.message || 'FAILED_TO_TOGGLE_CRON_ENGINE' }, { status: 500, headers: secureHeaders('application/json; charset=utf-8') });
        }
      }

      if (pathname === '/api/crons/reminders/disable') {
        try {
          const body = (await request.json().catch(() => ({}))) as any;
          const taskId = Number(body?.taskId);
          if (!taskId || taskId <= 0) {
            return Response.json({ error: 'INVALID_TASK_ID' }, { status: 400, headers: secureHeaders('application/json; charset=utf-8') });
          }
          const result = await disableTaskReminder(options.db, taskId);
          if (!result) {
            return Response.json({ error: 'TASK_NOT_FOUND' }, { status: 404, headers: secureHeaders('application/json; charset=utf-8') });
          }
          return Response.json({ success: true, task: result }, { headers: secureHeaders('application/json; charset=utf-8') });
        } catch (err: any) {
          return Response.json({ error: err?.message || 'FAILED_TO_DISABLE_TASK_REMINDER' }, { status: 500, headers: secureHeaders('application/json; charset=utf-8') });
        }
      }

      if (pathname === '/api/tasks/reschedule') {
        try {
          const body = (await request.json().catch(() => ({}))) as any;
          const taskId = Number(body?.taskId);
          if (!taskId || taskId <= 0) {
            return Response.json({ error: 'INVALID_TASK_ID' }, { status: 400, headers: secureHeaders('application/json; charset=utf-8') });
          }
          if (!body?.newDeadline) {
            return Response.json({ error: 'MISSING_NEW_DEADLINE' }, { status: 400, headers: secureHeaders('application/json; charset=utf-8') });
          }
          const newDeadline = new Date(body.newDeadline);
          if (isNaN(newDeadline.getTime())) {
            return Response.json({ error: 'INVALID_NEW_DEADLINE' }, { status: 400, headers: secureHeaders('application/json; charset=utf-8') });
          }
          const leadMinutes = typeof body?.leadMinutes === 'number' && body.leadMinutes > 0 ? body.leadMinutes : undefined;
          const result = await rescheduleDashboardTask(options.db, { taskId, newDeadline, leadMinutes });
          if (!result) {
            return Response.json({ error: 'TASK_NOT_FOUND' }, { status: 404, headers: secureHeaders('application/json; charset=utf-8') });
          }
          return Response.json({ success: true, updatedTask: result.updatedTask }, { headers: secureHeaders('application/json; charset=utf-8') });
        } catch (err: any) {
          return Response.json({ error: err?.message || 'FAILED_TO_RESCHEDULE_TASK' }, { status: 500, headers: secureHeaders('application/json; charset=utf-8') });
        }
      }

      if (pathname === '/api/tasks/remind-now' || pathname === '/api/tasks/trigger-reminder') {
        try {
          const body = (await request.json().catch(() => ({}))) as any;
          const taskId = Number(body?.taskId);
          if (!taskId || isNaN(taskId) || taskId <= 0) {
            return Response.json(
              { error: 'INVALID_TASK_ID' },
              { status: 400, headers: secureHeaders('application/json; charset=utf-8') }
            );
          }

          const result = options.sendReminder
            ? await options.sendReminder(taskId)
            : await triggerTaskReminder(options.db, taskId);

          if (!result.success) {
            const statusCode =
              result.error === 'TASK_NOT_FOUND'
                ? 404
                : result.error === 'TASK_ALREADY_CLOSED'
                ? 409
                : result.error === 'WHATSAPP_NOT_CONNECTED'
                ? 503
                : 400;
            return Response.json(
              { error: result.error || 'FAILED_TO_SEND_REMINDER' },
              { status: statusCode, headers: secureHeaders('application/json; charset=utf-8') }
            );
          }

          return Response.json(
            { success: true, taskId, messageId: result.messageId },
            { headers: secureHeaders('application/json; charset=utf-8') }
          );
        } catch (err: any) {
          return Response.json(
            { error: err?.message || 'FAILED_TO_TRIGGER_REMINDER' },
            { status: 500, headers: secureHeaders('application/json; charset=utf-8') }
          );
        }
      }

      if (pathname === '/api/crons/digest/toggle') {
        try {
          const body = (await request.json().catch(() => ({}))) as any;
          if (!body?.userJid) {
            return Response.json({ error: 'MISSING_USER_JID' }, { status: 400, headers: secureHeaders('application/json; charset=utf-8') });
          }
          const enabled = Boolean(body.enabled);
          const result = await toggleUserMorningDigest(options.db, body.userJid, enabled);
          if (!result) {
            return Response.json({ error: 'USER_NOT_FOUND' }, { status: 404, headers: secureHeaders('application/json; charset=utf-8') });
          }
          return Response.json({ success: true, user: result }, { headers: secureHeaders('application/json; charset=utf-8') });
        } catch (err: any) {
          return Response.json({ error: err?.message || 'FAILED_TO_TOGGLE_USER_DIGEST' }, { status: 500, headers: secureHeaders('application/json; charset=utf-8') });
        }
      }

      if (pathname === '/api/users/toggle') {
        try {
          const body = (await request.json().catch(() => ({}))) as any;
          if (!body?.userJid) {
            return Response.json({ error: 'MISSING_USER_JID' }, { status: 400, headers: secureHeaders('application/json; charset=utf-8') });
          }
          const result = await toggleUserAllowed(options.db, body.userJid, body.isAllowed);
          if (!result) {
            return Response.json({ error: 'USER_NOT_FOUND' }, { status: 404, headers: secureHeaders('application/json; charset=utf-8') });
          }
          return Response.json({ success: true, user: result }, { headers: secureHeaders('application/json; charset=utf-8') });
        } catch (err: any) {
          return Response.json({ error: err?.message || 'FAILED_TO_TOGGLE_USER' }, { status: 500, headers: secureHeaders('application/json; charset=utf-8') });
        }
      }

      if (pathname === '/api/users/add') {
        try {
          const body = (await request.json().catch(() => ({}))) as any;
          if (!body?.phone) {
            return Response.json({ error: 'MISSING_PHONE_NUMBER' }, { status: 400, headers: secureHeaders('application/json; charset=utf-8') });
          }
          const user = await addUserToWhitelist(options.db, body.phone, body.name);
          return Response.json({ success: true, user }, { headers: secureHeaders('application/json; charset=utf-8') });
        } catch (err: any) {
          return Response.json({ error: err?.message || 'FAILED_TO_ADD_USER' }, { status: 400, headers: secureHeaders('application/json; charset=utf-8') });
        }
      }

      if (pathname === '/api/users/lead-time') {
        try {
          const body = (await request.json().catch(() => ({}))) as any;
          if (!body?.userJid) {
            return Response.json({ error: 'MISSING_USER_JID' }, { status: 400, headers: secureHeaders('application/json; charset=utf-8') });
          }
          const leadMinutes = Number(body?.leadMinutes);
          if (isNaN(leadMinutes) || leadMinutes < 1 || leadMinutes > 1440) {
            return Response.json({ error: 'INVALID_LEAD_MINUTES' }, { status: 400, headers: secureHeaders('application/json; charset=utf-8') });
          }
          const user = await updateUserLeadReminderMinutes(options.db, body.userJid, leadMinutes);
          if (!user) {
            return Response.json({ error: 'USER_NOT_FOUND' }, { status: 404, headers: secureHeaders('application/json; charset=utf-8') });
          }
          return Response.json({ success: true, user }, { headers: secureHeaders('application/json; charset=utf-8') });
        } catch (err: any) {
          return Response.json({ error: err?.message || 'FAILED_TO_UPDATE_LEAD_TIME' }, { status: 500, headers: secureHeaders('application/json; charset=utf-8') });
        }
      }

      if (pathname === '/api/users/delete') {
        try {
          const body = (await request.json().catch(() => ({}))) as any;
          if (!body?.userJid) {
            return Response.json({ error: 'MISSING_USER_JID' }, { status: 400, headers: secureHeaders('application/json; charset=utf-8') });
          }
          const success = await deleteDashboardUser(options.db, body.userJid);
          return Response.json({ success }, { headers: secureHeaders('application/json; charset=utf-8') });
        } catch (err: any) {
          return Response.json({ error: err?.message || 'FAILED_TO_DELETE_USER' }, { status: 500, headers: secureHeaders('application/json; charset=utf-8') });
        }
      }

      if (pathname === '/api/settings') {
        try {
          const body = (await request.json().catch(() => ({}))) as any;
          if (body?.adminInstagram === undefined || typeof body.adminInstagram !== 'string') {
            return Response.json(
              { error: 'MISSING_OR_INVALID_ADMIN_INSTAGRAM' },
              { status: 400, headers: secureHeaders('application/json; charset=utf-8') }
            );
          }
          const saved = await setAdminInstagram(options.db, body.adminInstagram);
          return Response.json(
            { success: true, adminInstagram: saved },
            { headers: secureHeaders('application/json; charset=utf-8') }
          );
        } catch (err: any) {
          return Response.json(
            { error: err?.message || 'FAILED_TO_SAVE_SETTINGS' },
            { status: 500, headers: secureHeaders('application/json; charset=utf-8') }
          );
        }
      }

      if (pathname === '/api/snapshot' || pathname === '/api/activity') {
        const headers = secureHeaders('text/plain; charset=utf-8');
        headers.set('allow', 'GET');
        return new Response('Method not allowed', { status: 405, headers });
      }

      return new Response('Not found', { status: 404, headers: secureHeaders('text/plain; charset=utf-8') });
    }

    const headers = secureHeaders('text/plain; charset=utf-8');
    headers.set('allow', 'GET, POST');
    return new Response('Method not allowed', { status: 405, headers });
  };

  return async (request: Request) => {
    const startTime = performance.now();
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (!isAuthorized(request, options.username, options.password)) {
      recordHttpRequest(pathname, 401, Math.round(performance.now() - startTime));
      const headers = secureHeaders('text/plain; charset=utf-8');
      headers.set('www-authenticate', 'Basic realm="Todo Bot Monitoring", charset="UTF-8"');
      return new Response('Authentication required', { status: 401, headers });
    }

    let recordedStatus = 200;
    try {
      const response = await dispatch(request, pathname, url);
      recordedStatus = response.status;
      return response;
    } catch (err) {
      recordedStatus = 500;
      throw err;
    } finally {
      const durationMs = Math.round(performance.now() - startTime);
      recordHttpRequest(pathname, recordedStatus, durationMs);
    }
  };
}

export function startDashboardServer(options: {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  db: any;
  sendReminder?: (taskId: number) => Promise<{ success: boolean; messageId?: string; error?: string }>;
}): ReturnType<typeof Bun.serve> | null {
  if (!options.enabled) return null;
  if (!options.username || options.password.length < 16) {
    throw new Error('Dashboard requires DASHBOARD_USERNAME and a DASHBOARD_PASSWORD of at least 16 characters');
  }
  const handler = createDashboardHandler({
    username: options.username,
    password: options.password,
    snapshot: () => buildDashboardSnapshot(options.db),
    db: options.db,
    sendReminder: options.sendReminder,
  });
  return Bun.serve({ hostname: options.host, port: options.port, fetch: handler });
}
