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
`;

export const SETTINGS_JS = `(() => {
  const form = document.getElementById('settings-form');
  const input = document.getElementById('admin-instagram-input');
  const previewHandle = document.getElementById('preview-handle');
  const saveBtn = document.getElementById('save-settings-btn');
  const banner = document.getElementById('feedback-banner');
  const refreshBtn = document.getElementById('refresh');
  const lastUpdated = document.getElementById('last-updated');

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

  async function loadSettings() {
    try {
      if (lastUpdated) lastUpdated.textContent = 'Memuat data…';
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('Gagal memuat pengaturan');
      const data = await res.json();
      if (input) input.value = data.adminInstagram || '@kevadamar';
      updatePreview(data.adminInstagram || '@kevadamar');
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

  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadSettings);
  }

  loadSettings();
})();
`;
