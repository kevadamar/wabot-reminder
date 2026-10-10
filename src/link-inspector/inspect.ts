import type { Browser, BrowserContext, Page } from 'playwright-core';
import { mobileChromeProfile } from './browser-profile.ts';
import { startGuardProxy } from './guard-proxy.ts';
import type { LookupFn } from './ip-guard.ts';
import { EMPTY_FORMS, type InspectionError, type InspectionResult, type PageForms } from './types.ts';

export interface InspectOptions {
  lookup: LookupFn;
  upstreamProxy: URL | null;
  navigationTimeoutMs: number;
  /** Extra wait after load so JavaScript redirects and late-rendered content show up. */
  settleMs: number;
  maxTextChars: number;
}

/** Runs inside the page; a string so the bot's tsconfig (no DOM lib) never type-checks browser globals. */
const EXTRACT_PAGE = `(() => {
  const attr = (el) => [el.name, el.id, el.autocomplete, el.placeholder, el.getAttribute('aria-label')].join(' ').toLowerCase();
  const inputs = Array.from(document.querySelectorAll('input'));
  const forms = Array.from(document.forms);
  const meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
  const actionHosts = [...new Set(forms.map((form) => {
    try { return new URL(form.getAttribute('action') || '', location.href).hostname; } catch { return ''; }
  }).filter((host) => host && host !== location.hostname))];
  return {
    title: document.title || '',
    description: (meta && meta.getAttribute('content')) || '',
    text: (document.body && document.body.innerText) || '',
    forms: {
      total: forms.length,
      password: inputs.filter((i) => i.type === 'password').length,
      otp: inputs.filter((i) => i.autocomplete === 'one-time-code' || /otp|one-time|kode verifikasi|verification code/.test(attr(i))).length,
      card: inputs.filter((i) => /cc-|card|kartu|cvv|cvc/.test(attr(i))).length,
      pin: inputs.filter((i) => /\\bpin\\b/.test(attr(i))).length,
      externalActionHosts: actionHosts.slice(0, 5),
    },
  };
})()`;

function collapse(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

const bareHost = (host: string) => host.replace(/^\[|\]$/g, '').toLowerCase();

/**
 * Only blocks on hosts the main frame navigated to (the link itself or a redirect hop) explain a
 * failed navigation; a refused image or script on an otherwise normal page does not.
 */
export function classifyNavigationError(
  message: string,
  blocked: readonly { host: string; reason: string }[],
  navigatedHosts: ReadonlySet<string>
): InspectionError {
  const targetBlock = blocked.find((b) => navigatedHosts.has(bareHost(b.host)));
  if (targetBlock?.reason === 'dns_failed') return 'dns_failed';
  if (targetBlock) return 'blocked_target';
  if (/ERR_CERT|SSL|ERR_BAD_SSL/i.test(message)) return 'tls_error';
  if (/Timeout|timed out/i.test(message)) return 'timeout';
  return 'navigation_failed';
}

async function applyMobileHints(page: Page, profile: ReturnType<typeof mobileChromeProfile>): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: profile.userAgent,
    acceptLanguage: profile.acceptLanguage,
    platform: profile.navigatorPlatform,
    userAgentMetadata: profile.userAgentMetadata,
  });
}

/**
 * Opens one URL in a fresh, cookie-less browser context whose traffic all goes through the guard
 * proxy. Downloads are cancelled, dialogs dismissed, popups closed, service workers blocked.
 */
export async function inspectUrl(browser: Browser, rawUrl: string, options: InspectOptions): Promise<InspectionResult> {
  const started = Date.now();
  const result: InspectionResult = {
    requestedUrl: rawUrl,
    finalUrl: null,
    redirectChain: [],
    httpStatus: null,
    title: '',
    description: '',
    text: '',
    forms: { ...EMPTY_FORMS },
    download: null,
    blockedRequests: [],
    screenshot: null,
    error: null,
    errorDetail: null,
    durationMs: 0,
  };

  let url: URL;
  try {
    url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme');
  } catch {
    result.error = 'invalid_url';
    result.durationMs = Date.now() - started;
    return result;
  }

  const proxy = await startGuardProxy({ lookup: options.lookup, upstream: options.upstreamProxy });
  const profile = mobileChromeProfile(browser.version());
  let context: BrowserContext | null = null;

  try {
    context = await browser.newContext({
      ...profile.context,
      proxy: { server: proxy.url, bypass: '<-loopback>' },
      acceptDownloads: false,
      serviceWorkers: 'block',
      ignoreHTTPSErrors: false,
      permissions: [],
    });
    const page = await context.newPage();
    await applyMobileHints(page, profile);
    context.on('page', (popup) => {
      if (popup !== page) popup.close().catch(() => {});
    });
    page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
    page.on('download', (download) => {
      result.download = { filename: download.suggestedFilename().slice(0, 200) };
      download.cancel().catch(() => {});
    });
    // Every HTTP and JavaScript redirect is a new main-frame navigation request, including hops the
    // guard refuses, so the chain never ends in a `chrome-error://` page.
    const navigatedHosts = new Set<string>();
    page.on('request', (request) => {
      if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
      const target = request.url();
      try {
        navigatedHosts.add(bareHost(new URL(target).hostname));
      } catch {}
      if (result.redirectChain.at(-1) !== target) result.redirectChain.push(target);
    });

    try {
      const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: options.navigationTimeoutMs });
      result.httpStatus = response?.status() ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!result.download && !/Download is starting/i.test(message)) {
        result.error = classifyNavigationError(message, proxy.stats.blocked, navigatedHosts);
        result.errorDetail = message.split('\n')[0]!.slice(0, 200);
      }
    }

    if (!result.download && result.error !== 'blocked_target' && result.error !== 'dns_failed') {
      await page.waitForLoadState('load', { timeout: options.settleMs }).catch(() => {});
      await page.waitForTimeout(options.settleMs);
      const current = page.url();
      if (current && current !== 'about:blank' && !current.startsWith('chrome-error://')) {
        result.finalUrl = current;
        try {
          const extracted = (await page.evaluate(EXTRACT_PAGE)) as {
            title: string;
            description: string;
            text: string;
            forms: PageForms;
          };
          result.title = collapse(extracted.title, 200);
          result.description = collapse(extracted.description, 300);
          result.text = collapse(extracted.text, options.maxTextChars);
          result.forms = extracted.forms;
        } catch {}
        result.screenshot = await page
          .screenshot({ type: 'jpeg', quality: 55, scale: 'css', timeout: 5000 })
          .then((buffer) => ({ mimeType: 'image/jpeg' as const, data: buffer.toString('base64') }))
          .catch(() => null);
        if (result.error === 'timeout' && (result.title || result.text)) result.error = null;
      }
    }
  } finally {
    result.blockedRequests = proxy.stats.blocked.slice(0, 20);
    await context?.close().catch(() => {});
    await proxy.close();
    result.durationMs = Date.now() - started;
  }
  return result;
}
