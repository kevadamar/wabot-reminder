import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { db, initDb } from '../../src/db/index.js';
import { telemetryEvents, telemetryHourly } from '../../src/db/schema.js';
import { flushTelemetry, TelemetryBuffer } from '../../src/services/telemetry.js';

describe('Telemetry persistence', () => {
  beforeAll(async () => initDb());

  beforeEach(async () => {
    await db.delete(telemetryEvents);
    await db.delete(telemetryHourly);
  });

  it('flushes and merges hourly metrics while persisting sanitized error events', async () => {
    const buffer = new TelemetryBuffer();
    buffer.increment('reminder_dispatch_total', { outcome: 'success' });
    buffer.recordEvent({
      component: 'scheduler',
      operation: 'reminder_cycle',
      outcome: 'failed',
      provider: null,
      errorCode: 'DB_UNAVAILABLE',
      durationMs: 120,
    });
    await flushTelemetry(db, buffer, new Date('2026-09-29T01:15:00.000Z'));

    buffer.increment('reminder_dispatch_total', { outcome: 'success' });
    await flushTelemetry(db, buffer, new Date('2026-09-29T01:45:00.000Z'));

    const metrics = await db.select().from(telemetryHourly);
    const events = await db.select().from(telemetryEvents);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.count).toBe(2);
    expect(metrics[0]?.sumValue).toBe(2);
    expect(events).toHaveLength(1);
    expect(events[0]?.errorCode).toBe('DB_UNAVAILABLE');
  });
});
