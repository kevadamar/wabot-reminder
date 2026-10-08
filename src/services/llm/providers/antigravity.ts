import { LlmError, errorDetailFrom, kindFromStatus, parseRetryAfter, transportError } from '../errors.js';
import type { LlmProvider, LlmRequest, LlmResult, TokenUsage } from '../types.js';

export function createAntigravityProvider(options: {
  url: string;
  token: string;
  timeoutMs: number;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}): LlmProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `${options.url.replace(/\/$/, '')}/generate`;
  return {
    id: 'antigravity',
    model: 'antigravity-cli',
    timeoutMs: options.timeoutMs,
    capabilities: { structuredOutput: false, vision: true },
    async generate(req: LlmRequest): Promise<LlmResult> {
      const prompt = req.system ? `${req.system}\n\n${req.userContent}` : req.userContent;
      const images = req.images?.map((image) => ({
        mimeType: image.mimeType,
        data: Buffer.from(image.data).toString('base64'),
      }));
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
            ...(req.requestId ? { 'X-Request-Id': req.requestId } : {}),
          },
          body: JSON.stringify(images?.length ? { prompt, images } : { prompt }),
          signal: req.signal,
          redirect: 'error',
        });
      } catch (err) {
        if (err instanceof LlmError) throw err;
        throw transportError(err, req.signal, endpoint);
      }
      const providerRequestId = response.headers.get('x-request-id') || undefined;
      if (!response.ok) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        const detail = await errorDetailFrom(response, [options.token]);
        const agentGaveNoAnswer = detail === 'empty_output' || detail?.startsWith('tool_denied');
        const kind = agentGaveNoAnswer ? 'invalid_output' : kindFromStatus(response.status, retryAfter !== undefined);
        throw new LlmError(kind, response.status, retryAfter, {
          detail,
          providerRequestId,
        });
      }
      const data = (await response.json()) as { text?: string; usage?: TokenUsage };
      const text = data.text?.trim() || '';
      if (!text) {
        throw new LlmError('invalid_output', undefined, undefined, {
          providerRequestId,
          detail: 'Bridge membalas teks kosong (cek stderr agy di log bridge)',
        });
      }
      return data.usage ? { text, usage: data.usage, providerRequestId } : { text, providerRequestId };
    },
  };
}
