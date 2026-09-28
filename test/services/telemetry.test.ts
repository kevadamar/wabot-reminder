import { describe, expect, it } from 'bun:test';
import { recordAiUsage, TelemetryBuffer } from '../../src/services/telemetry.js';

describe('TelemetryBuffer', () => {
  it('aggregates bounded metrics without personal identifiers', () => {
    const telemetry = new TelemetryBuffer({ maxSeries: 10, maxEvents: 10 });

    telemetry.increment('message_received_total', { type: 'text', outcome: 'success' });
    telemetry.increment('message_received_total', { outcome: 'success', type: 'text' });
    telemetry.observe('handler_duration_ms', 120, { operation: 'message' });
    telemetry.observe('handler_duration_ms', 80, { operation: 'message' });

    const snapshot = telemetry.drain(new Date('2026-09-29T00:15:00.000Z'));
    expect(snapshot.metrics).toContainEqual({
      bucketAt: new Date('2026-09-29T00:00:00.000Z'),
      metric: 'message_received_total',
      dimension: 'outcome=success,type=text',
      count: 2,
      sumValue: 2,
      maxValue: 1,
    });
    expect(snapshot.metrics).toContainEqual({
      bucketAt: new Date('2026-09-29T00:00:00.000Z'),
      metric: 'handler_duration_ms',
      dimension: 'operation=message',
      count: 2,
      sumValue: 200,
      maxValue: 120,
    });
  });

  it('rejects high-cardinality or personal dimensions', () => {
    const telemetry = new TelemetryBuffer();
    expect(() => telemetry.increment('message_received_total', { user_jid: '628123@s.whatsapp.net' })).toThrow();
    expect(() => telemetry.increment('message_received_total', { operation: 'x'.repeat(40) })).toThrow();
  });

  it('caps buffered series and records dropped telemetry', () => {
    const telemetry = new TelemetryBuffer({ maxSeries: 1, maxEvents: 1 });
    telemetry.increment('first_total', { outcome: 'success' });
    telemetry.increment('second_total', { outcome: 'success' });

    expect(telemetry.getDroppedCount()).toBe(1);
  });

  it('records AI latency and token usage using bounded dimensions', () => {
    const buffer = new TelemetryBuffer();
    recordAiUsage(buffer, {
      operation: 'nlp_parse',
      provider: 'gemini',
      outcome: 'success',
      durationMs: 180,
      usage: { promptTokens: 20, outputTokens: 10, thoughtTokens: 5, totalTokens: 35 },
    });

    const snapshot = buffer.drain(new Date('2026-09-29T00:15:00.000Z'));
    expect(snapshot.metrics.some((item) => item.metric === 'ai_call_total' && item.sumValue === 1)).toBe(true);
    expect(snapshot.metrics.some((item) => item.metric === 'ai_tokens' && item.dimension.includes('type=total') && item.sumValue === 35)).toBe(true);
  });
});
