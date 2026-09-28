import { timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, gte, ilike, or, sql } from 'drizzle-orm';
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
import { config } from '../config/index.js';
import { DASHBOARD_CSS, DASHBOARD_HTML, DASHBOARD_JS } from './assets.js';

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
  const [taskRows, userRows, storageRows, usageRows, errorRows] = await Promise.all([
    db
      .select({ status: tasks.status, count: sql<number>`count(*)::int` })
      .from(tasks)
      .groupBy(tasks.status),
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
      .where(eq(telemetryEvents.outcome, 'failed'))
      .orderBy(desc(telemetryEvents.occurredAt))
      .limit(20),
  ]);

  const taskCounts = Object.fromEntries(taskRows.map((row: any) => [row.status, Number(row.count)]));
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
  query: { status?: string; search?: string; userJid?: string; limit?: number } = {}
) {
  if (!db) return [];
  const limit = Math.min(Math.max(query.limit || 50, 1), 200);

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
      conditions.push(or(eq(tasks.status, 'pending'), eq(tasks.status, 'pending_deadline')));
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
      sql`CASE WHEN ${tasks.status} IN ('pending', 'pending_deadline') THEN 0 ELSE 1 END`,
      asc(tasks.deadline),
      desc(tasks.createdAt)
    )
    .limit(limit);

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
}): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (!isAuthorized(request, options.username, options.password)) {
      const headers = secureHeaders('text/plain; charset=utf-8');
      headers.set('www-authenticate', 'Basic realm="Todo Bot Monitoring", charset="UTF-8"');
      return new Response('Authentication required', { status: 401, headers });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

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
          const tasksList = await listDashboardTasks(options.db, { status, search, userJid, limit });
          return Response.json(tasksList, { headers: secureHeaders('application/json; charset=utf-8') });
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

      if (pathname === '/api/snapshot') {
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
}

export function startDashboardServer(options: {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  db: any;
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
  });
  return Bun.serve({ hostname: options.host, port: options.port, fetch: handler });
}
