import type { Operation, TokenUsage } from './types.js';

export interface LlmCallRecord {
  /** `${chainId}-${seq}`; also sent to the Antigravity bridge as X-Request-Id. */
  id: string;
  chainId: string;
  seq: number;
  at: string;
  operation: Operation;
  provider: string;
  model: string | null;
  /** `success`, an ErrorKind, `skipped_*`, or `fallback` for the local tier. */
  outcome: string;
  durationMs: number;
  httpStatus: number | null;
  errorDetail: string | null;
  providerRequestId: string | null;
  usage: TokenUsage | null;
  request: { systemChars: number; userChars: number; imageCount: number; imageBytes: number };
  response: { chars: number } | null;
  /** Redacted and truncated; only present when LLM_LOG_PAYLOADS=true. */
  payload: { system: string; user: string; response: string | null } | null;
}

export type LlmCallSummary = Omit<LlmCallRecord, 'payload'> & { hasPayload: boolean };

/** In-memory ring buffer of recent calls for the dashboard. Resets on restart. */
export class LlmCallLog {
  private records: LlmCallRecord[] = [];

  constructor(private readonly capacity = 300) {}

  add(record: LlmCallRecord): void {
    this.records.push(record);
    if (this.records.length > this.capacity) this.records.splice(0, this.records.length - this.capacity);
  }

  list(limit = this.capacity): LlmCallSummary[] {
    return this.records
      .slice(-limit)
      .reverse()
      .map(({ payload, ...rest }) => ({ ...rest, hasPayload: payload !== null }));
  }

  get(id: string): LlmCallRecord | undefined {
    return this.records.find((record) => record.id === id);
  }

  clear(): void {
    this.records = [];
  }
}

export const llmCallLog = new LlmCallLog();

function kb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatCallLine(record: LlmCallRecord): string {
  const ok = record.outcome === 'success';
  const icon = ok ? '✓' : record.outcome === 'fallback' ? '↩' : record.outcome.startsWith('skipped') ? '⤼' : '✗';
  const target = record.model ? `${record.provider} (${record.model})` : record.provider;
  const parts = [`[LLM] ${record.id} ${record.operation} → ${target} ${icon} ${record.outcome} ${record.durationMs}ms`];
  const { systemChars, userChars, imageCount, imageBytes } = record.request;
  if (record.provider !== 'local' && !record.outcome.startsWith('skipped')) {
    parts.push(`in ${systemChars + userChars}c${imageCount ? ` +${imageCount} img (${kb(imageBytes)})` : ''}`);
  }
  if (record.response) parts.push(`out ${record.response.chars}c`);
  const usage = record.usage;
  if (usage && (usage.promptTokens != null || usage.outputTokens != null)) {
    parts.push(`tokens ${usage.promptTokens ?? '?'}/${usage.outputTokens ?? '?'}`);
  }
  if (record.httpStatus) parts.push(`http ${record.httpStatus}`);
  if (record.providerRequestId && record.providerRequestId !== record.id) parts.push(`upstream ${record.providerRequestId}`);
  if (record.errorDetail && record.errorDetail !== record.outcome) parts.push(`detail: ${record.errorDetail}`);
  return parts.join(' · ');
}

export function publishLlmCall(record: LlmCallRecord, options: { console: boolean }): void {
  llmCallLog.add(record);
  if (!options.console) return;
  console.log(formatCallLine(record));
  if (record.payload) {
    console.log(`   ↳ prompt: ${record.payload.user}`);
    if (record.payload.response !== null) console.log(`   ↳ response: ${record.payload.response}`);
  }
}
