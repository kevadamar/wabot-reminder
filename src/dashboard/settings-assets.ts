export const SETTINGS_HTML = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Todo Bot · Settings</title>
  <link rel="stylesheet" href="/dashboard.css">
  <link rel="stylesheet" href="/settings.css">
  <script src="/settings.js" defer></script>
</head>
<body class="settings-page">
  <a class="skip-link" href="#main">Lewati ke konten</a>
  <header class="topbar">
    <div class="topbar-brand">
      <p class="eyebrow">WHATSAPP TASK SERVICE · CONFIGURATION</p>
      <h1>Bot Settings</h1>
    </div>
    <nav class="topbar-nav" aria-label="Navigasi Halaman">
      <a href="/" class="nav-tab">Overview & Controls</a>
      <a href="/activity" class="nav-tab">Activity (APM)</a>
      <a href="/llm" class="nav-tab">LLM Calls</a>
      <a href="/settings" class="nav-tab active">Settings</a>
    </nav>
    <div class="topbar-actions">
      <span id="last-updated" class="muted" aria-live="polite">Memuat data…</span>
      <button id="refresh" type="button">Refresh</button>
    </div>
  </header>

  <main id="main" class="settings-main">
    <div id="feedback-banner" class="feedback-banner" aria-live="polite" hidden></div>

    <section class="settings-section" aria-labelledby="contact-heading">
      <div class="section-heading">
        <div>
          <p class="index">01</p>
          <h2 id="contact-heading">Akses Dibatasi & Kontak Admin</h2>
        </div>
      </div>

      <div class="settings-card">
        <div class="card-intro">
          <h3>Instagram Admin Handle</h3>
          <p class="text-muted">
            Akun Instagram admin yang disematkan pada balasan pesan otomatis ketika nomor WhatsApp yang belum diizinkan (tidak terdaftar di whitelist) menghubungi bot.
          </p>
        </div>

        <form id="settings-form" class="settings-form" onsubmit="return false;">
          <div class="form-group">
            <label for="admin-instagram-input" class="form-label">Username Instagram Admin</label>
            <div class="input-with-action">
              <input
                type="text"
                id="admin-instagram-input"
                name="adminInstagram"
                class="text-input"
                placeholder="@kevadamar"
                autocomplete="off"
                spellcheck="false"
                required
              />
              <button type="submit" id="save-settings-btn" class="btn-primary">
                Simpan Perubahan
              </button>
            </div>
            <p class="input-hint">Format diawali dengan @ (contoh: <code>@kevadamar</code>).</p>
          </div>
        </form>

        <div class="preview-box">
          <div class="preview-header">
            <span class="preview-badge">💬 Live WhatsApp Preview</span>
            <span class="preview-note">Tampilan yang dilihat oleh nomor tanpa akses</span>
          </div>
          <div class="whatsapp-bubble">
            <p>
              Hai! Senang banget deh kamu udah chat ke sini ✨👋<br><br>
              Tapi maaf ya kalau responnya agak selow, adminnya mungkin lagi sibuk recharge energi atau rebahan manja dulu nih 🛋️☕<br><br>
              Daripada pesan kamu menggantung atau bertepuk sebelah tangan (eh maksudnya kelamaan nunggu hehe 🙈), mending langsung colek admin lewat DM Instagram <strong id="preview-handle" class="highlight-handle">@kevadamar</strong> ya!<br><br>
              Pasti dibalas dan disambut hangat kok. Sampai ketemu di DM ya! 🙌✨
            </p>
          </div>
        </div>
      </div>
    </section>

    <section class="settings-section" aria-labelledby="nlp-heading">
      <div class="section-heading">
        <div>
          <p class="index">02</p>
          <h2 id="nlp-heading">Aturan & Frasa Parser NLP (Bahasa Indonesia)</h2>
        </div>
      </div>

      <div class="settings-card">
        <div class="card-intro">
          <h3>Konfigurasi Pengenalan Bahasa Alami (NLP)</h3>
          <p class="text-muted">
            Sesuaikan kata kerja tugas (task verbs), pemetaan frasa waktu bahasa Indonesia, kata kunci temporal, dan kata pembersih judul (stopwords). Aturan disimpan ke database (<code>bot_settings</code>) dan langsung aktif pada bot WhatsApp & Dashboard.
          </p>
        </div>

        <form id="nlp-settings-form" class="settings-form" onsubmit="return false;">
          <div class="form-group">
            <label for="nlp-verbs-input" class="form-label">Kata Kerja Tugas Kustom (Custom Task Verbs)</label>
            <p class="input-hint">Kata kerja pemicu pengenalan to-do (pisahkan dengan koma). Contoh: <code>minum obat, coding, code review, briefing, evaluasi, setor</code></p>
            <textarea
              id="nlp-verbs-input"
              class="text-input textarea-input"
              rows="3"
            >minum obat, minum vitamin, coding, code review, briefing, evaluasi, setor, nyetor, rekap, bimbingan, solat, shalat</textarea>
          </div>

          <div class="form-group">
            <label for="nlp-phrases-input" class="form-label">Pemetaan Frasa Waktu Kustom (Time Phrases Mapping)</label>
            <p class="input-hint">
              Satu aturan per baris dengan format: <code>frasa => target_waktu</code>. Format target chrono: <code>at HH:mm</code>, <code>tomorrow</code>, <code>tonight</code>, dll.
            </p>
            <textarea
              id="nlp-phrases-input"
              class="text-input textarea-input"
              rows="8"
            >ba'da isya => at 19:30
