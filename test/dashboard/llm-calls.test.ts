import { beforeEach, describe, expect, it } from 'bun:test';
import { createDashboardHandler } from '../../src/dashboard/server.js';
import { llmCallLog, type LlmCallRecord } from '../../src/services/llm/call-log.js';

function record(patch: Partial<LlmCallRecord>): LlmCallRecord {
  return {
    id: 'aaaa0000-1',
    chainId: 'aaaa0000',
    seq: 1,
    at: '2026-10-08T10:00:00.000Z',
    operation: 'nlp_parse',
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
    outcome: 'success',
    durationMs: 700,
    httpStatus: null,
    errorDetail: null,
    providerRequestId: null,
    usage: null,
    request: { systemChars: 100, userChars: 20, imageCount: 0, imageBytes: 0 },
    response: { chars: 50 },
    payload: null,
    ...patch,
  };
}

describe('Dashboard LLM calls', () => {
  const handler = createDashboardHandler({
    username: 'admin',
    password: 'a-secure-password-123',
    snapshot: async () => ({}),
  });
  const auth = { authorization: `Basic ${Buffer.from('admin:a-secure-password-123').toString('base64')}` };
  const get = (path: string, headers: Record<string, string> = auth) => handler(new Request(`http://localhost${path}`, { headers }));

  beforeEach(() => {
    llmCallLog.clear();
    llmCallLog.add(record({ id: 'aaaa0000-1' }));
    llmCallLog.add(
      record({
        id: 'bbbb0000-1',
        chainId: 'bbbb0000',
        provider: 'antigravity',
        model: 'antigravity-cli',
        outcome: 'timeout',
        httpStatus: 504,
        payload: { system: 'sys', user: 'halo', response: null },
      })
    );
  });

  it('requires authentication', async () => {
    expect((await get('/api/llm-calls', {})).status).toBe(401);
  });

  it('lists recent calls newest first without payloads', async () => {
    const res = await get('/api/llm-calls');
    const body = (await res.json()) as { calls: { id: string; hasPayload: boolean }[]; payloadLogging: boolean };
    expect(res.status).toBe(200);
    expect(body.calls.map((c) => c.id)).toEqual(['bbbb0000-1', 'aaaa0000-1']);
    expect(body.calls[0]?.hasPayload).toBe(true);
    expect(JSON.stringify(body)).not.toContain('halo');
    expect(typeof body.payloadLogging).toBe('boolean');
  });

  it('filters by provider and outcome group', async () => {
    const byProvider = (await (await get('/api/llm-calls?provider=antigravity')).json()) as { calls: { id: string }[] };
    expect(byProvider.calls.map((c) => c.id)).toEqual(['bbbb0000-1']);
    const failed = (await (await get('/api/llm-calls?outcome=error')).json()) as { calls: { id: string }[] };
    expect(failed.calls.map((c) => c.id)).toEqual(['bbbb0000-1']);
    const ok = (await (await get('/api/llm-calls?outcome=success')).json()) as { calls: { id: string }[] };
    expect(ok.calls.map((c) => c.id)).toEqual(['aaaa0000-1']);
  });

  it('returns one call with its payload, or 404', async () => {
    const res = await get('/api/llm-calls/detail?id=bbbb0000-1');
    const body = (await res.json()) as LlmCallRecord;
    expect(res.status).toBe(200);
    expect(body.payload?.user).toBe('halo');
    expect((await get('/api/llm-calls/detail?id=nope')).status).toBe(404);
  });

  it('serves the LLM calls page and links it from the overview', async () => {
    const page = await get('/llm');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('LLM Calls');
    expect((await get('/llm.js')).status).toBe(200);
    expect(await (await get('/')).text()).toContain('href="/llm"');
  });
});
