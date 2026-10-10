import { describe, expect, it } from 'bun:test';
import { createDohLookup } from '../../src/link-inspector/doh.ts';

type Answer = { name: string; type: number; data: string };

function fakeDoh(answers: Record<string, { Status: number; Answer?: Answer[] }>) {
  const requests: { url: string; accept: string | null }[] = [];
  const fetchImpl = async (input: string, init?: RequestInit) => {
    requests.push({ url: input, accept: new Headers(init?.headers).get('accept') });
    const type = new URL(input).searchParams.get('type')!;
    return Response.json(answers[type] ?? { Status: 0 });
  };
  return { fetchImpl, requests };
}

describe('DNS-over-HTTPS lookup', () => {
  it('returns A and AAAA records and skips CNAME hops', async () => {
    const { fetchImpl, requests } = fakeDoh({
      A: {
        Status: 0,
        Answer: [
          { name: 'www.toko.com', type: 5, data: 'toko.com.' },
          { name: 'toko.com', type: 1, data: '104.21.49.24' },
        ],
      },
      AAAA: { Status: 0, Answer: [{ name: 'toko.com', type: 28, data: '2606:4700:3033::6815:3118' }] },
    });
    const lookup = createDohLookup('https://1.1.1.1/dns-query', { fetchImpl });

    expect(await lookup('www.toko.com')).toEqual([
      { address: '104.21.49.24', family: 4 },
      { address: '2606:4700:3033::6815:3118', family: 6 },
    ]);
    expect(requests.map((r) => r.url).sort()).toEqual([
      'https://1.1.1.1/dns-query?name=www.toko.com&type=A',
      'https://1.1.1.1/dns-query?name=www.toko.com&type=AAAA',
    ]);
    expect(requests.every((r) => r.accept === 'application/dns-json')).toBe(true);
  });

  it('throws when the name does not exist or the resolver fails', async () => {
    const nx = createDohLookup('https://1.1.1.1/dns-query', { fetchImpl: fakeDoh({ A: { Status: 3 }, AAAA: { Status: 3 } }).fetchImpl });
    await expect(nx('tidak-ada.xyz')).rejects.toThrow();

    const down = createDohLookup('https://1.1.1.1/dns-query', {
      fetchImpl: async () => new Response('bad gateway', { status: 502 }),
    });
    await expect(down('toko.com')).rejects.toThrow();
  });

  it('ignores answer data that is not an IP address', async () => {
    const { fetchImpl } = fakeDoh({
      A: { Status: 0, Answer: [{ name: 'x.com', type: 1, data: 'not-an-ip' }, { name: 'x.com', type: 1, data: '203.0.113.9' }] },
    });
    const lookup = createDohLookup('https://1.1.1.1/dns-query', { fetchImpl });
    expect(await lookup('x.com')).toEqual([{ address: '203.0.113.9', family: 4 }]);
  });
});
