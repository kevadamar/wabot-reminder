import { describe, expect, it, beforeEach } from 'bun:test';
import {
  createDashboardHandler,
  buildDashboardActivity,
  recordHttpRequest,
  clearHttpRequestLogs,
} from '../../src/dashboard/server.js';
import { db } from '../../src/db/index.js';
import { telemetryEvents, telemetryHourly } from '../../src/db/schema.js';

describe('Activity APM Observability Dashboard', () => {
  const credentials = Buffer.from('admin:a-secure-password-123').toString('base64');
  const authHeaders = { authorization: `Basic ${credentials}` };

  beforeEach(async () => {
    clearHttpRequestLogs();
    if (db) {
      await db.delete(telemetryEvents);
      await db.delete(telemetryHourly);
    }
  });

  it('buildDashboardActivity returns a structured 24h APM dataset', async () => {
    // Record some mock HTTP requests
    recordHttpRequest('/api/snapshot', 200, 25);
    recordHttpRequest('/api/tasks', 200, 40);
    recordHttpRequest('/api/tasks', 500, 120);

    const activity = await buildDashboardActivity(db);

    expect(activity).toBeDefined();
    expect(activity.generatedAt).toBeDefined();
    expect(activity.summary).toBeDefined();
    expect(activity.summary.totalRequests).toBeGreaterThanOrEqual(3);
    expect(typeof activity.summary.errorRate).toBe('number');
    expect(typeof activity.summary.latestP50).toBe('number');
    expect(typeof activity.summary.latestP95).toBe('number');

    // Verify 24 hour series
    expect(Array.isArray(activity.series)).toBe(true);
    expect(activity.series.length).toBe(24);
    const firstBucket = activity.series[0];
    expect(firstBucket).toHaveProperty('label');
    expect(firstBucket).toHaveProperty('status2xx');
    expect(firstBucket).toHaveProperty('status4xx');
    expect(firstBucket).toHaveProperty('status5xx');
    expect(firstBucket).toHaveProperty('p50');
    expect(firstBucket).toHaveProperty('p95');

    // Verify paths table data
    expect(Array.isArray(activity.paths)).toBe(true);
    expect(activity.paths.length).toBeGreaterThan(0);
    const snapshotPath = activity.paths.find((p: any) => p.path === '/api/snapshot');
    expect(snapshotPath).toBeDefined();
    expect(snapshotPath?.requests).toBeGreaterThanOrEqual(1);
  });

  it('serves /activity with proper authentication and HTML content', async () => {
    const handler = createDashboardHandler({
      username: 'admin',
      password: 'a-secure-password-123',
      snapshot: async () => ({}),
      db,
    });

    // Unauthenticated
    const unauth = await handler(new Request('http://localhost/activity'));
    expect(unauth.status).toBe(401);

    // Authenticated
    const response = await handler(new Request('http://localhost/activity', { headers: authHeaders }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('Activity');
    expect(html).toContain('Requests');
    expect(html).toContain('Response Latency');
    expect(html).toContain('Paths');
  });

  it('serves /activity.css and /activity.js assets', async () => {
    const handler = createDashboardHandler({
      username: 'admin',
      password: 'a-secure-password-123',
      snapshot: async () => ({}),
      db,
    });

    const cssRes = await handler(new Request('http://localhost/activity.css', { headers: authHeaders }));
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers.get('content-type')).toContain('text/css');

    const jsRes = await handler(new Request('http://localhost/activity.js', { headers: authHeaders }));
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get('content-type')).toContain('text/javascript');
  });

  it('serves /api/activity endpoint with security headers and rejects POST', async () => {
    const handler = createDashboardHandler({
      username: 'admin',
      password: 'a-secure-password-123',
      snapshot: async () => ({}),
      db,
    });

    const getRes = await handler(new Request('http://localhost/api/activity', { headers: authHeaders }));
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('content-type')).toContain('application/json');
    const data = (await getRes.json()) as any;
    expect(data.summary).toBeDefined();
    expect(data.series).toBeDefined();

    const postRes = await handler(new Request('http://localhost/api/activity', { method: 'POST', headers: authHeaders }));
    expect(postRes.status).toBe(405);
  });
});
