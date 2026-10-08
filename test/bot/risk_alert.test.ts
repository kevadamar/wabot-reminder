import { describe, expect, it, beforeEach, beforeAll, afterAll } from 'bun:test';
import { resetLlmConfigCache } from '../../src/config/llm.js';
import { db } from '../../src/db/index.js';
import { tasks, taskMessages, userSettings } from '../../src/db/schema.js';
import { handleIncomingMessage } from '../../src/bot/handlers/router.js';
import { createTask, ensureUserSettings, listActiveTasks } from '../../src/services/task.js';
import { parseLocalTask } from '../../src/services/nlp.js';

describe('Risky content alert (judol / scam / phishing)', () => {
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

  const say = (text: string, id: string, options: { stanzaId?: string; forwarded?: boolean } = {}) =>
    handleIncomingMessage(mockSock as any, {
      key: { remoteJid: userJid, id },
      message:
        options.stanzaId || options.forwarded
          ? {
              extendedTextMessage: {
                text,
                contextInfo: { stanzaId: options.stanzaId, isForwarded: options.forwarded },
              },
            }
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
    const user = await ensureUserSettings(db, userJid, 'Owner', true);
    timezone = user.timezone;
  });

  it('holds a risky task and alerts the user instead of saving it', async () => {
    await say('Depo slot gacor maxwin besok jam 20:00', 'IN_1');

    const rows = await db.select().from(tasks);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('pending_risk_confirmation');
    expect(await listActiveTasks(db, userJid)).toHaveLength(0);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('judi online');
    expect(sent[0]!.text.toLowerCase()).toContain('lanjut');
    expect(sent[0]!.text.toLowerCase()).toContain('batal');
    expect(sent[0]!.text).not.toContain('Tugas Dicatat');
  });

  it('saves the task when the user confirms it is safe', async () => {
    await say('Depo slot gacor maxwin besok jam 20:00', 'IN_1');

    await say('lanjut', 'IN_2');

    const row = (await db.select().from(tasks))[0];
    expect(row?.status).toBe('pending');
    expect(sent[1]!.text).toContain('Tugas Dicatat');
  });

  it('asks for a time after confirming a risky task without a deadline', async () => {
    await say('/todo kirim kode OTP ke admin', 'IN_1');
    expect((await db.select().from(tasks))[0]?.status).toBe('pending_risk_confirmation');

    await say('aman', 'IN_2', { stanzaId: sent[0]!.id });

    expect((await db.select().from(tasks))[0]?.status).toBe('pending_deadline');
    expect(sent[1]!.text).toContain('kapan');
  });

  it('still checks same-schedule collisions after a risk confirmation', async () => {
    const deadline = parseLocalTask('besok jam 20:00', new Date(), timezone).deadline!;
    await createTask(db, { userJid, task: 'Makan malam', deadline, status: 'pending' });
    await say('Depo slot gacor maxwin besok jam 20:00', 'IN_1');

    await say('lanjut', 'IN_2');

    const held = (await db.select().from(tasks)).find((t) => t.task !== 'Makan malam');
    expect(held?.status).toBe('pending_confirmation');
    expect(sent[1]!.text).toContain('Makan malam');
  });

  it('drops the task when the user cancels', async () => {
    await say('Depo slot gacor maxwin besok jam 20:00', 'IN_1');

    await say('batal', 'IN_2');

    expect((await db.select().from(tasks))[0]?.status).toBe('cancelled');
    expect(sent[1]!.text.toLowerCase()).toContain('buang');
  });

  it('warns about a risky non-task message without creating anything', async () => {
    await say('Selamat! Anda terpilih sebagai pemenang undian berhadiah, klaim di bit.ly/hadiah', 'IN_1');

    expect(await db.select().from(tasks)).toHaveLength(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('penipuan');
  });

  it('flags risky forwarded messages', async () => {
    await say('Rekening anda akan diblokir hari ini, verifikasi segera di bri-layanan.xyz', 'IN_1', { forwarded: true });

    const rows = await db.select().from(tasks);
    expect(rows.every((t) => t.status !== 'pending' && t.status !== 'pending_deadline')).toBe(true);
    expect(sent[0]!.text).toMatch(/penipuan|phishing/);
  });

  it('does not bother the user for everyday tasks', async () => {
    await say('Bayar slot parkir besok jam 08:00', 'IN_1');

    expect((await db.select().from(tasks))[0]?.status).toBe('pending');
    expect(sent[0]!.text).toContain('Tugas Dicatat');
  });
});
