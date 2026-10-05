import { describe, expect, it, beforeEach } from 'bun:test';
import { db } from '../../src/db/index.js';
import { tasks, taskHistory, taskMessages, taskAttachments, userSettings } from '../../src/db/schema.js';
import {
  ensureUserSettings,
  createTask,
  rescheduleTask,
  renameTask,
  getTaskHistory,
} from '../../src/services/task.js';

describe('Task Revision & Audit Log', () => {
  const testUserJid = '628111555444@s.whatsapp.net';

  beforeEach(async () => {
    await db.delete(taskAttachments);
    await db.delete(taskHistory);
    await db.delete(taskMessages);
    await db.delete(tasks);
    await db.delete(userSettings);
    await ensureUserSettings(db, testUserJid, 'Audit Tester', true);
  });

  it('should reschedule task, recalculate remindAt, reset reminded flag, and log history', async () => {
    const initialDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours later
    const initialRemindAt = new Date(initialDeadline.getTime() - 30 * 60 * 1000);

    const task = await createTask(db, {
      userJid: testUserJid,
      task: 'Presentasi Proyek Q4',
      deadline: initialDeadline,
      remindAt: initialRemindAt,
      status: 'pending',
    });

    // Mark as reminded manually to test reset
    await db.update(tasks).set({ reminded: 1 });

    const newDeadline = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours later
    const rescheduleResult = await rescheduleTask(db, {
      taskId: task.id,
      userJid: testUserJid,
      newDeadline,
      leadMinutes: 15,
      rawInput: 'ubah waktu: 2 hari lagi jam 10 pagi',
    });

    expect(rescheduleResult).not.toBeNull();
    expect(rescheduleResult?.updatedTask.id).toBe(task.id);
    expect(new Date(rescheduleResult!.updatedTask.deadline!).getTime()).toBe(newDeadline.getTime());
    expect(rescheduleResult?.updatedTask.reminded).toBe(0); // Resets flag so reminder will fire again!

    // Verify audit log
    const history = await getTaskHistory(db, task.id, testUserJid);
    expect(history.length).toBe(2); // 'create' + 'reschedule'

    const createLog = history[0];
    expect(createLog?.changeType).toBe('create');
    expect(createLog?.newValue).toBe('Presentasi Proyek Q4');
    expect(createLog?.oldValue).toBe(initialDeadline.toISOString());

    const rescheduleLog = history[1];
    expect(rescheduleLog?.changeType).toBe('reschedule');
    expect(rescheduleLog?.fieldChanged).toBe('deadline');
    expect(rescheduleLog?.oldValue).toBe(initialDeadline.toISOString());
    expect(rescheduleLog?.rawInput).toBe('ubah waktu: 2 hari lagi jam 10 pagi');
    expect(rescheduleLog?.newValue).toBe(newDeadline.toISOString());
  });

  it('should calculate a +30 minute extension from the same reply timestamp', async () => {
    const replyTime = new Date('2026-09-28T03:17:00.000Z');
    const task = await createTask(db, {
      userJid: testUserJid,
      task: 'Re-test build release',
      deadline: new Date('2026-09-28T03:00:00.000Z'),
      remindAt: new Date('2026-09-28T02:45:00.000Z'),
      status: 'pending',
    });
    await db.update(tasks).set({ reminded: 2 });

    const result = await rescheduleTask(db, {
      taskId: task.id,
      userJid: testUserJid,
      newDeadline: new Date(replyTime.getTime() + 30 * 60 * 1000),
      leadMinutes: 30,
      now: replyTime,
      rawInput: '1',
    });

    expect(result?.updatedTask.deadline?.toISOString()).toBe('2026-09-28T03:47:00.000Z');
    expect(result?.updatedTask.remindAt?.toISOString()).toBe('2026-09-28T03:32:00.000Z');
    expect(result?.updatedTask.reminded).toBe(0);
  });

  it('should rename task title and log history', async () => {
    const task = await createTask(db, {
      userJid: testUserJid,
      task: 'Judul Lama',
      status: 'pending',
    });

    const renameResult = await renameTask(db, {
      taskId: task.id,
      userJid: testUserJid,
      newTitle: 'Judul Baru yang Lebih Spesifik',
      rawInput: 'ubah tugas: Judul Baru yang Lebih Spesifik',
    });

    expect(renameResult).not.toBeNull();
    expect(renameResult?.oldTitle).toBe('Judul Lama');
    expect(renameResult?.updatedTask.task).toBe('Judul Baru yang Lebih Spesifik');

    // Verify audit log
    const history = await getTaskHistory(db, task.id, testUserJid);
    expect(history.length).toBe(2); // 'create' + 'rename'

    const renameLog = history[1];
    expect(renameLog?.changeType).toBe('rename');
    expect(renameLog?.fieldChanged).toBe('task');
    expect(renameLog?.oldValue).toBe('Judul Lama');
    expect(renameLog?.newValue).toBe('Judul Baru yang Lebih Spesifik');
    expect(renameLog?.rawInput).toBe('ubah tugas: Judul Baru yang Lebih Spesifik');
  });

  it('should preserve full chronological history trail across multiple edits', async () => {
    const task = await createTask(db, {
      userJid: testUserJid,
      task: 'Beli Kue',
      status: 'pending',
    });

    // 1st Edit: Rename
    await renameTask(db, {
      taskId: task.id,
      userJid: testUserJid,
      newTitle: 'Beli Kue Ulang Tahun',
    });

    // 2nd Edit: Reschedule
    const d1 = new Date(Date.now() + 3600 * 1000);
    await rescheduleTask(db, {
      taskId: task.id,
      userJid: testUserJid,
      newDeadline: d1,
    });

    // 3rd Edit: Reschedule again
    const d2 = new Date(Date.now() + 7200 * 1000);
    await rescheduleTask(db, {
      taskId: task.id,
      userJid: testUserJid,
      newDeadline: d2,
    });

    const history = await getTaskHistory(db, task.id, testUserJid);
    expect(history.length).toBe(4); // create -> rename -> reschedule -> reschedule
    expect(history.map((h) => h.changeType)).toEqual(['create', 'rename', 'reschedule', 'reschedule']);
  });

  it('should transition a pending_deadline (no deadline) task to pending when rescheduled with a new deadline', async () => {
    const task = await createTask(db, {
      userJid: testUserJid,
      task: 'Tugas Tanpa Deadline Awal',
      status: 'pending_deadline',
    });

    expect(task.status).toBe('pending_deadline');
    expect(task.deadline).toBeNull();

    const newDeadline = new Date(Date.now() + 24 * 3600 * 1000);
    const res = await rescheduleTask(db, {
      taskId: task.id,
      userJid: testUserJid,
      newDeadline,
      leadMinutes: 15,
      rawInput: 'Atur deadline baru',
    });

    expect(res).not.toBeNull();
    expect(res?.updatedTask.status).toBe('pending');
    expect(res?.updatedTask.deadline).not.toBeNull();
    expect(new Date(res!.updatedTask.deadline!).getTime()).toBe(newDeadline.getTime());

    // Verify history logs status transition and deadline change
    const history = await getTaskHistory(db, task.id, testUserJid);
    expect(history.some((h) => h.changeType === 'reschedule' && h.fieldChanged === 'deadline')).toBe(true);
    expect(history.some((h) => h.changeType === 'reschedule' && h.fieldChanged === 'status' && h.oldValue === 'pending_deadline' && h.newValue === 'pending')).toBe(true);
  });
});
