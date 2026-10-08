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
 *
 * Vision: `images: [{ mimeType, data(base64) }]` are written to a private temp dir,
 * exposed to the CLI with `--add-dir`, referenced by path in the prompt, and deleted afterwards.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redactForLog } from '../src/services/llm/redact.ts';

const PORT = parseInt(process.env.PORT || '7860', 10);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_PROMPT_CHARS = 64 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 4;

const IMAGE_TYPES: Record<string, { ext: string; matches: (bytes: Buffer) => boolean }> = {
  'image/jpeg': { ext: 'jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', matches: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  'image/gif': { ext: 'gif', matches: (b) => b.toString('ascii', 0, 4) === 'GIF8' },
};

export interface BridgeDeps {
  token: string;
  maxBodyBytes: number;
  maxPromptChars: number;
  maxImageBytes: number;
  maxConcurrent: number;
  processTimeoutMs: number;
  state: { inFlight: number };
  /** One line per request; defaults to silent. */
  log?: (line: string) => void;
  /** >0 also logs the redacted prompt and output, truncated to this many characters. */
  payloadMaxChars?: number;
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

type DecodedImage = { ext: string; bytes: Buffer };

function decodeImages(raw: unknown, maxImageBytes: number): DecodedImage[] | Response {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_IMAGES) {
    return Response.json({ error: 'invalid_image' }, { status: 400 });
  }
  const decoded: DecodedImage[] = [];
  for (const item of raw as { mimeType?: unknown; data?: unknown }[]) {
    const type = typeof item?.mimeType === 'string' ? IMAGE_TYPES[item.mimeType.toLowerCase()] : undefined;
    if (!type || typeof item.data !== 'string' || !item.data) {
      return Response.json({ error: 'invalid_image' }, { status: 400 });
    }
    const bytes = Buffer.from(item.data, 'base64');
    if (bytes.length > maxImageBytes) return Response.json({ error: 'image_too_large' }, { status: 413 });
    if (!type.matches(bytes)) return Response.json({ error: 'invalid_image' }, { status: 400 });
    decoded.push({ ext: type.ext, bytes });
  }
  return decoded;
}

interface RequestTrace {
  prompt: string;
  imageCount: number;
  imageBytes: number;
  output: string | null;
  exitCode: number | null;
  stderr: string;
}

const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

export async function handleBridgeRequest(req: Request, deps: BridgeDeps): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname === '/health') {
    return Response.json({ status: 'ok', service: 'antigravity-cli-bridge' });
  }
  const presentedId = req.headers.get('x-request-id') ?? '';
  const requestId = REQUEST_ID.test(presentedId) ? presentedId : `bridge-${randomBytes(4).toString('hex')}`;
  const trace: RequestTrace = { prompt: '', imageCount: 0, imageBytes: 0, output: null, exitCode: null, stderr: '' };
  const started = Date.now();
  const response = await processRequest(req, url, deps, trace);
  response.headers.set('x-request-id', requestId);

  const log = deps.log ?? (() => {});
  let errorCode = '';
  if (!response.ok) {
    errorCode = await response
      .clone()
      .json()
      .then((body) => (body as { error?: string }).error ?? '')
      .catch(() => '');
  }
  const parts = [
    `[Bridge] ${requestId} ${req.method} ${url.pathname} → ${response.status} ${errorCode || 'ok'} ${Date.now() - started}ms`,
  ];
  if (trace.prompt) parts.push(`prompt ${trace.prompt.length}c`);
  if (trace.imageCount) parts.push(`${trace.imageCount} gambar (${Math.max(1, Math.round(trace.imageBytes / 1024))} KB)`);
  if (trace.output !== null) parts.push(`output ${trace.output.length}c`);
  if (trace.exitCode !== null && (trace.exitCode !== 0 || !response.ok)) {
    const stderr = redactForLog(trace.stderr.replace(/\s+/g, ' ').trim(), 300);
    parts.push(`exit ${trace.exitCode}`, `stderr: ${stderr || '(kosong)'}`);
  }
  log(parts.join(' · '));
  const maxChars = deps.payloadMaxChars ?? 0;
  if (maxChars > 0 && trace.prompt) {
    log(`   ↳ prompt: ${redactForLog(trace.prompt, maxChars)}`);
    if (trace.output !== null) log(`   ↳ output: ${redactForLog(trace.output, maxChars)}`);
  }
  return response;
}

