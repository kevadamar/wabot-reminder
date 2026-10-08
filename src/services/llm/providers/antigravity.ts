import { LlmError, kindFromStatus, parseRetryAfter } from '../errors.js';
import type { LlmProvider, LlmRequest, LlmResult } from '../types.js';

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
    capabilities: { structuredOutput: false, vision: false },
    async generate(req: LlmRequest): Promise<LlmResult> {
      if (req.images?.length) throw new LlmError('bad_request');
      const prompt = req.system ? `${req.system}\n\n${req.userContent}` : req.userContent;
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          },
          body: JSON.stringify({ prompt }),
          signal: req.signal,
          redirect: 'error',
        });
      } catch (err) {
        if (err instanceof LlmError) throw err;
        throw new LlmError(req.signal.aborted ? 'timeout' : 'network');
      }
      if (!response.ok) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        throw new LlmError(kindFromStatus(response.status, retryAfter !== undefined), response.status, retryAfter);
      }
      const data = (await response.json()) as { text?: string };
      const text = data.text?.trim() || '';
      if (!text) throw new LlmError('invalid_output');
      return { text };
    },
  };
}
