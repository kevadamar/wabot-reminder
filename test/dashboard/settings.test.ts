import { describe, expect, it, beforeEach } from 'bun:test';
import { createDashboardHandler } from '../../src/dashboard/server.js';
import { db } from '../../src/db/index.js';
import { botSettings } from '../../src/db/schema.js';
import {
  getAdminInstagram,
  setAdminInstagram,
  getNlpCustomRules,
  setNlpCustomRules,
} from '../../src/services/settings.js';

describe('Bot Settings Dashboard & API', () => {
  const snapshot = async () => ({
    generatedAt: '2026-10-01T00:00:00.000Z',
    health: { whatsappStatus: 'connected' },
    tasks: { pending: 0 },
    usage: [],
    recentErrors: [],
  });

  const credentials = Buffer.from('admin:a-secure-password-123').toString('base64');
  const authHeaders = { authorization: `Basic ${credentials}` };

  beforeEach(async () => {
    if (db) {
      await db.delete(botSettings);
    }
  });

  it('serves /settings with HTML containing configuration controls', async () => {
    const handler = createDashboardHandler({ username: 'admin', password: 'a-secure-password-123', snapshot, db });
    const response = await handler(new Request('http://localhost/settings', { headers: authHeaders }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('Bot Settings');
    expect(html).toContain('admin-instagram-input');
    expect(html).toContain('save-settings-btn');
    expect(html).toContain('preview-handle');
  });

  it('serves /settings.css and /settings.js with correct MIME types', async () => {
    const handler = createDashboardHandler({ username: 'admin', password: 'a-secure-password-123', snapshot, db });

    const cssRes = await handler(new Request('http://localhost/settings.css', { headers: authHeaders }));
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers.get('content-type')).toContain('text/css');

    const jsRes = await handler(new Request('http://localhost/settings.js', { headers: authHeaders }));
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get('content-type')).toContain('text/javascript');
  });

  it('GET /api/settings returns fallback when no custom handle is set', async () => {
    const handler = createDashboardHandler({ username: 'admin', password: 'a-secure-password-123', snapshot, db });
    const response = await handler(new Request('http://localhost/api/settings', { headers: authHeaders }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.adminInstagram).toBeDefined();
    expect(body.adminInstagram.startsWith('@')).toBe(true);
  });

  it('POST /api/settings updates handle and persists it', async () => {
    const handler = createDashboardHandler({ username: 'admin', password: 'a-secure-password-123', snapshot, db });

    // Update with username without '@'
    const updateRes = await handler(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ adminInstagram: 'custom_admin_handle' }),
      })
    );

    expect(updateRes.status).toBe(200);
    const updateBody = (await updateRes.json()) as any;
    expect(updateBody.success).toBe(true);
    expect(updateBody.adminInstagram).toBe('@custom_admin_handle');

    // Verify GET /api/settings reflects the updated handle
    const getRes = await handler(new Request('http://localhost/api/settings', { headers: authHeaders }));
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as any;
    expect(getBody.adminInstagram).toBe('@custom_admin_handle');

    // Verify settings service reads the same handle
    const handleFromDb = await getAdminInstagram(db);
    expect(handleFromDb).toBe('@custom_admin_handle');
  });

  it('POST /api/settings validates payload properly', async () => {
    const handler = createDashboardHandler({ username: 'admin', password: 'a-secure-password-123', snapshot, db });

    // Invalid missing payload
    const res = await handler(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe('MISSING_OR_INVALID_ADMIN_INSTAGRAM');
  });

  it('getAdminInstagram and setAdminInstagram service methods handle prefixing and fallback', async () => {
    // Falls back if empty string
    const fallback = await setAdminInstagram(db, '');
    expect(fallback).toBe('@kevadamar');

    // Strips excess whitespace and adds @
    const saved = await setAdminInstagram(db, '   my_awesome_admin   ');
    expect(saved).toBe('@my_awesome_admin');

    const retrieved = await getAdminInstagram(db);
    expect(retrieved).toBe('@my_awesome_admin');
  });

  it('serves /settings with HTML containing Section 02 NLP configuration controls', async () => {
    const handler = createDashboardHandler({ username: 'admin', password: 'a-secure-password-123', snapshot, db });
    const response = await handler(new Request('http://localhost/settings', { headers: authHeaders }));

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Aturan & Frasa Parser NLP (Bahasa Indonesia)');
    expect(html).toContain('nlp-settings-form');
    expect(html).toContain('nlp-verbs-input');
    expect(html).toContain('nlp-phrases-input');
    expect(html).toContain('nlp-keywords-input');
    expect(html).toContain('nlp-stopwords-input');
    expect(html).toContain('save-nlp-btn');
    expect(html).toContain('reset-nlp-btn');
    expect(html).toContain('nlp-test-btn');
  });

  it('GET /api/settings returns nlpRules and POST /api/settings persists custom rules', async () => {
    const handler = createDashboardHandler({ username: 'admin', password: 'a-secure-password-123', snapshot, db });

    // 1. Initial GET returns default nlpRules
    const initialGet = await handler(new Request('http://localhost/api/settings', { headers: authHeaders }));
    expect(initialGet.status).toBe(200);
    const initialBody = (await initialGet.json()) as any;
    expect(initialBody.nlpRules).toBeDefined();
    expect(Array.isArray(initialBody.nlpRules.customTaskVerbs)).toBe(true);
    expect(Array.isArray(initialBody.nlpRules.customTimePhrases)).toBe(true);

    // 2. POST updates custom rules
    const updateRes = await handler(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          nlpRules: {
            customTaskVerbs: ['bimbingan skripsi', 'review pr'],
            customTimePhrases: [{ phrase: "ba'da maghrib", replacement: 'at 18:30' }],
            customTimeKeywords: ['subuh', 'senja'],
            customStopwords: ['tolong dong', 'plis'],
          },
        }),
      })
    );

    expect(updateRes.status).toBe(200);
    const updateBody = (await updateRes.json()) as any;
    expect(updateBody.success).toBe(true);
    expect(updateBody.nlpRules.customTaskVerbs).toContain('bimbingan skripsi');
    expect(updateBody.nlpRules.customTimePhrases).toEqual([{ phrase: "ba'da maghrib", replacement: 'at 18:30' }]);

    // 3. Verify database read matches
    const fromDb = await getNlpCustomRules(db, true);
    expect(fromDb.customTaskVerbs).toContain('bimbingan skripsi');
    expect(fromDb.customTimePhrases).toEqual([{ phrase: "ba'da maghrib", replacement: 'at 18:30' }]);
  });

  it('POST /api/settings/nlp-test executes local parser with custom rules', async () => {
    const handler = createDashboardHandler({ username: 'admin', password: 'a-secure-password-123', snapshot, db });

    const testRes = await handler(
      new Request('http://localhost/api/settings/nlp-test', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          text: "besok ba'da isya bimbingan skripsi tolong dong",
          nlpRules: {
            customTaskVerbs: ['bimbingan skripsi'],
            customTimePhrases: [{ phrase: "ba'da isya", replacement: 'at 19:30' }],
            customTimeKeywords: [],
            customStopwords: ['tolong dong'],
          },
        }),
      })
    );

    expect(testRes.status).toBe(200);
    const testBody = (await testRes.json()) as any;
    expect(testBody.success).toBe(true);
    expect(testBody.result.isTask).toBe(true);
    expect(testBody.result.taskTitle).toBe('bimbingan skripsi');
    expect(testBody.result.deadline).not.toBeNull();
  });
});
