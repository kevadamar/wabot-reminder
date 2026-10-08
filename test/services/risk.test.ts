import { describe, expect, it } from 'bun:test';
import { assessMediaRisk, assessTextRisk, mergeRisk } from '../../src/services/risk.js';
import { parseNlpModelOutput, parseVisionModelOutput } from '../../src/services/llm/schemas.js';
import { parseTaskMessage } from '../../src/services/nlp.js';
import type { LlmProvider } from '../../src/services/llm/types.js';

describe('Local risk heuristics', () => {
  it.each([
    ['Daftar slot gacor maxwin depo 10rb', 'gambling'],
    ['main sl0t g4c0r malam ini', 'gambling'],
    ['depo 50rb bonus new member slot', 'gambling'],
    ['Pasang togel jam 9 malam', 'gambling'],
    ['kirim kode OTP yang masuk ke nomor ini ya kak', 'scam'],
    ['Selamat! Anda terpilih sebagai pemenang undian berhadiah, hubungi admin', 'scam'],
    ['transfer biaya admin 250rb untuk pencairan hadiah', 'scam'],
    ['Rekening anda akan diblokir, verifikasi segera', 'scam'],
    ['Investasi profit 10% per hari dijamin', 'scam'],
    ['Ma ini aku ganti nomor, tolong transfer dulu ya', 'scam'],
    ['Cek undangan pernikahan kami undangan.apk', 'malware'],
    ['buka http://192.168.10.5/login segera', 'phishing'],
    ['login di bca-verifikasi.xyz sebelum jam 5', 'phishing'],
    ['cek promo https://klikbca-promo.com/hadiah', 'phishing'],
    ['buka https://xn--bc-gka.com', 'phishing'],
    ['daftar di gacor88.vip', 'gambling'],
  ])('flags %p as %s', (text, category) => {
    const risk = assessTextRisk(text);
    expect(risk.flagged).toBe(true);
    expect(risk.categories).toContain(category as any);
    expect(risk.reasons.length).toBeGreaterThan(0);
  });

  it.each([
    'Bayar slot parkir besok jam 8',
    'Transfer uang ke rekening ibu jam 5 sore',
    'Lapor penipuan ke bank besok pagi',
    'Rapat tim jam 10 di https://meet.google.com/abc-defg-hij',
    'Bayar BCA kartu kredit via https://www.klikbca.com besok',
    'Deposit tabungan ke bank jumat',
    'Download apk gojek baru buat adik',
    'Cek bonus akhir tahun besok',
    'Bayar tagihan dana talangan ke danamon.co.id',
    'Kirim berkas ke bit.ly/berkas-rapat',
  ])('does not flag everyday task %p', (text) => {
    expect(assessTextRisk(text).flagged).toBe(false);
  });

  it('treats forwarded messages as less trusted', () => {
    const text = 'Info lengkap di bit.ly/promo-akhir';
    expect(assessTextRisk(text).flagged).toBe(false);
    expect(assessTextRisk(text, { isForwarded: true }).flagged).toBe(true);
  });

  it('lets the LLM add a flag but never clear a local one', () => {
    const benign = assessTextRisk('Ikut acara kantor jumat');
    const raised = mergeRisk(benign, { category: 'scam', reason: 'Meminta data pribadi https://evil.example' });
    expect(raised.flagged).toBe(true);
    expect(raised.categories).toEqual(['scam']);
    expect(raised.reasons.join(' ')).not.toContain('https://');

    const local = assessTextRisk('slot gacor maxwin malam ini');
    const kept = mergeRisk(local, { category: 'none', reason: null });
    expect(kept.flagged).toBe(true);
    expect(kept.categories).toContain('gambling');
  });

  it('combines vision screening, caption and OCR for media', () => {
    expect(
      assessMediaRisk({ caption: '', ocrText: '', vision: { isSuspicious: true, riskCategory: 'gambling', safetyReason: 'Banner situs slot' } }).categories
    ).toEqual(['gambling']);
    expect(
      assessMediaRisk({ caption: 'bayar besok', ocrText: 'Kirim kode OTP ke admin sekarang', vision: null }).flagged
    ).toBe(true);
    expect(assessMediaRisk({ caption: 'struk belanja', ocrText: 'Total 50.000', vision: null }).flagged).toBe(false);
  });
});

describe('LLM risk output', () => {
  const now = new Date('2026-10-08T10:00:00.000Z');

  it('parses a valid risk field and ignores invalid ones', () => {
    const flagged = parseNlpModelOutput(
      JSON.stringify({ isTask: true, taskTitle: 'x', needsDeadline: true, sentiment: 'neutral', risk: { category: 'gambling', reason: 'Ajakan slot' } }),
      now
    );
    expect(flagged.risk).toEqual({ category: 'gambling', reason: 'Ajakan slot' });

    const invalid = parseNlpModelOutput(
      JSON.stringify({ isTask: true, taskTitle: 'x', needsDeadline: true, sentiment: 'neutral', risk: { category: 'hack' } }),
      now
    );
    expect(invalid.risk).toEqual({ category: 'none', reason: null });
  });

  it('parses the vision risk category, defaulting suspicious images to scam', () => {
    expect(parseVisionModelOutput(JSON.stringify({ isSuspicious: true, ocrText: '', isTask: false, riskCategory: 'gambling' })).riskCategory).toBe('gambling');
    expect(parseVisionModelOutput(JSON.stringify({ isSuspicious: true, ocrText: '', isTask: false })).riskCategory).toBe('scam');
    expect(parseVisionModelOutput(JSON.stringify({ isSuspicious: false, ocrText: '', isTask: false })).riskCategory).toBe('none');
  });

  it('exposes the LLM risk on the parse result', async () => {
    const provider: LlmProvider = {
      id: 'openai',
      model: 'test',
      timeoutMs: 1000,
      capabilities: { structuredOutput: true, vision: false },
      generate: async () => ({
        text: JSON.stringify({
          isTask: true,
          taskTitle: 'Klaim hadiah',
          deadline: null,
          needsDeadline: true,
          sentiment: 'neutral',
          risk: { category: 'scam', reason: 'Hadiah palsu' },
        }),
      }),
    };

    const result = await parseTaskMessage('/todo klaim hadiah dari admin', { now, providers: [provider] });
    expect(result.risk).toEqual({ category: 'scam', reason: 'Hadiah palsu' });
  });
});
