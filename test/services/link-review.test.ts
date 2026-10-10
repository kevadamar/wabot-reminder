import { afterEach, describe, expect, it } from 'bun:test';
import {
  callInspector,
  checkSafeBrowsing,
  extractReviewableLinks,
  resetLinkReviewState,
  reviewLink,
  runLinkFollowUp,
  setLinkReviewDepsForTests,
  settleLinkReviews,
  type LinkReview,
  type LinkReviewDeps,
} from '../../src/services/link-review.js';
import { parseLinkReviewOutput } from '../../src/services/llm/schemas.js';
import { EMPTY_FORMS, type InspectionResult } from '../../src/link-inspector/types.js';
import { loadLinkReviewConfig } from '../../src/config/link-review.js';

const allowlist = loadLinkReviewConfig({ LINK_CHECK_ALLOWLIST: 'esb.id' }).allowlist;

function page(overrides: Partial<InspectionResult> = {}): InspectionResult {
  return {
    requestedUrl: 'https://toko-baru.com/',
    finalUrl: 'https://toko-baru.com/',
    redirectChain: [],
    httpStatus: 200,
    title: 'Toko Baru',
    description: '',
    text: 'Selamat datang di toko kami',
    forms: EMPTY_FORMS,
    download: null,
    blockedRequests: [],
    screenshot: { mimeType: 'image/jpeg', data: Buffer.from('jpeg').toString('base64') },
    error: null,
    errorDetail: null,
    durationMs: 900,
    ...overrides,
  };
}

function deps(overrides: Partial<LinkReviewDeps> = {}): LinkReviewDeps & { calls: Record<string, number> } {
  const calls = { inspect: 0, safeBrowsing: 0, judge: 0 };
  return {
    calls,
    inspect: async (url) => {
      calls.inspect += 1;
      return page({ requestedUrl: url, finalUrl: url });
    },
    safeBrowsing: async () => {
      calls.safeBrowsing += 1;
      return [];
    },
    judge: async () => {
      calls.judge += 1;
      return { verdict: { category: 'none', reason: null }, summary: 'Halaman toko online biasa' };
    },
    ...overrides,
  };
}

afterEach(() => {
  setLinkReviewDepsForTests(null);
  resetLinkReviewState();
});

describe('extractReviewableLinks', () => {
  it('skips allowlisted domains but never user-content hosts or redirectors', () => {
    const text = [
      'https://www.google.com/search?q=x',
      'https://docs.google.com/forms/d/abc',
      'https://www.google.com/url?q=https://evil.xyz',
      'https://esb.id/pricing',
      'https://promo-baru.xyz/klaim',
    ].join(' ');
    expect(extractReviewableLinks(text, { allowlist, maxLinks: 5 })).toEqual([
      'https://docs.google.com/forms/d/abc',
      'https://www.google.com/url?q=https://evil.xyz',
      'https://promo-baru.xyz/klaim',
    ]);
  });

  it('caps the number of links and ignores non-public hosts', () => {
    const text = 'a.xyz b.xyz c.xyz http://localhost:3000 http://10.0.0.1/admin';
    expect(extractReviewableLinks(text, { allowlist, maxLinks: 2 })).toEqual(['http://a.xyz/', 'http://b.xyz/']);
  });
});

describe('reviewLink', () => {
  it('marks a normal page as safe and keeps the LLM summary', async () => {
    const d = deps();
    const review = await reviewLink('https://toko-baru.com/', d);
    expect(review.status).toBe('safe');
    expect(review.title).toBe('Toko Baru');
    expect(review.summary).toBe('Halaman toko online biasa');
    expect(review.checks).toEqual({ inspected: true, safeBrowsing: 'clean', llm: true });
  });

  it('flags dangerous pages from page signals even when the LLM says none', async () => {
    const d = deps({
      inspect: async (url) => page({ requestedUrl: url, finalUrl: 'https://login-aman.xyz/', title: 'KlikBCA Login', forms: { ...EMPTY_FORMS, total: 1, password: 1 } }),
    });
    const review = await reviewLink('https://bit.ly/abc', d);
    expect(review.status).toBe('dangerous');
    expect(review.risk.categories).toContain('phishing');
    expect(review.finalHost).toBe('login-aman.xyz');
  });

  it('lets the LLM raise the verdict and Safe Browsing flag a page', async () => {
    const byLlm = await reviewLink(
      'https://toko-baru.com/',
      deps({ judge: async () => ({ verdict: { category: 'scam', reason: 'Investasi bodong' }, summary: 'Ajakan investasi' }) })
    );
    expect(byLlm.status).toBe('dangerous');
    expect(byLlm.risk.reasons.join(' ')).toContain('Investasi bodong');

    resetLinkReviewState();
    const bySb = await reviewLink('https://toko-baru.com/', deps({ safeBrowsing: async (urls) => urls.map((url) => ({ url, category: 'malware' as const })) }));
    expect(bySb.status).toBe('dangerous');
    expect(bySb.checks.safeBrowsing).toBe('match');
  });

  it('checks every URL in the redirect chain with Safe Browsing', async () => {
    let checked: string[] = [];
    await reviewLink(
      'https://bit.ly/x',
      deps({
        inspect: async () => page({ requestedUrl: 'https://bit.ly/x', redirectChain: ['https://bit.ly/x'], finalUrl: 'https://tujuan.com/' }),
        safeBrowsing: async (urls) => {
          checked = urls;
          return [];
        },
      })
    );
    expect(checked).toEqual(['https://bit.ly/x', 'https://tujuan.com/']);
  });

  it('reports unreachable pages without calling the LLM', async () => {
    const d = deps({ inspect: async (url) => page({ requestedUrl: url, finalUrl: null, error: 'dns_failed', screenshot: null, title: '' }) });
    const review = await reviewLink('https://tidak-ada.com/', d);
    expect(review.status).toBe('unreachable');
    expect(d.calls.judge).toBe(0);
  });

  it('flags a link the inspector blocked for reaching the internal network', async () => {
    const d = deps({
      inspect: async (url) =>
        page({ requestedUrl: url, finalUrl: null, redirectChain: [url, 'https://router.promo-baru.xyz/'], error: 'blocked_target', screenshot: null, title: '' }),
    });
    const review = await reviewLink('https://promo-baru.xyz/', d);
    expect(review.status).toBe('dangerous');
    expect(d.calls.judge).toBe(0);
  });

  it('caches finished reviews per URL', async () => {
    const d = deps();
    await reviewLink('https://toko-baru.com/', d);
    await reviewLink('https://toko-baru.com/', d);
    expect(d.calls.inspect).toBe(1);
  });
});

