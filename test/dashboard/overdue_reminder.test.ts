import { describe, expect, it, beforeEach } from 'bun:test';
import {
  createDashboardHandler,
  listDashboardTasks,
  countDashboardTasks,
  buildDashboardSnapshot,
} from '../../src/dashboard/server.js';
import { triggerTaskReminder } from '../../src/bot/client.js';
import { db } from '../../src/db/index.js';
import { eq } from 'drizzle-orm';
import { tasks, userSettings, taskHistory, taskMessages } from '../../src/db/schema.js';
import { ensureUserSettings, createTask } from '../../src/services/task.js';

describe('Dashboard Overdue Tasks Section & Manual Reminder Trigger', () => {
  const credentials = Buffer.from('admin:a-secure-password-123').toString('base64');
  const authHeaders = {
    authorization: `Basic ${credentials}`,
    'content-type': 'application/json',
  };
  const testUserJid = '628123456789@s.whatsapp.net';

  beforeEach(async () => {
    await db.delete(taskMessages);
    await db.delete(taskHistory);
    await db.delete(tasks);
    await db.delete(userSettings);
    await ensureUserSettings(db, testUserJid, 'Budi', true);
  });

  it('serves dashboard HTML with Section 07 for Overdue Tasks and filter button', async () => {
    const handler = createDashboardHandler({
      username: 'admin',
      password: 'a-secure-password-123',
      snapshot: () => buildDashboardSnapshot(db),
      db,
    });

    const page = await handler(new Request('http://localhost/', { headers: authHeaders }));
    expect(page.status).toBe(200);
    const html = await page.text();

    expect(html).toContain('id="overdue-tasks-title"');
    expect(html).toContain('Tugas Lewat Deadline (Overdue)');
    expect(html).toContain('id="overdue-count-badge"');
    expect(html).toContain('id="overdue-tasks-body"');
    expect(html).toContain('data-status="overdue"');
  });

  it('filters and counts overdue tasks accurately', async () => {
    const now = new Date();

    // 1. Overdue task (pending, deadline 1 hour ago) -> SHOULD MATCH
    const overdueTask = await createTask(db, {
      userJid: testUserJid,
      task: 'Tugas Terlewat 1 Jam',
      deadline: new Date(now.getTime() - 60 * 60 * 1000),
      status: 'pending',
    });

    // 2. Future task (pending, deadline tomorrow) -> SHOULD NOT MATCH
    await createTask(db, {
      userJid: testUserJid,
      task: 'Tugas Masa Depan',
      deadline: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      status: 'pending',
    });

    // 3. Resolved task even with past deadline -> SHOULD NOT MATCH
    await createTask(db, {
      userJid: testUserJid,
      task: 'Tugas Sudah Selesai Masa Lalu',
      deadline: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      status: 'resolved',
    });

    // 4. Task without deadline (pending_deadline) -> SHOULD NOT MATCH
    await createTask(db, {
      userJid: testUserJid,
      task: 'Tugas Tanpa Deadline',
      status: 'pending_deadline',
    });

    const overdueList = await listDashboardTasks(db, { status: 'overdue' });
    const overdueCount = await countDashboardTasks(db, { status: 'overdue' });

    expect(overdueList.length).toBe(1);
    expect(overdueCount).toBe(1);
    expect(overdueList[0]?.id).toBe(overdueTask.id);
    expect(overdueList[0]?.task).toBe('Tugas Terlewat 1 Jam');

    // Verify snapshot includes overdue metric
    const snapshot = await buildDashboardSnapshot(db);
    expect(snapshot.tasks.overdue).toBe(1);
  });

  it('rejects manual reminder trigger for invalid or missing task ID', async () => {
    const handler = createDashboardHandler({
      username: 'admin',
      password: 'a-secure-password-123',
      snapshot: () => buildDashboardSnapshot(db),
      db,
    });

    // Missing taskId
    const res1 = await handler(
      new Request('http://localhost/api/tasks/remind-now', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({}),
      })
    );
    expect(res1.status).toBe(400);

    // Negative / invalid taskId
    const res2 = await handler(
      new Request('http://localhost/api/tasks/remind-now', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ taskId: -5 }),
      })
    );
    expect(res2.status).toBe(400);
  });

  it('rejects manual reminder trigger if task is not found or already closed', async () => {
    const handler = createDashboardHandler({
      username: 'admin',
      password: 'a-secure-password-123',
      snapshot: () => buildDashboardSnapshot(db),
      db,
    });

    // Task not found
    const resNotFound = await handler(
      new Request('http://localhost/api/tasks/remind-now', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ taskId: 99999 }),
      })
    );
    expect(resNotFound.status).toBe(404);

    // Task already resolved
    const resolvedTask = await createTask(db, {
      userJid: testUserJid,
      task: 'Tugas yang sudah kelar',
      status: 'resolved',
    });

    const resResolved = await handler(
      new Request('http://localhost/api/tasks/remind-now', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ taskId: resolvedTask.id }),
      })
    );
    expect(resResolved.status).toBe(409);
  });

  it('successfully triggers manual reminder via POST /api/tasks/remind-now and executes triggerTaskReminder', async () => {
    const overdueTask = await createTask(db, {
      userJid: testUserJid,
      task: 'Presentasi Bisnis Mendesak',
      deadline: new Date(Date.now() - 30 * 60 * 1000), // 30 mins overdue
      status: 'pending',
    });

    const sentMessages: { jid: string; content: any }[] = [];
    const mockSend = async (jid: string, content: any) => {
      sentMessages.push({ jid, content });
      return { key: { id: 'MSG_OVERDUE_MANUAL_123' } };
    };

    // Use sendReminder injected handler calling triggerTaskReminder with mockSend
    const handler = createDashboardHandler({
      username: 'admin',
      password: 'a-secure-password-123',
      snapshot: () => buildDashboardSnapshot(db),
      db,
      sendReminder: (taskId) => triggerTaskReminder(db, taskId, mockSend),
    });

    const res = await handler(
      new Request('http://localhost/api/tasks/remind-now', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ taskId: overdueTask.id }),
      })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.taskId).toBe(overdueTask.id);
    expect(body.messageId).toBe('MSG_OVERDUE_MANUAL_123');

    // 1. Verify message sent to user
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]?.jid).toBe(testUserJid);
    expect(sentMessages[0]?.content?.text).toContain('Presentasi Bisnis Mendesak');
    expect(sentMessages[0]?.content?.text).toContain('Halo Budi!');
    expect(sentMessages[0]?.content?.text.toLowerCase()).toMatch(/admin|mager|anti-mager|rebahan/);

    // 2. Verify task state updated (reminded set to 2 for overdue)
    const updatedTasks = await db.select().from(tasks).where(eq(tasks.id, overdueTask.id));
    expect(updatedTasks[0]?.reminded).toBe(2);

    // 3. Verify taskMessages linked
    const linkedMessages = await db.select().from(taskMessages);
    expect(linkedMessages.some((m) => m.messageId === 'MSG_OVERDUE_MANUAL_123')).toBe(true);

    // 4. Verify taskHistory logged
    const historyRows = await db.select().from(taskHistory);
    const reminderHistory = historyRows.find((h) => h.taskId === overdueTask.id && h.changeType === 'reminded');
    expect(reminderHistory).toBeDefined();
    expect(reminderHistory?.rawInput).toContain('Dashboard');
  });
});
