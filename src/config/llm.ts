import { inspect } from 'node:util';
import type { ChainId, Operation, ProviderId } from '../services/llm/types.js';

export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmConfigError';
  }
}

const PROVIDER_IDS: readonly ProviderId[] = ['gemini', 'openai', 'anthropic', 'antigravity'];
const CHAIN_IDS: readonly ChainId[] = [...PROVIDER_IDS, 'local'];
const OPERATIONS: readonly Operation[] = [
  'nlp_parse',
  'affirmation',
  'reminder_message',
  'morning_motivation',
  'vision_screen',
  'link_review',
];

const OPERATION_ENV: Record<Operation, string> = {
  nlp_parse: 'LLM_CHAIN_NLP',
  affirmation: 'LLM_CHAIN_AFFIRMATION',
  reminder_message: 'LLM_CHAIN_REMINDER',
  morning_motivation: 'LLM_CHAIN_MORNING',
  vision_screen: 'LLM_CHAIN_VISION',
  link_review: 'LLM_CHAIN_LINK',
};

const BUILTIN_CHAIN: Record<Operation, string> = {
  nlp_parse: 'gemini,antigravity,local',
  affirmation: 'gemini,antigravity,local',
  reminder_message: 'gemini,antigravity,local',
  morning_motivation: 'gemini,local',
  vision_screen: 'gemini,local',
  link_review: 'gemini,antigravity,local',
};

/** Operations that send images, so every provider in their chain must support vision. */
export function isVisionOperation(op: Operation): boolean {
  return op === 'vision_screen' || op === 'link_review';
}

const THINKING_LEVELS = new Set(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']);

export interface LlmConfig {
  chains: Record<Operation, ChainId[]>;
  explicit: Record<Operation, boolean>;
  budgetMs: number;
  visionBudgetMs: number;
  /** link_review runs after the reply is sent, so it gets its own, longer budget. */
  linkBudgetMs: number;
  maxRetries: number;
  maxInputChars: number;
  minAttemptMs: number;
  breaker: { threshold: number; windowMs: number; cooldownMs: number };
  gemini: { model: string; thinkingLevel: string; timeoutMs: number; configured: boolean };
  openai: {
    model: string;
    baseUrl: string;
    timeoutMs: number;
    structuredOutput: boolean;
    vision: boolean;
    configured: boolean;
  };
  anthropic: { model: string; timeoutMs: number; configured: boolean };
  antigravity: { url: string; timeoutMs: number; configured: boolean };
  insecureHosts: string[];
  logging: { calls: boolean; payloads: boolean; payloadMaxChars: number };
  warnings: string[];
  reveal(id: ProviderId): string;
  toJSON(): unknown;
}

export function readInt(env: Record<string, string | undefined>, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new LlmConfigError(`${key} harus bilangan bulat`);
  }
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new LlmConfigError(`${key} di luar rentang ${min}-${max}`);
  }
  return value;
}

function parseChain(raw: string, label: string): ChainId[] {
  const parts = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set<string>();
  for (const part of parts) {
    if (!CHAIN_IDS.includes(part as ChainId)) {
      throw new LlmConfigError(`${label}: provider tidak dikenal "${part}"`);
    }
    if (seen.has(part)) throw new LlmConfigError(`${label}: provider duplikat "${part}"`);
    seen.add(part);
  }
  const localAt = parts.indexOf('local');
  if (localAt >= 0 && localAt !== parts.length - 1) {
    throw new LlmConfigError(`${label}: entri setelah local tidak akan dijangkau`);
  }
  if (localAt < 0) parts.push('local');
  return parts as ChainId[];
}

/**
 * Hosts that never leave the server or its private network: loopback, RFC 1918 / CGNAT
 * (Tailscale) / link-local IPs, IPv6 ULA, and internal names such as Docker service names.
 * Plain http to these does not expose prompts or the bridge token to the internet.
 */
export function isPrivateHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, '');
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (host.includes(':')) {
    return host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
  }
  if (!host.includes('.')) return true;
  return /\.(?:local|internal|lan|home\.arpa|localhost)$/.test(host) || host === 'host.docker.internal';
}

/** Accepts allowlist entries written as bare hosts, host:port, or full URLs (quotes tolerated). */
export function normalizeAllowlistEntry(entry: string): string {
  const cleaned = entry.trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
  if (!cleaned) return '';
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(cleaned) ? cleaned : `http://${cleaned}`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return cleaned;
  }
}

