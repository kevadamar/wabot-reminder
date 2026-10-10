import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { resetLlmConfigCache } from '../../src/config/llm.js';
import { db } from '../../src/db/index.js';
import { taskHistory, taskMessages, tasks, userSettings } from '../../src/db/schema.js';
import { handleIncomingMessage } from '../../src/bot/handlers/router.js';
import { ensureUserSettings, holdTaskForRisk, createTask } from '../../src/services/task.js';
import {
  resetLinkReviewState,
  setLinkReviewDepsForTests,
  settleLinkReviews,
  type LinkReviewDeps,
} from '../../src/services/link-review.js';
import { EMPTY_FORMS, type InspectionResult } from '../../src/link-inspector/types.js';

function page(url: string, overrides: Partial<InspectionResult> = {}): InspectionResult {
  return {
    requestedUrl: url,
    finalUrl: url,
    redirectChain: [],
    httpStatus: 200,
    title: 'Promo Baru',
    description: '',
    text: 'Isi halaman',
    forms: EMPTY_FORMS,
    download: null,
    blockedRequests: [],
    screenshot: null,
    error: null,
    errorDetail: null,
    durationMs: 500,
    ...overrides,
  };
}

const safe: LinkReviewDeps = {
  inspect: async (url) => page(url),
  safeBrowsing: async () => [],
  judge: async () => ({ verdict: { category: 'none', reason: null }, summary: 'Halaman promo toko' }),
};

const phishing: LinkReviewDeps = {
  ...safe,
  inspect: async (url) => page(url, { title: 'KlikBCA Individual Login', forms: { ...EMPTY_FORMS, total: 1, password: 1 } }),
};

describe('Link check follow-up', () => {
  const userJid = '628123456789@s.whatsapp.net';
  let sent: { text: string; id: string }[] = [];

  const mockSock = {
    sendMessage: async (_jid: string, content: any) => {
      const id = `BOT_${sent.length + 1}`;
      sent.push({ text: content.text, id });
      return { key: { id } };
    },
  };

  const say = async (text: string, id: string) => {
    await handleIncomingMessage(mockSock as any, { key: { remoteJid: userJid, id }, message: { conversation: text } });
    await settleLinkReviews();
  };

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
    resetLinkReviewState();
    await db.delete(taskMessages);
    await db.delete(taskHistory);
    await db.delete(tasks);
    await db.delete(userSettings);
    await ensureUserSettings(db, userJid, 'Owner', true);
  });
  afterEach(() => setLinkReviewDepsForTests(null));

  it('holds the task when the link turns out to be phishing, and activates it on "lanjut"', async () => {
    setLinkReviewDepsForTests(phishing);
    await say('besok jam 10:00 cek promo-baru.xyz/klaim', 'IN_1');

    expect(sent).toHaveLength(2);
    expect(sent[0]!.text).toContain('Tugas Dicatat');
    expect(sent[1]!.text).toContain('promo-baru.xyz');
    expect(sent[1]!.text).toContain('BCA');
    expect(sent[1]!.text.toLowerCase()).toContain('lanjut');
    expect((await db.select().from(tasks))[0]?.status).toBe('pending_risk_confirmation');

    await say('lanjut', 'IN_2');
    expect((await db.select().from(tasks))[0]?.status).toBe('pending');
  });

  it('holds a task that was still waiting for a deadline and asks for a time after confirming', async () => {
    setLinkReviewDepsForTests(phishing);
    await say('/todo isi form di promo-baru.xyz', 'IN_1');
    expect((await db.select().from(tasks))[0]?.status).toBe('pending_risk_confirmation');

    await say('aman', 'IN_2');
    expect((await db.select().from(tasks))[0]?.status).toBe('pending_deadline');
  });

  it('sends a short note when the link looks safe and keeps the task active', async () => {
    setLinkReviewDepsForTests(safe);
    await say('besok jam 10:00 cek promo-baru.xyz/klaim', 'IN_1');

    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).toContain('promo-baru.xyz');
    expect(sent[1]!.text).toContain('Halaman promo toko');
    expect((await db.select().from(tasks))[0]?.status).toBe('pending');
  });

  it('tells the user when the page could not be opened', async () => {
    setLinkReviewDepsForTests({ ...safe, inspect: async (url) => page(url, { finalUrl: null, error: 'dns_failed', title: '' }) });
    await say('besok jam 10:00 cek promo-baru.xyz/klaim', 'IN_1');

    expect(sent[1]!.text).toContain('nggak bisa aku buka');
    expect((await db.select().from(tasks))[0]?.status).toBe('pending');
  });

  it('warns about a dangerous link in a non-task message without creating a task', async () => {
    setLinkReviewDepsForTests(phishing);
    await say('promo-baru.xyz', 'IN_1');

    expect(await db.select().from(tasks)).toHaveLength(0);
    expect(sent.at(-1)!.text).toContain('BCA');
    expect(sent.at(-1)!.text.toLowerCase()).not.toContain('balas *lanjut*');
  });

  it('skips the follow-up when the message was already flagged locally, or links are allowlisted', async () => {
    let inspected = 0;
    setLinkReviewDepsForTests({ ...safe, inspect: async (url) => (inspected++, page(url)) });
    await say('login di bca-verifikasi.xyz besok jam 10:00', 'IN_1');
    await say('rapat besok jam 10:00 di https://meet.google.com/abc-defg-hij', 'IN_2');

    expect(inspected).toBe(0);
    expect(sent).toHaveLength(2);
  });

  it('does not hold a task that was finished before the check came back', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    setLinkReviewDepsForTests({ ...phishing, inspect: async (url) => (await gate, phishing.inspect!(url, 'x')) });

    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: userJid, id: 'IN_1' },
      message: { conversation: 'besok jam 10:00 cek promo-baru.xyz/klaim' },
    });
    await db.update(tasks).set({ status: 'resolved' });
    release();
    await settleLinkReviews();

    expect((await db.select().from(tasks))[0]?.status).toBe('resolved');
    expect(sent.at(-1)!.text).toContain('BCA');
    expect(sent.at(-1)!.text.toLowerCase()).not.toContain('balas *lanjut*');
  });

  it('holdTaskForRisk only holds active tasks and records history', async () => {
    const active = await createTask(db, { userJid, task: 'Cek link promo', status: 'pending_deadline' });
    const held = await holdTaskForRisk(db, active.id, userJid, 'link_review');
    expect(held?.status).toBe('pending_risk_confirmation');
    expect(await holdTaskForRisk(db, active.id, userJid)).toBeNull();

    const history = await db.select().from(taskHistory).where(eq(taskHistory.taskId, active.id));
    expect(history.some((h) => h.changeType === 'hold_risk' && h.oldValue === 'pending_deadline')).toBe(true);
  });
});
