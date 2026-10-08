import { redactPersonalData } from './redact.js';
import type { ErrorKind } from './types.js';

export class LlmError extends Error {
  readonly detail?: string;
  readonly providerRequestId?: string;

  constructor(
    readonly kind: ErrorKind,
    readonly status?: number,
    readonly retryAfterMs?: number,
    extra: { detail?: string; providerRequestId?: string } = {}
  ) {
    super(kind);
    this.name = 'LlmError';
    this.detail = extra.detail;
    this.providerRequestId = extra.providerRequestId;
  }
}

/** Reads a short, secret-free error message from a failed provider response. */
export async function errorDetailFrom(response: Response, secrets: string[] = []): Promise<string | undefined> {
  let raw = '';
  try {
    raw = await response.text();
  } catch {
    return undefined;
  }
  let message = raw;
  try {
    const body = JSON.parse(raw) as { error?: unknown; message?: unknown };
    const error = body.error as { message?: unknown } | string | undefined;
    if (typeof error === 'string') message = error;
    else if (error && typeof error.message === 'string') message = error.message;
    else if (typeof body.message === 'string') message = body.message;
  } catch {}
  const cleaned = redactPersonalData(redactSecrets(message.replace(/\s+/g, ' ').trim(), secrets)).slice(0, 200);
  return cleaned || undefined;
}

export function kindFromStatus(status: number, hasRetryAfter: boolean): ErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'quota_exhausted';
  if (status === 429) return hasRetryAfter ? 'rate_limited' : 'quota_exhausted';
  if (status === 408 || status === 529 || status >= 500) return 'server_error';
  if (status >= 400) return 'bad_request';
  return 'server_error';
}

export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  }
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return undefined;
}

function statusFromUnknown(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const record = err as { status?: unknown; code?: unknown; error?: { code?: unknown } };
  if (typeof record.status === 'number') return record.status;
  if (typeof record.code === 'number' && record.code >= 400 && record.code < 600) return record.code;
  if (typeof record.error?.code === 'number') return record.error.code;
  return undefined;
}

export function classify(err: unknown, signal?: AbortSignal): ErrorKind {
  if (err instanceof LlmError) return err.kind;
  const name = err instanceof Error ? err.name : '';
  const reasonName = signal?.reason instanceof Error ? signal.reason.name : '';
  if (name === 'TimeoutError' || reasonName === 'TimeoutError' || signal?.aborted) return 'timeout';
  const status = statusFromUnknown(err);
  if (status) return kindFromStatus(status, false);
  return 'network';
}

export function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join('[redacted]');
  }
  return out.slice(0, 300);
}
