import { describe, expect, it } from 'bun:test';
import { config } from '../../../src/config/index.js';
import { getLlmConfig } from '../../../src/config/llm.js';
import { providersForOperation } from '../../../src/services/llm/registry.js';
import { timeoutDetail } from '../../../src/services/llm/chain.js';

describe('providersForOperation', () => {
  it('uses the configured Antigravity timeout for text operations', () => {
    const cfg = getLlmConfig();
    const originalUrl = config.antigravityBridgeUrl;
    const originalTimeout = cfg.antigravity.timeoutMs;
    const operations = ['nlp_parse', 'affirmation', 'reminder_message'] as const;
    const originalChains = operations.map((operation) => cfg.chains[operation]);
    try {
      config.antigravityBridgeUrl = 'http://host.docker.internal:7860';
      cfg.antigravity.timeoutMs = 25_000;
      for (const operation of operations) {
        cfg.chains[operation] = ['antigravity', 'local'];
        const provider = providersForOperation(operation).find((item) => item.id === 'antigravity');
        expect(provider?.timeoutMs).toBe(25_000);
      }
    } finally {
      config.antigravityBridgeUrl = originalUrl;
      cfg.antigravity.timeoutMs = originalTimeout;
      operations.forEach((operation, index) => {
        cfg.chains[operation] = originalChains[index]!;
      });
    }
  });

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
