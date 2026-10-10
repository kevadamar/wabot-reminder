import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { InspectionResult } from './types.ts';

export interface InspectorDeps {
  token: string;
  maxConcurrent: number;
  state: { inFlight: number };
  inspect: (url: string, requestId: string) => Promise<InspectionResult>;
  log?: (line: string) => void;
}

const MAX_URL_CHARS = 2048;
const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

function tokensMatch(presented: string, expected: string): boolean {
  const left = createHash('sha256').update(presented).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

function hostOf(url: string | null): string {
  if (!url) return '-';
  try {
    return new URL(url).host;
  } catch {
    return '-';
  }
}

function describe(result: InspectionResult): string {
  const parts = [`${hostOf(result.requestedUrl)} → ${hostOf(result.finalUrl)}`];
  if (result.httpStatus) parts.push(`http ${result.httpStatus}`);
  if (result.redirectChain.length > 1) parts.push(`${result.redirectChain.length - 1} redirect`);
  if (result.forms.password) parts.push(`password ${result.forms.password}`);
  if (result.forms.otp) parts.push(`otp ${result.forms.otp}`);
  if (result.forms.card) parts.push(`card ${result.forms.card}`);
  if (result.download) parts.push(`download ${result.download.filename}`);
  if (result.blockedRequests.length) parts.push(`diblokir ${result.blockedRequests.length}`);
  if (result.error) parts.push(`error ${result.error}`);
  return parts.join(' · ');
}

export async function handleInspectorRequest(req: Request, deps: InspectorDeps): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname === '/health') {
    return Response.json({ status: 'ok', service: 'link-inspector' });
  }
  if (req.method !== 'POST' || url.pathname !== '/inspect') return new Response('Not Found', { status: 404 });

  const presentedId = req.headers.get('x-request-id') ?? '';
  const requestId = REQUEST_ID.test(presentedId) ? presentedId : `inspect-${randomBytes(4).toString('hex')}`;
  const log = deps.log ?? (() => {});
  const started = Date.now();
  const respond = (response: Response, summary: string) => {
    response.headers.set('x-request-id', requestId);
    log(`[Inspector] ${requestId} → ${response.status} ${Date.now() - started}ms · ${summary}`);
    return response;
  };

  const header = req.headers.get('authorization') || '';
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!deps.token || !tokensMatch(presented, deps.token)) {
    return respond(Response.json({ error: 'unauthorized' }, { status: 401 }), 'unauthorized');
  }

  let target: string;
  try {
    const body = (await req.json()) as { url?: unknown };
    if (typeof body.url !== 'string' || body.url.length > MAX_URL_CHARS) throw new Error('url');
    const parsed = new URL(body.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('scheme');
    target = parsed.href;
  } catch {
    return respond(Response.json({ error: 'invalid_url' }, { status: 400 }), 'invalid_url');
  }

  if (deps.state.inFlight >= deps.maxConcurrent) {
    return respond(Response.json({ error: 'busy' }, { status: 429 }), 'busy');
  }
  deps.state.inFlight += 1;
  try {
    const result = await deps.inspect(target, requestId);
    return respond(Response.json(result), describe(result));
  } catch {
    return respond(Response.json({ error: 'inspect_failed' }, { status: 500 }), 'inspect_failed');
  } finally {
    deps.state.inFlight -= 1;
  }
}
