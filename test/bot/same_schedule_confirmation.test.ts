import { describe, expect, it, beforeEach, beforeAll, afterAll } from 'bun:test';
import { resetLlmConfigCache } from '../../src/config/llm.js';
import { db } from '../../src/db/index.js';
import { tasks, taskMessages, userSettings } from '../../src/db/schema.js';
import { handleIncomingMessage } from '../../src/bot/handlers/router.js';
import { createTask, ensureUserSettings, linkTaskMessage } from '../../src/services/task.js';
import { parseLocalTask } from '../../src/services/nlp.js';

describe('Same-schedule confirmation flow', () => {
  const userJid = '628123456789@s.whatsapp.net';
  let timezone = 'Asia/Jakarta';
  let sent: { text: string; id: string }[] = [];

  const mockSock = {
    sendMessage: async (_jid: string, content: any) => {
      const id = `BOT_${sent.length + 1}`;
      sent.push({ text: content.text, id });
      return { key: { id } };
    },
  };

  const say = (text: string, id: string, stanzaId?: string) =>
    handleIncomingMessage(mockSock as any, {
      key: { remoteJid: userJid, id },
      message: stanzaId
        ? { extendedTextMessage: { text, contextInfo: { stanzaId } } }
        : { conversation: text },
    });

  const tomorrowAt = (time: string) => parseLocalTask(`besok jam ${time}`, new Date(), timezone).deadline!;

  const seedExisting = async (time = '14:00') => {
    const deadline = tomorrowAt(time);
    return createTask(db, {
      userJid,
      task: 'Meeting tim',
      deadline,
      remindAt: new Date(deadline.getTime() - 10 * 60 * 1000),
      status: 'pending',
    });
  };

  const newTask = async () => (await db.select().from(tasks)).find((t) => t.task !== 'Meeting tim');

  const previousNlpChain = process.env.LLM_CHAIN_NLP;
  beforeAll(() => {
    process.env.LLM_CHAIN_NLP = 'local';
    resetLlmConfigCache();
  });
  afterAll(() => {
    if (previousNlpChain === undefined) delete process.env.LLM_CHAIN_NLP;
    else process.env.LLM_CHAIN_NLP = previousNlpChain;
    resetLlmConfigCache();
  });

  beforeEach(async () => {
    sent = [];
    await db.delete(taskMessages);
    await db.delete(tasks);
    await db.delete(userSettings);
    const user = await ensureUserSettings(db, userJid, 'Owner', true);
    timezone = user.timezone;
  });

  it('asks for confirmation instead of saving when the schedule matches an existing task', async () => {
    const existing = await seedExisting();

    await say('Bayar listrik besok jam 14:00', 'IN_1');

    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).not.toContain('Tugas Dicatat');
    expect(sent[0]!.text).toContain('Meeting tim');
    expect(sent[0]!.text).toContain(`ID: ${existing.id}`);
    expect(sent[0]!.text.toLowerCase()).toContain('gas');
    expect(sent[0]!.text.toLowerCase()).toContain('batal');

    const held = await newTask();
    expect(held?.status).toBe('pending_confirmation');
    expect(held?.deadline?.getTime()).toBe(existing.deadline!.getTime());
  });

  it('saves the task as-is when the user is fine with the shared schedule', async () => {
    await seedExisting();
    await say('Bayar listrik besok jam 14:00', 'IN_1');

    await say('gas', 'IN_2');

    const confirmed = await newTask();
    expect(confirmed?.status).toBe('pending');
    expect(sent[1]!.text).toContain('Tugas Dicatat');
    const links = await db.select().from(taskMessages);
    expect(links.some((l) => l.taskId === confirmed!.id && l.messageId === sent[1]!.id)).toBe(true);
  });

  it('accepts confirmation by quoting the confirmation message', async () => {
    await seedExisting();
    await say('Bayar listrik besok jam 14:00', 'IN_1');

    await say('iya gapapa', 'IN_2', sent[0]!.id);

    expect((await newTask())?.status).toBe('pending');
  });

  it('cancels only the new task when the user backs out', async () => {
    const existing = await seedExisting();
    await say('Bayar listrik besok jam 14:00', 'IN_1');

    await say('ga jadi', 'IN_2');

    expect((await newTask())?.status).toBe('cancelled');
    const existingAfter = (await db.select().from(tasks)).find((t) => t.id === existing.id);
    expect(existingAfter?.status).toBe('pending');
    expect(sent[1]!.text).toContain('Meeting tim');
  });

  it('moves the new task to another time on the same day when the user replies with a time', async () => {
    await seedExisting();
    await say('Bayar listrik besok jam 14:00', 'IN_1');

    await say('jam 15:30 aja', 'IN_2');

    const moved = await newTask();
    expect(moved?.status).toBe('pending');
    expect(moved?.deadline?.getTime()).toBe(tomorrowAt('15:30').getTime());
    expect(sent[1]!.text).toContain('Waktu Disimpan');
  });

  it('asks again when the new time also collides with another task', async () => {
    await seedExisting('14:00');
    await createTask(db, {
      userJid,
      task: 'Jemput adik',
      deadline: tomorrowAt('16:00'),
      status: 'pending',
    });
    await say('Bayar listrik besok jam 14:00', 'IN_1');

    await say('jam 16:00', 'IN_2');

    const held = (await db.select().from(tasks)).find((t) => t.task.toLowerCase().includes('listrik'));
    expect(held?.status).toBe('pending_confirmation');
    expect(held?.deadline?.getTime()).toBe(tomorrowAt('16:00').getTime());
    expect(sent[1]!.text).toContain('Jemput adik');
  });

  it('saves immediately when no other task shares the schedule', async () => {
    await seedExisting('14:00');

    await say('Bayar listrik besok jam 15:00', 'IN_1');

    expect(sent[0]!.text).toContain('Tugas Dicatat');
    expect((await newTask())?.status).toBe('pending');
  });

  it('asks for confirmation when a pending_deadline task gets a colliding time', async () => {
    await seedExisting('14:00');
    const waiting = await createTask(db, { userJid, task: 'Bayar listrik', status: 'pending_deadline' });
    await linkTaskMessage(db, waiting.id, 'BOT_ASK_TIME');

    await say('besok jam 14:00', 'IN_1', 'BOT_ASK_TIME');

    const held = (await db.select().from(tasks)).find((t) => t.id === waiting.id);
    expect(held?.status).toBe('pending_confirmation');
    expect(sent[0]!.text).toContain('Meeting tim');

    await say('lanjut', 'IN_2');
    expect((await db.select().from(tasks)).find((t) => t.id === waiting.id)?.status).toBe('pending');
  });
});
