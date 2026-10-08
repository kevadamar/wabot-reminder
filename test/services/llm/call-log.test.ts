import { describe, expect, it } from 'bun:test';
import { formatCallLine, LlmCallLog, type LlmCallRecord } from '../../../src/services/llm/call-log.js';
import { redactForLog } from '../../../src/services/llm/redact.js';

function record(patch: Partial<LlmCallRecord> = {}): LlmCallRecord {
  return {
    id: 'abcd1234-1',
    chainId: 'abcd1234',
    seq: 1,
    at: '2026-10-08T10:00:00.000Z',
    operation: 'nlp_parse',
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
    outcome: 'success',
    durationMs: 812,
    httpStatus: null,
    errorDetail: null,
    providerRequestId: null,
    usage: { promptTokens: 310, outputTokens: 45, totalTokens: 355 },
    request: { systemChars: 900, userChars: 40, imageCount: 0, imageBytes: 0 },
    response: { chars: 212 },
    payload: null,
    ...patch,
  };
}

describe('redactForLog', () => {
  it('masks phone numbers, WhatsApp JIDs, emails, long digit runs and secrets', () => {
    const out = redactForLog(
      'hubungi 081234567890 / +6281234567890 / 628123456789@s.whatsapp.net / budi@mail.com, OTP 834221, ' +
        'Bearer abc.def.ghi key AIzaSyA1234567890abcdefghijklmnopqrstu sk-proj-abcdefghijklmnop1234',
      5000
    );
    expect(out).not.toMatch(/08123456789|6281234567890|628123456789|budi@mail\.com|834221|abc\.def\.ghi|AIzaSy|sk-proj/);
    expect(out).toContain('[nomor]');
    expect(out).toContain('[email]');
    expect(out).toContain('[angka]');
    expect(out).toContain('[secret]');
  });

  it('keeps short numbers like times and dates readable', () => {
    expect(redactForLog('besok jam 14:30 tanggal 12/10 bayar 50rb', 500)).toBe('besok jam 14:30 tanggal 12/10 bayar 50rb');
  });

  it('truncates long text and says how much was cut', () => {
    const out = redactForLog('a'.repeat(250), 100);
    expect(out.startsWith('a'.repeat(100))).toBe(true);
    expect(out).toContain('+150');
  });
});

describe('LlmCallLog', () => {
  it('keeps the newest records up to its capacity and lists newest first', () => {
    const log = new LlmCallLog(2);
    log.add(record({ id: 'a-1' }));
    log.add(record({ id: 'b-1' }));
    log.add(record({ id: 'c-1' }));
    expect(log.list().map((r) => r.id)).toEqual(['c-1', 'b-1']);
    expect(log.get('a-1')).toBeUndefined();
  });

  it('omits payloads from the list but returns them from get', () => {
    const log = new LlmCallLog(5);
    log.add(record({ payload: { system: 's', user: 'u', response: 'r' } }));
    const [summary] = log.list();
    expect(summary).not.toHaveProperty('payload');
    expect(summary?.hasPayload).toBe(true);
    expect(log.get('abcd1234-1')?.payload?.user).toBe('u');
  });

  it('caps list size', () => {
    const log = new LlmCallLog(10);
    for (let i = 0; i < 6; i++) log.add(record({ id: `x-${i}` }));
    expect(log.list(3)).toHaveLength(3);
  });
});

describe('formatCallLine', () => {
  it('describes a successful call with model, latency, sizes and tokens', () => {
    const line = formatCallLine(record());
    expect(line).toContain('[LLM]');
    expect(line).toContain('abcd1234-1');
    expect(line).toContain('nlp_parse');
    expect(line).toContain('gemini');
    expect(line).toContain('gemini-3.1-flash-lite');
    expect(line).toContain('success');
    expect(line).toContain('812ms');
    expect(line).toContain('in 940c');
    expect(line).toContain('out 212c');
    expect(line).toContain('tokens 310/45');
  });

  it('describes a failed bridge call with images, http status and detail', () => {
    const line = formatCallLine(
      record({
        provider: 'antigravity',
        model: 'antigravity-cli',
        outcome: 'timeout',
        durationMs: 25001,
        httpStatus: 504,
        errorDetail: 'timeout',
        request: { systemChars: 1000, userChars: 20, imageCount: 1, imageBytes: 86_016 },
        response: null,
        usage: null,
      })
    );
    expect(line).toContain('antigravity');
    expect(line).toContain('timeout');
    expect(line).toContain('1 img');
    expect(line).toContain('84 KB');
    expect(line).toContain('http 504');
  });
});
