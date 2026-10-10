import { describe, expect, it } from 'bun:test';
import { isPublicAddress, resolvePublicTarget } from '../../src/link-inspector/ip-guard.ts';

describe('isPublicAddress', () => {
  it.each([
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '192.0.2.10', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2002:c0a8:0101::1',
  ])('blocks %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '203.0.114.5', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it('rejects things that are not IP addresses', () => {
    expect(isPublicAddress('example.com')).toBe(false);
    expect(isPublicAddress('')).toBe(false);
  });
});

describe('resolvePublicTarget', () => {
  const lookup = (table: Record<string, string[]>) => async (host: string) =>
    (table[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

  it('returns the first public IPv4 address for a public hostname', async () => {
    const result = await resolvePublicTarget('kantor-contoh.id', lookup({ 'kantor-contoh.id': ['2606:4700::1', '104.21.1.1'] }));
    expect(result).toEqual({ ok: true, address: '104.21.1.1' });
  });

  it('blocks a hostname when any resolved address is private (DNS rebinding / split records)', async () => {
    const result = await resolvePublicTarget('evil.example', lookup({ 'evil.example': ['93.184.216.34', '10.0.0.5'] }));
    expect(result).toMatchObject({ ok: false, reason: 'private_address' });
  });

  it.each(['localhost', 'api.localhost', 'postgres', 'link-inspector', 'host.docker.internal', 'printer.local', 'router.lan', 'nas.home.arpa'])(
    'blocks internal-looking name %s without resolving it',
    async (host) => {
      let resolved = false;
      const result = await resolvePublicTarget(host, async () => {
        resolved = true;
        return [{ address: '93.184.216.34', family: 4 }];
      });
      expect(result).toMatchObject({ ok: false, reason: 'internal_name' });
      expect(resolved).toBe(false);
    }
  );

  it('checks IP literals directly', async () => {
    expect(await resolvePublicTarget('169.254.169.254', lookup({}))).toMatchObject({ ok: false, reason: 'private_address' });
    expect(await resolvePublicTarget('[::1]', lookup({}))).toMatchObject({ ok: false, reason: 'private_address' });
    expect(await resolvePublicTarget('8.8.8.8', lookup({}))).toEqual({ ok: true, address: '8.8.8.8' });
  });

  it('reports names that do not resolve', async () => {
    expect(await resolvePublicTarget('nothing.invalid', lookup({}))).toMatchObject({ ok: false, reason: 'dns_failed' });
  });
});
