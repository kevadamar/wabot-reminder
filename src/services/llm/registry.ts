import { GoogleGenAI } from '@google/genai';
import { config } from '../../config/index.js';
import { getLlmConfig, type LlmConfig } from '../../config/llm.js';
import type { LlmProvider, Operation } from './types.js';
import { createGeminiProvider } from './providers/gemini.js';
import { createAntigravityProvider } from './providers/antigravity.js';
import { createOpenAiProvider } from './providers/openai.js';
import { createAnthropicProvider } from './providers/anthropic.js';

let geminiClient: GoogleGenAI | null = null;

export function getSharedGeminiClient(): GoogleGenAI | null {
  const apiKey = getLlmConfig().reveal('gemini');
  if (!geminiClient && apiKey) geminiClient = new GoogleGenAI({ apiKey });
  return geminiClient;
}

export interface ProviderOverride {
  geminiClient?: unknown;
  providers?: LlmProvider[];
}

function geminiTimeout(op: Operation, cfg: LlmConfig): number {
  if (op === 'vision_screen') return Math.max(cfg.gemini.timeoutMs, 4000);
  return cfg.gemini.timeoutMs;
}

export function providersForOperation(op: Operation, override?: ProviderOverride): LlmProvider[] {
  if (override?.providers) return override.providers;
  const cfg = getLlmConfig();
  const injected = override !== undefined && Object.prototype.hasOwnProperty.call(override, 'geminiClient');
  const providers: LlmProvider[] = [];

  for (const id of cfg.chains[op]) {
    if (id === 'local') continue;
    if (id === 'gemini') {
      if (injected) {
        if (override?.geminiClient) {
          providers.push(
            createGeminiProvider({
              client: override.geminiClient as never,
              model: cfg.gemini.model,
              thinkingLevel: cfg.gemini.thinkingLevel,
              timeoutMs: geminiTimeout(op, cfg),
            })
          );
        }
        continue;
      }
      const client = getSharedGeminiClient();
      if (!client) continue;
      providers.push(
        createGeminiProvider({
          client,
          model: cfg.gemini.model,
          thinkingLevel: cfg.gemini.thinkingLevel,
          timeoutMs: geminiTimeout(op, cfg),
        })
      );
      continue;
    }
    if (id === 'openai') {
      if (!cfg.openai.configured || (op === 'vision_screen' && !cfg.openai.vision)) continue;
      providers.push(
        createOpenAiProvider({
          apiKey: cfg.reveal('openai'),
          model: cfg.openai.model,
          baseUrl: cfg.openai.baseUrl,
          timeoutMs: cfg.openai.timeoutMs,
          structuredOutput: cfg.openai.structuredOutput,
          vision: cfg.openai.vision,
        })
      );
      continue;
    }
    if (id === 'anthropic') {
      if (!cfg.anthropic.configured) continue;
      providers.push(
        createAnthropicProvider({
          apiKey: cfg.reveal('anthropic'),
          model: cfg.anthropic.model,
          timeoutMs: cfg.anthropic.timeoutMs,
        })
      );
      continue;
    }
    if (id === 'antigravity') {
      const url = config.antigravityBridgeUrl || cfg.antigravity.url;
      if (!url) continue;
      providers.push(
        createAntigravityProvider({
          url,
          token: config.antigravityBridgeToken || cfg.reveal('antigravity'),
          timeoutMs: cfg.antigravity.timeoutMs,
        })
      );
    }
  }
  return providers;
}
