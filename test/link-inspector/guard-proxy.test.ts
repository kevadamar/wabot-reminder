import { afterEach, describe, expect, it } from 'bun:test';
import net from 'node:net';
import { startGuardProxy, type GuardProxy } from '../../src/link-inspector/guard-proxy.ts';

const PUBLIC_IP = '93.184.216.34';
const opened: { close: () => unknown }[] = [];

afterEach(async () => {
  while (opened.length) await opened.pop()!.close();
});

/** A local TCP server standing in for a public website; records what it received. */
async function fakeOrigin(respond: (request: string, socket: net.Socket) => void) {
  const received: string[] = [];
  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => {
      received.push(chunk.toString('latin1'));
      respond(received.join(''), socket);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  opened.push({ close: () => new Promise((r) => server.close(() => r(undefined))) });
  return { port: (server.address() as net.AddressInfo).port, received };
}

async function startProxy(originPort: number, extra: Partial<Parameters<typeof startGuardProxy>[0]> = {}) {
  const connects: string[] = [];
  const proxy = await startGuardProxy({
    lookup: async (host) => (host === 'public.test' ? [{ address: PUBLIC_IP, family: 4 }] : host === 'rebind.test' ? [{ address: '10.0.0.7', family: 4 }] : []),
    connect: (host, port) => {
      connects.push(`${host}:${port}`);
      return net.connect(originPort, '127.0.0.1');
    },
    ...extra,
  });
  opened.push(proxy);
  return { proxy, connects };
}

/** Sends raw bytes to the proxy and collects everything it answers until the socket closes. */
function rawExchange(proxy: GuardProxy, payload: string, afterHead?: (socket: net.Socket) => void): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.connect(proxy.port, '127.0.0.1', () => socket.write(payload));
    let data = '';
    let sentFollowUp = false;
    socket.on('data', (chunk) => {
      data += chunk.toString('latin1');
      if (afterHead && !sentFollowUp && data.includes('\r\n\r\n')) {
        sentFollowUp = true;
        afterHead(socket);
      }
    });
    socket.on('close', () => resolve(data));
    socket.on('error', () => resolve(data));
    setTimeout(() => socket.destroy(), 1500);
  });
}

describe('guard proxy', () => {
  it('forwards plain HTTP to the pinned public address in origin form with Connection: close', async () => {
    const origin = await fakeOrigin((request, socket) => {
      if (request.includes('\r\n\r\n')) socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nhi');
    });
    const { proxy, connects } = await startProxy(origin.port);
    const answer = await rawExchange(
      proxy,
      'GET http://public.test/promo?x=1 HTTP/1.1\r\nHost: public.test\r\nProxy-Connection: keep-alive\r\nProxy-Authorization: Basic abc\r\n\r\n'
    );
    expect(answer).toContain('200 OK');
    expect(answer.endsWith('hi')).toBe(true);
    expect(connects).toEqual([`${PUBLIC_IP}:80`]);
    const forwarded = origin.received.join('');
    expect(forwarded.startsWith('GET /promo?x=1 HTTP/1.1\r\n')).toBe(true);
    expect(forwarded).toContain('Connection: close');
    expect(forwarded).not.toMatch(/proxy-/i);
    expect(proxy.stats.allowed).toBe(1);
  });

  it('tunnels CONNECT to a public host', async () => {
    const origin = await fakeOrigin((request, socket) => socket.write(`echo:${request}`));
    const { proxy, connects } = await startProxy(origin.port);
    const answer = await rawExchange(proxy, 'CONNECT public.test:443 HTTP/1.1\r\nHost: public.test:443\r\n\r\n', (socket) =>
      socket.write('TLS-BYTES')
    );
    expect(answer).toContain('200 Connection Established');
    expect(answer).toContain('echo:TLS-BYTES');
    expect(connects).toEqual([`${PUBLIC_IP}:443`]);
  });

  it.each([
    ['localhost', 'CONNECT localhost:443 HTTP/1.1\r\n\r\n', 'internal_name'],
    ['the cloud metadata IP', 'GET http://169.254.169.254/latest/meta-data HTTP/1.1\r\nHost: 169.254.169.254\r\n\r\n', 'private_address'],
    ['a docker service name', 'GET http://postgres:5432/ HTTP/1.1\r\n\r\n', 'internal_name'],
    ['a name that resolves to a private IP', 'CONNECT rebind.test:443 HTTP/1.1\r\n\r\n', 'private_address'],
  ])('refuses %s with 403 and never connects', async (_label, payload, reason) => {
    const origin = await fakeOrigin(() => {});
    const { proxy, connects } = await startProxy(origin.port);
    const answer = await rawExchange(proxy, payload);
    expect(answer).toContain('403');
    expect(connects).toEqual([]);
    expect(proxy.stats.blocked[0]?.reason).toBe(reason);
  });

  it('rejects non-http schemes', async () => {
    const origin = await fakeOrigin(() => {});
    const { proxy, connects } = await startProxy(origin.port);
    const answer = await rawExchange(proxy, 'GET ftp://public.test/file HTTP/1.1\r\n\r\n');
    expect(answer).toContain('400');
    expect(connects).toEqual([]);
  });

  it('chains through an upstream proxy with credentials after the local check passes', async () => {
    const upstream = await fakeOrigin((request, socket) => {
      if (request.includes('\r\n\r\n') && !request.includes('TLS-BYTES')) socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
      if (request.includes('TLS-BYTES')) socket.write('tunnel-ok');
    });
    const { proxy, connects } = await startProxy(upstream.port, { upstream: new URL('http://user%40mail:p%3Ass@proxy.example:8080') });
    const answer = await rawExchange(proxy, 'CONNECT public.test:443 HTTP/1.1\r\n\r\n', (socket) => socket.write('TLS-BYTES'));
    expect(answer).toContain('200 Connection Established');
    expect(answer).toContain('tunnel-ok');
    expect(connects).toEqual(['proxy.example:8080']);
    const sent = upstream.received.join('');
    expect(sent.startsWith('CONNECT public.test:443 HTTP/1.1\r\n')).toBe(true);
    expect(sent).toContain(`Proxy-Authorization: Basic ${Buffer.from('user@mail:p:ss').toString('base64')}`);
  });

  it('still refuses private targets when an upstream proxy is configured', async () => {
    const upstream = await fakeOrigin(() => {});
    const { proxy, connects } = await startProxy(upstream.port, { upstream: new URL('http://proxy.example:8080') });
    const answer = await rawExchange(proxy, 'CONNECT 10.0.0.1:443 HTTP/1.1\r\n\r\n');
    expect(answer).toContain('403');
    expect(connects).toEqual([]);
  });

  it('cuts a connection that downloads more than the byte cap', async () => {
    const origin = await fakeOrigin((request, socket) => {
      if (request.includes('\r\n\r\n')) socket.write(`HTTP/1.1 200 OK\r\n\r\n${'x'.repeat(5000)}`);
    });
    const { proxy } = await startProxy(origin.port, { maxBytesPerConnection: 1000 });
    const answer = await rawExchange(proxy, 'GET http://public.test/big HTTP/1.1\r\n\r\n');
    expect(answer.length).toBeLessThan(5000);
  });
});
