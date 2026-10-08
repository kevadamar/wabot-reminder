import { getLlmConfig } from '../../config/llm.js';
import { recordAiUsage, telemetry } from '../telemetry.js';
import { CircuitBreaker, getSharedBreaker } from './breaker.js';
import { classify, LlmError } from './errors.js';
import type { LlmProvider, LlmRequest, Operation, TokenUsage } from './types.js';

const SKIPPED = new Set(['skipped_breaker_open', 'skipped_unconfigured', 'skipped_budget']);

export interface ChainDeps {
  providers: LlmProvider[];
  breaker: CircuitBreaker;
  budgetMs: number;
  maxRetries: number;
  minAttemptMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  record: (operation: Operation, provider: string, outcome: string, startedAt?: number, usage?: TokenUsage) => void;
}

function defaultRecord(
  operation: Operation,
  provider: string,
  outcome: string,
  startedAt?: number,
  usage?: TokenUsage
): void {
  if (provider === 'local') {
    telemetry.increment('ai_fallback_total', { operation, provider: 'local', outcome: 'selected' });
    telemetry.increment('ai_chain_total', { operation, final_provider: 'local' });
    return;
  }
  if (SKIPPED.has(outcome)) {
    telemetry.increment('ai_call_total', { operation, provider, outcome });
    return;
  }
  recordAiUsage(telemetry, {
    operation,
    provider,
    outcome,
    durationMs: startedAt === undefined ? 0 : performance.now() - startedAt,
    usage,
  });
}

export function productionDeps(operation: Operation, providers: LlmProvider[]): ChainDeps {
  const config = getLlmConfig();
  return {
    providers,
    breaker: getSharedBreaker(config.breaker),
    budgetMs: operation === 'vision_screen' ? Math.min(config.budgetMs, 8000) : config.budgetMs,
    maxRetries: config.maxRetries,
    minAttemptMs: config.minAttemptMs,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    record: defaultRecord,
  };
}

export function isolatedDeps(operation: Operation, providers: LlmProvider[]): ChainDeps {
  const config = getLlmConfig();
  return {
    ...productionDeps(operation, providers),
    breaker: new CircuitBreaker(config.breaker),
  };
}

function fullJitter(baseMs: number): number {
  return Math.floor(Math.random() * Math.max(1, Math.min(baseMs, 2000)));
}

export async function runChain<T>(
  operation: Operation,
  request: Omit<LlmRequest, 'operation' | 'signal'>,
  validate: (text: string) => T,
  local: () => T,
  deps: ChainDeps
): Promise<{ value: T; provider: string }> {
  const deadline = deps.now() + deps.budgetMs;
  let attempts = 0;

  for (const provider of deps.providers) {
    if (!deps.breaker.allow(provider.id)) {
      deps.record(operation, provider.id, 'skipped_breaker_open');
      continue;
    }

    let retries = 0;
    while (true) {
      const remaining = deadline - deps.now();
      if (remaining < deps.minAttemptMs) {
        deps.record(operation, provider.id, 'skipped_budget');
        deps.record(operation, 'local', 'selected');
        return { value: local(), provider: 'local' };
      }

      const signal = AbortSignal.timeout(Math.min(provider.timeoutMs, remaining));
      const startedAt = performance.now();
      attempts += 1;
      try {
        const result = await provider.generate({ ...request, operation, signal });
        const value = validate(result.text);
        deps.breaker.onSuccess(provider.id);
        deps.record(operation, provider.id, 'success', startedAt, result.usage);
        telemetry.increment('ai_chain_total', { operation, final_provider: provider.id });
        return { value, provider: provider.id };
      } catch (err) {
        const kind = classify(err, signal);
        deps.breaker.onFailure(provider.id, kind);
        deps.record(operation, provider.id, kind, startedAt);
        const retryable = kind === 'rate_limited' || kind === 'server_error';
        const retryAfter = err instanceof LlmError ? err.retryAfterMs : undefined;
        if (retryable && retries < deps.maxRetries) {
          const wait = retryAfter ?? fullJitter(200 * 2 ** retries);
          if (deps.now() + wait < deadline) {
            retries += 1;
            await deps.sleep(wait);
            continue;
          }
        }
        break;
      }
    }
  }

  deps.record(operation, 'local', 'selected');
  void attempts;
  return { value: local(), provider: 'local' };
}
