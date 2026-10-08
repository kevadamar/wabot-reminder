import { describe, expect, it } from 'bun:test';
import { handleBridgeRequest, type BridgeDeps } from '../../scripts/antigravity-bridge.ts';

function deps(patch: Partial<BridgeDeps> = {}): BridgeDeps {
  return {
    token: 'bridge-token',
    maxBodyBytes: 64,
    maxConcurrent: 2,
    processTimeoutMs: 1000,
    state: { inFlight: 0 },
    spawn: () => ({
      stdout: new Response('hasil').body,
      stderr: new Response('').body,
      exited: Promise.resolve(0),
    }),
    ...patch,
  };
}

function post(body: string, headers: Record<string, string> = {}) {
  return new Request('http://bridge.local/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
}

describe('Antigravity bridge', () => {
  it('returns 401 when the bearer token is missing or wrong', async () => {
    const missing = await handleBridgeRequest(post('{"prompt":"halo"}'), deps());
    const wrong = await handleBridgeRequest(
      post('{"prompt":"halo"}', { Authorization: 'Bearer salah' }),
      deps()
    );
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await missing.text()).not.toContain('bridge-token');
  });

  it('returns 413 when the body exceeds the limit', async () => {
    const response = await handleBridgeRequest(
      post('{"prompt":"terlalu panjang untuk batas"}', { Authorization: 'Bearer bridge-token' }),
      deps({ maxBodyBytes: 10 })
    );
    expect(response.status).toBe(413);
  });

  it('returns 429 when too many CLI processes are already running', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const shared = deps({
      maxConcurrent: 1,
      spawn: () => ({
        stdout: new Response('ok').body,
        stderr: new Response('').body,
        exited: gate.then(() => 0),
      }),
    });
    const first = handleBridgeRequest(post('{"prompt":"satu"}', { Authorization: 'Bearer bridge-token' }), shared);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await handleBridgeRequest(
      post('{"prompt":"dua"}', { Authorization: 'Bearer bridge-token' }),
      shared
    );
    expect(second.status).toBe(429);
    release();
    expect((await first).status).toBe(200);
  });

  it('does not return stderr when the CLI fails', async () => {
    const response = await handleBridgeRequest(post('{"prompt":"halo"}', { Authorization: 'Bearer bridge-token' }), deps({
      spawn: () => ({
        stdout: new Response('').body,
        stderr: new Response('secret-stderr-detail').body,
        exited: Promise.resolve(1),
      }),
    }));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('secret-stderr-detail');
  });

  it('stops a stuck process when the timeout fires', async () => {
    let sawAbort = false;
    const response = await handleBridgeRequest(post('{"prompt":"halo"}', { Authorization: 'Bearer bridge-token' }), deps({
      processTimeoutMs: 30,
      spawn: (_command, options) => ({
        stdout: new ReadableStream(),
        stderr: new ReadableStream(),
        exited: new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            sawAbort = true;
            reject(new Error('killed'));
          });
        }),
      }),
    }));
    expect(response.status).toBe(504);
    expect(sawAbort).toBe(true);
    expect(await response.text()).not.toContain('killed');
  });
});
