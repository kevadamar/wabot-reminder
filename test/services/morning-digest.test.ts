import { describe, expect, it } from 'bun:test';
import {
  formatMorningDigestMessages,
  generateMorningMotivation,
  getLocalClock,
  parseMorningDigestCommand,
  shouldDispatchMorningDigest,
  validateMorningMotivation,
} from '../../src/services/morning-digest.js';

describe('Morning digest command parsing', () => {
  it('parses opt-in, opt-out, status, and local time commands', () => {
    expect(parseMorningDigestCommand('/pagi aktif')).toEqual({ action: 'enable' });
    expect(parseMorningDigestCommand('pagi nonaktif')).toEqual({ action: 'disable' });
    expect(parseMorningDigestCommand('/pagi status')).toEqual({ action: 'status' });
    expect(parseMorningDigestCommand('/pagi waktu 06:30')).toEqual({ action: 'set_time', time: '06:30' });
  });

  it('rejects malformed or out-of-range time values without matching normal chat', () => {
    expect(parseMorningDigestCommand('/pagi waktu 24:00')).toEqual({ action: 'invalid_time' });
    expect(parseMorningDigestCommand('/pagi waktu enam pagi')).toEqual({ action: 'invalid_time' });
    expect(parseMorningDigestCommand('pagi ini cerah')).toBeNull();
  });
});

describe('Morning digest scheduling', () => {
  it('reads the local date and clock in the requested timezone', () => {
    const now = new Date('2026-09-28T23:05:00.000Z');

    expect(getLocalClock(now, 'Asia/Jakarta')).toEqual({
      date: '2026-09-29',
      time: '06:05',
      minutes: 365,
    });
  });

  it('dispatches only enabled users after their configured time and inside the grace window', () => {
    expect(shouldDispatchMorningDigest({ enabled: false, localMinutes: 360, scheduledTime: '06:00' })).toBe(false);
    expect(shouldDispatchMorningDigest({ enabled: true, localMinutes: 359, scheduledTime: '06:00' })).toBe(false);
    expect(shouldDispatchMorningDigest({ enabled: true, localMinutes: 360, scheduledTime: '06:00' })).toBe(true);
    expect(shouldDispatchMorningDigest({ enabled: true, localMinutes: 719, scheduledTime: '06:00' })).toBe(true);
    expect(shouldDispatchMorningDigest({ enabled: true, localMinutes: 720, scheduledTime: '06:00' })).toBe(false);
  });
});

describe('Morning motivation validation', () => {
  it('accepts a short plain-text pantun and rejects unsafe or malformed output', () => {
    expect(validateMorningMotivation('Pagi cerah burung bernyanyi,\nLangkah kecil membuka jalan.\nKerjakan satu demi satu hari ini,\nSemoga lancar semua urusan.')).toBe(true);
    expect(validateMorningMotivation('```html\n<script>alert(1)</script>\n```')).toBe(false);
    expect(validateMorningMotivation('Kunjungi https://example.com untuk semangat')).toBe(false);
    expect(validateMorningMotivation('Terlalu pendek')).toBe(false);
  });

  it('uses minimal thinking, one bounded candidate, and exposes usage metadata', async () => {
    let request: any;
    const client = {
      models: {
        generateContent: async (input: any) => {
          request = input;
          return {
            text: 'Pagi cerah membuka hari,\nSemoga semua urusan lancar.',
            modelVersion: 'gemini-test-v1',
            usageMetadata: {
              promptTokenCount: 20,
              candidatesTokenCount: 12,
              thoughtsTokenCount: 2,
              totalTokenCount: 34,
            },
          };
        },
      },
    };

    const result = await generateMorningMotivation({ client, model: 'gemini-test', timeoutMs: 100 });
    expect(request.config.candidateCount).toBe(1);
    expect(request.config.maxOutputTokens).toBe(128);
    expect(String(request.config.thinkingConfig.thinkingLevel).toLowerCase()).toContain('minimal');
    expect(request.config.abortSignal).toBeInstanceOf(AbortSignal);
    expect(result.usage?.totalTokens).toBe(34);
  });

  it('aborts a slow AI request at the configured deadline', async () => {
    const client = {
      models: {
        generateContent: ({ config }: any) => new Promise((_resolve, reject) => {
          config.abortSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
      },
    };

    await expect(generateMorningMotivation({ client, model: 'gemini-test', timeoutMs: 5 })).rejects.toThrow('aborted');
  });
});

describe('Morning digest formatting', () => {
  it('keeps deadline order, marks earlier tasks overdue, and includes motivation only once', () => {
    const messages = formatMorningDigestMessages({
      displayName: 'Keva',
      timezone: 'Asia/Jakarta',
      now: new Date('2026-09-28T23:00:00.000Z'),
      localDate: '2026-09-29',
      motivation: 'Pagi cerah membuka hari,\nSemoga semua urusan lancar.',
      tasks: [
        { id: 1, task: 'Kirim laporan', deadline: new Date('2026-09-28T22:30:00.000Z') },
        { id: 2, task: 'Rapat tim', deadline: new Date('2026-09-29T01:00:00.000Z') },
      ],
      maxTasksPerMessage: 1,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('05.30 — Kirim laporan');
    expect(messages[0]).toContain('terlewat');
    expect(messages[0]).toContain('Pagi cerah membuka hari');
    expect(messages[1]).toContain('08.00 — Rapat tim');
    expect(messages[1]).not.toContain('Pagi cerah membuka hari');
  });
});
