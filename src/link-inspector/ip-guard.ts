import { isIP } from 'node:net';

/** Anything the inspector container could reach that is not the public internet. */
const BLOCKED_V4: [number, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].map(([base, bits]) => [v4ToInt(base as string), bits as number]);

const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.intranet', '.corp'];

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isPublicV4(ip: string): boolean {
  const value = v4ToInt(ip);
  return !BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (base & mask);
  });
}

function expandV6(ip: string): number[] | null {
  let text = ip;
  const dotted = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const v4 = v4ToInt(dotted[2]!);
    text = `${dotted[1]}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) =>
    part ? part.split(':').map((h) => (/^[0-9a-f]{1,4}$/i.test(h) ? parseInt(h, 16) : Number.NaN)) : [];
  const left = parse(halves[0]!);
  if (halves.length === 1) return left.length === 8 && left.every(Number.isInteger) ? left : null;
  const right = parse(halves[1]!);
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  const groups = [...left, ...Array<number>(missing).fill(0), ...right];
  return groups.every(Number.isInteger) ? groups : null;
}

function v4FromGroups(high: number, low: number): string {
  return [high >>> 8, high & 0xff, low >>> 8, low & 0xff].join('.');
}

function isPublicV6(ip: string): boolean {
  const g = expandV6(ip.split('%')[0]!);
  if (!g) return false;
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zeros(0, 8)) return false;
  if (zeros(0, 7) && g[7] === 1) return false;
  if (zeros(0, 5) && (g[5] === 0xffff || g[5] === 0)) return isPublicV4(v4FromGroups(g[6]!, g[7]!));
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return isPublicV4(v4FromGroups(g[6]!, g[7]!));
  if (g[0] === 0x2002) return isPublicV4(v4FromGroups(g[1]!, g[2]!));
  if (g[0] === 0x2001 && g[1] === 0) return false;
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false;
  if ((g[0]! & 0xfe00) === 0xfc00) return false;
  if ((g[0]! & 0xffc0) === 0xfe80) return false;
  if ((g[0]! & 0xff00) === 0xff00) return false;
  return true;
}

export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPublicV4(ip);
  if (family === 6) return isPublicV6(ip);
  return false;
}

export type LookupFn = (host: string) => Promise<{ address: string; family: number }[]>;

export type TargetCheck =
  | { ok: true; address: string }
  | { ok: false; reason: 'internal_name' | 'private_address' | 'dns_failed'; detail: string };

/**
 * Resolves a hostname and refuses it unless EVERY address is public. The caller must connect to the
 * returned address (not re-resolve the name) so a DNS rebinding answer cannot swap in an internal IP.
 */
export async function resolvePublicTarget(rawHost: string, lookup: LookupFn): Promise<TargetCheck> {
  const host = rawHost.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (isIP(host)) {
    return isPublicAddress(host)
      ? { ok: true, address: host }
      : { ok: false, reason: 'private_address', detail: host };
  }
  if (!host.includes('.') || host === 'localhost' || INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return { ok: false, reason: 'internal_name', detail: host };
  }
  let records: { address: string; family: number }[];
  try {
    records = await lookup(host);
  } catch {
    return { ok: false, reason: 'dns_failed', detail: host };
  }
  if (records.length === 0) return { ok: false, reason: 'dns_failed', detail: host };
  const blocked = records.find((record) => !isPublicAddress(record.address));
  if (blocked) return { ok: false, reason: 'private_address', detail: `${host} → ${blocked.address}` };
  const preferred = records.find((record) => record.family === 4) ?? records[0]!;
  return { ok: true, address: preferred.address };
}
