/**
 * Risky-content screening for task input: online gambling (judol), scams, phishing links and
 * malicious APKs. Two layers:
 *   1. Local, deterministic rules (always on, also when every LLM is down).
 *   2. An LLM verdict from the NLP / vision call, which can only ADD a flag. A message that
 *      tries to talk the model out of flagging it can never clear a local flag.
 * The result is used to warn the user and ask for confirmation, never to silently drop input.
 */

/** `blocked`: the page is a government / ISP block notice. Only local page rules set it, never the LLM. */
export type RiskCategory = 'gambling' | 'scam' | 'phishing' | 'malware' | 'blocked';
export type LlmRiskCategory = Exclude<RiskCategory, 'blocked'> | 'none';

export interface LlmRiskVerdict {
  category: LlmRiskCategory;
  reason: string | null;
}

export interface RiskAssessment {
  flagged: boolean;
  categories: RiskCategory[];
  reasons: string[];
}

export const RISK_CATEGORIES: readonly RiskCategory[] = ['malware', 'phishing', 'scam', 'gambling', 'blocked'];

const FLAG_THRESHOLD = 3;
const MAX_REASON_LENGTH = 140;

interface Rule {
  category: RiskCategory;
  weight: number;
  pattern: RegExp;
  reason: string;
}

const SECRET = String.raw`(?:otp|kode\s+(?:verifikasi|aktivasi|keamanan)|pin(?:\s+(?:atm|m-?banking))?|password|kata\s+sandi|cvv)`;
const SHARE = String.raw`(?:kirim(?:kan|in)?|berikan|kasih(?:kan)?|sebutkan|bagikan|share|forward|teruskan|minta)`;

const TEXT_RULES: Rule[] = [
  {
    category: 'gambling',
    weight: 3,
    pattern: /\b(?:gacor|maxwin|max\s+win|scatter|togel|judol|judi|kasino|casino|sbobet|parlay|sabung\s+ayam|mahjong\s+ways|gates\s+of\s+olympus|pragmatic\s+play|slot\s+online|situs\s+slot|akun\s+pro|bonus\s+new\s+member|freechip|freebet|link\s+alternatif|rtp\s+live|bandar\s+(?:togel|bola|slot))\b/,
    reason: 'Ada istilah khas judi online (gacor, maxwin, togel, dll.)',
  },
  { category: 'gambling', weight: 1, pattern: /\bslot\b/, reason: 'Menyebut "slot"' },
  { category: 'gambling', weight: 1, pattern: /\b(?:depo|wd|withdraw)\b/, reason: 'Menyebut depo / WD' },
  { category: 'gambling', weight: 1, pattern: /\b(?:bonus|jackpot|jp|cuan|hoki)\b/, reason: 'Iming-iming bonus / jackpot' },
  {
    category: 'scam',
    weight: 3,
    pattern: new RegExp(String.raw`\b${SHARE}\b[^.\n]{0,40}\b${SECRET}\b|\b${SECRET}\b[^.\n]{0,40}\b${SHARE}\b`),
    reason: 'Diminta membagikan OTP / PIN / password',
  },
  {
    category: 'scam',
    weight: 3,
    pattern: /\bselamat\W+(?:anda|kamu)\s+(?:terpilih|memenangkan|mendapatkan|berhak)|\bpemenang\s+(?:undian|hadiah|giveaway)\b|\bundian\s+berhadiah\b|\bklaim\s+hadiah\b|\bmemenangkan\s+(?:hadiah|undian|uang)\b/,
    reason: 'Pengumuman hadiah / undian yang tidak pernah kamu ikuti',
  },
  {
    category: 'scam',
    weight: 3,
    pattern: /\b(?:transfer|tf|bayar|kirim)\b[^.\n]{0,40}\b(?:biaya|ongkos)\s+(?:admin|administrasi|pajak|pencairan|aktivasi|asuransi)\b|\b(?:biaya|ongkos)\s+(?:admin|administrasi|pajak|pencairan|aktivasi|asuransi)\b[^.\n]{0,40}\b(?:pencairan|hadiah|transfer|tf)\b/,
    reason: 'Diminta transfer biaya admin / pajak untuk pencairan',
  },
  {
    category: 'scam',
    weight: 3,
    pattern: /\b(?:akun|rekening|kartu|nomor)\s+(?:(?:anda|kamu)\s+)?(?:akan\s+)?(?:diblokir|dinonaktifkan|ditangguhkan|dibekukan|hangus)\b/,
    reason: 'Ancaman akun / rekening akan diblokir',
  },
  {
    category: 'scam',
    weight: 3,
    pattern: /\b(?:profit|untung|keuntungan|return|imbal\s+hasil)\s+(?:pasti|dijamin|tetap|harian)\b|\b\d{1,3}\s*%\s*(?:per|\/)\s*(?:hari|minggu)\b|\b(?:investasi|trading)\b[^.\n]{0,30}\b(?:pasti\s+untung|tanpa\s+rugi|anti\s+rugi|dijamin)\b/,
    reason: 'Janji keuntungan pasti (ciri investasi bodong)',
  },
  {
    category: 'scam',
    weight: 3,
    pattern: /\b(?:kerja|tugas|job)\b[^.\n]{0,30}\b(?:like|follow|subscribe|review)\b[^.\n]{0,30}\b(?:dibayar|komisi|gaji|bayaran|cuan)\b/,
    reason: 'Lowongan "like / follow lalu dibayar"',
  },
  {
    category: 'scam',
    weight: 3,
    pattern: /\b(?:mama|mamah|papa|ibu|bapak|ayah|ma|pa)\b[^.\n]{0,20}\bganti\s+nomor\b|\bganti\s+nomor\b[^.\n]{0,40}\b(?:transfer|tf|pulsa|pinjam)\b|\b(?:mama|papa)\s+minta\s+(?:pulsa|uang)\b/,
    reason: 'Modus "ganti nomor / mama minta pulsa"',
  },
  {
    category: 'scam',
    weight: 2,
    pattern: /\b(?:pinjaman|pinjol|dana)\s+(?:cepat|kilat|instan|tanpa\s+jaminan|langsung\s+cair)\b/,
    reason: 'Tawaran pinjaman cepat cair',
  },
  {
    category: 'scam',
    weight: 1,
    pattern: /\b(?:segera|sekarang\s+juga|1\s*x\s*24\s+jam|hari\s+ini\s+terakhir)\b/,
    reason: 'Mendesak harus segera',
  },
  { category: 'malware', weight: 3, pattern: /\.apk\b/, reason: 'Ada file APK (sering dipakai untuk membobol HP)' },
  { category: 'malware', weight: 1, pattern: /\b(?:install|instal|pasang)\b[^.\n]{0,30}\b(?:apk|aplikasi|app)\b/, reason: 'Diminta install aplikasi' },
];

