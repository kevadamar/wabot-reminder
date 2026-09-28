import { describe, expect, it } from 'bun:test';
import { parseTaskMessage } from '../../src/services/nlp.js';
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
});
