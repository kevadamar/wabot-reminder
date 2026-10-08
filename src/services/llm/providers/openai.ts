import { LlmError, kindFromStatus, parseRetryAfter } from '../errors.js';
import type { LlmProvider, LlmRequest, LlmResult, TokenUsage } from '../types.js';

function usageFrom(body: { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }): TokenUsage {
  return {
    promptTokens: body.usage?.prompt_tokens ?? null,
    outputTokens: body.usage?.completion_tokens ?? null,
    totalTokens: body.usage?.total_tokens ?? null,
  };
}

export function createOpenAiProvider(options: {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  structuredOutput: boolean;
  vision: boolean;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}): LlmProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `${options.baseUrl.replace(/\/$/, '')}/chat/completions`;
  return {
    id: 'openai',
    model: options.model,
    timeoutMs: options.timeoutMs,
    capabilities: { structuredOutput: options.structuredOutput, vision: options.vision },
    async generate(req: LlmRequest): Promise<LlmResult> {
      if (req.images?.length && !options.vision) throw new LlmError('bad_request');
      const content = req.images?.length
        ? [
            { type: 'text', text: req.userContent },
            ...req.images.map((image) => ({
              type: 'image_url',
              image_url: { url: `data:${image.mimeType};base64,${Buffer.from(image.data).toString('base64')}` },
            })),
          ]
        : req.userContent;
      const body: Record<string, unknown> = {
        model: options.model,
        messages: [
          ...(req.system ? [{ role: 'system', content: req.system }] : []),
          { role: 'user', content },
        ],
        max_tokens: req.maxOutputTokens,
      };
      if (req.jsonSchema && options.structuredOutput) {
        body.response_format = {
          type: 'json_schema',
          json_schema: { name: req.operation, schema: req.jsonSchema },
        };
      }
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.apiKey}`,
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
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const text = payload.choices?.[0]?.message?.content?.trim() || '';
      if (!text) throw new LlmError('invalid_output');
      return { text, model: options.model, usage: usageFrom(payload) };
    },
  };
}
