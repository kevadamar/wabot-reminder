import { describe, expect, it } from 'bun:test';
import { LlmError } from '../../../src/services/llm/errors.js';
import { createAnthropicProvider } from '../../../src/services/llm/providers/anthropic.js';
import { createAntigravityProvider } from '../../../src/services/llm/providers/antigravity.js';
import { createOpenAiProvider } from '../../../src/services/llm/providers/openai.js';

const signal = AbortSignal.timeout(1000);

describe('OpenAI-compatible provider', () => {
  it('sends a JSON schema and does not follow redirects', async () => {
    let init: RequestInit | undefined;
    const fetchImpl = async (_url: string, options?: RequestInit) => {
      init = options;
      return Response.json({ choices: [{ message: { content: '{"isTask":true}' } }] });
    };

    const provider = createOpenAiProvider({
      apiKey: 'sk-super-secret-value',
      model: 'gpt-test',
      baseUrl: 'https://api.openai.com/v1',
      timeoutMs: 1000,
      structuredOutput: true,
      vision: false,
      fetchImpl,
    });
    const result = await provider.generate({
      operation: 'nlp_parse',
      system: 'instruksi',
      userContent: '<pesan_pengguna>beli sabun</pesan_pengguna>',
      jsonSchema: { type: 'object' },
      maxOutputTokens: 100,
      signal,
    });

    expect(result.text).toContain('isTask');
    expect(init?.redirect).toBe('error');
    const body = JSON.parse(String(init?.body));
    expect(body.response_format.type).toBe('json_schema');
    expect(body.messages[0].role).toBe('system');
    expect(String((init?.headers as Record<string, string>).Authorization)).toContain('sk-super-secret-value');
  });

  it('maps 429 with Retry-After and 401 without leaking the key', async () => {
    const secret = 'sk-super-secret-value';
    const fetchImpl = async () => new Response('nope', { status: 429, headers: { 'Retry-After': '2' } });
    const provider = createOpenAiProvider({
      apiKey: secret,
      model: 'gpt-test',
      baseUrl: 'https://api.openai.com/v1',
      timeoutMs: 1000,
      structuredOutput: false,
      vision: false,
      fetchImpl,
    });
    try {
      await provider.generate({
        operation: 'affirmation',
        system: '',
        userContent: 'tugas',
        maxOutputTokens: 20,
        signal,
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LlmError);
      expect((err as LlmError).kind).toBe('rate_limited');
      expect((err as LlmError).retryAfterMs).toBe(2000);
      expect(String(err)).not.toContain(secret);
    }

    const denied = createOpenAiProvider({
      apiKey: secret,
      model: 'gpt-test',
      baseUrl: 'https://api.openai.com/v1',
      timeoutMs: 1000,
      structuredOutput: false,
      vision: false,
      fetchImpl: async () => new Response(JSON.stringify({ error: secret }), { status: 401 }),
    });
    await expect(
      denied.generate({ operation: 'affirmation', system: '', userContent: 'tugas', maxOutputTokens: 20, signal })
    ).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('Anthropic provider', () => {
  it('sends output_config and the API key header', async () => {
    let init: RequestInit | undefined;
    const fetchImpl = async (_url: string, options?: RequestInit) => {
      init = options;
      return Response.json({ content: [{ type: 'text', text: '{"isTask":false}' }] });
    };
    const provider = createAnthropicProvider({
      apiKey: 'ant-secret-value',
      model: 'claude-test',
      timeoutMs: 1000,
      fetchImpl,
    });
    await provider.generate({
      operation: 'nlp_parse',
      system: 'instruksi',
      userContent: 'pesan',
      jsonSchema: { type: 'object' },
      maxOutputTokens: 40,
      signal,
    });
    const body = JSON.parse(String(init?.body));
    expect(body.output_config.format.type).toBe('json_schema');
    expect(init?.redirect).toBe('error');
    expect((init?.headers as Record<string, string>)['x-api-key']).toBe('ant-secret-value');
  });
});

describe('Antigravity provider', () => {
  it('sends the bearer token and refuses redirects', async () => {
    let init: RequestInit | undefined;
    const fetchImpl = async (_url: string, options?: RequestInit) => {
      init = options;
      return Response.json({ text: '{"isTask":true}' });
    };
    const provider = createAntigravityProvider({
      url: 'https://bridge.internal',
      token: 'bridge-token-value',
      timeoutMs: 1000,
      fetchImpl,
    });
    await provider.generate({
      operation: 'nlp_parse',
      system: 'instruksi',
      userContent: '<pesan_pengguna>beli sabun</pesan_pengguna>',
      maxOutputTokens: 40,
      signal,
    });
    expect(init?.redirect).toBe('error');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer bridge-token-value');
  });

  it('supports vision by sending images as base64 to the bridge', async () => {
    let body: { prompt?: string; images?: { mimeType: string; data: string }[] } = {};
    const fetchImpl = async (_url: string, options?: RequestInit) => {
      body = JSON.parse(String(options?.body));
      return Response.json({ text: '{"isSuspicious":false}' });
    };
    const provider = createAntigravityProvider({ url: 'http://host.docker.internal:7860', token: '', timeoutMs: 1000, fetchImpl });
    expect(provider.capabilities.vision).toBe(true);
    await provider.generate({
      operation: 'vision_screen',
      system: 'analisis gambar',
      userContent: 'Gambar terlampir.',
      images: [{ data: new Uint8Array([0xff, 0xd8, 0xff, 0x01]), mimeType: 'image/jpeg' }],
      maxOutputTokens: 100,
      signal,
    });
    expect(body.images).toEqual([{ mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0x01]).toString('base64') }]);
    expect(body.prompt).toContain('analisis gambar');
  });

  it('omits the images field for text-only requests', async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = async (_url: string, options?: RequestInit) => {
      body = JSON.parse(String(options?.body));
      return Response.json({ text: 'ok' });
    };
    const provider = createAntigravityProvider({ url: 'http://host.docker.internal:7860', token: '', timeoutMs: 1000, fetchImpl });
    await provider.generate({ operation: 'affirmation', system: 's', userContent: 'u', maxOutputTokens: 10, signal });
    expect('images' in body).toBe(false);
  });
});
