import { describe, expect, it } from 'bun:test';
import { mobileChromeProfile } from '../../src/link-inspector/browser-profile.ts';

describe('mobileChromeProfile', () => {
  const profile = mobileChromeProfile('156.0.8078.4');

  it('looks like Chrome on an Android phone, not a headless browser', () => {
    expect(profile.userAgent).toBe(
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36'
    );
    expect(profile.userAgent).not.toMatch(/headless/i);
    expect(profile.context).toMatchObject({ isMobile: true, hasTouch: true, locale: 'id-ID', timezoneId: 'Asia/Jakarta' });
  });

  it('keeps client hints consistent with the user agent', () => {
    const meta = profile.userAgentMetadata;
    expect(meta.mobile).toBe(true);
    expect(meta.platform).toBe('Android');
    expect(meta.brands.map((b) => b.brand)).toContain('Google Chrome');
    expect(meta.brands.find((b) => b.brand === 'Google Chrome')?.version).toBe('156');
    expect(meta.fullVersion).toBe('156.0.8078.4');
    expect(JSON.stringify(meta)).not.toMatch(/headless/i);
  });

  it('lists Indonesian first, without q-weights (Chrome adds those itself)', () => {
    expect(profile.acceptLanguage).toBe('id-ID,id,en-US,en');
    expect(profile.acceptLanguage).not.toContain('q=');
  });
});
