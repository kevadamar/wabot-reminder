/**
 * Link Inspector: opens links from chat messages in headless Chromium (as Chrome on Android) and
 * reports what the page does. Runs as its own container; the bot calls POST /inspect.
 *
 *   LINK_INSPECTOR_TOKEN=$(openssl rand -hex 32) bun run src/link-inspector/main.ts
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { chromium, type Browser } from 'playwright-core';
import { createDohLookup } from './doh.ts';
import { inspectUrl } from './inspect.ts';
import { handleInspectorRequest } from './server.ts';

const env = process.env;
const token = env.LINK_INSPECTOR_TOKEN?.trim() || '';
if (token.length < 16) {
  console.error('❌ LINK_INSPECTOR_TOKEN wajib diisi (minimal 16 karakter). Contoh: openssl rand -hex 32');
  process.exit(1);
}

const readInt = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(env[name]);
  return Number.isFinite(value) && value >= min && value <= max ? Math.round(value) : fallback;
};

let upstreamProxy: URL | null = null;
if (env.LINK_CHECK_PROXY_URL?.trim()) {
  try {
    upstreamProxy = new URL(env.LINK_CHECK_PROXY_URL.trim());
    if (upstreamProxy.protocol !== 'http:') throw new Error('protocol');
  } catch {
    console.error('❌ LINK_CHECK_PROXY_URL harus berupa http://[user:pass@]host:port (proxy HTTP dengan dukungan CONNECT).');
    process.exit(1);
  }
}

const dnsMode = env.INSPECTOR_DNS?.trim().toLowerCase() || 'system';
if (dnsMode !== 'system' && dnsMode !== 'doh') {
  console.error('❌ INSPECTOR_DNS harus "system" atau "doh".');
  process.exit(1);
}
const dohUrl = env.INSPECTOR_DOH_URL?.trim() || 'https://1.1.1.1/dns-query';
if (dnsMode === 'doh' && !dohUrl.startsWith('https://')) {
  console.error('❌ INSPECTOR_DOH_URL harus https:// (endpoint DNS-over-HTTPS JSON, misalnya https://1.1.1.1/dns-query).');
  process.exit(1);
}

const options = {
  lookup:
    dnsMode === 'doh'
      ? createDohLookup(dohUrl)
      : (host: string) => dnsLookup(host, { all: true, verbatim: true }),
  upstreamProxy,
  navigationTimeoutMs: readInt('INSPECTOR_NAV_TIMEOUT_MS', 15_000, 3_000, 60_000),
  settleMs: readInt('INSPECTOR_SETTLE_MS', 1_500, 0, 10_000),
  maxTextChars: readInt('INSPECTOR_MAX_TEXT_CHARS', 3_000, 500, 20_000),
};

let browserPromise: Promise<Browser> | null = null;
function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium
    .launch({
      channel: 'chromium',
      headless: true,
      chromiumSandbox: env.INSPECTOR_CHROMIUM_SANDBOX === 'true',
      // Contexts always set the guard proxy; this dead default makes any context without it fail closed.
      proxy: { server: 'http://127.0.0.1:9' },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-quic',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--no-first-run',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    })
    .then((browser) => {
      browser.on('disconnected', () => {
        browserPromise = null;
      });
      return browser;
    })
    .catch((err) => {
      browserPromise = null;
      throw err;
    });
  return browserPromise;
}

const state = { inFlight: 0 };
const port = readInt('INSPECTOR_PORT', 7870, 1, 65_535);
const hostname = env.INSPECTOR_HOST || '0.0.0.0';

await getBrowser();
Bun.serve({
  port,
  hostname,
  idleTimeout: Math.min(255, Math.ceil((options.navigationTimeoutMs + options.settleMs * 2 + 10_000) / 1000)),
  async fetch(req) {
    return handleInspectorRequest(req, {
      token,
      maxConcurrent: readInt('INSPECTOR_MAX_CONCURRENT', 2, 1, 8),
      state,
      inspect: async (url) => inspectUrl(await getBrowser(), url, options),
      log: (line) => console.log(line),
    });
  },
});
console.log(
  `✅ Link Inspector siap di http://${hostname}:${port} (Chromium ${(await getBrowser()).version()}, DNS ${dnsMode === 'doh' ? `DoH ${new URL(dohUrl).host}` : 'sistem'}${upstreamProxy ? `, lewat proxy ${upstreamProxy.host}` : ''})`
);
