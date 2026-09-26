import fallbackAffirmations from '../data/affirmations.json';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config/index.js';

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
  const gemini = customClient !== undefined ? customClient : getGeminiClient();

  if (gemini) {
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gemini API timeout (3s)')), 3000)
      );

      const response: any = await Promise.race([
        gemini.models.generateContent({
          model: config.geminiModel,
          contents: prompt,
        }),
        timeoutPromise,
      ]);

      const text = response.text?.trim();
      if (text) {
        return text.replace(/^["']|["']$/g, '');
      }
    } catch (err: any) {
      console.warn(`[Affirmation] Gemini error (${err?.message || err}), beralih ke kalimat motivasi lokal.`);
    }
  }

  return getRandomFallbackAffirmation();
}
