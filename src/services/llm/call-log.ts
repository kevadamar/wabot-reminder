import { desc, eq, lt } from 'drizzle-orm';
import { llmCallRecords, type InsertLlmCallRecordRow, type LlmCallRecordRow } from '../../db/schema.js';
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

export function recordToRow(record: LlmCallRecord): InsertLlmCallRecordRow {
  return {
    id: record.id,
    chainId: record.chainId,
    seq: record.seq,
    at: new Date(record.at),
    operation: record.operation,
    provider: record.provider,
    model: record.model,
    outcome: record.outcome,
    durationMs: record.durationMs,
    httpStatus: record.httpStatus,
    errorDetail: record.errorDetail,
    providerRequestId: record.providerRequestId,
    promptTokens: record.usage?.promptTokens ?? null,
    outputTokens: record.usage?.outputTokens ?? null,
    totalTokens: record.usage?.totalTokens ?? null,
    systemChars: record.request.systemChars,
    userChars: record.request.userChars,
    imageCount: record.request.imageCount,
    imageBytes: record.request.imageBytes,
    responseChars: record.response?.chars ?? null,
    payload: record.payload,
  };
}

export function rowToRecord(row: any): LlmCallRecord {
  const atDate =
    row.at instanceof Date
      ? row.at.toISOString()
      : typeof row.at === 'string'
        ? new Date(row.at).toISOString()
        : new Date().toISOString();
  return {
    id: row.id,
    chainId: row.chainId,
    seq: Number(row.seq) || 1,
    at: atDate,
    operation: row.operation as Operation,
    provider: row.provider,
    model: row.model || null,
    outcome: row.outcome,
    durationMs: Number(row.durationMs) || 0,
    httpStatus: row.httpStatus != null ? Number(row.httpStatus) : null,
    errorDetail: row.errorDetail || null,
    providerRequestId: row.providerRequestId || null,
    usage:
      row.promptTokens != null || row.outputTokens != null || row.totalTokens != null
        ? {
            promptTokens: row.promptTokens != null ? Number(row.promptTokens) : undefined,
            outputTokens: row.outputTokens != null ? Number(row.outputTokens) : undefined,
            totalTokens: row.totalTokens != null ? Number(row.totalTokens) : undefined,
          }
        : null,
    request: {
      systemChars: Number(row.systemChars) || 0,
      userChars: Number(row.userChars) || 0,
      imageCount: Number(row.imageCount) || 0,
      imageBytes: Number(row.imageBytes) || 0,
    },
    response: row.responseChars != null ? { chars: Number(row.responseChars) } : null,
    payload: row.payload || null,
  };
}

/** In-memory ring buffer of recent calls for the dashboard with async DB persistence. */
export class LlmCallLog {
  private records: LlmCallRecord[] = [];
  private db: any = null;

  constructor(private readonly capacity = 300) {}

  setDb(db: any): void {
    this.db = db;
  }

  getDb(): any {
    return this.db;
  }

  hydrate(records: LlmCallRecord[]): void {
    this.records = [...records].slice(-this.capacity);
  }

  add(record: LlmCallRecord): void {
    this.records.push(record);
    if (this.records.length > this.capacity) this.records.splice(0, this.records.length - this.capacity);
    if (this.db) {
      // Non-blocking fire-and-forget async write to PostgreSQL
      queueMicrotask(() => {
        persistLlmCall(this.db, record).catch(() => {});
      });
    }
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

export async function persistLlmCall(db: any, record: LlmCallRecord): Promise<void> {
  if (!db) return;
  try {
    const row = recordToRow(record);
    if (db.insert) {
      const q = db.insert(llmCallRecords).values(row);
      if (typeof q.onConflictDoNothing === 'function') {
        await q.onConflictDoNothing();
      } else {
        await q;
      }
    }
  } catch (err: any) {
    // Fail-safe: Never disrupt the application on logging failure
    console.warn(`⚠️ [LLM Call Log] Gagal menyimpan call ${record.id} ke database:`, err?.message || err);
  }
}

export async function hydrateLlmCallLog(db: any, limit = 300): Promise<number> {
  if (!db || !db.select) return 0;
  try {
    const rows = await db
      .select()
      .from(llmCallRecords)
      .orderBy(desc(llmCallRecords.at))
      .limit(limit);

    if (!rows || rows.length === 0) return 0;
    // Rows are descending (newest first). Ring buffer expects chronological order (oldest first).
    const records = rows.slice().reverse().map(rowToRecord);
    llmCallLog.hydrate(records);
    return records.length;
  } catch (err: any) {
    console.warn('⚠️ [LLM Call Log] Gagal memuat riwayat call dari database:', err?.message || err);
    return 0;
  }
}

export async function pruneLlmCallRecords(db: any, retentionDays = 14, now = new Date()): Promise<void> {
  if (!db || !db.delete) return;
  try {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    await db.delete(llmCallRecords).where(lt(llmCallRecords.at, cutoff));
  } catch (err: any) {
    console.warn('⚠️ [LLM Call Log] Gagal melakukan pruning data lama:', err?.message || err);
  }
}

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
