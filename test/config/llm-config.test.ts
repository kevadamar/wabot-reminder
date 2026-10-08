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

  it('rejects a vision chain that includes a provider without vision', () => {
    expect(() =>
      loadLlmConfig({
        LLM_CHAIN_VISION: 'antigravity,local',
        ANTIGRAVITY_BRIDGE_URL: 'https://bridge.example',
        ANTIGRAVITY_BRIDGE_TOKEN: 'a'.repeat(32),
      })
    ).toThrow(/vision/);
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
