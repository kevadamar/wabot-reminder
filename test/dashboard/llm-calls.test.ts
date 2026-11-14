import { beforeEach, describe, expect, it } from 'bun:test';
import { createDashboardHandler } from '../../src/dashboard/server.js';
import {
  hydrateLlmCallLog,
  llmCallLog,
  persistLlmCall,
  pruneLlmCallRecords,
  recordToRow,
  rowToRecord,
  type LlmCallRecord,
} from '../../src/services/llm/call-log.js';

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
    llmCallLog.setDb(null);
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

  describe('Database Persistence & Hydration', () => {
    it('correctly maps between LlmCallRecord and DB Row', () => {
      const rec = record({
        id: 'test-map-1',
        usage: { promptTokens: 120, outputTokens: 40, totalTokens: 160 },
        payload: { system: 'system', user: 'prompt', response: 'reply' },
      });
      const row = recordToRow(rec);
      expect(row.id).toBe('test-map-1');
      expect(row.promptTokens).toBe(120);
      expect(row.outputTokens).toBe(40);
      expect(row.payload).toEqual({ system: 'system', user: 'prompt', response: 'reply' });

      const reconstituted = rowToRecord({
        ...row,
        at: row.at,
        createdAt: new Date(),
      });
      expect(reconstituted.id).toBe('test-map-1');
      expect(reconstituted.usage?.totalTokens).toBe(160);
      expect(reconstituted.payload?.response).toBe('reply');
    });

    it('hydrates llmCallLog from database on startup', async () => {
      llmCallLog.clear();
      expect(llmCallLog.list().length).toBe(0);

      const mockDb = {
        select: () => ({
          from: () => ({
            orderBy: () => ({
              limit: async (lim: number) => [
                {
                  id: 'db-call-2',
                  chainId: 'chain-db',
                  seq: 2,
                  at: new Date('2026-11-14T10:01:00.000Z'),
                  operation: 'nlp_parse',
                  provider: 'gemini',
                  model: 'gemini-3.1-flash-lite',
                  outcome: 'success',
                  durationMs: 400,
                  httpStatus: null,
                  errorDetail: null,
                  providerRequestId: null,
                  promptTokens: 50,
                  outputTokens: 20,
                  totalTokens: 70,
                  systemChars: 100,
                  userChars: 20,
                  imageCount: 0,
                  imageBytes: 0,
                  responseChars: 50,
                  payload: null,
                },
                {
                  id: 'db-call-1',
                  chainId: 'chain-db',
                  seq: 1,
                  at: new Date('2026-11-14T10:00:00.000Z'),
                  operation: 'nlp_parse',
                  provider: 'antigravity',
                  model: 'antigravity-cli',
                  outcome: 'timeout',
                  durationMs: 5000,
                  httpStatus: 504,
                  errorDetail: 'timeout',
                  providerRequestId: null,
                  promptTokens: null,
                  outputTokens: null,
                  totalTokens: null,
                  systemChars: 100,
                  userChars: 20,
                  imageCount: 0,
                  imageBytes: 0,
                  responseChars: null,
                  payload: null,
                },
              ],
            }),
          }),
        }),
      };

      const count = await hydrateLlmCallLog(mockDb);
      expect(count).toBe(2);
      const list = llmCallLog.list();
      expect(list.length).toBe(2);
      // Newest should be first in list()
      expect(list[0]?.id).toBe('db-call-2');
      expect(list[1]?.id).toBe('db-call-1');
    });

    it('falls back to database query in /api/llm-calls/detail when record is not in RAM', async () => {
      llmCallLog.clear(); // Empty in memory!

      const historicalRow = {
        id: 'historical-call-99',
        chainId: 'hist-chain',
        seq: 1,
        at: new Date('2026-11-01T08:00:00.000Z'),
        operation: 'link_review',
        provider: 'gemini',
        model: 'gemini-3.1-flash-lite',
        outcome: 'success',
        durationMs: 1200,
        httpStatus: null,
        errorDetail: null,
        providerRequestId: null,
        promptTokens: 300,
        outputTokens: 80,
        totalTokens: 380,
        systemChars: 500,
        userChars: 100,
        imageCount: 0,
        imageBytes: 0,
        responseChars: 150,
        payload: { system: 'sys', user: 'http://example.com', response: 'safe' },
      };

      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [historicalRow],
            }),
          }),
        }),
      };

      const customHandler = createDashboardHandler({
        username: 'admin',
        password: 'a-secure-password-123',
        snapshot: async () => ({}),
        db: mockDb,
      });

      const res = await customHandler(
        new Request('http://localhost/api/llm-calls/detail?id=historical-call-99', { headers: auth })
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as LlmCallRecord;
      expect(data.id).toBe('historical-call-99');
      expect(data.operation).toBe('link_review');
      expect(data.payload?.response).toBe('safe');
    });

    it('asynchronously persists new calls when db is configured', async () => {
      let insertedRow: any = null;
      const mockDb = {
        insert: () => ({
          values: (val: any) => ({
            onConflictDoNothing: async () => {
              insertedRow = val;
            },
          }),
        }),
      };

      llmCallLog.setDb(mockDb);
      const newCall = record({ id: 'async-call-123', provider: 'openai' });
      llmCallLog.add(newCall);

      // Wait a microtask tick for async queueMicrotask to finish
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(insertedRow).not.toBeNull();
      expect(insertedRow.id).toBe('async-call-123');
      expect(insertedRow.provider).toBe('openai');
    });

    it('prunes records older than retentionDays', async () => {
      let deletedCondition: any = null;
      const mockDb = {
        delete: () => ({
          where: async (cond: any) => {
            deletedCondition = cond;
          },
        }),
      };

      await pruneLlmCallRecords(mockDb, 14);
      expect(deletedCondition).not.toBeNull();
    });
  });
});
