import fallbackAffirmations from '../data/affirmations.json';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config/index.js';
import { callAntigravityBridge } from './nlp.js';
import { recordAiUsage, telemetry } from './telemetry.js';

let defaultGeminiClient: any = null;
function getGeminiClient() {
  if (!defaultGeminiClient && config.geminiApiKey) {
    defaultGeminiClient = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }
  return defaultGeminiClient;
}

/**
 * Returns a random quote from local affirmations.json
 */
export function getRandomFallbackAffirmation(): string {
  const index = Math.floor(Math.random() * fallbackAffirmations.length);
  return fallbackAffirmations[index] || 'Hebat! Satu tugas selesai, teruskan semangat produktifmu!';
}

/**
 * Public interface to generate positive affirmation upon task completion
 */
export async function generateAffirmation(taskName: string, customClient?: any): Promise<string> {
  const prompt = `Berikan satu kalimat singkat penyemangat atau pujian ramah berbahasa Indonesia untuk seseorang yang baru saja menyelesaikan tugas: "${taskName}". Jangan gunakan tanda petik ganda di awal dan akhir.`;
  const gemini = customClient !== undefined ? customClient : getGeminiClient();

  if (gemini) {
    const startedAt = performance.now();
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gemini API timeout (3s)')), 3000)
      );

      const response: any = await Promise.race([
        gemini.models.generateContent({
          model: config.geminiModel,
          contents: prompt,
          config: {
            thinkingConfig: {
              thinkingLevel: config.geminiThinkingLevel as any,
            },
          },
        }),
        timeoutPromise,
      ]);

      const text = response.text?.trim();
      if (text) {
        const usage = response.usageMetadata ?? {};
        recordAiUsage(telemetry, {
          operation: 'affirmation',
          provider: 'gemini',
          outcome: 'success',
          durationMs: performance.now() - startedAt,
          usage: {
            promptTokens: usage.promptTokenCount,
            outputTokens: usage.candidatesTokenCount,
            thoughtTokens: usage.thoughtsTokenCount,
            totalTokens: usage.totalTokenCount,
          },
        });
        return text.replace(/^["']|["']$/g, '');
      }
    } catch (err: any) {
      recordAiUsage(telemetry, {
        operation: 'affirmation',
        provider: 'gemini',
        outcome: String(err?.message || '').includes('timeout') ? 'timeout' : 'failed',
        durationMs: performance.now() - startedAt,
      });
      console.warn(`[Affirmation] Gemini error (${err?.message || err}), beralih ke opsi fallback...`);
    }
  }

  // Tier 2: Try Antigravity CLI Host Bridge
  if (config.antigravityBridgeUrl) {
    const bridgeText = await callAntigravityBridge(prompt);
    if (bridgeText) {
      return bridgeText.replace(/^["']|["']$/g, '').trim();
    }
  }

  // Tier 3: Local Offline Affirmations
  telemetry.increment('ai_fallback_total', { operation: 'affirmation', provider: 'local', outcome: 'selected' });
  return getRandomFallbackAffirmation();
}
