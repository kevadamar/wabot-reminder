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

  it('should remind 10 minutes before deadline by default when deadline is > 10 mins away', () => {
    const deadline = new Date('2026-09-26T13:00:00.000Z');
    const remindAt = calculateRemindAt(deadline, { now: baseNow });
    expect(remindAt.toISOString()).toBe('2026-09-26T12:50:00.000Z');
  });

  it('should respect custom leadMinutes when deadline is > 2 hours away', () => {
    const deadline = new Date('2026-09-26T13:00:00.000Z');
    const remindAt = calculateRemindAt(deadline, { leadMinutes: 15, now: baseNow });
    expect(remindAt.toISOString()).toBe('2026-09-26T12:45:00.000Z');
  });

  it('should adaptively remind 15 minutes before deadline when leadMinutes is 30 and distance is between 30 mins and 2 hours away', () => {
    const deadline = new Date('2026-09-26T11:00:00.000Z');
    const remindAt = calculateRemindAt(deadline, { leadMinutes: 30, now: baseNow });
    expect(remindAt.toISOString()).toBe('2026-09-26T10:45:00.000Z');
  });

  it('should remind at exact deadline when deadline is <= leadMinutes away', () => {
    const deadline = new Date('2026-09-26T10:05:00.000Z');
    const remindAt = calculateRemindAt(deadline, { now: baseNow });
    expect(remindAt.toISOString()).toBe('2026-09-26T10:05:00.000Z');
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

  it('should not dispatch overdue reminder within 15-minute grace period after deadline', async () => {
    await ensureUserSettings(db, testUserJid, 'User 1', true);

    // Create a task whose deadline was 5 minutes ago and already reminded once
    const deadlinePast5Min = new Date('2026-09-26T09:55:00.000Z');
    await createTask(db, {
      userJid: testUserJid,
      task: 'Cek email masuk',
      deadline: deadlinePast5Min,
      remindAt: new Date('2026-09-26T09:25:00.000Z'),
      status: 'pending',
    });

    // Mark task as already reminded once
    await db.update(tasks).set({ reminded: 1 });

    const sentAlerts: Array<{ taskId: number; isOverdue: boolean }> = [];
    const mockDispatcher = async (task: any, isOverdue: boolean) => {
      sentAlerts.push({ taskId: task.id, isOverdue });
      return 'MSG_ALERT_OVERDUE';
    };

    // Current time is baseNow (10:00:00), deadline was 09:55:00 (only 5 minutes passed, grace is 15 min)
    const dispatchedCount = await checkAndDispatchReminders(db, mockDispatcher, baseNow);

    expect(dispatchedCount).toBe(0);
    expect(sentAlerts.length).toBe(0);
  });

  it('should dispatch final overdue reminder 15 minutes after deadline and update reminded to 2', async () => {
    await ensureUserSettings(db, testUserJid, 'User 1', true);

    // Create a task whose deadline was 16 minutes ago and already reminded once
    const deadlinePast16Min = new Date('2026-09-26T09:44:00.000Z');
    const task = await createTask(db, {
      userJid: testUserJid,
      task: 'Submit laporan mingguan',
      deadline: deadlinePast16Min,
      remindAt: new Date('2026-09-26T09:14:00.000Z'),
      status: 'pending',
    });

    // Mark task as reminded once
    await db.update(tasks).set({ reminded: 1 });

    const sentAlerts: Array<{ taskId: number; isOverdue: boolean }> = [];
    const mockDispatcher = async (t: any, isOverdue: boolean) => {
      sentAlerts.push({ taskId: t.id, isOverdue });
      return 'MSG_ALERT_FINAL_OVERDUE';
    };

    // Current time is baseNow (10:00:00), deadline was 09:44:00 (16 minutes passed, >= 15 min threshold)
    const dispatchedCount = await checkAndDispatchReminders(db, mockDispatcher, baseNow);

    expect(dispatchedCount).toBe(1);
    expect(sentAlerts.length).toBe(1);
    expect(sentAlerts[0]?.taskId).toBe(task.id);
    expect(sentAlerts[0]?.isOverdue).toBe(true);

    const checkDb = await db.select().from(tasks);
    expect(checkDb[0]?.reminded).toBe(2);
  });

  it('caps reminders per user per cycle and leaves the rest due for the next cycle', async () => {
    await ensureUserSettings(db, testUserJid, 'User 1', true);
    const sameRemindAt = new Date('2026-09-26T09:55:00.000Z');
    const sameDeadline = new Date('2026-09-26T10:05:00.000Z');
    const created = [];
    for (const title of ['Tugas A', 'Tugas B', 'Tugas C']) {
      created.push(
        await createTask(db, {
          userJid: testUserJid,
          task: title,
          deadline: sameDeadline,
          remindAt: sameRemindAt,
          status: 'pending',
        })
      );
    }

    const sent: number[] = [];
    const dispatcher = async (task: any) => {
      sent.push(task.id);
      return null;
    };

    const firstCycle = await checkAndDispatchReminders(db, dispatcher, baseNow, { maxPerUserPerCycle: 2 });
    expect(firstCycle).toBe(2);
    expect(sent).toEqual([created[0]!.id, created[1]!.id]);

    const stillDue = (await db.select().from(tasks)).filter((t) => t.reminded === 0);
    expect(stillDue.map((t) => t.id)).toEqual([created[2]!.id]);

    const secondCycle = await checkAndDispatchReminders(db, dispatcher, baseNow, { maxPerUserPerCycle: 2 });
    expect(secondCycle).toBe(1);
    expect(sent).toEqual([created[0]!.id, created[1]!.id, created[2]!.id]);
  });

  it('dispatches the earliest-due reminder of a user first', async () => {
    await ensureUserSettings(db, testUserJid, 'User 1', true);
    const later = await createTask(db, {
      userJid: testUserJid,
      task: 'Later',
      deadline: new Date('2026-09-26T10:30:00.000Z'),
      remindAt: new Date('2026-09-26T09:59:00.000Z'),
      status: 'pending',
    });
    const earlier = await createTask(db, {
      userJid: testUserJid,
      task: 'Earlier',
      deadline: new Date('2026-09-26T10:30:00.000Z'),
      remindAt: new Date('2026-09-26T09:50:00.000Z'),
      status: 'pending',
    });

    const sent: number[] = [];
    await checkAndDispatchReminders(db, async (task: any) => {
      sent.push(task.id);
      return null;
    }, baseNow);

    expect(sent).toEqual([earlier.id, later.id]);
  });

  it('does not make other users wait while one user is being paced', async () => {
    const otherUserJid = '628111222333@s.whatsapp.net';
    await ensureUserSettings(db, testUserJid, 'User 1', true);
    await ensureUserSettings(db, otherUserJid, 'User 2', true);
    const remindAt = new Date('2026-09-26T09:55:00.000Z');
    const deadline = new Date('2026-09-26T10:05:00.000Z');
    await createTask(db, { userJid: testUserJid, task: 'Slow user', deadline, remindAt, status: 'pending' });
    const otherTask = await createTask(db, { userJid: otherUserJid, task: 'Other user', deadline, remindAt, status: 'pending' });

    let releaseSlowUser: () => void = () => {};
    const slowUserGate = new Promise<void>((resolve) => {
      releaseSlowUser = resolve;
    });
    const sent: number[] = [];

    const cycle = checkAndDispatchReminders(db, async (task: any) => {
      if (task.userJid === testUserJid) await slowUserGate;
      sent.push(task.id);
      return null;
    }, baseNow);

    for (let i = 0; i < 50 && !sent.includes(otherTask.id); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(sent).toContain(otherTask.id);

    releaseSlowUser();
    expect(await cycle).toBe(2);
  });

  it('never dispatches tasks awaiting same-schedule confirmation', async () => {
    await ensureUserSettings(db, testUserJid, 'User 1', true);
    await createTask(db, {
      userJid: testUserJid,
      task: 'Belum dikonfirmasi',
      deadline: new Date('2026-09-26T10:05:00.000Z'),
      remindAt: new Date('2026-09-26T09:55:00.000Z'),
      status: 'pending_confirmation',
    });

    const count = await checkAndDispatchReminders(db, async () => 'MSG', baseNow);
    expect(count).toBe(0);
  });
});
