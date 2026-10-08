import { describe, expect, it } from 'bun:test';
import { CircuitBreaker } from '../../../src/services/llm/breaker.js';
import { isolatedDeps, runChain, type ChainDeps } from '../../../src/services/llm/chain.js';
import { LlmError } from '../../../src/services/llm/errors.js';
import type { LlmProvider, LlmResult } from '../../../src/services/llm/types.js';

function provider(
  id: LlmProvider['id'],
  generate: LlmProvider['generate'],
  timeoutMs = 1000
): LlmProvider {
  return {
    id,
    model: 'test-model',
    timeoutMs,
    capabilities: { structuredOutput: true, vision: true },
    generate,
  };
}

function deps(providers: LlmProvider[], patch: Partial<ChainDeps> = {}): ChainDeps {
  const base = isolatedDeps('nlp_parse', providers);
  return {
    ...base,
    budgetMs: 5000,
    maxRetries: 0,
    minAttemptMs: 50,
    now: () => 0,
    sleep: async () => {},
    record: () => {},
    ...patch,
    providers,
  };
}

describe('LLM chain', () => {
  it('stops at the first provider that returns valid output', async () => {
    let second = 0;
    const result = await runChain(
      'nlp_parse',
      { system: 'sys', userContent: 'user', maxOutputTokens: 20 },
      (text) => text,
      () => 'local',
      deps([
        provider('gemini', async () => ({ text: 'first' })),
        provider('openai', async () => {
          second += 1;
          return { text: 'second' };
        }),
      ])
    );
    expect(result).toEqual({ value: 'first', provider: 'gemini' });
    expect(second).toBe(0);
  });

  it('uses local when every provider fails', async () => {
    const result = await runChain(
      'nlp_parse',
      { system: 'sys', userContent: 'user', maxOutputTokens: 20 },
      (text) => text,
      () => 'local-result',
      deps([provider('gemini', async () => { throw new Error('down'); })])
    );
    expect(result).toEqual({ value: 'local-result', provider: 'local' });
  });

  it('cancels a timed-out attempt and continues', async () => {
    let aborted = false;
    const result = await runChain(
      'nlp_parse',
      { system: 'sys', userContent: 'user', maxOutputTokens: 20 },
      (text) => text,
      () => 'local',
      deps([
        provider(
          'gemini',
          (req) =>
            new Promise<LlmResult>((_resolve, reject) => {
              req.signal.addEventListener('abort', () => {
                aborted = true;
                reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
              });
            }),
          20
        ),
        provider('openai', async () => ({ text: 'next' })),
      ])
    );
    expect(aborted).toBe(true);
    expect(result).toEqual({ value: 'next', provider: 'openai' });
  });

  it('skips later providers when the budget is already spent', async () => {
    let calls = 0;
    const result = await runChain(
      'nlp_parse',
      { system: 'sys', userContent: 'user', maxOutputTokens: 20 },
      (text) => text,
      () => 'local',
      deps([provider('gemini', async () => { calls += 1; return { text: 'nope' }; })], {
        budgetMs: 10,
        minAttemptMs: 250,
      })
    );
    expect(calls).toBe(0);
    expect(result.provider).toBe('local');
  });

  it('moves to the next provider when output is invalid', async () => {
    const result = await runChain(
      'nlp_parse',
      { system: 'sys', userContent: 'user', maxOutputTokens: 20 },
      (text) => {
        if (text === 'bad') throw new LlmError('invalid_output');
        return text;
      },
      () => 'local',
      deps([
        provider('gemini', async () => ({ text: 'bad' })),
        provider('openai', async () => ({ text: 'good' })),
      ])
    );
    expect(result).toEqual({ value: 'good', provider: 'openai' });
  });

  it('opens the breaker immediately on auth failure and skips that provider', async () => {
    let now = 0;
    let calls = 0;
    const breaker = new CircuitBreaker({ threshold: 5, windowMs: 10_000, cooldownMs: 1_000, now: () => now });
    const failing = provider('gemini', async () => {
      calls += 1;
      throw new LlmError('auth', 401);
    });
    const chainDeps = deps([failing], { breaker, now: () => now });
    await runChain('nlp_parse', { system: '', userContent: '', maxOutputTokens: 8 }, (text) => text, () => 'local', chainDeps);
    await runChain('nlp_parse', { system: '', userContent: '', maxOutputTokens: 8 }, (text) => text, () => 'local', chainDeps);
    expect(calls).toBe(1);
    expect(breaker.allow('gemini')).toBe(false);
  });

  it('opens after repeated failures and allows one probe after cooldown', () => {
    let now = 0;
    const breaker = new CircuitBreaker({ threshold: 2, windowMs: 10_000, cooldownMs: 500, now: () => now });
    breaker.onFailure('openai', 'network');
    breaker.onFailure('openai', 'timeout');
    expect(breaker.allow('openai')).toBe(false);
    now = 500;
    expect(breaker.allow('openai')).toBe(true);
    breaker.onFailure('openai', 'server_error');
    expect(breaker.allow('openai')).toBe(false);
    now = 1000;
    expect(breaker.allow('openai')).toBe(true);
    breaker.onSuccess('openai');
    expect(breaker.allow('openai')).toBe(true);
  });
});
