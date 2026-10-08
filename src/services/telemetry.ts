import { lt, sql } from 'drizzle-orm';
import {
  dailyDigestDeliveries,
  dailyMotivations,
  telemetryEvents,
  telemetryHourly,
} from '../db/schema.js';

let lastRetentionRunAt = 0;

const ALLOWED_DIMENSION_KEYS = new Set([
  'operation',
  'outcome',
  'provider',
  'final_provider',
  'source',
  'status',
  'type',
]);

export interface BufferedMetric {
  bucketAt: Date;
  metric: string;
  dimension: string;
  count: number;
  sumValue: number;
  maxValue: number;
}

export interface BufferedEvent {
  occurredAt: Date;
  component: string;
  operation: string;
  outcome: string;
  provider: string | null;
  errorCode: string | null;
  durationMs: number | null;
}

interface MetricAccumulator {
  metric: string;
  dimension: string;
  count: number;
  sumValue: number;
  maxValue: number;
}

function boundedName(value: string, field: string, maxLength = 64): string {
  if (!/^[a-z][a-z0-9_.-]*$/i.test(value) || value.length > maxLength) {
    throw new Error(`INVALID_TELEMETRY_${field.toUpperCase()}`);
  }
  return value;
}

function serializeDimensions(dimensions: Record<string, string>): string {
  const entries = Object.entries(dimensions).sort(([left], [right]) => left.localeCompare(right));
  for (const [key, value] of entries) {
    if (!ALLOWED_DIMENSION_KEYS.has(key)) throw new Error('FORBIDDEN_TELEMETRY_DIMENSION');
    boundedName(value, 'dimension_value', 32);
  }
  return entries.map(([key, value]) => `${key}=${value}`).join(',');
}

function hourBucket(now: Date): Date {
  const bucket = new Date(now);
  bucket.setUTCMinutes(0, 0, 0);
  return bucket;
}

export class TelemetryBuffer {
  private readonly maxSeries: number;
  private readonly maxEvents: number;
  private metrics = new Map<string, MetricAccumulator>();
  private events: BufferedEvent[] = [];
  private droppedCount = 0;

  constructor(options: { maxSeries?: number; maxEvents?: number } = {}) {
    this.maxSeries = options.maxSeries ?? 200;
    this.maxEvents = options.maxEvents ?? 100;
  }

  increment(metric: string, dimensions: Record<string, string> = {}, value = 1): void {
    this.recordMetric(metric, value, dimensions);
  }

  observe(metric: string, value: number, dimensions: Record<string, string> = {}): void {
    this.recordMetric(metric, value, dimensions);
  }

  private recordMetric(metric: string, value: number, dimensions: Record<string, string>): void {
    boundedName(metric, 'metric');
    if (!Number.isFinite(value)) throw new Error('INVALID_TELEMETRY_VALUE');
    const dimension = serializeDimensions(dimensions);
    const key = `${metric}|${dimension}`;
    const current = this.metrics.get(key);
    if (current) {
      current.count++;
      current.sumValue += value;
      current.maxValue = Math.max(current.maxValue, value);
      return;
    }
    if (this.metrics.size >= this.maxSeries) {
      this.droppedCount++;
      return;
    }
    this.metrics.set(key, {
      metric,
      dimension,
      count: 1,
      sumValue: value,
      maxValue: value,
    });
  }

  recordEvent(input: Omit<BufferedEvent, 'occurredAt'> & { occurredAt?: Date }): void {
    boundedName(input.component, 'component');
    boundedName(input.operation, 'operation');
    boundedName(input.outcome, 'outcome');
    if (input.provider) boundedName(input.provider, 'provider');
    if (input.errorCode) boundedName(input.errorCode, 'error_code');
    if (this.events.length >= this.maxEvents) {
      this.droppedCount++;
      return;
    }
    this.events.push({
      occurredAt: input.occurredAt ?? new Date(),
      component: input.component,
      operation: input.operation,
      outcome: input.outcome,
      provider: input.provider,
      errorCode: input.errorCode,
      durationMs: input.durationMs,
    });
  }