async function processRequest(req: Request, url: URL, deps: BridgeDeps, trace: RequestTrace): Promise<Response> {
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

  let body: { prompt?: string; images?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > deps.maxBodyBytes) {
      return Response.json({ error: 'payload_too_large' }, { status: 413 });
    }
    body = JSON.parse(raw) as { prompt?: string; images?: unknown };
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return Response.json({ error: 'prompt_required' }, { status: 400 });
  if (prompt.length > deps.maxPromptChars) return Response.json({ error: 'payload_too_large' }, { status: 413 });
  trace.prompt = prompt;

  const images = decodeImages(body.images, deps.maxImageBytes);
  if (images instanceof Response) return images;
  trace.imageCount = images.length;
  trace.imageBytes = images.reduce((sum, image) => sum + image.bytes.length, 0);

  if (deps.state.inFlight >= deps.maxConcurrent) {
    return Response.json({ error: 'busy' }, { status: 429 });
  }

  deps.state.inFlight += 1;
  let imageDir: string | null = null;
  try {
    const command = ['agy', '-p', prompt, '--output-format', 'text'];
    if (images.length > 0) {
      imageDir = await mkdtemp(join(tmpdir(), 'agy-vision-'));
      const paths: string[] = [];
      for (const [index, image] of images.entries()) {
        const path = join(imageDir, `image-${index + 1}.${image.ext}`);
        await writeFile(path, image.bytes, { mode: 0o600 });
        paths.push(path);
      }
      command[2] = `${prompt}\n\nBuka dan analisis file gambar berikut (jangan ubah atau jalankan apa pun):\n${paths.map((p) => `- ${p}`).join('\n')}`;
      command.push('--add-dir', imageDir);
    }

    const signal = AbortSignal.any([AbortSignal.timeout(deps.processTimeoutMs), req.signal]);
    const cancel = new Promise<never>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason ?? new Error('aborted'));
      else signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true });
    });
    const proc = deps.spawn(command, {
      stdout: 'pipe',
      stderr: 'pipe',
      signal,
      killSignal: 'SIGKILL',
    });
    const exitCode = await Promise.race([proc.exited, cancel]);
    const output = await Promise.race([new Response(proc.stdout ?? undefined).text(), cancel]);
    const errOutput = await Promise.race([new Response(proc.stderr ?? undefined).text(), cancel]);
    trace.exitCode = exitCode;
    if (exitCode !== 0) {
      trace.stderr = errOutput;
      return Response.json({ error: 'cli_failed' }, { status: 502 });
    }
    trace.output = output.trim();
    if (!trace.output) {
      trace.stderr = errOutput;
      return Response.json({ error: 'empty_output' }, { status: 502 });
    }
    return Response.json({ text: trace.output });
  } catch {
    return Response.json({ error: 'timeout' }, { status: 504 });
  } finally {
    deps.state.inFlight -= 1;
    if (imageDir) await rm(imageDir, { recursive: true, force: true }).catch(() => {});
  }
}

if (import.meta.main) {
  const token = process.env.ANTIGRAVITY_BRIDGE_TOKEN?.trim() || '';
  if (!token) {
    console.warn('⚠️ ANTIGRAVITY_BRIDGE_TOKEN kosong. Pasang token sebelum bridge bisa dijangkau dari container.');
  }
  const processTimeoutMs = Number(process.env.ANTIGRAVITY_TIMEOUT_MS || 25_000);
  const logPayloads = process.env.BRIDGE_LOG_PAYLOADS?.trim().toLowerCase() === 'true';
  const payloadMaxChars = Number(process.env.BRIDGE_LOG_PAYLOAD_MAX_CHARS || 2000);
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
        maxPromptChars: MAX_PROMPT_CHARS,
        maxImageBytes: MAX_IMAGE_BYTES,
        maxConcurrent: Number(process.env.BRIDGE_MAX_CONCURRENT || 2),
        processTimeoutMs,
        state,
        spawn: (command, options) => Bun.spawn(command, options),
        log: (line) => console.log(line),
        payloadMaxChars: logPayloads ? payloadMaxChars : 0,
      });
    },
  });
  console.log(`✅ Antigravity CLI Bridge siap di http://${HOST}:${PORT}`);
  if (logPayloads) {
    console.warn('⚠️ BRIDGE_LOG_PAYLOADS aktif: isi prompt/output (disensor & dipotong) ikut dicatat di log bridge.');
  }
}