ba'da maghrib => at 18:30
ba'da ashar => at 15:30
ba'da dzuhur => at 12:30
ba'da subuh => at 05:00
subuh => at 04:30
pulang kantor => at 17:00
jam pulang kerja => at 17:00
tengah malam => at 00:00
siang bolong => at 12:00</textarea>
          </div>

          <div class="form-group">
            <label for="nlp-keywords-input" class="form-label">Kata Kunci Waktu Tambahan (Time Keywords)</label>
            <p class="input-hint">Kata pemicu konteks temporal tambahan (pisahkan dengan koma). Contoh: <code>weekend, akhir pekan, subuh, fajar, senja</code></p>
            <input
              type="text"
              id="nlp-keywords-input"
              class="text-input"
              value="weekend, akhir pekan, subuh, fajar, senja, maghrib, isya, ashar, dzuhur"
            />
          </div>

          <div class="form-group">
            <label for="nlp-stopwords-input" class="form-label">Pembersih Judul Tugas / Stopwords</label>
            <p class="input-hint">Kata-kata pengantar/basa-basi yang otomatis dihapus dari judul to-do (pisahkan dengan koma). Contoh: <code>tolong dong, tolong, dong, plis, please, ya</code></p>
            <input
              type="text"
              id="nlp-stopwords-input"
              class="text-input"
              value="tolong dong, tolong, dong, plis, please, ya, yah, bantu"
            />
          </div>

          <div class="nlp-action-bar">
            <button type="submit" id="save-nlp-btn" class="btn-primary">
              Simpan Aturan NLP
            </button>
            <button type="button" id="reset-nlp-btn" class="btn-secondary">
              Reset ke Default
            </button>
          </div>
        </form>

        <div class="preview-box">
          <div class="preview-header">
            <span class="preview-badge">🧪 Live NLP Parser Simulator</span>
            <span class="preview-note">Uji coba pemrosesan pesan tugas secara instan</span>
          </div>
          <div class="tester-input-group">
            <input
              type="text"
              id="nlp-test-input"
              class="text-input"
              placeholder="Contoh: besok ba'da isya review PR tolong dong"
            />
            <button type="button" id="nlp-test-btn" class="btn-secondary">Uji Parser</button>
          </div>
          <div id="nlp-test-result" class="tester-result-box" hidden></div>
        </div>
      </div>
    </section>
  </main>
</body>
</html>`;

export const SETTINGS_CSS = `
.settings-main {
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem 1.5rem 4rem;
}

