import { describe, expect, it } from 'bun:test';
import { handleInspectorRequest, type InspectorDeps } from '../../src/link-inspector/server.ts';
import { EMPTY_FORMS, type InspectionResult } from '../../src/link-inspector/types.ts';

function result(patch: Partial<InspectionResult> = {}): InspectionResult {
  return {
    requestedUrl: 'https://promo.example/',
    finalUrl: 'https://promo.example/login',
    redirectChain: ['https://promo.example/', 'https://promo.example/login'],
    httpStatus: 200,
    title: 'Login',
    description: '',
    text: 'Masukkan PIN',
    forms: { ...EMPTY_FORMS, total: 1, password: 1 },
    download: null,
    blockedRequests: [],
    screenshot: null,
    error: null,
    errorDetail: null,
    durationMs: 1200,
    ...patch,
  };
}

function deps(patch: Partial<InspectorDeps> = {}): InspectorDeps {
  return {
    token: 'inspector-token',
    maxConcurrent: 2,
    state: { inFlight: 0 },
    inspect: async (url) => result({ requestedUrl: url }),
    ...patch,
  };
}

const auth = { Authorization: 'Bearer inspector-token' };
const inspectReq = (body: unknown, headers: Record<string, string> = auth) =>
  new Request('http://inspector.local/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('link inspector server', () => {
  it('answers /health without auth', async () => {
    const response = await handleInspectorRequest(new Request('http://inspector.local/health'), deps());
    expect(response.status).toBe(200);
  });

  it('requires the bearer token', async () => {
    let called = false;
    const response = await handleInspectorRequest(inspectReq({ url: 'https://promo.example/' }, {}), deps({
      inspect: async () => {
        called = true;
        return result();
      },
    }));
    expect(response.status).toBe(401);
    expect(called).toBe(false);
  });

  it.each([
    ['invalid JSON', '{'],
    ['a missing url', { nope: 1 }],
    ['a non-http scheme', { url: 'file:///etc/passwd' }],
    ['an overlong url', { url: `https://a.example/${'x'.repeat(3000)}` }],
  ])('rejects %s with 400', async (_label, body) => {
    const response = await handleInspectorRequest(inspectReq(body), deps());
    expect(response.status).toBe(400);
  });

  it('returns the inspection and echoes the request id', async () => {
    const lines: string[] = [];
    const response = await handleInspectorRequest(
      inspectReq({ url: 'https://promo.example/' }, { ...auth, 'X-Request-Id': 'abcd1234-1' }),
      deps({ log: (line) => lines.push(line) })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('abcd1234-1');
    const body = (await response.json()) as InspectionResult;
    expect(body.finalUrl).toBe('https://promo.example/login');
    expect(lines[0]).toContain('abcd1234-1');
    expect(lines[0]).toContain('promo.example');
    expect(lines[0]).toContain('password 1');
  });

  it('returns 429 when the browser is already busy', async () => {
    const response = await handleInspectorRequest(inspectReq({ url: 'https://promo.example/' }), deps({
      maxConcurrent: 1,
      state: { inFlight: 1 },
    }));
    expect(response.status).toBe(429);
  });

  it('turns a crash into 500 without leaking the message', async () => {
    const response = await handleInspectorRequest(inspectReq({ url: 'https://promo.example/' }), deps({
      inspect: async () => {
        throw new Error('browser died at /root/secret/path');
      },
    }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('/root/secret');
  });
});
