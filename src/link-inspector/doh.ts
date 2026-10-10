import { isIP } from 'node:net';
import type { LookupFn } from './ip-guard.ts';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const RECORD_TYPES = [
  { name: 'A', code: 1, family: 4 },
  { name: 'AAAA', code: 28, family: 6 },
] as const;

/**
 * Resolves names over DNS-over-HTTPS (JSON API) instead of the host resolver. Indonesian ISPs
 * intercept plain DNS (even to 1.1.1.1:53) and answer blocked domains with their notice page, so
 * the inspector would never see the real site. Use an IP-literal endpoint so the resolver itself
 * does not depend on the filtered DNS.
 */
export function createDohLookup(endpoint: string, options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}): LookupFn {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;

  const query = async (host: string, type: (typeof RECORD_TYPES)[number]) => {
    const url = new URL(endpoint);
    url.searchParams.set('name', host);
    url.searchParams.set('type', type.name);
    const response = await fetchImpl(url.href, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`DoH HTTP ${response.status}`);
    const body = (await response.json()) as { Status?: number; Answer?: { type?: number; data?: string }[] };
    if (body.Status !== 0) throw new Error(`DoH status ${body.Status}`);
    return (body.Answer ?? [])
      .filter((answer) => answer.type === type.code && typeof answer.data === 'string' && isIP(answer.data) === type.family)
      .map((answer) => ({ address: answer.data!, family: type.family }));
  };

  return async (host) => {
    const results = await Promise.allSettled(RECORD_TYPES.map((type) => query(host, type)));
    const records = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    if (records.length === 0) throw new Error(`DoH: no address for ${host}`);
    return records;
  };
}
