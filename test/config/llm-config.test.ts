import { describe, expect, it } from 'bun:test';
import { LlmConfigError, loadLlmConfig } from '../../src/config/llm.js';

describe('LLM config', () => {
  it('uses the current chain when no LLM_CHAIN vars are set', () => {
    const config = loadLlmConfig({});
    expect(config.chains.nlp_parse).toEqual(['gemini', 'antigravity', 'local']);
    expect(config.chains.affirmation).toEqual(['gemini', 'antigravity', 'local']);
    expect(config.chains.reminder_message).toEqual(['gemini', 'antigravity', 'local']);
    expect(config.chains.morning_motivation).toEqual(['gemini', 'local']);
    expect(config.chains.vision_screen).toEqual(['gemini', 'local']);
    expect(config.warnings.some((warning) => warning.includes('gemini'))).toBe(true);
    expect(config.gemini.configured).toBe(false);
  });

  it('appends local and rejects entries after it', () => {
    const config = loadLlmConfig({ LLM_CHAIN_NLP: 'gemini', GEMINI_API_KEY: 'key-value-123' });
    expect(config.chains.nlp_parse).toEqual(['gemini', 'local']);
    expect(() => loadLlmConfig({ LLM_CHAIN_NLP: 'local,gemini', GEMINI_API_KEY: 'key-value-123' })).toThrow(LlmConfigError);
  });

  it('rejects unknown ids, duplicates, and explicit providers without credentials', () => {
    expect(() => loadLlmConfig({ LLM_CHAIN_NLP: 'gemni,local' })).toThrow(/tidak dikenal/);
    expect(() => loadLlmConfig({ LLM_CHAIN_NLP: 'gemini,gemini,local', GEMINI_API_KEY: 'key-value-123' })).toThrow(/duplikat/);
    expect(() => loadLlmConfig({ LLM_CHAIN_NLP: 'openai,local' })).toThrow(/belum dikonfigurasi|kosong/);
  });

  it('rejects non-allowlisted http URLs and invalid integers', () => {
    expect(() => loadLlmConfig({ ANTIGRAVITY_BRIDGE_URL: 'http://evil.example/generate' })).toThrow(/https/);
    expect(() => loadLlmConfig({ OPENAI_BASE_URL: 'https://user:pass@api.openai.com/v1' })).toThrow(/kredensial/);
    expect(() => loadLlmConfig({ GEMINI_TIMEOUT_MS: '3s' })).toThrow(/bilangan bulat/);
    const internal = loadLlmConfig({
      ANTIGRAVITY_BRIDGE_URL: 'http://host.docker.internal:7860',
      ANTIGRAVITY_BRIDGE_TOKEN: 'a'.repeat(32),
    });
    expect(internal.antigravity.configured).toBe(true);
  });

  it.each([
    'http://172.17.0.1:7860',
    'http://10.0.0.5:7860',
    'http://192.168.1.10:7860',
    'http://100.101.1.2:7860',
    'http://127.0.0.1:7860',
    'http://antigravity:7860',
    'http://bridge.internal:7860',
    'http://my-server.local:7860',
    'http://[::1]:7860',
    'http://[fd00::5]:7860',
  ])('allows http to the in-server / private host %s without an allowlist', (url) => {
    const config = loadLlmConfig({ ANTIGRAVITY_BRIDGE_URL: url, ANTIGRAVITY_BRIDGE_TOKEN: 'a'.repeat(32) });
    expect(config.antigravity.configured).toBe(true);
  });

  it.each(['http://evil.example/generate', 'http://8.8.8.8:7860', 'http://172.32.0.1:7860', 'http://my-vps.example.com:7860'])(
    'still requires https for the public host %s and names it in the error',
    (url) => {
      const host = new URL(url).hostname;
      expect(() => loadLlmConfig({ ANTIGRAVITY_BRIDGE_URL: url })).toThrow(new RegExp(`https[\\s\\S]*"${host.replace(/\./g, '\\.')}"`));
    }
  );

  it('accepts allowlist entries written as URLs, with ports, quotes or spaces', () => {
    const config = loadLlmConfig({
      LLM_INSECURE_HOST_ALLOWLIST: ' "http://my-vps.example.com:7860/" , 203.0.113.5:7860 ',
      ANTIGRAVITY_BRIDGE_URL: 'http://my-vps.example.com:7860',
      OPENAI_BASE_URL: 'http://203.0.113.5:7860/v1',
      ANTIGRAVITY_BRIDGE_TOKEN: 'a'.repeat(32),
    });
    expect(config.antigravity.configured).toBe(true);
  });

  const openai = { OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-test' };

  it('rejects a vision chain that includes a provider without vision', () => {
    expect(() => loadLlmConfig({ LLM_CHAIN_VISION: 'openai,local', ...openai })).toThrow(/vision/);
  });

  it('drops non-vision providers inherited from LLM_CHAIN_DEFAULT instead of failing', () => {
    const config = loadLlmConfig({ LLM_CHAIN_DEFAULT: 'gemini,openai,local', GEMINI_API_KEY: 'key', ...openai });
    expect(config.chains.vision_screen).toEqual(['gemini', 'local']);
    expect(config.chains.nlp_parse).toEqual(['gemini', 'openai', 'local']);
    expect(config.warnings.some((warning) => warning.includes('vision_screen') && warning.includes('openai'))).toBe(true);
  });

  it('falls back to the local vision screen when the inherited chain has no vision provider', () => {
    const config = loadLlmConfig({ LLM_CHAIN_DEFAULT: 'openai', ...openai });
    expect(config.chains.vision_screen).toEqual(['local']);
  });

  it('has a link review chain that defaults to vision-capable providers and its own budget', () => {
    const config = loadLlmConfig({});
    expect(config.chains.link_review).toEqual(['gemini', 'antigravity', 'local']);
    expect(config.linkBudgetMs).toBe(60_000);
    expect(loadLlmConfig({ LLM_LINK_BUDGET_MS: '90000' }).linkBudgetMs).toBe(90_000);
  });

  it('treats LLM_CHAIN_LINK like a vision chain because it sends a page screenshot', () => {
    expect(() => loadLlmConfig({ LLM_CHAIN_LINK: 'openai,local', ...openai })).toThrow(/LLM_CHAIN_LINK[\s\S]*vision/);
    const vision = loadLlmConfig({ LLM_CHAIN_LINK: 'openai,local', OPENAI_VISION: 'true', ...openai });
    expect(vision.chains.link_review).toEqual(['openai', 'local']);
    const inherited = loadLlmConfig({ LLM_CHAIN_DEFAULT: 'gemini,openai,local', GEMINI_API_KEY: 'key', ...openai });
    expect(inherited.chains.link_review).toEqual(['gemini', 'local']);
  });

  it('accepts antigravity in the vision chain and gives vision the full budget', () => {
    const config = loadLlmConfig({
      LLM_CHAIN_VISION: 'antigravity,gemini,local',
      GEMINI_API_KEY: 'key',
      ANTIGRAVITY_BRIDGE_URL: 'http://host.docker.internal:7860',
    });
    expect(config.chains.vision_screen).toEqual(['antigravity', 'gemini', 'local']);
    expect(config.visionBudgetMs).toBe(config.budgetMs);
  });

  it('keeps the short vision budget when the vision chain has no antigravity', () => {
    expect(loadLlmConfig({}).visionBudgetMs).toBe(8000);
  });

  it('logs call metadata by default and keeps payload logging off', () => {
    const config = loadLlmConfig({});
    expect(config.logging).toEqual({ calls: true, payloads: false, payloadMaxChars: 2000 });
  });

  it('enables payload logging with a warning when LLM_LOG_PAYLOADS=true', () => {
    const config = loadLlmConfig({ LLM_LOG_PAYLOADS: 'true', LLM_LOG_PAYLOAD_MAX_CHARS: '500', LLM_LOG_CALLS: 'false' });
    expect(config.logging).toEqual({ calls: false, payloads: true, payloadMaxChars: 500 });
    expect(config.warnings.some((warning) => warning.includes('LLM_LOG_PAYLOADS'))).toBe(true);
  });

  it('lets LLM_VISION_BUDGET_MS override the vision budget', () => {
    expect(loadLlmConfig({ LLM_VISION_BUDGET_MS: '15000' }).visionBudgetMs).toBe(15000);
  });

  it('does not serialize API keys', () => {
    const secret = 'super-secret-gemini-key';
    const config = loadLlmConfig({
      GEMINI_API_KEY: secret,
      OPENAI_API_KEY: 'sk-openai-secret-value',
      OPENAI_MODEL: 'gpt-test',
      LLM_CHAIN_NLP: 'openai,gemini,local',
    });
    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('sk-openai-secret-value');
    expect(config.reveal('gemini')).toBe(secret);
  });
});