  drain(now: Date = new Date()): { metrics: BufferedMetric[]; events: BufferedEvent[] } {
    const bucketAt = hourBucket(now);
    const metrics = [...this.metrics.values()].map((item) => ({ bucketAt, ...item }));
    const events = this.events;
    this.metrics = new Map();
    this.events = [];
    return { metrics, events };
  }

  restore(batch: { metrics: BufferedMetric[]; events: BufferedEvent[] }): void {
    for (const item of batch.metrics) {
      this.recordMetric(item.metric, item.sumValue, Object.fromEntries(
        item.dimension ? item.dimension.split(',').map((part) => part.split('=', 2) as [string, string]) : []
      ));
      const restored = this.metrics.get(`${item.metric}|${item.dimension}`);
      if (restored) {
        restored.count = item.count;
        restored.maxValue = item.maxValue;
      }
    }
    for (const event of batch.events) {
      if (this.events.length < this.maxEvents) this.events.push(event);
      else this.droppedCount++;
    }
  }

  getDroppedCount(): number {
    return this.droppedCount;
  }
}

export const telemetry = new TelemetryBuffer();

export const runtimeHealth = {
  startedAt: new Date(),
  whatsappStatus: 'starting' as 'starting' | 'connected' | 'reconnecting' | 'logged_out',
  whatsappChangedAt: new Date(),
  lastReminderCycleAt: null as Date | null,
  lastMorningDigestCycleAt: null as Date | null,
  schedulerPaused: false,
  reminderCronEnabled: true,
  morningDigestCronEnabled: true,
};

export function recordAiUsage(
  buffer: TelemetryBuffer,
  input: {
    operation: string;
    provider: string;
    outcome: string;
    durationMs: number;
    usage?: {
      promptTokens?: number | null;
      outputTokens?: number | null;
      thoughtTokens?: number | null;
      totalTokens?: number | null;
    };
  }
): void {
  const base = { operation: input.operation, provider: input.provider, outcome: input.outcome };
  buffer.increment('ai_call_total', base);
  buffer.observe('ai_duration_ms', Math.max(0, Math.round(input.durationMs)), base);
  const tokenValues = {
    prompt: input.usage?.promptTokens,
    output: input.usage?.outputTokens,
    thought: input.usage?.thoughtTokens,
    total: input.usage?.totalTokens,
  };
  for (const [type, value] of Object.entries(tokenValues)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      buffer.observe('ai_tokens', value, { operation: input.operation, provider: input.provider, type });
    }
  }
}

export async function flushTelemetry(
  db: any,
  buffer: TelemetryBuffer = telemetry,
  now: Date = new Date()
): Promise<void> {
  const batch = buffer.drain(now);
  if (batch.metrics.length === 0 && batch.events.length === 0) return;
  const shouldRunRetention = now.getTime() - lastRetentionRunAt >= 24 * 60 * 60 * 1000;

  try {
    await db.transaction(async (tx: any) => {
      if (batch.metrics.length > 0) {
        await tx
          .insert(telemetryHourly)
          .values(batch.metrics.map((metric) => ({ ...metric, updatedAt: now })))
          .onConflictDoUpdate({
            target: [telemetryHourly.bucketAt, telemetryHourly.metric, telemetryHourly.dimension],
            set: {
              count: sql`${telemetryHourly.count} + excluded.count`,
              sumValue: sql`${telemetryHourly.sumValue} + excluded.sum_value`,
              maxValue: sql`GREATEST(${telemetryHourly.maxValue}, excluded.max_value)`,
              updatedAt: now,
            },
          });
      }
      if (batch.events.length > 0) {
        await tx.insert(telemetryEvents).values(batch.events);
      }
      if (shouldRunRetention) {
        await tx.delete(telemetryEvents).where(
          lt(telemetryEvents.occurredAt, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))
        );
        await tx.delete(telemetryHourly).where(
          lt(telemetryHourly.bucketAt, new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000))
        );
        await tx.delete(dailyDigestDeliveries).where(
          lt(dailyDigestDeliveries.createdAt, new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000))
        );
        await tx.delete(dailyMotivations).where(
          lt(dailyMotivations.createdAt, new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000))
        );
      }
    });
    if (shouldRunRetention) lastRetentionRunAt = now.getTime();
  } catch (error) {
    buffer.restore(batch);
    throw error;
  }
}
