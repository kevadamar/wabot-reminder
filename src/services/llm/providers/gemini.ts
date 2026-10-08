import { LlmError, kindFromStatus } from '../errors.js';
import { redactPersonalData } from '../redact.js';
import type { LlmProvider, LlmRequest, LlmResult } from '../types.js';

interface GeminiClient {
  models: {
    generateContent: (input: any) => Promise<{
      text?: string;
      modelVersion?: string;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
        totalTokenCount?: number;
      };
    }>;
  };
}

function statusOf(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const record = err as { status?: unknown; code?: unknown };
  if (typeof record.status === 'number') return record.status;
  if (typeof record.code === 'number' && record.code >= 400 && record.code < 600) return record.code;
  return undefined;
}

export function createGeminiProvider(options: {
  client: GeminiClient | any;
  model: string;
  thinkingLevel: string;
  timeoutMs: number;
}): LlmProvider {
  return {
    id: 'gemini',
    model: options.model,
    timeoutMs: options.timeoutMs,
    capabilities: { structuredOutput: true, vision: true },
    async generate(req: LlmRequest): Promise<LlmResult> {
      const parts: unknown[] = [req.userContent];
      for (const image of req.images ?? []) {
        parts.push({
          inlineData: {
            data: Buffer.from(image.data).toString('base64'),
            mimeType: image.mimeType,
          },
        });
      }
      try {
        const response = await options.client.models.generateContent({
          model: options.model,
          contents: req.images?.length ? parts : req.userContent,
          config: {
            abortSignal: req.signal,
            systemInstruction: req.system || undefined,
            maxOutputTokens: req.maxOutputTokens,
            candidateCount: req.candidateCount,
            thinkingConfig: { thinkingLevel: req.thinkingLevel ?? options.thinkingLevel },
            responseFormat: req.jsonSchema
              ? [{ text: { mimeType: 'application/json', schema: req.jsonSchema } }]
              : undefined,
          },
        });
        const text = response.text?.trim() || '';
        if (!text) throw new LlmError('invalid_output');
        const usage = response.usageMetadata ?? {};
        return {
          text,
          model: response.modelVersion || options.model,
          usage: {
            promptTokens: usage.promptTokenCount ?? null,
            outputTokens: usage.candidatesTokenCount ?? null,
            thoughtTokens: usage.thoughtsTokenCount ?? null,
            totalTokens: usage.totalTokenCount ?? null,
          },
        };
      } catch (err) {
        if (err instanceof LlmError) throw err;
        const status = statusOf(err);
        if (status) {
          const message = err instanceof Error ? err.message : '';
          const detail = redactPersonalData(message.replace(/\s+/g, ' ').trim()).slice(0, 200) || undefined;
          throw new LlmError(kindFromStatus(status, false), status, undefined, { detail });
        }
        throw err;
      }
    },
  };
}
