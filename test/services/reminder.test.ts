import { describe, expect, it, beforeEach } from 'bun:test';
import { calculateRemindAt, checkAndDispatchReminders } from '../../src/services/reminder.js';
import { db } from '../../src/db/index.js';
import { tasks, taskMessages, userSettings } from '../../src/db/schema.js';
import { createTask, ensureUserSettings } from '../../src/services/task.js';

describe('Seam 2: Adaptive Reminder Calculator & Dispatcher', () => {
  const baseNow = new Date('2026-09-26T10:00:00.000Z');
  const testUserJid = '628999888777@s.whatsapp.net';

  beforeEach(async () => {
    await db.delete(taskMessages);
    await db.delete(tasks);
    await db.delete(userSettings);
  });

  it('should remind 30 minutes before deadline when deadline is > 2 hours away', () => {
    const deadline = new Date('2026-09-26T13:00:00.000Z');
    const remindAt = calculateRemindAt(deadline, { now: baseNow });
    expect(remindAt.toISOString()).toBe('2026-09-26T12:30:00.000Z');
  });

  it('should respect custom leadMinutes when deadline is > 2 hours away', () => {
    const deadline = new Date('2026-09-26T13:00:00.000Z');
    const remindAt = calculateRemindAt(deadline, { leadMinutes: 45, now: baseNow });
    expect(remindAt.toISOString()).toBe('2026-09-26T12:15:00.000Z');
  });

  it('should remind 15 minutes before deadline when deadline is between 30 mins and 2 hours away', () => {
    const deadline = new Date('2026-09-26T11:00:00.000Z');
    const remindAt = calculateRemindAt(deadline, { now: baseNow });
    expect(remindAt.toISOString()).toBe('2026-09-26T10:45:00.000Z');
  });

  it('should remind at exact deadline when deadline is < 30 mins away', () => {
    const deadline = new Date('2026-09-26T10:20:00.000Z');
    const remindAt = calculateRemindAt(deadline, { now: baseNow });
    expect(remindAt.toISOString()).toBe('2026-09-26T10:20:00.000Z');
  });

  it('should query due reminders and dispatch them', async () => {
    await ensureUserSettings(db, testUserJid, 'User 1', true);

    // Create a task whose remindAt is in the past
    const taskDue = await createTask(db, {
      userJid: testUserJid,
      task: 'Beli obat sekarang',
      deadline: new Date('2026-09-26T10:30:00.000Z'),
      remindAt: new Date('2026-09-26T09:55:00.000Z'),
      status: 'pending',
    });

    const sentAlerts: Array<{ taskId: number; isOverdue: boolean }> = [];
    const mockDispatcher = async (task: any, isOverdue: boolean) => {
      sentAlerts.push({ taskId: task.id, isOverdue });
      return 'MSG_ALERT_123';
    };

    const dispatchedCount = await checkAndDispatchReminders(db, mockDispatcher, baseNow);

    expect(dispatchedCount).toBe(1);
    expect(sentAlerts.length).toBe(1);
    expect(sentAlerts[0]?.taskId).toBe(taskDue.id);
    expect(sentAlerts[0]?.isOverdue).toBe(false);

    // Verify task reminded flag was set to 1 in DB
    const checkDb = await db.select().from(tasks);
    expect(checkDb[0]?.reminded).toBe(1);
  });
});
