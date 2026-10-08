import { randomUUID } from 'node:crypto';
import { getLlmConfig } from '../../config/llm.js';
import { recordAiUsage, telemetry } from '../telemetry.js';
import { CircuitBreaker, getSharedBreaker } from './breaker.js';
import { publishLlmCall, type LlmCallRecord } from './call-log.js';
import { classify, LlmError } from './errors.js';
import { redactForLog, redactPersonalData } from './redact.js';
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
  /** Receives one record per attempt, skip, and local fallback. */
  observe?: (record: LlmCallRecord) => void;
  /** 0 disables prompt/response capture. */
  payloadMaxChars?: number;
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

export function productionObserver(): Pick<ChainDeps, 'observe' | 'payloadMaxChars'> {
  const { logging } = getLlmConfig();
  return {
    observe: (record) => publishLlmCall(record, { console: logging.calls }),
    payloadMaxChars: logging.payloads ? logging.payloadMaxChars : 0,
  };
}

export function productionDeps(operation: Operation, providers: LlmProvider[]): ChainDeps {
  const config = getLlmConfig();
  return {
    ...productionObserver(),
    providers,
    breaker: getSharedBreaker(config.breaker),
    budgetMs: operation === 'vision_screen' ? config.visionBudgetMs : config.budgetMs,
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

type CallExtra = Partial<
  Pick<LlmCallRecord, 'durationMs' | 'httpStatus' | 'errorDetail' | 'providerRequestId' | 'usage'>
> & { id?: string; responseText?: string | null };

export interface CallTracer {
  nextId: () => string;
  emit: (provider: string, model: string | null, outcome: string, extra?: CallExtra) => void;
  failure: (provider: LlmProvider, id: string, kind: string, err: unknown, startedAt: number, responseText?: string | null) => void;
}

/** Builds one LlmCallRecord per provider attempt; ids are `${chainId}-${seq}` and travel as X-Request-Id. */
export function createCallTracer(
  operation: Operation,
  request: Omit<LlmRequest, 'operation' | 'signal'>,
  options: Pick<ChainDeps, 'observe' | 'payloadMaxChars'>
): CallTracer {
  const chainId = randomUUID().slice(0, 8);
  const maxChars = options.payloadMaxChars ?? 0;
  const requestStats = {
    systemChars: request.system.length,
    userChars: request.userContent.length,
    imageCount: request.images?.length ?? 0,
    imageBytes: (request.images ?? []).reduce((sum, image) => sum + image.data.byteLength, 0),
  };
  let seq = 0;
  const nextId = () => `${chainId}-${++seq}`;

  const emit: CallTracer['emit'] = (provider, model, outcome, extra = {}) => {
    if (!options.observe) return;
    const id = extra.id ?? nextId();
    const responseText = extra.responseText ?? null;
    options.observe({
      id,
      chainId,
      seq: Number(id.slice(chainId.length + 1)),
      at: new Date().toISOString(),
      operation,
      provider,
      model,
      outcome,
      durationMs: Math.round(extra.durationMs ?? 0),
      httpStatus: extra.httpStatus ?? null,
      errorDetail: extra.errorDetail ?? null,
      providerRequestId: extra.providerRequestId ?? null,
      usage: extra.usage ?? null,
      request: requestStats,
      response: responseText === null ? null : { chars: responseText.length },
      payload:
        maxChars > 0 && provider !== 'local' && !outcome.startsWith('skipped')
          ? {
              system: redactForLog(request.system, maxChars),
              user: redactForLog(request.userContent, maxChars),
              response: responseText === null ? null : redactForLog(responseText, maxChars),
            }
          : null,
    });
  };

  const failure: CallTracer['failure'] = (provider, id, kind, err, startedAt, responseText = null) => {
    const llmErr = err instanceof LlmError ? err : undefined;
    emit(provider.id, provider.model, kind, {
      id,
      durationMs: performance.now() - startedAt,
      httpStatus: llmErr?.status,
      errorDetail:
        llmErr?.detail ??
        (llmErr || !(err instanceof Error) ? undefined : redactPersonalData(err.message).slice(0, 200) || undefined),
      providerRequestId: llmErr?.providerRequestId,
      responseText,
    });
  };

  return { nextId, emit, failure };
}

export async function runChain<T>(
  operation: Operation,
  request: Omit<LlmRequest, 'operation' | 'signal'>,
  validate: (text: string) => T,
  local: () => T,
  deps: ChainDeps
): Promise<{ value: T; provider: string }> {
  const deadline = deps.now() + deps.budgetMs;
  const chainStartedAt = performance.now();
  const { nextId, emit, failure } = createCallTracer(operation, request, deps);

  const fallback = () => {
    deps.record(operation, 'local', 'selected');
    emit('local', null, 'fallback', { durationMs: performance.now() - chainStartedAt });
    return { value: local(), provider: 'local' };
  };

  for (const provider of deps.providers) {
    if (!deps.breaker.allow(provider.id)) {
      deps.record(operation, provider.id, 'skipped_breaker_open');
      emit(provider.id, provider.model, 'skipped_breaker_open');
      continue;
    }

    let retries = 0;
    while (true) {
      const remaining = deadline - deps.now();
      if (remaining < deps.minAttemptMs) {
        deps.record(operation, provider.id, 'skipped_budget');
        emit(provider.id, provider.model, 'skipped_budget');
        return fallback();
      }

      const signal = AbortSignal.timeout(Math.min(provider.timeoutMs, remaining));
      const startedAt = performance.now();
      const id = nextId();
      let responseText: string | null = null;
      try {
        const result = await provider.generate({ ...request, operation, signal, requestId: id });
        responseText = result.text;
        const value = validate(result.text);
        deps.breaker.onSuccess(provider.id);
        deps.record(operation, provider.id, 'success', startedAt, result.usage);
        emit(provider.id, result.model ?? provider.model, 'success', {
          id,
          durationMs: performance.now() - startedAt,
          providerRequestId: result.providerRequestId,
          usage: result.usage,
          responseText,
        });
        telemetry.increment('ai_chain_total', { operation, final_provider: provider.id });
        return { value, provider: provider.id };
      } catch (err) {
        const kind = classify(err, signal);
        deps.breaker.onFailure(provider.id, kind);
        deps.record(operation, provider.id, kind, startedAt);
        failure(provider, id, kind, err, startedAt, responseText);
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

  return fallback();
}
