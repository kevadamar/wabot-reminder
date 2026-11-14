import { describe, expect, it } from 'bun:test';
import { parseLocalTask, parseTaskMessage, normalizeIndonesianTimePhrases } from '../../src/services/nlp.js';
import { setLoadedNlpRules, DEFAULT_NLP_CUSTOM_RULES } from '../../src/services/settings.js';

describe('NLP Custom Configurable Rules', () => {
  const baseNow = new Date('2026-11-14T03:00:00.000Z'); // 10:00 WIB Saturday

  it('normalizes custom time phrases such as ba\'da maghrib, subuh, and pulang kantor', () => {
    const text = "besok ba'da isya review codingan";
    const customRules = {
      customTaskVerbs: ['review codingan'],
      customTimePhrases: [
        { phrase: "ba'da isya", replacement: 'at 19:30' },
      ],
      customTimeKeywords: [],
      customStopwords: [],
    };

    const normalized = normalizeIndonesianTimePhrases(text, customRules);
    expect(normalized).toContain('at 19:30');
    expect(normalized).toContain('tomorrow');
  });

  it('recognizes custom task verbs without requiring explicit /todo prefix', async () => {
    // "bimbingan skripsi" is not in built-in TASK_VERBS_REGEX
    const customRules = {
      customTaskVerbs: ['bimbingan skripsi'],
      customTimePhrases: [],
      customTimeKeywords: [],
      customStopwords: [],
    };

    const result = await parseTaskMessage('besok bimbingan skripsi', {
      now: baseNow,
      providers: [],
      customRules,
    });

    expect(result.isTask).toBe(true);
    expect(result.taskTitle).toContain('bimbingan skripsi');
  });

  it('cleans custom stopwords from task title', () => {
    const customRules = {
      customTaskVerbs: ['meeting'],
      customTimePhrases: [{ phrase: 'subuh', replacement: 'at 04:30' }],
      customTimeKeywords: ['subuh'],
      customStopwords: ['tolong dong', 'plis'],
    };

    const result = parseLocalTask('besok subuh meeting vendor tolong dong', baseNow, 'Asia/Jakarta', customRules);
    expect(result.isTask).toBe(true);
    expect(result.taskTitle).toBe('meeting vendor');
    expect(result.taskTitle).not.toContain('tolong dong');
    expect(result.taskTitle).not.toContain('subuh');
  });

  it('uses default rules when no custom override is provided', () => {
    // Default rules include ba'da isya => at 19:30
    setLoadedNlpRules(DEFAULT_NLP_CUSTOM_RULES);
    const result = parseLocalTask("besok ba'da isya meeting", baseNow, 'Asia/Jakarta');
    expect(result.isTask).toBe(true);
    expect(result.deadline).not.toBeNull();
    // 19:30 WIB is 12:30 UTC
    expect(result.deadline?.getUTCHours()).toBe(12);
    expect(result.deadline?.getUTCMinutes()).toBe(30);
  });
});
