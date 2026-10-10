import { describe, expect, it } from 'bun:test';
import { providersForOperation } from '../../../src/services/llm/registry.js';
import { timeoutDetail } from '../../../src/services/llm/chain.js';

describe('providersForOperation', () => {
  it('gives the background link review more Gemini time than the interactive vision screen', () => {
    const fakeClient = { models: { generateContent: async () => ({ text: '{}' }) } };
    const link = providersForOperation('link_review', { geminiClient: fakeClient });
    const vision = providersForOperation('vision_screen', { geminiClient: fakeClient });
    expect(link.find((p) => p.id === 'gemini')?.timeoutMs).toBeGreaterThanOrEqual(15_000);
    expect(vision.find((p) => p.id === 'gemini')?.timeoutMs).toBeLessThan(15_000);
  });

  it('names the link budget when a link review attempt runs out of it', () => {
    const provider = providersForOperation('link_review', { geminiClient: { models: {} } })[0]!;
    expect(timeoutDetail('link_review', provider, 1000)).toContain('LLM_LINK_BUDGET_MS');
  });
});
