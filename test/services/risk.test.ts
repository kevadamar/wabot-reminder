import { describe, expect, it } from 'bun:test';
import {
  assessMediaRisk,
  assessPageRisk,
  assessTextRisk,
  extractLinkCandidates,
  mergeRisk,
  type PageRiskInput,
} from '../../src/services/risk.js';
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

describe('Link extraction', () => {
  it('extracts links with and without a scheme, keeping path case and dropping trailing punctuation', () => {
    expect(extractLinkCandidates('cek https://Bit.ly/AbC12, lalu promo-murah.xyz/Login!')).toEqual([
      'https://bit.ly/AbC12',
      'http://promo-murah.xyz/Login',
    ]);
  });

  it('ignores filenames and tokens without a known TLD, and dedupes', () => {
    expect(extractLinkCandidates('kirim laporan.pdf dan notes.txt')).toEqual([]);
    expect(extractLinkCandidates('www.example.com dan http://www.example.com/')).toEqual(['http://www.example.com/']);
  });
});

describe('Page risk', () => {
  const base: PageRiskInput = {
    requestedUrl: 'https://toko-online-baru.com/',
    finalUrl: 'https://toko-online-baru.com/',
    redirectChain: [],
    title: 'Toko Online Baru',
    description: '',
    forms: { total: 0, password: 0, otp: 0, card: 0, pin: 0, externalActionHosts: [] },
    downloadFilename: null,
    text: '',
    tlsError: false,
    internalTarget: false,
    safeBrowsing: [],
  };

  it('does not flag an ordinary page', () => {
    expect(assessPageRisk(base).flagged).toBe(false);
  });

  it('flags a login page that impersonates a bank on a non-official domain', () => {
    const risk = assessPageRisk({
      ...base,
      title: 'KlikBCA Individual - Login',
      forms: { ...base.forms, total: 1, password: 1 },
    });
    expect(risk.categories).toContain('phishing');
    expect(risk.reasons.join(' ')).toContain('BCA');
  });

  it('does not flag the official bank login', () => {
    const risk = assessPageRisk({
      ...base,
      requestedUrl: 'https://ibank.klikbca.com/',
      finalUrl: 'https://ibank.klikbca.com/',
      title: 'KlikBCA Individual - Login',
      forms: { ...base.forms, total: 1, password: 1 },
    });
    expect(risk.flagged).toBe(false);
  });

  it('flags a redirect that lands on a suspicious domain asking for an OTP', () => {
    const risk = assessPageRisk({
      ...base,
      requestedUrl: 'https://bit.ly/abc',
      redirectChain: ['https://bit.ly/abc'],
      finalUrl: 'https://verif-hadiah.xyz/otp',
      forms: { ...base.forms, total: 1, otp: 1 },
    });
    expect(risk.categories).toContain('phishing');
  });

  it('flags APK downloads, Safe Browsing matches and gambling titles', () => {
    expect(assessPageRisk({ ...base, downloadFilename: 'undangan.apk' }).categories).toEqual(['malware']);
    expect(assessPageRisk({ ...base, safeBrowsing: ['phishing'] }).categories).toEqual(['phishing']);
    expect(assessPageRisk({ ...base, title: 'SLOT GACOR MAXWIN - Daftar Sekarang' }).categories).toEqual(['gambling']);
  });

  it('flags a public link that leads into the internal network', () => {
    const risk = assessPageRisk({
      ...base,
      requestedUrl: 'https://promo-baru.xyz/',
      redirectChain: ['https://promo-baru.xyz/', 'http://192.168.1.1/admin'],
      finalUrl: null,
      internalTarget: true,
    });
    expect(risk.categories).toContain('phishing');
    expect(risk.reasons.join(' ')).toContain('jaringan internal');
  });

  it('flags a link that lands on the government block page (Internet Positif)', () => {
    const risk = assessPageRisk({
      ...base,
      requestedUrl: 'http://toko-contoh.com/',
      redirectChain: ['http://toko-contoh.com/', 'https://internet-positif.info/'],
      finalUrl: 'https://internet-positif.info/',
      title: '(47) Internet Positif - Positifkan diri kamu',
      description: 'Halaman yang kamu tuju tidak dapat diakses',
    });
    expect(risk.categories).toEqual(['blocked']);
    expect(risk.reasons.join(' ')).toContain('blokir pemerintah');
  });

  it('recognizes a block page served under the original domain by its short notice text', () => {
    const risk = assessPageRisk({
      ...base,
      requestedUrl: 'http://toko-contoh.com/',
      finalUrl: 'http://toko-contoh.com/',
      title: 'Pemberitahuan',
      text: 'Akses ke situs ini telah diblokir oleh Komdigi karena melanggar peraturan perundang-undangan. Laporkan lewat kanal pengaduan resmi.',
    });
    expect(risk.categories).toEqual(['blocked']);
  });

  it('does not treat a long news article about blocking as a block page', () => {
    const risk = assessPageRisk({
      ...base,
      requestedUrl: 'https://berita-teknologi.net/artikel',
      finalUrl: 'https://berita-teknologi.net/artikel',
      title: 'Komdigi blokir 1.000 situs judol lewat Internet Positif',
      text: `Kementerian Komunikasi dan Digital (Komdigi) kembali memblokir situs yang melanggar peraturan perundang-undangan. ${'Isi artikel panjang. '.repeat(120)}`,
    });
    expect(risk.categories).not.toContain('blocked');
  });

  it('does not penalize the http:// prefix added to scheme-less links', () => {
    const risk = assessPageRisk({
      ...base,
      requestedUrl: 'http://promo-baru.xyz/',
      redirectChain: ['http://promo-baru.xyz/'],
      finalUrl: 'https://promo-baru.xyz/',
    });
    expect(risk.flagged).toBe(false);
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
