const RULES: [RegExp, string][] = [
  [/\bBearer\s+\S+/gi, 'Bearer [secret]'],
  [/\b(?:AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{16,})/g, '[secret]'],
  [/\b\d{8,15}@(?:s\.whatsapp\.net|g\.us|lid)\b/g, '[nomor]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/(?:\+?62|\b0)8\d{7,12}\b/g, '[nomor]'],
  [/\b\d{6,}\b/g, '[angka]'],
];

/** Masks phone numbers, JIDs, emails, OTP-like digit runs and API keys before text reaches a log. */
export function redactPersonalData(text: string): string {
  return RULES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

export function truncateForLog(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}… (+${text.length - maxChars} karakter)`;
}

export function redactForLog(text: string, maxChars: number): string {
  return truncateForLog(redactPersonalData(text), maxChars);
}