const SHORTENERS = new Set([
  'bit.ly', 's.id', 'tinyurl.com', 'cutt.ly', 'shorturl.at', 'rb.gy', 't.ly', 'is.gd', 'ow.ly', 'rebrand.ly',
  'linktr.ee', 'lynk.id', 'tiny.cc', 'v.gd', 'shorturl.asia',
]);
const SUSPICIOUS_TLDS = new Set([
  'xyz', 'top', 'click', 'icu', 'vip', 'bet', 'casino', 'win', 'tk', 'ml', 'ga', 'cf', 'gq', 'rest', 'monster',
  'buzz', 'cyou', 'sbs', 'cfd', 'lol', 'pw', 'fun', 'loan', 'cam', 'quest',
]);
const COMMON_TLDS = new Set([
  'com', 'net', 'org', 'id', 'io', 'me', 'info', 'biz', 'co', 'app', 'ly', 'site', 'online', 'store', 'shop',
  'live', 'space', 'link', 'cc', 'asia', 'dev', 'ai', 'gov', 'edu', 'my', 'sg', 'us', 'uk', 'ee', 'gl', 'to', 'at',
]);
export const BRAND_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  bca: ['bca.co.id', 'klikbca.com'],
  bri: ['bri.co.id'],
  bni: ['bni.co.id'],
  btn: ['btn.co.id'],
  mandiri: ['bankmandiri.co.id'],
  dana: ['dana.id'],
  ovo: ['ovo.id'],
  gopay: ['gopay.co.id', 'gojek.com'],
  shopee: ['shopee.co.id', 'shopee.com'],
  tokopedia: ['tokopedia.com'],
  bpjs: ['bpjs-kesehatan.go.id', 'bpjsketenagakerjaan.go.id'],
  pln: ['pln.co.id'],
  jnt: ['jet.co.id'],
  jne: ['jne.co.id'],
};
const GAMBLING_HOST = /(?:slot|gacor|togel|judi|casino|kasino|maxwin|toto\d|\d{2,3}(?:bet|slot)|(?:bet|slot)\d{2,3}|[a-z]88\b)/;