.settings-section {
  background: var(--surface, #14171d);
  border: 1px solid var(--border, #242a35);
  border-radius: 8px;
  padding: 1.75rem;
  margin-bottom: 2rem;
}

.settings-card {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.card-intro h3 {
  margin: 0 0 0.5rem;
  font-size: 1.15rem;
  font-weight: 600;
  color: #fff;
}

.text-muted {
  color: var(--muted, #8b949e);
  font-size: 0.9rem;
  line-height: 1.5;
  margin: 0;
}

.settings-form {
  margin-top: 0.5rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-label {
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #c9d1d9;
}

.input-with-action {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.text-input {
  flex: 1;
  background: #0d1117;
  border: 1px solid var(--border, #30363d);
  border-radius: 6px;
  padding: 0.65rem 0.9rem;
  color: #f0f6fc;
  font-family: var(--font-mono, monospace);
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.text-input:focus {
  border-color: #58a6ff;
  box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.2);
}

.btn-primary {
  background: #238636;
  color: #fff;
  border: 1px solid rgba(240, 246, 252, 0.1);
  border-radius: 6px;
  padding: 0.65rem 1.25rem;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, opacity 0.15s;
}

.btn-primary:hover:not(:disabled) {
  background: #2ea043;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.input-hint {
  font-size: 0.8rem;
  color: var(--muted, #8b949e);
  margin: 0;
}

.input-hint code {
  background: rgba(110, 118, 129, 0.2);
  padding: 0.15rem 0.35rem;
  border-radius: 4px;
  color: #58a6ff;
}

.preview-box {
  background: #0d1117;
  border: 1px solid var(--border, #30363d);
  border-radius: 8px;
  padding: 1.25rem;
  margin-top: 0.5rem;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
  font-size: 0.8rem;
}

.preview-badge {
  font-weight: 600;
  color: #58a6ff;
}

.preview-note {
  color: var(--muted, #8b949e);
}

.whatsapp-bubble {
  background: #005c4b;
  color: #e9edef;
  border-radius: 8px;
  padding: 0.9rem 1.1rem;
  font-size: 0.92rem;
  line-height: 1.5;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  position: relative;
}

.whatsapp-bubble p {
  margin: 0;
}

.highlight-handle {
  color: #70e2b5;
  background: rgba(0, 0, 0, 0.2);
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
}

.feedback-banner {
  padding: 0.85rem 1.25rem;
  border-radius: 6px;
  margin-bottom: 1.5rem;
  font-size: 0.9rem;
  font-weight: 500;
}

.feedback-banner.success {
  background: rgba(35, 134, 54, 0.2);
  border: 1px solid #238636;
  color: #3fb950;
}

.feedback-banner.error {
  background: rgba(248, 81, 73, 0.2);
  border: 1px solid #f85149;
  color: #f85149;
}

.textarea-input {
  font-family: var(--font-mono, monospace);
  font-size: 0.88rem;
  line-height: 1.45;
  resize: vertical;
}

.nlp-action-bar {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.btn-secondary {
  background: #21262d;
  color: #c9d1d9;
  border: 1px solid var(--border, #30363d);
  border-radius: 6px;
  padding: 0.65rem 1.25rem;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.btn-secondary:hover:not(:disabled) {
  background: #30363d;
  border-color: #8b949e;
  color: #f0f6fc;
}

.btn-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.tester-input-group {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.tester-result-box {
  background: #161b22;
  border: 1px solid var(--border, #30363d);
  border-radius: 6px;
  padding: 0.85rem 1rem;
  font-size: 0.88rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.tester-result-item {
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
}

.tester-label {
  color: var(--muted, #8b949e);
  font-size: 0.8rem;
  min-width: 140px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.tester-val {
  color: #f0f6fc;
  font-family: var(--font-mono, monospace);
  font-weight: 500;
}

.badge-tag {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
}

.badge-green {
  background: rgba(46, 160, 67, 0.2);
  color: #3fb950;
  border: 1px solid rgba(46, 160, 67, 0.4);
}

.badge-red {
  background: rgba(248, 81, 73, 0.2);
  color: #f85149;
  border: 1px solid rgba(248, 81, 73, 0.4);
}

.badge-blue {
  background: rgba(88, 166, 255, 0.2);
  color: #58a6ff;
  border: 1px solid rgba(88, 166, 255, 0.4);
}
`;

export const SETTINGS_JS = `(() => {
  const form = document.getElementById('settings-form');
  const input = document.getElementById('admin-instagram-input');
  const previewHandle = document.getElementById('preview-handle');
  const saveBtn = document.getElementById('save-settings-btn');
  const banner = document.getElementById('feedback-banner');
  const refreshBtn = document.getElementById('refresh');
  const lastUpdated = document.getElementById('last-updated');

  // NLP Elements
  const nlpForm = document.getElementById('nlp-settings-form');
  const nlpVerbsInput = document.getElementById('nlp-verbs-input');
  const nlpPhrasesInput = document.getElementById('nlp-phrases-input');
  const nlpKeywordsInput = document.getElementById('nlp-keywords-input');
  const nlpStopwordsInput = document.getElementById('nlp-stopwords-input');
  const saveNlpBtn = document.getElementById('save-nlp-btn');
  const resetNlpBtn = document.getElementById('reset-nlp-btn');
  const nlpTestInput = document.getElementById('nlp-test-input');
  const nlpTestBtn = document.getElementById('nlp-test-btn');
  const nlpTestResult = document.getElementById('nlp-test-result');

  function showBanner(msg, isError = false) {
    if (!banner) return;
    banner.hidden = false;
    banner.className = 'feedback-banner ' + (isError ? 'error' : 'success');
    banner.textContent = msg;
    setTimeout(() => {
      banner.hidden = true;
    }, 4000);
  }

  function updatePreview(val) {
    let clean = (val || '').trim();
    if (clean && !clean.startsWith('@')) {
      clean = '@' + clean;
    }
    if (previewHandle) {
      previewHandle.textContent = clean || '@kevadamar';
    }
  }

  const DEFAULT_FORM_RULES = {
    customTaskVerbs: [
      'minum obat', 'minum vitamin', 'coding', 'code review', 'briefing',
      'evaluasi', 'setor', 'nyetor', 'rekap', 'bimbingan', 'solat', 'shalat'
    ],
    customTimePhrases: [
      { phrase: "ba'da isya", replacement: 'at 19:30' },
      { phrase: "ba'da maghrib", replacement: 'at 18:30' },
      { phrase: "ba'da ashar", replacement: 'at 15:30' },
      { phrase: "ba'da dzuhur", replacement: 'at 12:30' },
      { phrase: "ba'da subuh", replacement: 'at 05:00' },
      { phrase: 'subuh', replacement: 'at 04:30' },
      { phrase: 'pulang kantor', replacement: 'at 17:00' },
      { phrase: 'jam pulang kerja', replacement: 'at 17:00' },
      { phrase: 'tengah malam', replacement: 'at 00:00' },
      { phrase: 'siang bolong', replacement: 'at 12:00' }
    ],
    customTimeKeywords: ['weekend', 'akhir pekan', 'subuh', 'fajar', 'senja', 'maghrib', 'isya', 'ashar', 'dzuhur'],
    customStopwords: ['tolong dong', 'tolong', 'dong', 'plis', 'please', 'ya', 'yah', 'bantu']
  };

  function populateNlpFields(rules) {
    const active = rules || DEFAULT_FORM_RULES;
    if (nlpVerbsInput) {
      const verbs = (active.customTaskVerbs && active.customTaskVerbs.length > 0)
        ? active.customTaskVerbs
        : DEFAULT_FORM_RULES.customTaskVerbs;
      nlpVerbsInput.value = verbs.join(', ');
    }
    if (nlpPhrasesInput) {
      const phrases = (active.customTimePhrases && active.customTimePhrases.length > 0)
        ? active.customTimePhrases
        : DEFAULT_FORM_RULES.customTimePhrases;
      nlpPhrasesInput.value = phrases
        .map((r) => \`\${r.phrase} => \${r.replacement}\`)
        .join('\\n');
    }
    if (nlpKeywordsInput) {
      const keywords = (active.customTimeKeywords && active.customTimeKeywords.length > 0)
        ? active.customTimeKeywords
        : DEFAULT_FORM_RULES.customTimeKeywords;
      nlpKeywordsInput.value = keywords.join(', ');
    }
    if (nlpStopwordsInput) {
      const stopwords = (active.customStopwords && active.customStopwords.length > 0)
        ? active.customStopwords
        : DEFAULT_FORM_RULES.customStopwords;
      nlpStopwordsInput.value = stopwords.join(', ');
    }
  }

  function gatherNlpRulesFromForm() {
    const splitComma = (val) =>
      (val || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

    const phrasesLines = (nlpPhrasesInput?.value || '')
      .split('\\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const customTimePhrases = [];
    for (const line of phrasesLines) {
      const parts = line.split(/=>|:/);
      if (parts.length >= 2) {
        const phrase = parts[0].trim().toLowerCase();
        const replacement = parts.slice(1).join(':').trim();
        if (phrase && replacement) {
          customTimePhrases.push({ phrase, replacement });
        }
      }
    }

    return {
      customTaskVerbs: splitComma(nlpVerbsInput?.value),
      customTimePhrases,
      customTimeKeywords: splitComma(nlpKeywordsInput?.value),
      customStopwords: splitComma(nlpStopwordsInput?.value),
    };
  }

  async function loadSettings() {
    try {
      if (lastUpdated) lastUpdated.textContent = 'Memuat data…';
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('Gagal memuat pengaturan');
      const data = await res.json();
      if (input) input.value = data.adminInstagram || '@kevadamar';
      updatePreview(data.adminInstagram || '@kevadamar');

      if (data.nlpRules) {
        populateNlpFields(data.nlpRules);
      }

      if (lastUpdated) {
        const d = new Date();
        lastUpdated.textContent = 'Diperbarui ' + d.toLocaleTimeString('id-ID');
      }
    } catch (err) {
      showBanner(err.message || 'Gagal memuat pengaturan', true);
    }
  }

  if (input) {
    input.addEventListener('input', (e) => {
      updatePreview(e.target.value);
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = (input?.value || '').trim();
      if (!val) {
        showBanner('Username Instagram tidak boleh kosong', true);
        return;
      }

      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Menyimpan…';
      }

      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ adminInstagram: val }),
        });

        const data = await res.json();
        if (res.ok && data.success) {
          showBanner('✅ Akun Instagram admin berhasil disimpan!');
          if (input) input.value = data.adminInstagram;
          updatePreview(data.adminInstagram);
          if (lastUpdated) {
            const d = new Date();
            lastUpdated.textContent = 'Diperbarui ' + d.toLocaleTimeString('id-ID');
          }
        } else {
          showBanner('⚠️ ' + (data.error || 'Gagal menyimpan pengaturan'), true);
        }
      } catch (err) {
        showBanner('Terjadi kesalahan jaringan saat menyimpan', true);
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Simpan Perubahan';
        }
      }
    });
  }

  if (nlpForm) {
    nlpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nlpRules = gatherNlpRulesFromForm();

      if (saveNlpBtn) {
        saveNlpBtn.disabled = true;
        saveNlpBtn.textContent = 'Menyimpan…';
      }

      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nlpRules }),
        });

        const data = await res.json();
        if (res.ok && data.success) {
          showBanner('✅ Aturan NLP berhasil disimpan dan aktif!');
          if (data.nlpRules) {
            populateNlpFields(data.nlpRules);
          }
          if (lastUpdated) {
            const d = new Date();
            lastUpdated.textContent = 'Diperbarui ' + d.toLocaleTimeString('id-ID');
          }
        } else {
          showBanner('⚠️ ' + (data.error || 'Gagal menyimpan aturan NLP'), true);
        }
      } catch (err) {
        showBanner('Terjadi kesalahan jaringan saat menyimpan aturan NLP', true);
      } finally {
        if (saveNlpBtn) {
          saveNlpBtn.disabled = false;
          saveNlpBtn.textContent = 'Simpan Aturan NLP';
        }
      }
    });
  }

  if (resetNlpBtn) {
    resetNlpBtn.addEventListener('click', async () => {
      if (!confirm('Yakin ingin mereset aturan NLP ke pengaturan default?')) return;
      if (resetNlpBtn) {
        resetNlpBtn.disabled = true;
        resetNlpBtn.textContent = 'Mereset…';
      }

      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            nlpRules: {
              customTaskVerbs: [],
              customTimePhrases: [],
              customTimeKeywords: [],
              customStopwords: [],
            },
          }),
        });

        const data = await res.json();
        if (res.ok && data.success) {
          showBanner('✅ Aturan NLP berhasil direset ke default!');
          await loadSettings();
        } else {
          showBanner('⚠️ ' + (data.error || 'Gagal mereset aturan NLP'), true);
        }
      } catch (err) {
        showBanner('Terjadi kesalahan jaringan saat mereset', true);
      } finally {
        if (resetNlpBtn) {
          resetNlpBtn.disabled = false;
          resetNlpBtn.textContent = 'Reset ke Default';
        }
      }
    });
  }

  if (nlpTestBtn && nlpTestInput && nlpTestResult) {
    const runTest = async () => {
      const text = (nlpTestInput.value || '').trim();
      if (!text) {
        showBanner('Masukkan teks tugas terlebih dahulu untuk diuji', true);
        return;
      }

      nlpTestBtn.disabled = true;
      nlpTestBtn.textContent = 'Menguji…';
      nlpTestResult.hidden = false;
      nlpTestResult.innerHTML = '<span class="muted">Memproses pengujian NLP…</span>';

      try {
        const rules = gatherNlpRulesFromForm();
        const res = await fetch('/api/settings/nlp-test', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, nlpRules: rules }),
        });

        const data = await res.json();
        if (res.ok && data.success && data.result) {
          const r = data.result;
          let deadlineText = 'Tidak ada tenggat waktu';
          if (r.deadline) {
            const d = new Date(r.deadline);
            deadlineText = d.toLocaleString('id-ID', {
              timeZone: 'Asia/Jakarta',
              weekday: 'long',
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }) + ' WIB';
          }

          nlpTestResult.innerHTML = \`
            <div class="tester-result-item">
              <span class="tester-label">Status Tugas:</span>
              <span class="tester-val">
                <span class="badge-tag \${r.isTask ? 'badge-green' : 'badge-red'}">
                  \${r.isTask ? '✅ Tugas (isTask: true)' : '❌ Bukan Tugas (isTask: false)'}
                </span>
              </span>
            </div>
            <div class="tester-result-item">
              <span class="tester-label">Judul Tugas:</span>
              <span class="tester-val">\${r.taskTitle || '(kosong)'}</span>
            </div>
            <div class="tester-result-item">
              <span class="tester-label">Tenggat Waktu:</span>
              <span class="tester-val">\${deadlineText}</span>
            </div>
            <div class="tester-result-item">
              <span class="tester-label">Perlu Tenggat:</span>
              <span class="tester-val">\${r.needsDeadline ? 'Ya (needsDeadline: true)' : 'Tidak'}</span>
            </div>
            \${r.reminderLeadMinutes ? \`
            <div class="tester-result-item">
              <span class="tester-label">Pengingat Awal:</span>
              <span class="tester-val">\${r.reminderLeadMinutes} menit sebelum</span>
            </div>\` : ''}
            <div class="tester-result-item">
              <span class="tester-label">Nuansa Sentimen:</span>
              <span class="tester-val">
                <span class="badge-tag badge-blue">\${r.sentiment?.tone || 'neutral'}</span>
              </span>
            </div>
          \`;
        } else {
          nlpTestResult.innerHTML = \`<span style="color:#f85149">⚠️ Gagal menguji: \${data.error || 'Unknown error'}</span>\`;
        }
      } catch (err) {
        nlpTestResult.innerHTML = '<span style="color:#f85149">⚠️ Terjadi kesalahan jaringan saat menguji parser</span>';
      } finally {
        nlpTestBtn.disabled = false;
        nlpTestBtn.textContent = 'Uji Parser';
      }
    };

    nlpTestBtn.addEventListener('click', runTest);
    nlpTestInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runTest();
      }
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadSettings);
  }

  loadSettings();
})();
`;
