import { describe, expect, it } from 'bun:test';
import { getDynamicTimeSuggestions } from '../../src/bot/handlers/router.js';

describe('Dynamic Time Suggestions', () => {
  it('should provide morning suggestions before 12:00', () => {
    // 09:00 WIB
    const morningDate = new Date('2026-09-27T02:00:00.000Z');
    const suggestions = getDynamicTimeSuggestions('Asia/Jakarta', morningDate);

    expect(suggestions.length).toBe(3);
    expect(suggestions[0]?.label).toContain('13:00');
    expect(suggestions[1]?.label).toContain('17:00');
    expect(suggestions[2]?.label).toContain('09:00');
  });

  it('should provide afternoon suggestions between 12:00 and 17:00', () => {
    // 14:00 WIB
    const afternoonDate = new Date('2026-09-27T07:00:00.000Z');
    const suggestions = getDynamicTimeSuggestions('Asia/Jakarta', afternoonDate);

    expect(suggestions.length).toBe(3);
    expect(suggestions[0]?.label).toContain('17:00');
    expect(suggestions[1]?.label).toContain('20:00');
    expect(suggestions[2]?.label).toContain('Besok pagi');
  });

  it('should provide evening suggestions between 17:00 and 21:00', () => {
    // 18:00 WIB
    const eveningDate = new Date('2026-09-27T11:00:00.000Z');
    const suggestions = getDynamicTimeSuggestions('Asia/Jakarta', eveningDate);

    expect(suggestions.length).toBe(3);
    expect(suggestions[0]?.label).toContain('21:00');
    expect(suggestions[1]?.label).toContain('Besok pagi');
    expect(suggestions[2]?.label).toContain('Besok siang');
  });

  it('should provide night suggestions after 21:00', () => {
    // 22:00 WIB
    const nightDate = new Date('2026-09-27T15:00:00.000Z');
    const suggestions = getDynamicTimeSuggestions('Asia/Jakarta', nightDate);

    expect(suggestions.length).toBe(3);
    expect(suggestions[0]?.label).toContain('Besok pagi');
    expect(suggestions[1]?.label).toContain('Besok siang');
    expect(suggestions[2]?.label).toContain('Besok sore');
  });
});
