import { LlmError } from './errors.js';

export function delimitUserText(text: string, maxChars: number): string {
  const clipped = Array.from(text).slice(0, maxChars).join('');
  const safe = clipped.replaceAll('</pesan_pengguna>', '<\\/pesan_pengguna>');
  return `<pesan_pengguna>\n${safe}\n</pesan_pengguna>`;
}

export function extractJsonObject(text: string): string {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new LlmError('invalid_output');
  return trimmed.slice(start, end + 1);
}

export function cleanModelText(text: string, maxLength: number): string {
  const cleaned = text
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/https?:\/\/\S+/gi, '')
    .trim();
  if (cleaned.length < 2 || cleaned.length > maxLength) throw new LlmError('invalid_output');
  return cleaned;
}
