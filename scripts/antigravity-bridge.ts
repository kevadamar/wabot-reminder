/**
 * Antigravity CLI Host Bridge
 *
 * Runs on the host, outside the bot container.
 * Containers call this HTTP bridge to use the host `agy` CLI as an LLM fallback.
 *
 *   ANTIGRAVITY_BRIDGE_TOKEN=$(openssl rand -hex 32) bun run scripts/antigravity-bridge.ts
 *
 * Bind address defaults to 127.0.0.1. Set HOST only if the bot container must
 * reach this process, and keep the port off the public firewall.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

const PORT = parseInt(process.env.PORT || '7860', 10);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY_BYTES = 64 * 1024;

export interface BridgeDeps {
  token: string;
  maxBodyBytes: number;
  maxConcurrent: number;
  processTimeoutMs: number;
  state: { inFlight: number };
  spawn: (
    command: string[],
    options: { stdout: 'pipe'; stderr: 'pipe'; signal: AbortSignal; killSignal: 'SIGKILL' }
  ) => {
    stdout: ReadableStream<Uint8Array> | null;
    stderr: ReadableStream<Uint8Array> | null;
    exited: Promise<number>;
  };
}

function tokensMatch(presented: string, expected: string): boolean {
  const left = createHash('sha256').update(presented).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

function authorized(req: Request, token: string): boolean {
  if (!token) return true;
  const header = req.headers.get('authorization') || '';
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  return tokensMatch(presented, token);
}

export async function handleBridgeRequest(req: Request, deps: BridgeDeps): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname === '/health') {
    return Response.json({ status: 'ok', service: 'antigravity-cli-bridge' });
  }
  if (req.method !== 'POST' || (url.pathname !== '/generate' && url.pathname !== '/prompt')) {
    return new Response('Not Found', { status: 404 });
  }
  if (!authorized(req, deps.token)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const declared = Number(req.headers.get('content-length') || '0');
  if (Number.isFinite(declared) && declared > deps.maxBodyBytes) {
    return Response.json({ error: 'payload_too_large' }, { status: 413 });
  }

  let body: { prompt?: string };
  try {
    const raw = await req.text();
    if (raw.length > deps.maxBodyBytes) {
      return Response.json({ error: 'payload_too_large' }, { status: 413 });
    }
    body = JSON.parse(raw) as { prompt?: string };
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt) return Response.json({ error: 'prompt_required' }, { status: 400 });
  if (prompt.length > deps.maxBodyBytes) return Response.json({ error: 'payload_too_large' }, { status: 413 });

  if (deps.state.inFlight >= deps.maxConcurrent) {
    return Response.json({ error: 'busy' }, { status: 429 });
  }

  deps.state.inFlight += 1;
  const started = Date.now();
  try {
    const signal = AbortSignal.any([AbortSignal.timeout(deps.processTimeoutMs), req.signal]);
    const cancel = new Promise<never>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason ?? new Error('aborted'));
      else signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true });
    });
    const proc = deps.spawn(['agy', '-p', prompt, '--output-format', 'text'], {
      stdout: 'pipe',
      stderr: 'pipe',
      signal,
      killSignal: 'SIGKILL',
    });
    const exitCode = await Promise.race([proc.exited, cancel]);
    const output = await Promise.race([new Response(proc.stdout ?? undefined).text(), cancel]);
    const errOutput = await Promise.race([new Response(proc.stderr ?? undefined).text(), cancel]);
    if (exitCode !== 0) {
      console.error(`[Bridge] agy exited ${exitCode} after ${Date.now() - started}ms: ${errOutput.slice(0, 200)}`);
      return Response.json({ error: 'cli_failed' }, { status: 502 });
    }
    console.log(`[Bridge] selesai dalam ${Date.now() - started}ms (${prompt.length} chars)`);
    return Response.json({ text: output.trim() });
  } catch {
    return Response.json({ error: 'timeout' }, { status: 504 });
  } finally {
    deps.state.inFlight -= 1;
  }
}

if (import.meta.main) {
  const token = process.env.ANTIGRAVITY_BRIDGE_TOKEN?.trim() || '';
  if (!token) {
    console.warn('⚠️ ANTIGRAVITY_BRIDGE_TOKEN kosong. Pasang token sebelum bridge bisa dijangkau dari container.');
  }
  const processTimeoutMs = Number(process.env.ANTIGRAVITY_TIMEOUT_MS || 25_000);
  const state = { inFlight: 0 };
  Bun.serve({
    port: PORT,
    hostname: HOST,
    idleTimeout: Math.min(255, Math.ceil(processTimeoutMs / 1000) + 5),
    maxRequestBodySize: MAX_BODY_BYTES,
    async fetch(req) {
      return handleBridgeRequest(req, {
        token,
        maxBodyBytes: MAX_BODY_BYTES,
        maxConcurrent: Number(process.env.BRIDGE_MAX_CONCURRENT || 2),
        processTimeoutMs,
        state,
        spawn: (command, options) => Bun.spawn(command, options),
      });
    },
  });
  console.log(`✅ Antigravity CLI Bridge siap di http://${HOST}:${PORT}`);
}
