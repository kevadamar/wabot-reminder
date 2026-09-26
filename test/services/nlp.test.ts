import { describe, expect, it } from 'bun:test';
import { parseTaskMessage } from '../../src/services/nlp.js';

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
});
