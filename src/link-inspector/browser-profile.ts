/**
 * A WhatsApp link is usually opened on a phone, and many phishing / judol kits only show their real
 * page to mobile visitors. The profile mimics Chrome on Android, including client hints, so the
 * user agent, `navigator.userAgentData` and `Sec-CH-UA-*` headers all agree with each other.
 */
export function mobileChromeProfile(browserVersion: string) {
  const major = browserVersion.split('.')[0] || '0';
  const userAgent = `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36`;
  /** Plain list: Chrome adds the q-weights itself, so `id-ID,id;q=0.9,...` reaches the server. */
  const acceptLanguage = 'id-ID,id,en-US,en';
  const brands = [
    { brand: 'Google Chrome', version: major },
    { brand: 'Chromium', version: major },
    { brand: 'Not.A/Brand', version: '99' },
  ];
  return {
    userAgent,
    acceptLanguage,
    context: {
      userAgent,
      viewport: { width: 412, height: 915 },
      screen: { width: 412, height: 915 },
      deviceScaleFactor: 2.625,
      isMobile: true,
      hasTouch: true,
      locale: 'id-ID',
      timezoneId: 'Asia/Jakarta',
    },
    /** For CDP `Emulation.setUserAgentOverride`; Playwright alone leaves the headless client hints. */
    userAgentMetadata: {
      brands,
      fullVersionList: brands.map((b) => ({ brand: b.brand, version: b.brand === 'Not.A/Brand' ? '99.0.0.0' : browserVersion })),
      fullVersion: browserVersion,
      platform: 'Android',
      platformVersion: '14.0.0',
      architecture: '',
      model: 'Pixel 7',
      mobile: true,
      bitness: '',
      wow64: false,
    },
    navigatorPlatform: 'Linux armv81',
  };
}
