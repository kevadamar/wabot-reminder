import { describe, expect, it } from 'bun:test';
import { parseTaskMessage, cleanProfanity, isTimeOnlyExpression } from '../../src/services/nlp.js';
import { config } from '../../src/config/index.js';

describe('Seam 1: NLP Intent & Deadline Extraction', () => {
  const baseNow = new Date('2026-09-26T03:00:00.000Z'); // 10:00 WIB

  it('should ignore casual greetings and chatter (isTask: false)', async () => {
    const greetings = ['halo', 'Halo bot', 'selamat pagi', 'P', 'ping', 'makasih ya', 'assalamualaikum'];

    for (const msg of greetings) {
      const result = await parseTaskMessage(msg, { now: baseNow });
      expect(result.isTask).toBe(false);
    }
  });

  it('should identify task without deadline and mark needsDeadline: true', async () => {
    const result = await parseTaskMessage('Beli sabun mandi dan odol', { now: baseNow, geminiClient: null });

    expect(result.isTask).toBe(true);
    expect(result.taskTitle).toContain('sabun mandi dan odol');
    expect(result.deadline).toBeNull();
    expect(result.needsDeadline).toBe(true);
  });

  it('should identify task with /todo prefix even without action verb', async () => {
    const result = await parseTaskMessage('/todo dokumen presentasi', { now: baseNow, geminiClient: null });

    expect(result.isTask).toBe(true);
    expect(result.taskTitle).toBe('dokumen presentasi');
    expect(result.needsDeadline).toBe(true);
  });

  it('should parse Indonesian deadline using local fallback parser', async () => {
    // "Kirim draft proposal besok jam 14:00"
    const result = await parseTaskMessage('Kirim draft proposal besok jam 14:00', { now: baseNow, geminiClient: null });

    expect(result.isTask).toBe(true);
    expect(result.taskTitle.toLowerCase()).toContain('draft proposal');
    expect(result.deadline).not.toBeNull();
    expect(result.needsDeadline).toBe(false);

    // Verify date is tomorrow
    const tomorrowDate = new Date(baseNow);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    expect(result.deadline?.getUTCDate()).toBe(tomorrowDate.getUTCDate());
  });

  it('should gracefully fallback to local parser when Gemini fails', async () => {
    const mockFaultyGemini = {
      models: {
        generateContent: async () => {
          throw new Error('Gemini Quota Exceeded / Network Error');
        },
      },
    };

    const result = await parseTaskMessage('Rapat tim besok jam 10:00', {
      now: baseNow,
      geminiClient: mockFaultyGemini as any,
    });

    expect(result.isTask).toBe(true);
    expect(result.deadline).not.toBeNull();
  });

  it('should parse Antigravity Bridge JSON wrapped in prose and markdown', async () => {
    const originalBridgeUrl = config.antigravityBridgeUrl;
    const originalFetch = globalThis.fetch;

    config.antigravityBridgeUrl = 'http://antigravity-bridge.test';
    globalThis.fetch = (async () =>
      Response.json({
        text: `Berikut hasil analisisnya:\n\n\`\`\`json\n{"isTask":true,"taskTitle":"Kirim laporan hasil bridge","deadline":"2026-09-27T03:00:00.000Z","needsDeadline":false}\n\`\`\``,
      })) as unknown as typeof fetch;

    try {
      const result = await parseTaskMessage('Kirim laporan besok jam 10', {
        now: baseNow,
        geminiClient: null,
      });

      expect(result.taskTitle).toBe('Kirim laporan hasil bridge');
      expect(result.deadline?.toISOString()).toBe('2026-09-27T03:00:00.000Z');
      expect(result.needsDeadline).toBe(false);
    } finally {
      config.antigravityBridgeUrl = originalBridgeUrl;
      globalThis.fetch = originalFetch;
    }
  });

  it('should accurately parse Indonesian time phrases and clean titles with dots (14.00, jam 3 siang)', async () => {
    // 1. "besok jam 3 siang mau beli matcha sama mas"
    const r1 = await parseTaskMessage('besok jam 3 siang mau beli matcha sama mas', {
      now: baseNow,
      timezone: 'Asia/Jakarta',
      geminiClient: null,
    });
    expect(r1.isTask).toBe(true);
    expect(r1.taskTitle).toBe('mau beli matcha sama mas');
    expect(r1.deadline).not.toBeNull();
    // 15:00 WIB is 08:00 UTC
    expect(r1.deadline?.getUTCHours()).toBe(8);

    // 2. "besok jam 2 siang mau facial"
    const r2 = await parseTaskMessage('besok jam 2 siang mau facial', {
      now: baseNow,
      timezone: 'Asia/Jakarta',
      geminiClient: null,
    });
    expect(r2.isTask).toBe(true);
    expect(r2.taskTitle).toBe('mau facial');
    // 14:00 WIB is 07:00 UTC
    expect(r2.deadline?.getUTCHours()).toBe(7);

    // 3. "besok jam 14.00 mau facial" (with dot)
    const r3 = await parseTaskMessage('besok jam 14.00 mau facial', {
      now: baseNow,
      timezone: 'Asia/Jakarta',
      geminiClient: null,
    });
    expect(r3.isTask).toBe(true);
    expect(r3.taskTitle).toBe('mau facial');
    expect(r3.deadline?.getUTCHours()).toBe(7);
  });

  it('should parse Indonesian day of week forward and recognize Indonesian month names', async () => {
    // Current time: Thursday, Oct 1, 2026, 13:00 WIB
    const thursdayNow = new Date('2026-10-01T06:00:00.000Z');

    // 1. "senin jam 9" on Thursday should resolve forward to next Monday, Oct 5, 2026 at 09:00 WIB (02:00 UTC)
    const r1 = await parseTaskMessage('konsul nama jenis senin jam 9', {
      now: thursdayNow,
      timezone: 'Asia/Jakarta',
      geminiClient: null,
    });
    expect(r1.isTask).toBe(true);
    expect(r1.taskTitle).toBe('konsul nama jenis');
    expect(r1.deadline).not.toBeNull();
    expect(r1.deadline?.toISOString()).toBe('2026-10-05T02:00:00.000Z');

    // 2. "senin 5 oktober jam 9" should resolve to Monday, Oct 5, 2026 at 09:00 WIB
    const r2 = await parseTaskMessage('konsul nama jenis senin 5 oktober jam 9', {
      now: thursdayNow,
      timezone: 'Asia/Jakarta',
      geminiClient: null,
    });
    expect(r2.isTask).toBe(true);
    expect(r2.taskTitle).toBe('konsul nama jenis');
    expect(r2.deadline?.toISOString()).toBe('2026-10-05T02:00:00.000Z');

    // 3. "5 oktober jam 9" should resolve to Oct 5, 2026 at 09:00 WIB
    const r3 = await parseTaskMessage('review dokumen 5 oktober jam 9', {
      now: thursdayNow,
      timezone: 'Asia/Jakarta',
      geminiClient: null,
    });
    expect(r3.isTask).toBe(true);
    expect(r3.taskTitle).toBe('review dokumen');
    expect(r3.deadline?.toISOString()).toBe('2026-10-05T02:00:00.000Z');
  });

  it('should extract explicit per-task reminder lead time (menit, jam, H-1) and clean the task title', async () => {
    // 1. "Meeting project besok jam 15:00 ingatkan 30 menit sebelumnya"
    const r1 = await parseTaskMessage('Meeting project besok jam 15:00 ingatkan 30 menit sebelumnya', {
      now: baseNow,
      timezone: 'Asia/Jakarta',
      geminiClient: null,
    });
    expect(r1.isTask).toBe(true);
    expect(r1.taskTitle).toBe('Meeting project');
    expect(r1.reminderLeadMinutes).toBe(30);
    expect(r1.deadline).not.toBeNull();

    // 2. "Presentasi besok jam 10 pagi ingatkan 1 jam sebelum"
    const r2 = await parseTaskMessage('Presentasi besok jam 10 pagi ingatkan 1 jam sebelum', {
      now: baseNow,
      timezone: 'Asia/Jakarta',
      geminiClient: null,
    });
    expect(r2.isTask).toBe(true);
    expect(r2.taskTitle).toBe('Presentasi');
    expect(r2.reminderLeadMinutes).toBe(60);

    // 3. "Ujian akhir besok jam 8 pagi ingatkan H-1"
    const r3 = await parseTaskMessage('Ujian akhir besok jam 8 pagi ingatkan H-1', {
      now: baseNow,
      timezone: 'Asia/Jakarta',
      geminiClient: null,
    });
    expect(r3.isTask).toBe(true);
    expect(r3.taskTitle).toBe('Ujian akhir');
    expect(r3.reminderLeadMinutes).toBe(1440);

    // 4. Default task without reminder phrase should have null/undefined reminderLeadMinutes
    const r4 = await parseTaskMessage('Beli makan malam jam 7 malam', {
      now: baseNow,
      timezone: 'Asia/Jakarta',
      geminiClient: null,
    });
    expect(r4.isTask).toBe(true);
    expect(r4.reminderLeadMinutes).toBeNull();
  });

  it('should detect sentiment, screen toxicity, and clean profanity from task titles', async () => {
    // 1. Pure toxic insult
    const r1 = await parseTaskMessage('bot anjing goblok lu', { now: baseNow, geminiClient: null });
    expect(r1.isTask).toBe(false);
    expect(r1.sentiment?.isToxicOnly).toBe(true);

    // 2. Pure distress / burnout
    const r2 = await parseTaskMessage('capek hidup mau mati aja pusing', { now: baseNow, geminiClient: null });
    expect(r2.isTask).toBe(false);
    expect(r2.sentiment?.isDistress).toBe(true);

    // 3. Real task with swearing: should clean profanity and preserve task
    const r3 = await parseTaskMessage('anjing besok jam 14:00 harus kumpul laporan tai', {
      now: baseNow,
      geminiClient: null,
    });
    expect(r3.isTask).toBe(true);
    expect(r3.taskTitle.toLowerCase()).toContain('kumpul laporan');
    expect(r3.taskTitle.toLowerCase()).not.toContain('anjing');
    expect(r3.taskTitle.toLowerCase()).not.toContain('tai');
    expect(r3.sentiment?.hasProfanity).toBe(true);

    // 4. Broad Indonesian slang from sentiment-lexicon.json (jancuk, anjir, bgsd, ga sanggup lagi)
    const r4 = await parseTaskMessage('jancuk bot sialan', { now: baseNow, geminiClient: null });
    expect(r4.isTask).toBe(false);
    expect(r4.sentiment?.isToxicOnly).toBe(true);

    const r5 = await parseTaskMessage('ga sanggup lagi sumpah pengen nyerah', { now: baseNow, geminiClient: null });
    expect(r5.isTask).toBe(false);
    expect(r5.sentiment?.isDistress).toBe(true);

    // 5. AI structured sentiment parsing (Gemini)
    const mockGeminiWithSentiment = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            isTask: true,
            taskTitle: 'Kirim revisi desain',
            deadline: '2026-09-27T07:00:00.000Z',
            needsDeadline: false,
            reminderLeadMinutes: 15,
            sentiment: 'frustrated',
          }),
        }),
      },
    };

    const r6 = await parseTaskMessage('pusing banget besok jam 2 siang harus kirim revisi desain', {
      now: baseNow,
      geminiClient: mockGeminiWithSentiment as any,
    });
    expect(r6.isTask).toBe(true);
    expect(r6.taskTitle).toBe('Kirim revisi desain');
    expect(r6.sentiment?.tone).toBe('frustrated');
  });

  it('should format multiline tasks and normalize bullet lists (*, -, ·, •) into standard bullets', async () => {
    // 1. WhatsApp style asterisks with newlines
    const inputWithAsterisks = `hari ini, jam 10.30 tanya:\n* mpc 1\n* mpc 2\n* mpc 3\n* mpc 4\n* wok owok`;
    const r1 = await parseTaskMessage(inputWithAsterisks, {
      now: baseNow,
      timezone: 'Asia/Jakarta',
      geminiClient: null,
    });
    expect(r1.isTask).toBe(true);
    expect(r1.taskTitle).toContain('tanya:');
    expect(r1.taskTitle).toContain('• mpc 1');
    expect(r1.taskTitle).toContain('• mpc 2');
    expect(r1.taskTitle).toContain('• mpc 3');
    expect(r1.taskTitle).toContain('• mpc 4');
    expect(r1.taskTitle).toContain('• wok owok');
    expect(r1.taskTitle).not.toContain('* mpc');

    // 2. Middle dots with newlines
    const inputWithDots = `hari ini, jam 10.30 tanya:\n· mpc 1\n· mpc 2`;
    const r2 = await parseTaskMessage(inputWithDots, {
      now: baseNow,
      timezone: 'Asia/Jakarta',
      geminiClient: null,
    });
    expect(r2.isTask).toBe(true);
    expect(r2.taskTitle).toContain('• mpc 1');
    expect(r2.taskTitle).toContain('• mpc 2');

    // 3. Single-line pseudo-bullets (e.g. "tanya: * mpc 1 * mpc 2")
    const singleLineBullets = cleanProfanity('tanya: * mpc 1 * mpc 2 * mpc 3');
    expect(singleLineBullets).toBe('tanya:\n• mpc 1\n• mpc 2\n• mpc 3');
  });

  it('should recognize tasks with 2-digit hour times without day keyword (e.g. jam 10.30 tanya:)', async () => {
    const input = `jam 10.30 tanya:\n· mpc 1\n· mpc 2`;
    const r = await parseTaskMessage(input, {
      now: baseNow,
      timezone: 'Asia/Jakarta',
      geminiClient: null,
    });
    expect(r.isTask).toBe(true);
    expect(r.deadline).not.toBeNull();
    expect(r.taskTitle).toContain('tanya:');
    expect(r.taskTitle).toContain('• mpc 1');
  });

  it('should accurately detect time-only expressions with isTimeOnlyExpression', () => {
    expect(isTimeOnlyExpression('jam 10.30').isTimeOnly).toBe(true);
    expect(isTimeOnlyExpression('10.30').isTimeOnly).toBe(true);
    expect(isTimeOnlyExpression('10:30').isTimeOnly).toBe(true);
    expect(isTimeOnlyExpression('jam 10').isTimeOnly).toBe(true);
    expect(isTimeOnlyExpression('pukul 15:00').isTimeOnly).toBe(true);
    expect(isTimeOnlyExpression('jam 3 sore').isTimeOnly).toBe(true);
    expect(isTimeOnlyExpression('pk 08.00').isTimeOnly).toBe(true);

    // Negative cases
    expect(isTimeOnlyExpression('jam 10.30 tanya ke bos').isTimeOnly).toBe(false);
    expect(isTimeOnlyExpression('hari ini jam 10.30').isTimeOnly).toBe(false);
    expect(isTimeOnlyExpression('besok jam 10.30').isTimeOnly).toBe(false);
    expect(isTimeOnlyExpression('halo bot').isTimeOnly).toBe(false);
  });
});
