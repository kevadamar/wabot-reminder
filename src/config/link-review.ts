import { inspect } from 'node:util';
import { assertProviderUrl, LlmConfigError, normalizeAllowlistEntry, readInt } from './llm.js';
import { BRAND_DOMAINS } from '../services/risk.js';

/**
 * Domains whose links are not inspected (subdomains included). Platforms that host arbitrary user
 * pages (Google Sites/Docs/Forms, Notion, GitHub Pages, …) are deliberately absent; see also
 * USER_CONTENT_HOSTS in the link review service.
 */
const DEFAULT_ALLOWLIST = [
  'google.com', 'youtube.com', 'youtu.be', 'whatsapp.com', 'wa.me', 'instagram.com', 'facebook.com',
  'x.com', 'twitter.com', 'tiktok.com', 'linkedin.com', 'wikipedia.org', 'zoom.us', 'microsoft.com',
  'apple.com', 'kompas.com', 'detik.com', 'grab.com', 'traveloka.com', 'tiket.com',
  ...Object.values(BRAND_DOMAINS).flat(),
];

export interface LinkReviewConfig {
  enabled: boolean;
  inspectorUrl: string | null;
  timeoutMs: number;
  safeBrowsing: boolean;
  allowlist: string[];
  maxLinks: number;
  warnings: string[];
  reveal(): { inspectorToken: string; safeBrowsingKey: string };
  toJSON(): unknown;
}

export function loadLinkReviewConfig(env: Record<string, string | undefined>): LinkReviewConfig {
  const warnings: string[] = [];
  const requested = env.LINK_CHECK_ENABLED?.trim().toLowerCase() === 'true';
  const allowHttp = new Set(
    (env.LLM_INSECURE_HOST_ALLOWLIST?.trim() || 'localhost,127.0.0.1,host.docker.internal')
      .split(',')
      .map(normalizeAllowlistEntry)
      .filter(Boolean)
  );

  // Inspector settings are only validated when the check is on, so a compose default URL never blocks startup.
  const inspectorRaw = requested ? env.LINK_INSPECTOR_URL?.trim() || '' : '';
  const inspectorToken = env.LINK_INSPECTOR_TOKEN?.trim() || '';
  const inspectorUrl = inspectorRaw ? assertProviderUrl(inspectorRaw, allowHttp, 'LINK_INSPECTOR_URL') : null;
  if (inspectorUrl && inspectorToken.length < 16) {
    throw new LlmConfigError('LINK_INSPECTOR_TOKEN wajib diisi (minimal 16 karakter, sama dengan token di service link-inspector)');
  }
  const safeBrowsingKey = env.GOOGLE_SAFE_BROWSING_API_KEY?.trim() || '';

  let enabled = requested;
  if (requested && !inspectorUrl && !safeBrowsingKey) {
    warnings.push('LINK_CHECK_ENABLED=true tapi LINK_INSPECTOR_URL dan GOOGLE_SAFE_BROWSING_API_KEY kosong; cek link dimatikan');
    enabled = false;
  } else if (requested && !inspectorUrl) {
    warnings.push('LINK_INSPECTOR_URL kosong; cek link hanya memakai Google Safe Browsing tanpa membuka halamannya');
  }

  const extra = (env.LINK_CHECK_ALLOWLIST ?? '').split(',').map(normalizeAllowlistEntry).filter(Boolean);
  const view = {
    enabled,
    inspectorUrl,
    timeoutMs: readInt(env, 'LINK_CHECK_TIMEOUT_MS', 30_000, 5_000, 120_000),
    safeBrowsing: Boolean(safeBrowsingKey),
    allowlist: [...new Set([...DEFAULT_ALLOWLIST, ...extra])],
    maxLinks: readInt(env, 'LINK_CHECK_MAX_LINKS', 2, 1, 5),
    warnings,
  };
  const config: LinkReviewConfig = {
    ...view,
    reveal: () => ({ inspectorToken, safeBrowsingKey }),
    toJSON: () => ({ ...view, allowlist: view.allowlist.length }),
  };
  Object.defineProperty(config, inspect.custom, { value: () => config.toJSON() });
  return config;
}

let cached: LinkReviewConfig | null = null;

export function getLinkReviewConfig(): LinkReviewConfig {
  if (!cached) {
    cached = loadLinkReviewConfig(process.env);
    for (const warning of cached.warnings) console.warn(`⚠️ [LinkCheck] ${warning}`);
  }
  return cached;
}

export function resetLinkReviewConfigCache(): void {
  cached = null;
}

export function formatLinkReviewStartupLog(config: LinkReviewConfig): string {
  if (!config.enabled) return '🔎 Cek link: nonaktif (LINK_CHECK_ENABLED)';
  const parts = [config.inspectorUrl ? `inspector ${config.inspectorUrl}` : 'tanpa inspector'];
  parts.push(config.safeBrowsing ? 'Safe Browsing aktif' : 'tanpa Safe Browsing');
  return `🔎 Cek link: aktif · ${parts.join(' · ')} · maks ${config.maxLinks} link/pesan`;
}
