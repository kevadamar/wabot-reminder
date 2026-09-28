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

export function createDashboardHandler(options: {
  username: string;
  password: string;
  snapshot: () => Promise<unknown>;
}): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (!isAuthorized(request, options.username, options.password)) {
      const headers = secureHeaders('text/plain; charset=utf-8');
      headers.set('www-authenticate', 'Basic realm="Todo Bot Monitoring", charset="UTF-8"');
      return new Response('Authentication required', { status: 401, headers });
    }
    if (request.method !== 'GET') {
      const headers = secureHeaders('text/plain; charset=utf-8');
      headers.set('allow', 'GET');
      return new Response('Method not allowed', { status: 405, headers });
    }

    const pathname = new URL(request.url).pathname;
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
    return new Response('Not found', { status: 404, headers: secureHeaders('text/plain; charset=utf-8') });
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
  });
  return Bun.serve({ hostname: options.host, port: options.port, fetch: handler });
}
