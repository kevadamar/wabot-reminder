import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { db, initDb } from '../../src/db/index.js';
import {
  dailyDigestDeliveries,
  dailyMotivations,
  taskMessages,
  tasks,
  userSettings,
} from '../../src/db/schema.js';
import {
  claimMorningDigestDelivery,
  countYesterdayResolvedTasks,
  dispatchMorningDigests,
  getOrCreateMorningMotivation,
  listOverdueTasks,
  listTasksForLocalDate,
  updateMorningDigestSettings,
} from '../../src/services/morning-digest.js';
import { ensureUserSettings } from '../../src/services/task.js';

describe('Morning digest persistence', () => {
  const userJid = '628100000001@s.whatsapp.net';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await db.delete(dailyDigestDeliveries);
    await db.delete(dailyMotivations);
    await db.delete(taskMessages);
    await db.delete(tasks);
    await db.delete(userSettings);
  });

  it('defaults to disabled and persists opt-in time settings', async () => {
    const user = await ensureUserSettings(db, userJid, 'Keva', true);
    expect(user.morningDigestEnabled).toBe(false);
    expect(user.morningDigestTime).toBe('06:00');

    const updated = await updateMorningDigestSettings(db, userJid, {
      enabled: true,
      time: '06:30',
    });
    expect(updated?.morningDigestEnabled).toBe(true);
    expect(updated?.morningDigestTime).toBe('06:30');

    const repeated = await updateMorningDigestSettings(db, userJid, {
      enabled: true,
      time: '06:30',
      now: new Date('2026-09-29T12:00:00.000Z'),
    });
    expect(repeated?.morningDigestUpdatedAt.toISOString()).toBe(
      updated?.morningDigestUpdatedAt.toISOString()
    );
  });

  it('lists only pending tasks on the requested local date in stable ascending order', async () => {
    await ensureUserSettings(db, userJid, 'Keva', true);
    await db.insert(tasks).values([
      { userJid, task: 'Jam delapan kedua', status: 'pending', deadline: new Date('2026-09-29T01:00:00.000Z') },
      { userJid, task: 'Jam lima', status: 'pending', deadline: new Date('2026-09-28T22:00:00.000Z') },
      { userJid, task: 'Besok', status: 'pending', deadline: new Date('2026-09-29T17:00:00.000Z') },
      { userJid, task: 'Tanpa waktu', status: 'pending_deadline', deadline: null },
      { userJid, task: 'Sudah selesai', status: 'resolved', deadline: new Date('2026-09-29T02:00:00.000Z') },
      { userJid, task: 'Jam delapan pertama', status: 'pending', deadline: new Date('2026-09-29T01:00:00.000Z') },
    ]);

    const result = await listTasksForLocalDate(db, userJid, '2026-09-29', 'Asia/Jakarta');
    expect(result.map((task) => task.task)).toEqual([
      'Jam lima',
      'Jam delapan kedua',
      'Jam delapan pertama',
    ]);
  });

  it('lists overdue tasks from previous dates and counts yesterday resolved tasks', async () => {
    await ensureUserSettings(db, userJid, 'Keva', true);
    await db.insert(tasks).values([
      // Overdue tasks (before 2026-09-29 00:00 WIB = 2026-09-28 17:00 UTC)
      { userJid, task: 'Tugas kemarin pagi', status: 'pending', deadline: new Date('2026-09-28T02:00:00.000Z') },
      { userJid, task: 'Tugas kemarin sore', status: 'pending', deadline: new Date('2026-09-28T10:00:00.000Z') },
      // Today task
      { userJid, task: 'Tugas hari ini', status: 'pending', deadline: new Date('2026-09-29T02:00:00.000Z') },
      // Tasks resolved yesterday (between 2026-09-28 00:00 WIB and 2026-09-29 00:00 WIB)
      { userJid, task: 'Selesai kemarin 1', status: 'resolved', updatedAt: new Date('2026-09-28T03:00:00.000Z') },
      { userJid, task: 'Selesai kemarin 2', status: 'resolved', updatedAt: new Date('2026-09-28T09:00:00.000Z') },
      // Task resolved two days ago
      { userJid, task: 'Selesai lusa lalu', status: 'resolved', updatedAt: new Date('2026-09-27T03:00:00.000Z') },
    ]);

    const overdue = await listOverdueTasks(db, userJid, '2026-09-29', 'Asia/Jakarta');
    expect(overdue.map((t) => t.task)).toEqual([
      'Tugas kemarin pagi',
      'Tugas kemarin sore',
    ]);

    const yesterdayResolved = await countYesterdayResolvedTasks(db, userJid, '2026-09-29', 'Asia/Jakarta');
    expect(yesterdayResolved).toBe(2);
  });

  it('claims at most one delivery per user and local date', async () => {
    await ensureUserSettings(db, userJid, 'Keva', true);

    const first = await claimMorningDigestDelivery(db, {
      userJid,
      localDate: '2026-09-29',
      timezone: 'Asia/Jakarta',
      now: new Date('2026-09-28T23:00:00.000Z'),
    });
    const second = await claimMorningDigestDelivery(db, {
      userJid,
      localDate: '2026-09-29',
      timezone: 'Asia/Jakarta',
      now: new Date('2026-09-28T23:01:00.000Z'),
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('stores one validated motivation per date and reuses it without a second generator call', async () => {
    let calls = 0;
    const generate = async () => {
      calls++;
      return {
        text: 'Pagi cerah membuka hari,\nSemoga semua urusan lancar.',
        source: 'gemini' as const,
        model: 'gemini-test',
        usage: { promptTokens: 20, outputTokens: 30, totalTokens: 50 },
      };
    };

    const first = await getOrCreateMorningMotivation(db, '2026-09-29', generate);
    const second = await getOrCreateMorningMotivation(db, '2026-09-29', generate);

    expect(first.text).toBe(second.text);
    expect(first.source).toBe('gemini');
    expect(calls).toBe(1);
  });

  it('dispatches only opted-in due users and remains idempotent on the next tick', async () => {
    const disabledJid = '628100000002@s.whatsapp.net';
    await ensureUserSettings(db, userJid, 'Keva', true);
    await ensureUserSettings(db, disabledJid, 'Disabled', true);
    await updateMorningDigestSettings(db, userJid, {
      enabled: true,
      time: '06:00',
      now: new Date('2026-09-28T22:00:00.000Z'),
    });
    await db.insert(tasks).values([
      { userJid, task: 'Task jam delapan', status: 'pending', deadline: new Date('2026-09-29T01:00:00.000Z') },
      { userJid, task: 'Task jam tujuh', status: 'pending', deadline: new Date('2026-09-29T00:00:00.000Z') },
      { userJid: disabledJid, task: 'Tidak boleh terkirim', status: 'pending', deadline: new Date('2026-09-29T00:30:00.000Z') },
    ]);

    const sent: Array<{ jid: string; text: string }> = [];
    let generationCalls = 0;
    const options = {
      now: new Date('2026-09-28T23:05:00.000Z'),
      generateMotivation: async () => {
        generationCalls++;
        return {
          text: 'Pagi cerah membuka hari,\nSemoga semua urusan lancar.',
          source: 'gemini' as const,
        };
      },
      sendMessage: async (jid: string, text: string) => {
        sent.push({ jid, text });
        return `MSG_${sent.length}`;
      },
    };

    const first = await dispatchMorningDigests(db, options);
    const second = await dispatchMorningDigests(db, options);

    expect(first).toEqual({ due: 1, sent: 1, failed: 0 });
    expect(second).toEqual({ due: 0, sent: 0, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.jid).toBe(userJid);
    expect(sent[0]?.text.indexOf('Task jam tujuh')).toBeLessThan(sent[0]?.text.indexOf('Task jam delapan') ?? 0);
    expect(generationCalls).toBe(1);

    const deliveries = await db.select().from(dailyDigestDeliveries);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.status).toBe('sent');
    expect(deliveries[0]?.taskCount).toBe(2);
  });

  it('does not send immediately when a user opts in after today\'s configured time', async () => {
    await ensureUserSettings(db, userJid, 'Keva', true);
    await updateMorningDigestSettings(db, userJid, {
      enabled: true,
      time: '06:00',
      now: new Date('2026-09-29T00:00:00.000Z'),
    });

    const result = await dispatchMorningDigests(db, {
      now: new Date('2026-09-29T00:05:00.000Z'),
      generateMotivation: async () => ({
        text: 'Pagi cerah membuka hari,\nSemoga semua urusan lancar.',
        source: 'gemini',
      }),
      sendMessage: async () => 'SHOULD_NOT_SEND',
    });

    expect(result).toEqual({ due: 0, sent: 0, failed: 0 });
  });
});
