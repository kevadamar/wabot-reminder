/** Wire format of `POST /inspect`, shared by the inspector service and the bot client. */

export interface PageForms {
  total: number;
  password: number;
  otp: number;
  card: number;
  pin: number;
  /** Hosts that forms submit to, other than the page's own host. */
  externalActionHosts: string[];
}

export type InspectionError =
  | 'invalid_url'
  | 'blocked_target'
  | 'dns_failed'
  | 'tls_error'
  | 'timeout'
  | 'navigation_failed';

export interface InspectionResult {
  requestedUrl: string;
  finalUrl: string | null;
  /** Main-frame URLs in the order the browser visited them (HTTP and JavaScript redirects). */
  redirectChain: string[];
  httpStatus: number | null;
  title: string;
  description: string;
  /** Visible page text, whitespace-collapsed and truncated. */
  text: string;
  forms: PageForms;
  /** Set when the link starts a file download (e.g. an APK) instead of showing a page. */
  download: { filename: string } | null;
  /** Requests the guard proxy refused (internal hosts the page tried to reach). */
  blockedRequests: { host: string; reason: string }[];
  screenshot: { mimeType: 'image/jpeg'; data: string } | null;
  error: InspectionError | null;
  errorDetail: string | null;
  durationMs: number;
}

export const EMPTY_FORMS: PageForms = { total: 0, password: 0, otp: 0, card: 0, pin: 0, externalActionHosts: [] };
