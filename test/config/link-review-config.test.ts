import { describe, expect, it } from 'bun:test';
import { loadLinkReviewConfig } from '../../src/config/link-review.js';

const token = 't'.repeat(32);

describe('Link review config', () => {
  it('is disabled by default', () => {
    const config = loadLinkReviewConfig({});
    expect(config.enabled).toBe(false);
    expect(config.maxLinks).toBe(2);
  });

  it('ignores a default inspector URL without a token while the check is off', () => {
    expect(loadLinkReviewConfig({ LINK_INSPECTOR_URL: 'http://link-inspector:7870' }).enabled).toBe(false);
  });

  it('enables the inspector with a URL and token', () => {
    const config = loadLinkReviewConfig({
      LINK_CHECK_ENABLED: 'true',
      LINK_INSPECTOR_URL: 'http://link-inspector:7870/',
      LINK_INSPECTOR_TOKEN: token,
    });
    expect(config.enabled).toBe(true);
    expect(config.inspectorUrl).toBe('http://link-inspector:7870');
    expect(config.reveal()).toEqual({ inspectorToken: token, safeBrowsingKey: '' });
    expect(JSON.stringify(config)).not.toContain(token);
  });

  it('rejects an inspector URL without a strong token or over plain http to a public host', () => {
    expect(() =>
      loadLinkReviewConfig({ LINK_CHECK_ENABLED: 'true', LINK_INSPECTOR_URL: 'http://link-inspector:7870', LINK_INSPECTOR_TOKEN: 'short' })
    ).toThrow(/LINK_INSPECTOR_TOKEN/);
    expect(() =>
      loadLinkReviewConfig({ LINK_CHECK_ENABLED: 'true', LINK_INSPECTOR_URL: 'http://inspector.example.com', LINK_INSPECTOR_TOKEN: token })
    ).toThrow(/https/);
  });

  it('runs with Safe Browsing only, and turns itself off when nothing is configured', () => {
    const sbOnly = loadLinkReviewConfig({ LINK_CHECK_ENABLED: 'true', GOOGLE_SAFE_BROWSING_API_KEY: 'key-123' });
    expect(sbOnly.enabled).toBe(true);
    expect(sbOnly.inspectorUrl).toBeNull();
    expect(sbOnly.warnings.join(' ')).toContain('LINK_INSPECTOR_URL');

    const nothing = loadLinkReviewConfig({ LINK_CHECK_ENABLED: 'true' });
    expect(nothing.enabled).toBe(false);
    expect(nothing.warnings.length).toBeGreaterThan(0);
  });

  it('extends the default allowlist with LINK_CHECK_ALLOWLIST entries', () => {
    const config = loadLinkReviewConfig({ LINK_CHECK_ALLOWLIST: ' https://esb.id/ , ayomakan.com ' });
    expect(config.allowlist).toContain('esb.id');
    expect(config.allowlist).toContain('ayomakan.com');
    expect(config.allowlist).toContain('google.com');
  });
});
