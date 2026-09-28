import { describe, expect, it, beforeEach } from 'bun:test';
import {
  createDashboardHandler,
  normalizePhoneNumberToJid,
  listDashboardUsers,
  toggleUserAllowed,
  addUserToWhitelist,
  deleteDashboardUser,
} from '../../src/dashboard/server.js';
import { db } from '../../src/db/index.js';
import { tasks, userSettings } from '../../src/db/schema.js';

describe('Monitoring dashboard HTTP boundary & user whitelist management', () => {
  const snapshot = async () => ({
    generatedAt: '2026-09-29T00:00:00.000Z',
    health: { whatsappStatus: 'connected' },
    tasks: { pending: 2 },
    usage: [],
    recentErrors: [],
  });

  const credentials = Buffer.from('admin:a-secure-password-123').toString('base64');
  const authHeaders = { authorization: `Basic ${credentials}` };

  beforeEach(async () => {
    await db.delete(tasks);
    await db.delete(userSettings);
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
    const response = await handler(new Request('http://localhost/api/snapshot', {
      headers: authHeaders,
    }));
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(body.health.whatsappStatus).toBe('connected');
    expect(JSON.stringify(body)).not.toContain('userJid');
  });

  it('serves an accessible dashboard shell with section 06 and rejects non-GET snapshot', async () => {
    const handler = createDashboardHandler({ username: 'admin', password: 'a-secure-password-123', snapshot });

    const page = await handler(new Request('http://localhost/', { headers: authHeaders }));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<main');
    expect(html).toContain('User Whitelist & Access Management');

    const post = await handler(new Request('http://localhost/api/snapshot', { method: 'POST', headers: authHeaders }));
    expect(post.status).toBe(405);
  });

  it('normalizes phone numbers to standard WhatsApp JIDs properly', () => {
    expect(normalizePhoneNumberToJid('08123456789')).toBe('628123456789@s.whatsapp.net');
    expect(normalizePhoneNumberToJid('+62 812-3456-7890')).toBe('6281234567890@s.whatsapp.net');
    expect(normalizePhoneNumberToJid('62899887766')).toBe('62899887766@s.whatsapp.net');
    expect(normalizePhoneNumberToJid('123')).toBeNull(); // too short
    expect(normalizePhoneNumberToJid('')).toBeNull();
  });

  it('lists users and allows adding, toggling, and deleting users via dashboard API', async () => {
    const handler = createDashboardHandler({
      username: 'admin',
      password: 'a-secure-password-123',
      snapshot,
      db,
    });

    // 1. Initially users list is empty
    const listRes1 = await handler(new Request('http://localhost/api/users', { headers: authHeaders }));
    expect(listRes1.status).toBe(200);
    expect(await listRes1.json()).toEqual([]);

    // 2. Add a new user via POST /api/users/add
    const addRes = await handler(
      new Request('http://localhost/api/users/add', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '081299988877', name: 'Budi Test' }),
      })
    );
    expect(addRes.status).toBe(200);
    const addBody = (await addRes.json()) as any;
    expect(addBody.success).toBe(true);
    expect(addBody.user.userJid).toBe('6281299988877@s.whatsapp.net');
    expect(addBody.user.isAllowed).toBe(true);

    // 3. Verify user in GET /api/users
    const listRes2 = await handler(new Request('http://localhost/api/users', { headers: authHeaders }));
    const users = (await listRes2.json()) as any[];
    expect(users.length).toBe(1);
    expect(users[0]?.phoneNumber).toBe('6281299988877');
    expect(users[0]?.name).toBe('Budi Test');
    expect(users[0]?.isAllowed).toBe(true);

    // 4. Toggle access off via POST /api/users/toggle
    const toggleRes1 = await handler(
      new Request('http://localhost/api/users/toggle', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ userJid: '6281299988877@s.whatsapp.net' }),
      })
    );
    expect(toggleRes1.status).toBe(200);
    const toggleBody1 = (await toggleRes1.json()) as any;
    expect(toggleBody1.user.isAllowed).toBe(false);

    // 5. Toggle access back on via POST /api/users/toggle with explicit isAllowed: true
    const toggleRes2 = await handler(
      new Request('http://localhost/api/users/toggle', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ userJid: '6281299988877@s.whatsapp.net', isAllowed: true }),
      })
    );
    expect(toggleRes2.status).toBe(200);
    const toggleBody2 = (await toggleRes2.json()) as any;
    expect(toggleBody2.user.isAllowed).toBe(true);

    // 6. Delete user via POST /api/users/delete
    const delRes = await handler(
      new Request('http://localhost/api/users/delete', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ userJid: '6281299988877@s.whatsapp.net' }),
      })
    );
    expect(delRes.status).toBe(200);
    const delBody = (await delRes.json()) as any;
    expect(delBody.success).toBe(true);

    // 7. Verify user is gone
    const listRes3 = await handler(new Request('http://localhost/api/users', { headers: authHeaders }));
    expect(await listRes3.json()).toEqual([]);
  });

  it('handles invalid user requests gracefully', async () => {
    const handler = createDashboardHandler({
      username: 'admin',
      password: 'a-secure-password-123',
      snapshot,
      db,
    });

    // Add with missing phone
    const addBad = await handler(
      new Request('http://localhost/api/users/add', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Tanpa Nomor' }),
      })
    );
    expect(addBad.status).toBe(400);

    // Toggle non-existent user
    const toggle404 = await handler(
      new Request('http://localhost/api/users/toggle', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ userJid: '62800000000@s.whatsapp.net' }),
      })
    );
    expect(toggle404.status).toBe(404);
  });
});
