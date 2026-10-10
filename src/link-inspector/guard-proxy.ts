import net from 'node:net';
import { resolvePublicTarget, type LookupFn } from './ip-guard.ts';

export interface GuardProxyOptions {
  lookup: LookupFn;
  /** Optional HTTP proxy (e.g. residential) to exit through; targets are still checked locally first. */
  upstream?: URL | null;
  maxBytesPerConnection?: number;
  idleTimeoutMs?: number;
  connect?: (host: string, port: number) => net.Socket;
}

export interface GuardProxyStats {
  allowed: number;
  blocked: { host: string; reason: string }[];
  bytes: number;
}

export interface GuardProxy {
  port: number;
  url: string;
  stats: GuardProxyStats;
  close: () => Promise<void>;
}

const MAX_HEAD_BYTES = 16 * 1024;
const HOP_BY_HOP = /^(?:proxy-connection|proxy-authorization|connection|keep-alive)$/i;

function reply(socket: net.Socket, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
}

function splitHostPort(target: string, defaultPort: number): { host: string; port: number } | null {
  const match = target.match(/^(\[[^\]]+\]|[^:]+)(?::(\d{1,5}))?$/);
  if (!match) return null;
  const port = match[2] ? Number(match[2]) : defaultPort;
  if (port < 1 || port > 65_535) return null;
  return { host: match[1]!, port };
}

function proxyAuthHeader(upstream: URL): string[] {
  if (!upstream.username) return [];
  const credentials = `${decodeURIComponent(upstream.username)}:${decodeURIComponent(upstream.password)}`;
  return [`Proxy-Authorization: Basic ${Buffer.from(credentials).toString('base64')}`];
}

/**
 * Local forward proxy that every Chromium request goes through. Each target is resolved and must be a
 * public address; the connection is then made to that exact IP, so redirects, subresources and page
 * JavaScript can never reach the container network, the host, or cloud metadata endpoints.
 */
export async function startGuardProxy(options: GuardProxyOptions): Promise<GuardProxy> {
  const maxBytes = options.maxBytesPerConnection ?? 15 * 1024 * 1024;
  const idleMs = options.idleTimeoutMs ?? 30_000;
  const connect = options.connect ?? ((host, port) => net.connect(port, host));
  const upstream = options.upstream ?? null;
  const stats: GuardProxyStats = { allowed: 0, blocked: [], bytes: 0 };
  const sockets = new Set<net.Socket>();

  const pipeBoth = (client: net.Socket, remote: net.Socket, initial?: Buffer) => {
    let received = 0;
    const count = (chunk: Buffer) => {
      received += chunk.length;
      stats.bytes += chunk.length;
      if (received > maxBytes) {
        remote.destroy();
        client.destroy();
      }
    };
    if (initial?.length) {
      count(initial);
      client.write(initial);
    }
    remote.on('data', count);
    remote.pipe(client);
    client.pipe(remote);
    client.resume();
  };

  const handle = async (client: net.Socket, headText: string, rest: Buffer) => {
    const [requestLine = '', ...headerLines] = headText.split('\r\n');
    const [method = '', target = '', version = 'HTTP/1.1'] = requestLine.split(' ');
    const isConnect = method.toUpperCase() === 'CONNECT';

    let host: string;
    let port: number;
    let url: URL | null = null;
    if (isConnect) {
      const parsed = splitHostPort(target, 443);
      if (!parsed) return reply(client, 400, 'Bad Request');
      ({ host, port } = parsed);
    } else {
      try {
        url = new URL(target);
      } catch {
        return reply(client, 400, 'Bad Request');
      }
      if (url.protocol !== 'http:') return reply(client, 400, 'Bad Request');
      host = url.hostname;
      port = Number(url.port || 80);
    }

    const check = await resolvePublicTarget(host, options.lookup);
    if (!check.ok) {
      stats.blocked.push({ host, reason: check.reason });
      return reply(client, 403, 'Forbidden');
    }
    stats.allowed += 1;

    const headers = headerLines.filter((line) => line && !HOP_BY_HOP.test(line.split(':')[0]!.trim()));
    const remote = upstream
      ? connect(upstream.hostname, Number(upstream.port || 80))
      : connect(check.address, port);
    sockets.add(remote);
    client.on('close', () => remote.destroy());
    remote.setTimeout(idleMs, () => remote.destroy());
    remote.on('close', () => {
      sockets.delete(remote);
      client.destroy();
    });
    let established = false;
    remote.on('error', () => {
      if (!established) reply(client, 502, 'Bad Gateway');
      else client.destroy();
    });

    remote.on('connect', () => {
      if (isConnect && upstream) {
        remote.write([`CONNECT ${host}:${port} HTTP/1.1`, `Host: ${host}:${port}`, ...proxyAuthHeader(upstream), '', ''].join('\r\n'));
        let answer = Buffer.alloc(0);
        const onAnswer = (chunk: Buffer) => {
          answer = Buffer.concat([answer, chunk]);
          const end = answer.indexOf('\r\n\r\n');
          if (end === -1) {
            if (answer.length > MAX_HEAD_BYTES) remote.destroy();
            return;
          }
          remote.off('data', onAnswer);
          if (!/^HTTP\/1\.[01] 200/.test(answer.subarray(0, end).toString('latin1'))) {
            established = true;
            reply(client, 502, 'Bad Gateway');
            remote.destroy();
            return;
          }
          established = true;
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (rest.length) remote.write(rest);
          pipeBoth(client, remote, answer.subarray(end + 4));
        };
        remote.on('data', onAnswer);
        return;
      }

      established = true;
      if (isConnect) {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (rest.length) remote.write(rest);
      } else {
        const requestTarget = upstream ? url!.href : `${url!.pathname}${url!.search}`;
        const hostHeader = headers.some((line) => /^host:/i.test(line)) ? [] : [`Host: ${url!.host}`];
        const authHeader = upstream ? proxyAuthHeader(upstream) : [];
        remote.write(
          [`${method} ${requestTarget} ${version}`, ...hostHeader, ...headers, ...authHeader, 'Connection: close', '', ''].join('\r\n')
        );
        if (rest.length) remote.write(rest);
      }
      pipeBoth(client, remote);
    });
  };

  const server = net.createServer((client) => {
    sockets.add(client);
    client.setTimeout(idleMs, () => client.destroy());
    client.on('close', () => sockets.delete(client));
    client.on('error', () => {});
    let head = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end === -1) {
        if (head.length > MAX_HEAD_BYTES) reply(client, 431, 'Request Header Fields Too Large');
        return;
      }
      client.off('data', onData);
      client.pause();
      const headText = head.subarray(0, end).toString('latin1');
      handle(client, headText, head.subarray(end + 4)).catch(() => client.destroy());
    };
    client.on('data', onData);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    stats,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
