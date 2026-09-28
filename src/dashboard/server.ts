import { timingSafeEqual } from 'node:crypto';
import { desc, eq, gte, sql } from 'drizzle-orm';
import {
  taskAttachments,
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
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
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

    const pathname = new URL(request.url).pathname;

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
      return new Response('Not found', { status: 404, headers: secureHeaders('text/plain; charset=utf-8') });
    }

    if (request.method === 'POST') {
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
