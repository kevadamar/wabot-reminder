import { describe, expect, it, beforeEach } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { tasks, taskHistory, taskMessages, userSettings } from '../../src/db/schema.js';
import {
  confirmTask,
  createTask,
  ensureUserSettings,
  findSameScheduleTasks,
  getLatestPendingConfirmationTask,
  listActiveTasks,
} from '../../src/services/task.js';

describe('Same-schedule detection & confirmation helpers', () => {
  const userJid = '628111222333@s.whatsapp.net';
  const otherJid = '628444555666@s.whatsapp.net';
  const deadline = new Date('2026-10-09T07:00:00.000Z');

  beforeEach(async () => {
    await db.delete(taskMessages);
    await db.delete(tasks);
    await db.delete(userSettings);
    await ensureUserSettings(db, userJid, 'User', true);
    await ensureUserSettings(db, otherJid, 'Other', true);
  });

  it('matches pending tasks of the same user in the same clock minute', async () => {
    const sameMinute = await createTask(db, {
      userJid,
      task: 'Meeting',
      deadline: new Date('2026-10-09T07:00:45.000Z'),
      status: 'pending',
    });
    await createTask(db, { userJid, task: 'Next minute', deadline: new Date('2026-10-09T07:01:00.000Z'), status: 'pending' });
    await createTask(db, { userJid: otherJid, task: 'Other user', deadline, status: 'pending' });
    const done = await createTask(db, { userJid, task: 'Already done', deadline, status: 'pending' });
    await db.update(tasks).set({ status: 'resolved' }).where(eq(tasks.id, done.id));

    const matches = await findSameScheduleTasks(db, userJid, deadline);
    expect(matches.map((t) => t.id)).toEqual([sameMinute.id]);
  });

  it('can exclude the task being scheduled', async () => {
    const existing = await createTask(db, { userJid, task: 'Meeting', deadline, status: 'pending' });
    expect(await findSameScheduleTasks(db, userJid, deadline, existing.id)).toEqual([]);
  });

  it('confirms a pending_confirmation task into an active pending task with an audit row', async () => {
    const held = await createTask(db, { userJid, task: 'Bayar listrik', deadline, status: 'pending_confirmation' });
    expect(await listActiveTasks(db, userJid)).toEqual([]);

    const confirmed = await confirmTask(db, held.id, userJid, 'gas');
    expect(confirmed?.status).toBe('pending');
    expect((await listActiveTasks(db, userJid)).map((t) => t.id)).toEqual([held.id]);

    const history = await db.select().from(taskHistory);
    expect(history.some((h) => h.taskId === held.id && h.changeType === 'confirm')).toBe(true);
  });

  it('does not confirm tasks of another user or tasks that are not awaiting confirmation', async () => {
    const held = await createTask(db, { userJid, task: 'Bayar listrik', deadline, status: 'pending_confirmation' });
    const cancelled = await createTask(db, { userJid, task: 'Batal', deadline, status: 'cancelled' });

    expect(await confirmTask(db, held.id, otherJid, 'gas')).toBeNull();
    expect(await confirmTask(db, cancelled.id, userJid, 'gas')).toBeNull();
  });

  it('finds the latest pending_confirmation task within the window', async () => {
    await createTask(db, { userJid, task: 'Pertama', deadline, status: 'pending_confirmation' });
    const latest = await createTask(db, { userJid, task: 'Kedua', deadline, status: 'pending_confirmation' });

    const found = await getLatestPendingConfirmationTask(db, userJid, 15);
    expect(found?.id).toBe(latest.id);
    expect(await getLatestPendingConfirmationTask(db, otherJid, 15)).toBeNull();
  });
});