const URL_PATTERN = /\b(?:https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,24}(?:\/[^\s<>"']*)?)/gi;

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
}

function deLeet(text: string): string {
  return text.replace(/[013457@$]/g, (ch) => LEET[ch] ?? ch);
}

interface Signal {
  category: RiskCategory;
  weight: number;
  reason: string;
}

function textSignals(normalized: string): Signal[] {
  const variants = [normalized, deLeet(normalized)];
  return TEXT_RULES.filter((rule) => variants.some((v) => rule.pattern.test(v)));
}

function hostOf(candidate: string): { host: string; url: URL } | null {
  try {
    const url = new URL(/^https?:\/\//.test(candidate) ? candidate : `http://${candidate}`);
    return { host: url.hostname.toLowerCase(), url };
  } catch {
    return null;
  }
}

function isUnderDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

interface LinkCandidate {
  raw: string;
  hasScheme: boolean;
  host: string;
  url: URL;
}

function scanLinks(text: string): LinkCandidate[] {
  const links: LinkCandidate[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0].replace(/[).,!?]+$/, '');
    const hasScheme = /^https?:\/\//i.test(raw) || /^www\./i.test(raw);
    const parsed = hostOf(raw);
    if (!parsed) continue;
    const { host, url } = parsed;
    const tld = host.split('.').pop() ?? '';
    if (!hasScheme && !COMMON_TLDS.has(tld) && !SUSPICIOUS_TLDS.has(tld) && !SHORTENERS.has(host)) continue;
    links.push({ raw, hasScheme, host, url });
  }
  return links;
}

/** Links in a message as absolute URLs (scheme-less ones get http://), using the same rules as the risk check. */
export function extractLinkCandidates(text: string): string[] {
  const cleaned = text.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
  return [...new Set(scanLinks(cleaned).map((link) => link.url.href))];
}

const HTTP_REASON = 'Link tanpa HTTPS';

function linkSignals(normalized: string): Signal[] {
  const signals: Signal[] = [];
  for (const { raw, hasScheme, host, url } of scanLinks(normalized)) {
    const tld = host.split('.').pop() ?? '';
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
      signals.push({ category: 'phishing', weight: 3, reason: 'Link memakai alamat IP, bukan nama situs resmi' });
    }
    if (url.username || raw.includes('@')) {
      signals.push({ category: 'phishing', weight: 3, reason: 'Link menyamarkan alamat aslinya (pakai "@")' });
    }
    if (host.split('.').some((label) => label.startsWith('xn--'))) {
      signals.push({ category: 'phishing', weight: 3, reason: 'Domain memakai huruf mirip (punycode) untuk menyamar' });
    }
    if (SHORTENERS.has(host)) {
      signals.push({ category: 'phishing', weight: 2, reason: 'Link pemendek yang menyembunyikan tujuan aslinya' });
    }
    if (SUSPICIOUS_TLDS.has(tld)) {
      signals.push({ category: 'phishing', weight: 2, reason: `Domain .${tld} yang sering dipakai situs abal-abal` });
    }
    if (url.pathname.toLowerCase().endsWith('.apk')) {
      signals.push({ category: 'malware', weight: 3, reason: 'Link langsung mengunduh file APK' });
    }
    if (GAMBLING_HOST.test(host)) {
      signals.push({ category: 'gambling', weight: 3, reason: 'Nama domainnya berbau situs judi online' });
    }
    const labels = host.split(/[.-]/);
    for (const [brand, officialDomains] of Object.entries(BRAND_DOMAINS)) {
      const mentionsBrand =
        brand.length <= 4 ? labels.some((l) => l === brand || l === `klik${brand}`) : labels.some((l) => l.includes(brand));
      if (mentionsBrand && !officialDomains.some((d) => isUnderDomain(host, d))) {
        signals.push({ category: 'phishing', weight: 3, reason: `Domain meniru nama ${brand.toUpperCase()} tapi bukan situs resminya` });
        break;
      }
    }
    if (url.protocol === 'http:' && hasScheme && raw.startsWith('http://')) {
      signals.push({ category: 'phishing', weight: 1, reason: HTTP_REASON });
    }
  }
  return signals;
}