describe('runLinkFollowUp', () => {
  it('reviews links in the background and hands the results to the callback', async () => {
    setLinkReviewDepsForTests(deps());
    const results: LinkReview[][] = [];
    const started = runLinkFollowUp('cek promo-baru.xyz besok', async (reviews) => {
      results.push(reviews);
    });
    expect(started).toBe(true);
    await settleLinkReviews();
    expect(results[0]?.map((r) => r.status)).toEqual(['safe']);
  });

  it('does nothing without reviewable links or when disabled', async () => {
    setLinkReviewDepsForTests(deps());
    expect(runLinkFollowUp('rapat jam 3 di https://meet.google.com/abc', async () => {})).toBe(false);
    setLinkReviewDepsForTests(null);
    expect(runLinkFollowUp('cek promo-baru.xyz', async () => {})).toBe(false);
  });

  it('never throws when the callback fails', async () => {
    setLinkReviewDepsForTests(deps());
    runLinkFollowUp('cek promo-baru.xyz', async () => {
      throw new Error('socket closed');
    });
    await settleLinkReviews();
  });
});

describe('inspector and Safe Browsing clients', () => {
  it('posts to the inspector with the bearer token and request id', async () => {
    let seen: Request | null = null;
    const result = await callInspector('https://toko-baru.com/', {
      baseUrl: 'http://link-inspector:7870',
      token: 'secret-token-1234567',
      timeoutMs: 1000,
      requestId: 'link-1',
      fetchImpl: async (input, init) => {
        seen = new Request(input as string, init);
        return Response.json(page());
      },
    });
    expect(result?.title).toBe('Toko Baru');
    const req = seen as unknown as Request;
    expect(req.url).toBe('http://link-inspector:7870/inspect');
    expect(req.headers.get('authorization')).toBe('Bearer secret-token-1234567');
    expect(req.headers.get('x-request-id')).toBe('link-1');
  });

  it('returns null when the inspector fails or replies with junk', async () => {
    const opts = { baseUrl: 'http://x:1', token: 't', timeoutMs: 1000, requestId: 'r' };
    expect(await callInspector('https://a.com', { ...opts, fetchImpl: async () => new Response('busy', { status: 429 }) })).toBeNull();
    expect(await callInspector('https://a.com', { ...opts, fetchImpl: async () => Response.json({ hello: 1 }) })).toBeNull();
    expect(await callInspector('https://a.com', { ...opts, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } })).toBeNull();
  });

  it('maps Safe Browsing threat types and returns null on errors', async () => {
    let body: any = null;
    const matches = await checkSafeBrowsing(['https://a.xyz/', 'https://b.xyz/'], {
      apiKey: 'k',
      fetchImpl: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({
          matches: [
            { threatType: 'SOCIAL_ENGINEERING', threat: { url: 'https://a.xyz/' } },
            { threatType: 'UNWANTED_SOFTWARE', threat: { url: 'https://b.xyz/' } },
          ],
        });
      },
    });
    expect(matches).toEqual([
      { url: 'https://a.xyz/', category: 'phishing' },
      { url: 'https://b.xyz/', category: 'malware' },
    ]);
    expect(body.threatInfo.threatEntries).toEqual([{ url: 'https://a.xyz/' }, { url: 'https://b.xyz/' }]);
    expect(await checkSafeBrowsing(['https://a.xyz/'], { apiKey: 'k', fetchImpl: async () => Response.json({}) })).toEqual([]);
    expect(await checkSafeBrowsing(['https://a.xyz/'], { apiKey: 'k', fetchImpl: async () => new Response('', { status: 403 }) })).toBeNull();
  });
});

describe('parseLinkReviewOutput', () => {
  it('parses verdicts, strips links from the summary, and rejects bad categories', () => {
    expect(parseLinkReviewOutput('{"category":"phishing","reason":"Login palsu","summary":"Halaman login https://x.xyz"}')).toEqual({
      verdict: { category: 'phishing', reason: 'Login palsu' },
      summary: 'Halaman login',
    });
    expect(() => parseLinkReviewOutput('{"category":"hack","summary":"x"}')).toThrow();
  });
});
