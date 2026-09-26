import { describe, expect, it } from 'bun:test';
import { generateAffirmation } from '../../src/services/affirmation.js';

describe('Seam 4: Dynamic Affirmation Generator', () => {
  it('should return affirmation from Gemini when client responds successfully', async () => {
    const mockGemini = {
      models: {
        generateContent: async () => ({
          text: 'Gokil banget bro, tugas proposalnya kelar juga!',
        }),
      },
    };

    const affirmation = await generateAffirmation('Kirim proposal', mockGemini);
    expect(affirmation).toBe('Gokil banget bro, tugas proposalnya kelar juga!');
  });

  it('should fallback to local quotes when Gemini throws an error', async () => {
    const mockFaultyGemini = {
      models: {
        generateContent: async () => {
          throw new Error('API Rate Limit Exceeded');
        },
      },
    };

    const affirmation = await generateAffirmation('Beli kopi', mockFaultyGemini);
    expect(typeof affirmation).toBe('string');
    expect(affirmation.length).toBeGreaterThan(10);
  });

  it('should fallback to local quotes when no Gemini client is configured', async () => {
    const affirmation = await generateAffirmation('Olahraga pagi', null);
    expect(typeof affirmation).toBe('string');
    expect(affirmation.length).toBeGreaterThan(10);
  });
});