function summarize(signals: Signal[], isForwarded: boolean): RiskAssessment {
  const scores = new Map<RiskCategory, number>();
  const reasons: string[] = [];
  const seen = new Set<string>();
  for (const signal of signals) {
    const key = `${signal.category}:${signal.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scores.set(signal.category, (scores.get(signal.category) ?? 0) + signal.weight);
  }
  if (isForwarded) {
    for (const [category, score] of scores) scores.set(category, score + 1);
  }

  const categories = RISK_CATEGORIES.filter((c) => (scores.get(c) ?? 0) >= FLAG_THRESHOLD);
  for (const signal of signals) {
    if (categories.includes(signal.category) && !reasons.includes(signal.reason)) reasons.push(signal.reason);
  }
  if (categories.length > 0 && isForwarded) reasons.push('Pesan diteruskan dari pihak lain');

  return { flagged: categories.length > 0, categories, reasons };
}

export function assessTextRisk(text: string, options: { isForwarded?: boolean } = {}): RiskAssessment {
  const normalized = normalize(text);
  if (!normalized.trim()) return { flagged: false, categories: [], reasons: [] };
  return summarize([...textSignals(normalized), ...linkSignals(normalized)], Boolean(options.isForwarded));
}

function cleanLlmReason(reason: string | null): string | null {
  if (!reason) return null;
  const cleaned = reason
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_REASON_LENGTH ? `${cleaned.slice(0, MAX_REASON_LENGTH - 1)}…` : cleaned;
}

/** Union of local and LLM verdicts; the LLM can raise but never lower the risk. */
export function mergeRisk(local: RiskAssessment, llm?: LlmRiskVerdict | null): RiskAssessment {
  if (!llm || llm.category === 'none' || !RISK_CATEGORIES.includes(llm.category)) return local;
  const categories = RISK_CATEGORIES.filter((c) => c === llm.category || local.categories.includes(c));
  const reason = `Menurut penerawangan-kuh: ${cleanLlmReason(llm.reason) ?? 'pola pesannya mirip modus yang sering merugikan'}`;
  return { flagged: true, categories, reasons: [...local.reasons, reason] };
}

export function assessMediaRisk(input: {
  caption: string;
  ocrText: string;
  isForwarded?: boolean;
  vision: { isSuspicious: boolean; riskCategory?: LlmRiskCategory; safetyReason: string | null } | null;
}): RiskAssessment {
  const local = assessTextRisk([input.caption, input.ocrText].filter(Boolean).join('\n'), {
    isForwarded: input.isForwarded,
  });
  if (!input.vision?.isSuspicious) return local;
  const category = input.vision.riskCategory && input.vision.riskCategory !== 'none' ? input.vision.riskCategory : 'scam';
  return mergeRisk(local, { category, reason: input.vision.safetyReason });
}

export interface PageRiskInput {
  requestedUrl: string;
  finalUrl: string | null;
  redirectChain: string[];
  title: string;
  description: string;
  /** Visible page text; only used to recognize short block notices. */
  text: string;
  forms: { total: number; password: number; otp: number; card: number; pin: number; externalActionHosts: string[] };
  downloadFilename: string | null;
  tlsError: boolean;
  /** The link (or a redirect) resolved to a private / loopback / metadata address and was refused. */
  internalTarget: boolean;
  safeBrowsing: Array<'phishing' | 'malware'>;
}

/** Brand names as they appear in page titles. Matched case-sensitively where the plain word is common ("dana"). */
const BRAND_PAGE_PATTERNS: Record<string, RegExp> = {
  bca: /\b(?:klik\s?bca|bca|m-?bca|mybca)\b/i,
  bri: /\b(?:bri|brimo)\b/i,
  bni: /\bbni\b/i,
  btn: /\bbtn\b/i,
  mandiri: /\b(?:bank\s+mandiri|livin)\b/i,
  dana: /\bDANA\b/,
  ovo: /\bovo\b/i,
  gopay: /\b(?:gopay|gojek)\b/i,
  shopee: /\bshopee\b/i,
  tokopedia: /\btokopedia\b/i,
  bpjs: /\bbpjs\b/i,
  pln: /\bpln\b/i,
  jnt: /\bj\s?&\s?t\b/i,
  jne: /\bjne\b/i,
};
const DANGEROUS_DOWNLOAD = /\.(?:apk|xapk|apks|exe|msi|scr|bat|cmd|jar|vbs)$/i;
const GAMBLING_RULES = TEXT_RULES.filter((rule) => rule.category === 'gambling');

/**
 * Indonesian ISPs answer DNS for sites on the Komdigi (TrustPositif) list with their own notice page,
 * either by redirecting to one of these hosts or by serving the notice under the original domain.
 */
const BLOCK_PAGE_DOMAINS = [
  'internetpositif.id',
  'internet-positif.info',
  'internetsehatku.com',
  'trustpositif.komdigi.go.id',
  'trustpositif.kominfo.go.id',
];
const BLOCK_NOTICE_SOURCE = /internet\s?positif|internet\s?sehat|trust\s?positif|kominfo|komdigi|kementerian\s+komunikasi/i;
const BLOCK_NOTICE_ACTION = /diblokir|tidak dapat diakses|pemblokiran|peraturan perundang/i;
/** Notices are short; a long page that mentions blocking is usually news and is left to the LLM. */
const BLOCK_NOTICE_MAX_CHARS = 1500;

function isBlockPage(visited: string[], input: PageRiskInput): boolean {
  if (visited.some((url) => BLOCK_PAGE_DOMAINS.some((domain) => isUnderDomain(hostOf(url)?.host ?? '', domain)))) return true;
  if (input.text.length > BLOCK_NOTICE_MAX_CHARS) return false;
  const notice = `${input.title}\n${input.description}\n${input.text}`;
  return BLOCK_NOTICE_SOURCE.test(notice) && BLOCK_NOTICE_ACTION.test(notice);
}

/**
 * Local verdict for a visited page (redirects, forms, downloads, Safe Browsing, block notices). Only
 * the title and description are matched against gambling rules: body text of news about judol would
 * false-flag, so the body is left to the LLM. Plain http only counts when a password form is served over it.
 */
export function assessPageRisk(input: PageRiskInput): RiskAssessment {
  const signals: Signal[] = [];
  const finalUrl = input.finalUrl ?? input.requestedUrl;
  const visited = [...new Set([input.requestedUrl, ...input.redirectChain, finalUrl])];
  for (const url of visited) {
    signals.push(...linkSignals(normalize(url)).filter((signal) => signal.reason !== HTTP_REASON));
  }

  for (const category of new Set(input.safeBrowsing)) {
    signals.push({
      category,
      weight: FLAG_THRESHOLD,
      reason: category === 'malware' ? 'Google Safe Browsing menandainya sebagai situs malware' : 'Google Safe Browsing menandainya sebagai situs penipuan',
    });
  }

  if (input.downloadFilename && DANGEROUS_DOWNLOAD.test(input.downloadFilename)) {
    signals.push({ category: 'malware', weight: 3, reason: 'Halamannya langsung mengunduh file aplikasi' });
  }

  const finalHost = hostOf(finalUrl)?.host ?? '';
  const heading = `${input.title}\n${input.description}`;
  const { forms } = input;
  const asksSecret = forms.otp + forms.card + forms.pin > 0;
  if (forms.password > 0 || asksSecret) {
    for (const [brand, pattern] of Object.entries(BRAND_PAGE_PATTERNS)) {
      if (pattern.test(heading) && !BRAND_DOMAINS[brand]?.some((domain) => isUnderDomain(finalHost, domain))) {
        signals.push({ category: 'phishing', weight: 3, reason: `Halaman login mengaku ${brand.toUpperCase()} tapi bukan situs resminya` });
        break;
      }
    }
  }
  if (asksSecret) signals.push({ category: 'phishing', weight: 2, reason: 'Halamannya meminta OTP / PIN / nomor kartu' });
  else if (forms.password > 0) signals.push({ category: 'phishing', weight: 1, reason: 'Halamannya meminta password' });
  if (forms.password > 0 && finalUrl.startsWith('http://')) {
    signals.push({ category: 'phishing', weight: 2, reason: 'Password dikirim tanpa HTTPS' });
  }
  if (forms.externalActionHosts.length > 0) {
    signals.push({ category: 'phishing', weight: 1, reason: 'Isian form dikirim ke situs lain' });
  }
  if (input.tlsError) signals.push({ category: 'phishing', weight: 1, reason: 'Sertifikat HTTPS-nya tidak valid' });
  if (input.internalTarget) {
    signals.push({
      category: 'phishing',
      weight: FLAG_THRESHOLD,
      reason: 'Link-nya mengarah ke alamat jaringan internal (misalnya router atau perangkat lokal)',
    });
  }
  if (isBlockPage(visited, input)) {
    signals.push({
      category: 'blocked',
      weight: FLAG_THRESHOLD,
      reason: 'Situsnya masuk daftar blokir pemerintah (Internet Positif / TrustPositif), jadi isi aslinya nggak bisa aku cek',
    });
  }

  const normalizedHeading = normalize(heading);
  const headingVariants = [normalizedHeading, deLeet(normalizedHeading)];
  signals.push(...GAMBLING_RULES.filter((rule) => headingVariants.some((v) => rule.pattern.test(v))));

  return summarize(signals, false);
}
