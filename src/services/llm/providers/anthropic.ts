import { LlmError, kindFromStatus, parseRetryAfter } from '../errors.js';
import type { LlmProvider, LlmRequest, LlmResult } from '../types.js';

export function createAnthropicProvider(options: {
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}): LlmProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    id: 'anthropic',
    model: options.model,
    timeoutMs: options.timeoutMs,
    capabilities: { structuredOutput: true, vision: true },
    async generate(req: LlmRequest): Promise<LlmResult> {
      const content = req.images?.length
        ? [
            ...req.images.map((image) => ({
              type: 'image',
              source: {
                type: 'base64',
                media_type: image.mimeType,
                data: Buffer.from(image.data).toString('base64'),
              },
            })),
            { type: 'text', text: req.userContent },
          ]
        : req.userContent;
      const body: Record<string, unknown> = {
        model: options.model,
        max_tokens: req.maxOutputTokens,
        system: req.system,
        messages: [{ role: 'user', content }],
      };
      if (req.jsonSchema) {
        body.output_config = { format: { type: 'json_schema', schema: req.jsonSchema } };
      }
      let response: Response;
      try {
        response = await fetchImpl('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': options.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
          signal: req.signal,
          redirect: 'error',
        });
      } catch {
        throw new LlmError(req.signal.aborted ? 'timeout' : 'network');
      }
      if (!response.ok) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        throw new LlmError(kindFromStatus(response.status, retryAfter !== undefined), response.status, retryAfter);
      }
      const payload = (await response.json()) as {
        content?: { type?: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = payload.content?.find((block) => block.type === 'text')?.text?.trim() || '';
      if (!text) throw new LlmError('invalid_output');
      return {
        text,
        model: options.model,
        usage: {
          promptTokens: payload.usage?.input_tokens ?? null,
          outputTokens: payload.usage?.output_tokens ?? null,
          totalTokens:
            payload.usage?.input_tokens !== undefined && payload.usage?.output_tokens !== undefined
              ? payload.usage.input_tokens + payload.usage.output_tokens
              : null,
        },
      };
    },
  };
}
