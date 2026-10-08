import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handleBridgeRequest, type BridgeDeps } from '../../scripts/antigravity-bridge.ts';

function deps(patch: Partial<BridgeDeps> = {}): BridgeDeps {
  return {
    token: 'bridge-token',
    maxBodyBytes: 64,
    maxPromptChars: 64 * 1024,
    maxImageBytes: 5 * 1024 * 1024,
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

  describe('observability', () => {
    const auth = { Authorization: 'Bearer bridge-token' };

    it('echoes a valid X-Request-Id and logs one line per request with it', async () => {
      const lines: string[] = [];
      const response = await handleBridgeRequest(
        post('{"prompt":"halo 081234567890"}', { ...auth, 'X-Request-Id': 'abcd1234-2' }),
        deps({ log: (line) => lines.push(line) })
      );
      expect(response.headers.get('x-request-id')).toBe('abcd1234-2');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('abcd1234-2');
      expect(lines[0]).toContain('200');
      expect(lines[0]).toMatch(/prompt \d+c/);
      expect(lines[0]).toContain('output 5c');
      expect(lines.join('\n')).not.toContain('081234567890');
    });

    it('replaces an unsafe request id with a generated one', async () => {
      const response = await handleBridgeRequest(
        post('{"prompt":"halo"}', { ...auth, 'X-Request-Id': 'bad id; with spaces' }),
        deps({ log: () => {} })
      );
      const id = response.headers.get('x-request-id') ?? '';
      expect(id).toMatch(/^bridge-[a-f0-9]{8}$/);
    });

    it('logs rejected requests with their status and error code', async () => {
      const lines: string[] = [];
      await handleBridgeRequest(post('{"prompt":"halo"}'), deps({ log: (line) => lines.push(line) }));
      expect(lines[0]).toContain('401');
      expect(lines[0]).toContain('unauthorized');
    });

    it('treats an empty CLI output as a failure and logs stderr only on the bridge', async () => {
      const lines: string[] = [];
      const response = await handleBridgeRequest(
        post('{"prompt":"halo"}', { ...auth, 'X-Request-Id': 'abcd1234-1' }),
        deps({
          log: (line) => lines.push(line),
          spawn: () => ({
            stdout: new Response('  \n').body,
            stderr: new Response('Error: not logged in. Run agy login').body,
            exited: Promise.resolve(0),
          }),
        })
      );
      expect(response.status).toBe(502);
      const body = await response.text();
      expect(body).toContain('empty_output');
      expect(body).not.toContain('not logged in');
      expect(lines[0]).toContain('502 empty_output');
      expect(lines[0]).toContain('stderr: Error: not logged in. Run agy login');
    });

    it('does not log /health checks', async () => {
      const lines: string[] = [];
      await handleBridgeRequest(new Request('http://bridge.local/health'), deps({ log: (line) => lines.push(line) }));
      expect(lines).toHaveLength(0);
    });

    it('logs redacted prompt and output only when payload logging is enabled', async () => {
      const lines: string[] = [];
      await handleBridgeRequest(
        post('{"prompt":"telepon 081234567890 besok"}', auth),
        deps({ log: (line) => lines.push(line), payloadMaxChars: 500 })
      );
      const text = lines.join('\n');
      expect(text).toContain('prompt: telepon [nomor] besok');
      expect(text).toContain('output: hasil');
    });
  });

  describe('agent JSON output', () => {
    const auth = { Authorization: 'Bearer bridge-token' };
    const agyJson = (body: Record<string, unknown>) => ({
      stdout: new Response(JSON.stringify(body)).body,
      stderr: new Response('').body,
      exited: Promise.resolve(0),
    });

    it('asks for JSON output and tells the agent not to use tools', async () => {
      let command: string[] = [];
      await handleBridgeRequest(post('{"prompt":"besok revamp esb.id"}', auth), deps({
        spawn: (cmd) => {
          command = cmd;
          return agyJson({ status: 'SUCCESS', response: 'ok' });
        },
      }));
      expect(command[command.indexOf('--output-format') + 1]).toBe('json');
      const prompt = command[command.indexOf('-p') + 1]!;
      expect(prompt).toContain('besok revamp esb.id');
      expect(prompt).toMatch(/jangan menjalankan perintah/i);
      expect(command).not.toContain('--dangerously-skip-permissions');
    });

    it('returns the response text and token usage', async () => {
      const response = await handleBridgeRequest(post('{"prompt":"halo"}', auth), deps({
        spawn: () => agyJson({
          status: 'SUCCESS',
          response: '{"isTask": true}\n',
          usage: { input_tokens: 16392, output_tokens: 18, thinking_tokens: 2, total_tokens: 16412 },
        }),
      }));
      expect(await response.json()).toEqual({
        text: '{"isTask": true}',
        usage: { promptTokens: 16392, outputTokens: 18, thoughtTokens: 2, totalTokens: 16412 },
      });
    });

    it('reports a denied tool instead of an empty answer', async () => {
      const lines: string[] = [];
      const response = await handleBridgeRequest(post('{"prompt":"halo"}', { ...auth, 'X-Request-Id': 'abcd1234-1' }), deps({
        log: (line) => lines.push(line),
        spawn: () => ({
          stdout: new Response(JSON.stringify({
            status: 'SUCCESS',
            response: '',
            denied_actions: [{ action: 'command', display_name: 'RunCommand' }],
          })).body,
          stderr: new Response('no output produced — a tool required the "command" permission').body,
          exited: Promise.resolve(0),
        }),
      }));
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'tool_denied:command' });
      expect(lines[0]).toContain('502 tool_denied:command');
      expect(lines[0]).toContain('tool ditolak: command');
    });
  });

  describe('images', () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const auth = { Authorization: 'Bearer bridge-token' };
    const imageBody = (images: unknown) => JSON.stringify({ prompt: 'analisis', images });

    it('writes images to a private temp dir, passes it with --add-dir, and removes it afterwards', async () => {
      let command: string[] = [];
      let fileDuringRun: Buffer | null = null;
      const response = await handleBridgeRequest(
        post(imageBody([{ mimeType: 'image/png', data: PNG.toString('base64') }]), auth),
        deps({
          maxBodyBytes: 10_000,
          spawn: (cmd) => {
            command = cmd;
            const dir = cmd[cmd.indexOf('--add-dir') + 1]!;
            fileDuringRun = readFileSync(join(dir, 'image-1.png'));
            return { stdout: new Response('{"isSuspicious":false}').body, stderr: new Response('').body, exited: Promise.resolve(0) };
          },
        })
      );
      expect(response.status).toBe(200);
      expect(fileDuringRun).not.toBeNull();
      expect(Buffer.compare(fileDuringRun!, PNG)).toBe(0);
      const dir = command[command.indexOf('--add-dir') + 1]!;
      expect(command[command.indexOf('-p') + 1]).toContain(join(dir, 'image-1.png'));
      expect(existsSync(dir)).toBe(false);
    });

    it('removes the temp dir even when the CLI fails', async () => {
      let dir = '';
      const response = await handleBridgeRequest(
        post(imageBody([{ mimeType: 'image/png', data: PNG.toString('base64') }]), auth),
        deps({
          maxBodyBytes: 10_000,
          spawn: (cmd) => {
            dir = cmd[cmd.indexOf('--add-dir') + 1]!;
            return { stdout: new Response('').body, stderr: new Response('x').body, exited: Promise.resolve(1) };
          },
        })
      );
      expect(response.status).toBe(502);
      expect(dir).not.toBe('');
      expect(existsSync(dir)).toBe(false);
    });

    it('keeps text-only prompts free of --add-dir', async () => {
      let command: string[] = [];
      await handleBridgeRequest(post('{"prompt":"halo"}', auth), deps({
        spawn: (cmd) => {
          command = cmd;
          return { stdout: new Response('ok').body, stderr: new Response('').body, exited: Promise.resolve(0) };
        },
      }));
      expect(command).not.toContain('--add-dir');
    });

    it.each([
      ['an unsupported mime type', [{ mimeType: 'image/svg+xml', data: PNG.toString('base64') }]],
      ['bytes that do not match the declared type', [{ mimeType: 'image/jpeg', data: PNG.toString('base64') }]],
      ['an empty image', [{ mimeType: 'image/png', data: '' }]],
      ['a non-array images field', { mimeType: 'image/png', data: PNG.toString('base64') }],
      ['too many images', Array.from({ length: 5 }, () => ({ mimeType: 'image/png', data: PNG.toString('base64') }))],
    ])('rejects %s with 400 without spawning the CLI', async (_label, images) => {
      let spawned = false;
      const response = await handleBridgeRequest(post(imageBody(images), auth), deps({
        maxBodyBytes: 10_000,
        spawn: () => {
          spawned = true;
          return { stdout: new Response('').body, stderr: new Response('').body, exited: Promise.resolve(0) };
        },
      }));
      expect(response.status).toBe(400);
      expect(spawned).toBe(false);
    });

    it('rejects an image larger than the per-image limit with 413', async () => {
      const response = await handleBridgeRequest(
        post(imageBody([{ mimeType: 'image/png', data: PNG.toString('base64') }]), auth),
        deps({ maxBodyBytes: 10_000, maxImageBytes: 4 })
      );
      expect(response.status).toBe(413);
    });
  });
});
