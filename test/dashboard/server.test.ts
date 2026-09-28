import { describe, expect, it } from 'bun:test';
import { createDashboardHandler } from '../../src/dashboard/server.js';

describe('Monitoring dashboard HTTP boundary', () => {
  const snapshot = async () => ({
    generatedAt: '2026-09-29T00:00:00.000Z',
    health: { whatsappStatus: 'connected' },
    tasks: { pending: 2 },
    usage: [],
    recentErrors: [],
  });

  it('fails closed without valid basic authentication', async () => {
    const handler = createDashboardHandler({ username: 'admin', password: 'a-secure-password-123', snapshot });
    const response = await handler(new Request('http://localhost/api/snapshot'));

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Basic');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('serves a privacy-safe snapshot with security headers after authentication', async () => {
    const handler = createDashboardHandler({ username: 'admin', password: 'a-secure-password-123', snapshot });
    const credentials = Buffer.from('admin:a-secure-password-123').toString('base64');
    const response = await handler(new Request('http://localhost/api/snapshot', {
      headers: { authorization: `Basic ${credentials}` },
    }));
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(body.health.whatsappStatus).toBe('connected');
    expect(JSON.stringify(body)).not.toContain('userJid');
  });

  it('serves an accessible dashboard shell and rejects non-GET methods', async () => {
    const handler = createDashboardHandler({ username: 'admin', password: 'a-secure-password-123', snapshot });
    const credentials = Buffer.from('admin:a-secure-password-123').toString('base64');
    const headers = { authorization: `Basic ${credentials}` };

    const page = await handler(new Request('http://localhost/', { headers }));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<main');

    const post = await handler(new Request('http://localhost/api/snapshot', { method: 'POST', headers }));
    expect(post.status).toBe(405);
  });
});