export function assertProviderUrl(raw: string, allowHttpHosts: ReadonlySet<string>, label: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LlmConfigError(`${label} bukan URL yang valid`);
  }
  if (url.username || url.password) throw new LlmConfigError(`${label} tidak boleh memuat kredensial`);
  if (url.search || url.hash) throw new LlmConfigError(`${label} tidak boleh memuat query atau fragment`);
  const host = url.hostname.toLowerCase();
  if (url.protocol === 'http:') {
    if (!isPrivateHost(host) && !allowHttpHosts.has(host.replace(/^\[|\]$/g, ''))) {
      throw new LlmConfigError(
        `${label} harus https untuk host publik "${host}". Host lokal/jaringan privat boleh http; untuk host publik lain tambahkan "${host}" ke LLM_INSECURE_HOST_ALLOWLIST`
      );
    }
  } else if (url.protocol !== 'https:') {
    throw new LlmConfigError(`${label} harus https`);
  }
  return raw.replace(/\/$/, '');
}

function supportsVision(id: ChainId, openaiVision: boolean): boolean {
  if (id === 'local' || id === 'gemini' || id === 'anthropic' || id === 'antigravity') return true;
  if (id === 'openai') return openaiVision;
  return false;
}

export function loadLlmConfig(env: Record<string, string | undefined>): LlmConfig {
  const allowRaw = env.LLM_INSECURE_HOST_ALLOWLIST?.trim() || 'localhost,127.0.0.1,host.docker.internal';
  const insecureHosts = allowRaw
    .split(',')
    .map(normalizeAllowlistEntry)
    .filter(Boolean);
  const allowHttp = new Set(insecureHosts);

  const geminiKey = env.GEMINI_API_KEY?.trim() || '';
  const geminiModel = env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite';
  const thinkingLevel = (env.GEMINI_THINKING_LEVEL?.trim() || 'MEDIUM').toUpperCase();
  if (!THINKING_LEVELS.has(thinkingLevel)) {
    throw new LlmConfigError('GEMINI_THINKING_LEVEL harus MINIMAL, LOW, MEDIUM, atau HIGH');
  }

  const openaiKey = env.OPENAI_API_KEY?.trim() || '';
  const openaiModel = env.OPENAI_MODEL?.trim() || '';
  const openaiBaseRaw = env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1';
  const openaiBaseUrl = assertProviderUrl(openaiBaseRaw, allowHttp, 'OPENAI_BASE_URL');
  const openaiStructured = env.OPENAI_STRUCTURED_OUTPUT?.trim().toLowerCase() !== 'false';
  const openaiVision = env.OPENAI_VISION?.trim().toLowerCase() === 'true';

  const anthropicKey = env.ANTHROPIC_API_KEY?.trim() || '';
  const anthropicModel = env.ANTHROPIC_MODEL?.trim() || '';

  const bridgeUrlRaw = env.ANTIGRAVITY_BRIDGE_URL?.trim() || '';
  const bridgeToken = env.ANTIGRAVITY_BRIDGE_TOKEN?.trim() || '';
  const bridgeUrl = bridgeUrlRaw ? assertProviderUrl(bridgeUrlRaw, allowHttp, 'ANTIGRAVITY_BRIDGE_URL') : '';

  const warnings: string[] = [];
  if (bridgeUrl && !bridgeToken) {
    warnings.push('ANTIGRAVITY_BRIDGE_URL diisi tanpa ANTIGRAVITY_BRIDGE_TOKEN. Bridge menolak request tanpa token jika proses bridge memasang token.');
  }

  const configured: Record<ProviderId, boolean> = {
    gemini: geminiKey.length > 0,
    openai: openaiKey.length > 0 && openaiModel.length > 0,
    anthropic: anthropicKey.length > 0 && anthropicModel.length > 0,
    antigravity: bridgeUrl.length > 0,
  };

  const chains = {} as Record<Operation, ChainId[]>;
  const explicit = {} as Record<Operation, boolean>;

  for (const op of OPERATIONS) {
    const specific = env[OPERATION_ENV[op]]?.trim();
    const fallback = env.LLM_CHAIN_DEFAULT?.trim();
    const source = specific || fallback;
    const label = specific ? OPERATION_ENV[op] : fallback ? 'LLM_CHAIN_DEFAULT' : op;
    let ids = parseChain(source || BUILTIN_CHAIN[op], label);
    const isExplicit = Boolean(source);
    explicit[op] = isExplicit;

    if (isVisionOperation(op)) {
      const unsupported = ids.filter((id) => !supportsVision(id, openaiVision));
      if (unsupported.length > 0) {
        if (specific) {
          const envName = OPERATION_ENV[op];
          throw new LlmConfigError(
            `${label}: ${unsupported.join(', ')} tidak mendukung vision. Hapus dari ${envName} (contoh: ${envName}=gemini,local).`
          );
        }
        ids = ids.filter((id) => supportsVision(id, openaiVision));
        if (ids.length === 0) ids = ['local'];
        warnings.push(`${op}: ${unsupported.join(', ')} dilewati karena tidak mendukung vision`);
      }
    }

    for (const id of ids) {
      if (id === 'local') continue;
      if (!configured[id]) {
        if (isExplicit) {
          throw new LlmConfigError(`${label}: ${id} dicantumkan tetapi kredensial atau model-nya kosong`);
        }
        warnings.push(`${op}: ${id} dilewati karena belum dikonfigurasi`);
      }
    }
    chains[op] = ids;
  }

  const secrets: Record<ProviderId, string> = {
    gemini: geminiKey,
    openai: openaiKey,
    anthropic: anthropicKey,
    antigravity: bridgeToken,
  };

  const logging = {
    calls: env.LLM_LOG_CALLS?.trim().toLowerCase() !== 'false',
    payloads: env.LLM_LOG_PAYLOADS?.trim().toLowerCase() === 'true',
    payloadMaxChars: readInt(env, 'LLM_LOG_PAYLOAD_MAX_CHARS', 2000, 100, 20_000),
  };
  if (logging.payloads) {
    warnings.push(
      'LLM_LOG_PAYLOADS aktif: isi prompt/response (sudah disensor & dipotong) dicatat di log dan dashboard. Matikan setelah selesai debugging.'
    );
  }

  const budgetMs = readInt(env, 'LLM_TOTAL_BUDGET_MS', 28_000, 100, 120_000);
  const slowVision = chains.vision_screen.includes('antigravity');

  const view = {
    chains,
    explicit,
    budgetMs,
    visionBudgetMs: readInt(env, 'LLM_VISION_BUDGET_MS', slowVision ? budgetMs : Math.min(budgetMs, 8000), 100, 120_000),
    linkBudgetMs: readInt(env, 'LLM_LINK_BUDGET_MS', 60_000, 1000, 180_000),
    maxRetries: readInt(env, 'LLM_MAX_RETRIES', 0, 0, 3),
    maxInputChars: readInt(env, 'LLM_MAX_INPUT_CHARS', 2000, 200, 20_000),
    minAttemptMs: 250,
    breaker: {
      threshold: readInt(env, 'LLM_BREAKER_FAILURE_THRESHOLD', 5, 1, 100),
      windowMs: readInt(env, 'LLM_BREAKER_WINDOW_MS', 60_000, 1000, 600_000),
      cooldownMs: readInt(env, 'LLM_BREAKER_COOLDOWN_MS', 30_000, 1000, 600_000),
    },
    gemini: { model: geminiModel, thinkingLevel, timeoutMs: readInt(env, 'GEMINI_TIMEOUT_MS', 3000, 100, 60_000), configured: configured.gemini },
    openai: {
      model: openaiModel,
      baseUrl: openaiBaseUrl,
      timeoutMs: readInt(env, 'OPENAI_TIMEOUT_MS', 5000, 100, 60_000),
      structuredOutput: openaiStructured,
      vision: openaiVision,
      configured: configured.openai,
    },
    anthropic: {
      model: anthropicModel,
      timeoutMs: readInt(env, 'ANTHROPIC_TIMEOUT_MS', 5000, 100, 60_000),
      configured: configured.anthropic,
    },
    antigravity: {
      url: bridgeUrl,
      timeoutMs: readInt(env, 'ANTIGRAVITY_TIMEOUT_MS', 25_000, 100, 60_000),
      configured: configured.antigravity,
    },
    insecureHosts,
    logging,
    warnings,
  };

  const config: LlmConfig = {
    ...view,
    reveal(id) {
      return secrets[id];
    },
    toJSON() {
      return {
        chains: view.chains,
        budgetMs: view.budgetMs,
        maxRetries: view.maxRetries,
        geminiModel: view.gemini.model,
        openaiModel: view.openai.model,
        openaiBaseUrl: view.openai.baseUrl,
        anthropicModel: view.anthropic.model,
        antigravityConfigured: view.antigravity.configured,
      };
    },
  };
  Object.defineProperty(config, inspect.custom, {
    value: () => config.toJSON(),
  });
  return config;
}

export function formatLlmStartupLog(config: LlmConfig): string {
  const lines = OPERATIONS.map((op) => {
    const rendered = config.chains[op]
      .map((id) => {
        if (id === 'gemini') return `gemini:${config.gemini.model}`;
        if (id === 'openai') return `openai:${config.openai.model || 'unset'}`;
        if (id === 'anthropic') return `anthropic:${config.anthropic.model || 'unset'}`;
        return id;
      })
      .join(' → ');
    return `${op}: ${rendered}`;
  });
  return `🔗 Rantai LLM efektif:\n${lines.map((line) => `   ${line}`).join('\n')}`;
}

let cached: LlmConfig | null = null;

export function getLlmConfig(): LlmConfig {
  if (!cached) {
    cached = loadLlmConfig(process.env);
    for (const warning of cached.warnings) console.warn(`⚠️ [LLM] ${warning}`);
  }
  return cached;
}

export function resetLlmConfigCache(): void {
  cached = null;
}
