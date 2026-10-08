import { describe, expect, it, beforeEach, beforeAll, afterAll } from 'bun:test';
import { resetLlmConfigCache } from '../../src/config/llm.js';
import { db } from '../../src/db/index.js';
import { tasks, taskMessages, userSettings } from '../../src/db/schema.js';
import { handleIncomingMessage } from '../../src/bot/handlers/router.js';
import { createTask, ensureUserSettings, hasEnoughTitleLetters, linkTaskMessage } from '../../src/services/task.js';

describe('Task title minimum length (3 letters)', () => {
  const userJid = '628123456789@s.whatsapp.net';
  let sent: string[] = [];

  const mockSock = {
    sendMessage: async (_jid: string, content: any) => {
      sent.push(content.text);
      return { key: { id: `BOT_${sent.length}` } };
    },
  };

  const say = (text: string, id: string, stanzaId?: string) =>
    handleIncomingMessage(mockSock as any, {
      key: { remoteJid: userJid, id },
      message: stanzaId
        ? { extendedTextMessage: { text, contextInfo: { stanzaId } } }
        : { conversation: text },
    });

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
    await ensureUserSettings(db, userJid, 'Owner', true);
  });

  it('counts letters of any script, ignoring digits, emoji and punctuation', () => {
    expect(hasEnoughTitleLetters('ab')).toBe(false);
    expect(hasEnoughTitleLetters('  a.b!  ')).toBe(false);
    expect(hasEnoughTitleLetters('12345')).toBe(false);
    expect(hasEnoughTitleLetters('🏃🏃🏃')).toBe(false);
    expect(hasEnoughTitleLetters('abc')).toBe(true);
    expect(hasEnoughTitleLetters('PR 3 IPA')).toBe(true);
    expect(hasEnoughTitleLetters('ñañ')).toBe(true);
  });

  it('asks again instead of saving a new task whose title is too short', async () => {
    await say('ab besok jam 14:00', 'IN_1');

    expect(await db.select().from(tasks)).toHaveLength(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('minimal 3 huruf');
    expect(sent[0]).toContain('"ab"');
  });

  it('does not create a subtask with a too-short title', async () => {
    const parent = await createTask(db, { userJid, task: 'Proyek besar', status: 'pending' });

    await say(`subtask ${parent.id} ok`, 'IN_1');

    const rows = await db.select().from(tasks);
    expect(rows).toHaveLength(1);
    expect(sent[0]).toContain('minimal 3 huruf');
  });

  it('does not create a subtask via quoted reply with a too-short title', async () => {
    const parent = await createTask(db, { userJid, task: 'Proyek besar', status: 'pending' });
    await linkTaskMessage(db, parent.id, 'BOT_PARENT');

    await say('subtask: x', 'IN_1', 'BOT_PARENT');

    expect(await db.select().from(tasks)).toHaveLength(1);
    expect(sent[0]).toContain('minimal 3 huruf');
  });

  it('keeps the old title when a rename is too short', async () => {
    const task = await createTask(db, { userJid, task: 'Presentasi Q3', status: 'pending' });
    await linkTaskMessage(db, task.id, 'BOT_TASK');

    await say('ubah tugas: Q3', 'IN_1', 'BOT_TASK');

    const after = (await db.select().from(tasks))[0];
    expect(after?.task).toBe('Presentasi Q3');
    expect(sent[0]).toContain('minimal 3 huruf');
    expect(sent[0]).toContain('Presentasi Q3');
  });

  it('still saves tasks with 3 or more letters', async () => {
    await say('Beli besok jam 14:00', 'IN_1');

    const rows = await db.select().from(tasks);
    expect(rows).toHaveLength(1);
    expect(sent[0]).toContain('Tugas Dicatat');
  });
});
