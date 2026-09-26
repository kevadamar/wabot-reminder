import { describe, expect, it, beforeEach } from 'bun:test';
import { db } from '../../src/db/index.js';
import { tasks, taskMessages, userSettings } from '../../src/db/schema.js';
import {
  ensureUserSettings,
  createTask,
  linkTaskMessage,
  findTaskByMessageId,
  resolveTask,
  cancelTask,
  listActiveTasks,
  updateTaskDeadline,
  getLatestPendingDeadlineTask,
} from '../../src/services/task.js';

describe('Seam 3: Task Management & State Operations', () => {
  const testUserJid = '628111222333@s.whatsapp.net';

  beforeEach(async () => {
    // Clear test data
    await db.delete(taskMessages);
    await db.delete(tasks);
    await db.delete(userSettings);
  });

  it('should ensure user settings row exists', async () => {
    const user = await ensureUserSettings(db, testUserJid, 'Budi Test', true);
    expect(user.userJid).toBe(testUserJid);
    expect(user.name).toBe('Budi Test');
    expect(user.isAllowed).toBe(true);
    expect(user.timezone).toBe('Asia/Jakarta');
  });

  it('should create a new task and list active tasks', async () => {
    await ensureUserSettings(db, testUserJid, 'Budi Test', true);

    const deadline = new Date('2026-09-27T10:00:00.000Z');
    const remindAt = new Date('2026-09-27T09:30:00.000Z');

    const created = await createTask(db, {
      userJid: testUserJid,
      task: 'Kirim laporan ke bos',
      deadline,
      remindAt,
      status: 'pending',
    });

    expect(created.id).toBeDefined();
    expect(created.task).toBe('Kirim laporan ke bos');
    expect(created.status).toBe('pending');

    const activeList = await listActiveTasks(db, testUserJid);
    expect(activeList.length).toBe(1);
    expect(activeList[0]?.id).toBe(created.id);
  });

  it('should link WhatsApp message ID and find task by message ID', async () => {
    await ensureUserSettings(db, testUserJid, 'Budi Test', true);
    const created = await createTask(db, {
      userJid: testUserJid,
      task: 'Rapat project',
      status: 'pending',
    });

    const fakeMsgId = 'BAE5F92A82910F1';
    await linkTaskMessage(db, created.id, fakeMsgId);

    const found = await findTaskByMessageId(db, fakeMsgId);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
    expect(found?.task).toBe('Rapat project');
  });

  it('should resolve and cancel tasks properly', async () => {
    await ensureUserSettings(db, testUserJid, 'Budi Test', true);
    const t1 = await createTask(db, {
      userJid: testUserJid,
      task: 'Tugas 1',
      status: 'pending',
    });
    const t2 = await createTask(db, {
      userJid: testUserJid,
      task: 'Tugas 2',
      status: 'pending',
    });

    const resolved = await resolveTask(db, t1.id, testUserJid);
    expect(resolved?.status).toBe('resolved');

    const cancelled = await cancelTask(db, t2.id, testUserJid);
    expect(cancelled?.status).toBe('cancelled');

    // Both are no longer in active list
    const active = await listActiveTasks(db, testUserJid);
    expect(active.length).toBe(0);
  });

  it('should update deadline for pending_deadline task', async () => {
    await ensureUserSettings(db, testUserJid, 'Budi Test', true);
    const task = await createTask(db, {
      userJid: testUserJid,
      task: 'Beli buku',
      status: 'pending_deadline',
    });

    const pendingTask = await getLatestPendingDeadlineTask(db, testUserJid, 10);
    expect(pendingTask?.id).toBe(task.id);

    const newDeadline = new Date('2026-09-28T08:00:00.000Z');
    const newRemindAt = new Date('2026-09-28T07:30:00.000Z');
    const updated = await updateTaskDeadline(db, task.id, newDeadline, newRemindAt);

    expect(updated?.status).toBe('pending');
    expect(updated?.deadline?.toISOString()).toBe(newDeadline.toISOString());
  });
});
