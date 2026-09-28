import { describe, expect, it, beforeEach } from 'bun:test';
import {
  createDashboardHandler,
  normalizePhoneNumberToJid,
  listDashboardUsers,
  toggleUserAllowed,
  addUserToWhitelist,
  deleteDashboardUser,
  listDashboardTasks,
  getDashboardTaskDetail,
  listScheduledCrons,
  toggleCronEngine,
  disableTaskReminder,
  toggleUserMorningDigest,
  updateUserLeadReminderMinutes,
} from '../../src/dashboard/server.js';
import { db } from '../../src/db/index.js';
import { eq } from 'drizzle-orm';
import { tasks, userSettings, taskAttachments, taskHistory, taskMessages } from '../../src/db/schema.js';

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

  it('serves task list with filters and search, and task detail with subtasks, attachments, and history', async () => {
    const handler = createDashboardHandler({
      username: 'admin',
      password: 'a-secure-password-123',
      snapshot,
      db,
    });

    const userJid = '628123456789@s.whatsapp.net';
    await db.insert(userSettings).values({
      userJid,
      name: 'Keva Tester',
      isAllowed: true,
      timezone: 'Asia/Jakarta',
      leadReminderMinutes: 10,
    });

    // 1. Insert parent task
    const [parentTask] = await db
      .insert(tasks)
      .values({
        userJid,
        task: 'Tugas Utama Project',
        status: 'pending',
        deadline: new Date('2026-10-01T15:00:00.000Z'),
        remindAt: new Date('2026-10-01T14:50:00.000Z'),
        reminded: 0,
      })
      .returning();
    expect(parentTask).toBeDefined();

    // 2. Insert subtask
    const [subtask] = await db
      .insert(tasks)
      .values({
        userJid,
        parentId: parentTask!.id,
        task: 'Subtask Desain UI',
        status: 'resolved',
        deadline: new Date('2026-10-01T12:00:00.000Z'),
        remindAt: new Date('2026-10-01T11:50:00.000Z'),
        reminded: 1,
      })
      .returning();
    expect(subtask).toBeDefined();

    // 3. Insert task without deadline
    const [noDeadlineTask] = await db
      .insert(tasks)
      .values({
        userJid,
        task: 'Catatan Ide Fitur',
        status: 'pending_deadline',
      })
      .returning();
    expect(noDeadlineTask).toBeDefined();

    // 4. Insert attachment for parent task
    await db.insert(taskAttachments).values({
      taskId: parentTask!.id,
      userJid,
      fileName: 'struk-belanja.jpg',
      fileType: 'image',
      mimeType: 'image/jpeg',
      fileSize: 45000,
      storagePath: '/data/attachments/struk-belanja.jpg',
      sha256Hash: 'abcd1234efgh5678',
      safetyStatus: 'clean',
      ocrExtractedText: 'Total: Rp 150.000\nItem: Kopi & Roti',
    });

    // 5. Insert history for parent task
    await db.insert(taskHistory).values({
      taskId: parentTask!.id,
      userJid,
      changeType: 'reschedule',
      fieldChanged: 'deadline',
      oldValue: '2026-10-01 10:00',
      newValue: '2026-10-01 15:00',
      rawInput: 'undur jam 3 sore ya',
    });

    // TEST: GET /api/tasks (all tasks)
    const allRes = await handler(new Request('http://localhost/api/tasks', { headers: authHeaders }));
    expect(allRes.status).toBe(200);
    const allTasks = (await allRes.json()) as any[];
    expect(allTasks.length).toBe(3);

    // Verify parent task metrics & fields
    const parentRow = allTasks.find((t) => t.id === parentTask!.id);
    expect(parentRow).toBeDefined();
    expect(parentRow.phoneNumber).toBe('628123456789');
    expect(parentRow.userName).toBe('Keva Tester');
    expect(parentRow.attachmentCount).toBe(1);
    expect(parentRow.subtaskCount).toBe(1);

    // TEST: Filter by status 'resolved'
    const resolvedRes = await handler(new Request('http://localhost/api/tasks?status=resolved', { headers: authHeaders }));
    const resolvedTasks = (await resolvedRes.json()) as any[];
    expect(resolvedTasks.length).toBe(1);
    expect(resolvedTasks[0]?.id).toBe(subtask!.id);

    // TEST: Filter by status 'active' (pending & pending_deadline)
    const activeRes = await handler(new Request('http://localhost/api/tasks?status=active', { headers: authHeaders }));
    const activeTasks = (await activeRes.json()) as any[];
    expect(activeTasks.length).toBe(2);
    expect(activeTasks.map((t) => t.id).sort()).toEqual([parentTask!.id, noDeadlineTask!.id].sort());

    // TEST: Search query substring
    const searchRes = await handler(new Request('http://localhost/api/tasks?search=Utama', { headers: authHeaders }));
    const searchTasks = (await searchRes.json()) as any[];
    expect(searchTasks.length).toBe(1);
    expect(searchTasks[0]?.id).toBe(parentTask!.id);

    // TEST: Pagination (limit & offset)
    const pagedRes = await handler(
      new Request('http://localhost/api/tasks?limit=1&offset=1', { headers: authHeaders })
    );
    expect(pagedRes.status).toBe(200);
    expect(pagedRes.headers.get('x-total-count')).toBe('3');
    expect(pagedRes.headers.get('x-limit')).toBe('1');
    expect(pagedRes.headers.get('x-offset')).toBe('1');
    const pagedTasks = (await pagedRes.json()) as any[];
    expect(pagedTasks.length).toBe(1);

    // TEST: GET /api/tasks/detail for parent task
    const detailRes = await handler(
      new Request(`http://localhost/api/tasks/detail?id=${parentTask!.id}`, { headers: authHeaders })
    );
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as any;
    expect(detail.task.id).toBe(parentTask!.id);
    expect(detail.task.task).toBe('Tugas Utama Project');
    expect(detail.task.phoneNumber).toBe('628123456789');
    expect(detail.parentTask).toBeNull();
    expect(detail.subtasks.length).toBe(1);
    expect(detail.subtasks[0]?.id).toBe(subtask!.id);
    expect(detail.attachments.length).toBe(1);
    expect(detail.attachments[0]?.fileName).toBe('struk-belanja.jpg');
    expect(detail.attachments[0]?.ocrExtractedText).toContain('Total: Rp 150.000');
    expect(detail.history.length).toBe(1);
    expect(detail.history[0]?.changeType).toBe('reschedule');
    expect(detail.history[0]?.rawInput).toBe('undur jam 3 sore ya');

    // TEST: GET /api/tasks/detail for subtask
    const subDetailRes = await handler(
      new Request(`http://localhost/api/tasks/detail?id=${subtask!.id}`, { headers: authHeaders })
    );
    expect(subDetailRes.status).toBe(200);
    const subDetail = (await subDetailRes.json()) as any;
    expect(subDetail.parentTask).toBeDefined();
    expect(subDetail.parentTask.id).toBe(parentTask!.id);

    // TEST: Invalid task ID
    const badIdRes = await handler(new Request('http://localhost/api/tasks/detail?id=abc', { headers: authHeaders }));
    expect(badIdRes.status).toBe(400);

    // TEST: Non-existent task ID
    const notFoundRes = await handler(new Request('http://localhost/api/tasks/detail?id=999999', { headers: authHeaders }));
    expect(notFoundRes.status).toBe(404);

    // TEST: POST /api/tasks/reschedule from dashboard
    const newDeadline = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const reschedRes = await handler(
      new Request('http://localhost/api/tasks/reschedule', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          taskId: parentTask!.id,
          newDeadline,
          leadMinutes: 15,
        }),
      })
    );
    expect(reschedRes.status).toBe(200);
    const reschedData = (await reschedRes.json()) as any;
    expect(reschedData.success).toBe(true);
    expect(new Date(reschedData.updatedTask.deadline).toISOString()).toBe(newDeadline);
  });

  it('monitors cron jobs and allows pausing dispatcher, disabling task reminders, and toggling digests', async () => {
    const handler = createDashboardHandler({
      username: 'admin',
      password: 'a-secure-password-123',
      snapshot,
      db,
    });

    const userJid = '628999111222@s.whatsapp.net';
    await db.insert(userSettings).values({
      userJid,
      name: 'Cron User',
      isAllowed: true,
      morningDigestEnabled: true,
      morningDigestTime: '07:30',
      timezone: 'Asia/Jakarta',
    });

    // Insert upcoming reminder task
    const [upcomingTask] = await db
      .insert(tasks)
      .values({
        userJid,
        task: 'Tugas Heavy Yang Berpotensi Spam',
        status: 'pending',
        deadline: new Date('2026-10-05T10:00:00.000Z'),
        remindAt: new Date('2026-10-05T09:50:00.000Z'),
        reminded: 0,
      })
      .returning();
    expect(upcomingTask).toBeDefined();

    // 1. GET /api/crons
    const cronsRes = await handler(new Request('http://localhost/api/crons', { headers: authHeaders }));
    expect(cronsRes.status).toBe(200);
    const cronsData = (await cronsRes.json()) as any;
    expect(cronsData.engine.length).toBe(2);
    expect(cronsData.upcomingReminders.length).toBe(1);
    expect(cronsData.upcomingReminders[0]?.id).toBe(upcomingTask!.id);
    expect(cronsData.upcomingReminders[0]?.phoneNumber).toBe('628999111222');
    expect(cronsData.upcomingDigests.length).toBe(1);
    expect(cronsData.upcomingDigests[0]?.morningDigestTime).toBe('07:30');

    // 2. POST /api/crons/reminders/disable - Action to turn off upcoming reminder
    const disableRes = await handler(
      new Request('http://localhost/api/crons/reminders/disable', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: upcomingTask!.id }),
      })
    );
    expect(disableRes.status).toBe(200);
    const disableBody = (await disableRes.json()) as any;
    expect(disableBody.success).toBe(true);

    // Verify task is removed from upcomingReminders queue (reminded set to 2 and remindAt set to null)
    const cronsRes2 = await handler(new Request('http://localhost/api/crons', { headers: authHeaders }));
    const cronsData2 = (await cronsRes2.json()) as any;
    expect(cronsData2.upcomingReminders.length).toBe(0);

    // Verify audit log in taskHistory
    const hist = await db.select().from(taskHistory).where(eq(taskHistory.taskId, upcomingTask!.id));
    expect(hist.some((h) => h.changeType === 'cancel_reminder')).toBe(true);

    // 3. POST /api/crons/digest/toggle - Action to disable user morning digest
    const toggleDigestRes = await handler(
      new Request('http://localhost/api/crons/digest/toggle', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ userJid, enabled: false }),
      })
    );
    expect(toggleDigestRes.status).toBe(200);
    const digestBody = (await toggleDigestRes.json()) as any;
    expect(digestBody.success).toBe(true);
    expect(digestBody.user.morningDigestEnabled).toBe(false);

    // 4. POST /api/crons/engine/toggle - Action to pause/resume cron dispatcher
    const toggleEngineRes = await handler(
      new Request('http://localhost/api/crons/engine/toggle', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ cronId: 'reminder_dispatcher', enabled: false }),
      })
    );
    expect(toggleEngineRes.status).toBe(200);
    const engineBody = (await toggleEngineRes.json()) as any;
    expect(engineBody.success).toBe(true);
    expect(engineBody.reminderCronEnabled).toBe(false);

    // Re-enable reminder dispatcher
    await handler(
      new Request('http://localhost/api/crons/engine/toggle', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ cronId: 'reminder_dispatcher', enabled: true }),
      })
    );
  });

  it('allows configuring user lead reminder minutes via POST /api/users/lead-time with validation', async () => {
    const handler = createDashboardHandler({
      username: 'admin',
      password: 'a-secure-password-123',
      snapshot,
      db,
    });

    const userJid = '6281233445566@s.whatsapp.net';
    await db.insert(userSettings).values({
      userJid,
      name: 'Lead Time User',
      isAllowed: true,
      timezone: 'Asia/Jakarta',
      leadReminderMinutes: 10,
    });

    // 1. Update lead time to 30 minutes
    const resValid = await handler(
      new Request('http://localhost/api/users/lead-time', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ userJid, leadMinutes: 30 }),
      })
    );
    expect(resValid.status).toBe(200);
    const bodyValid = (await resValid.json()) as any;
    expect(bodyValid.success).toBe(true);
    expect(bodyValid.user.leadReminderMinutes).toBe(30);

    // 2. Verify in GET /api/users
    const listRes = await handler(new Request('http://localhost/api/users', { headers: authHeaders }));
    const users = (await listRes.json()) as any[];
    const targetUser = users.find((u) => u.userJid === userJid);
    expect(targetUser?.leadReminderMinutes).toBe(30);

    // 3. Validation: Missing userJid -> 400
    const resMissingJid = await handler(
      new Request('http://localhost/api/users/lead-time', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ leadMinutes: 15 }),
      })
    );
    expect(resMissingJid.status).toBe(400);

    // 4. Validation: Invalid lead minutes (< 1 or > 1440 or NaN) -> 400
    const resZero = await handler(
      new Request('http://localhost/api/users/lead-time', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ userJid, leadMinutes: 0 }),
      })
    );
    expect(resZero.status).toBe(400);

    const resTooLarge = await handler(
      new Request('http://localhost/api/users/lead-time', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ userJid, leadMinutes: 1500 }),
      })
    );
    expect(resTooLarge.status).toBe(400);

    const resNaN = await handler(
      new Request('http://localhost/api/users/lead-time', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ userJid, leadMinutes: 'invalid' }),
      })
    );
    expect(resNaN.status).toBe(400);

    // 5. Non-existent user -> 404
    const resNotFound = await handler(
      new Request('http://localhost/api/users/lead-time', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ userJid: '6289999999999@s.whatsapp.net', leadMinutes: 15 }),
      })
    );
    expect(resNotFound.status).toBe(404);
  });

  it('serves dashboard assets with Task Explorer, Cron Monitoring, Lead Time Manager, and Confirmation Modal', async () => {
    const handler = createDashboardHandler({
      username: 'admin',
      password: 'a-secure-password-123',
      snapshot,
      db,
    });

    const pageRes = await handler(new Request('http://localhost/', { headers: authHeaders }));
    const html = await pageRes.text();
    expect(html).toContain('Task Explorer & Detail View');
    expect(html).toContain('Cron & Automation Monitoring');
    expect(html).toContain('id="tasks-table-body"');
    expect(html).toContain('id="task-modal"');
    expect(html).toContain('id="confirm-modal"');
    expect(html).toContain('id="lead-modal"');
    expect(html).toContain('id="cron-reminders-body"');

    const cssRes = await handler(new Request('http://localhost/dashboard.css', { headers: authHeaders }));
    const css = await cssRes.text();
    expect(css).toContain('.task-toolbar');
    expect(css).toContain('.task-modal');
    expect(css).toContain('.confirm-modal');
    expect(css).toContain('.cron-card');
    expect(css).toContain('.lead-badge');
    expect(css).toContain('.btn-lead');

    const jsRes = await handler(new Request('http://localhost/dashboard.js', { headers: authHeaders }));
    const js = await jsRes.text();
    expect(js).toContain('loadTasks');
    expect(js).toContain('openTaskDetail');
    expect(js).toContain('loadCrons');
    expect(js).toContain('askAdminConfirmation');
    expect(js).toContain('renderCrons');
    expect(js).toContain('openLeadTimeModal');
  });
});


