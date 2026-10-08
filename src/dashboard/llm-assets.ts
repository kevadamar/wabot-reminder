export const LLM_HTML = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Todo Bot · LLM Calls</title>
  <link rel="stylesheet" href="/dashboard.css">
  <link rel="stylesheet" href="/llm.css">
  <script src="/llm.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#main">Lewati ke konten</a>
  <header class="topbar">
    <div class="topbar-brand">
      <p class="eyebrow">WHATSAPP TASK SERVICE · AI PROVIDERS</p>
      <h1>LLM Calls</h1>
    </div>
    <nav class="topbar-nav" aria-label="Navigasi Halaman">
      <a href="/" class="nav-tab">Overview & Controls</a>
      <a href="/activity" class="nav-tab">Activity (APM)</a>
      <a href="/llm" class="nav-tab active">LLM Calls</a>
      <a href="/settings" class="nav-tab">Settings</a>
    </nav>
    <div class="topbar-actions">
      <label class="llm-auto"><input type="checkbox" id="auto-refresh" checked> Auto 10s</label>
      <span id="last-updated" class="muted" aria-live="polite">Memuat data…</span>
      <button id="refresh" type="button">Refresh</button>
    </div>
  </header>
  <main id="main">
    <section aria-labelledby="llm-summary-title">
      <div class="section-heading">
        <div><p class="index">01</p><h2 id="llm-summary-title">Ringkasan call terbaru</h2></div>
        <span id="payload-mode" class="status">—</span>
      </div>
      <p class="section-desc">Setiap percobaan ke provider (API maupun Antigravity bridge) tercatat di sini, termasuk provider yang dilewati dan fallback ke parser lokal. Data disimpan di memori (maks 300 call terakhir) dan hilang saat bot restart. ID call sama dengan <code>X-Request-Id</code> di log bridge.</p>
      <dl class="metric-strip" id="llm-summary">
        <div><dt>Total call</dt><dd id="sum-total">—</dd></div>
        <div><dt>Sukses</dt><dd id="sum-success">—</dd></div>
        <div><dt>Gagal</dt><dd id="sum-failed">—</dd></div>
        <div><dt>Fallback lokal</dt><dd id="sum-fallback">—</dd></div>
        <div><dt>Rata-rata latensi</dt><dd id="sum-latency">—</dd></div>
      </dl>
      <dl class="data-list" id="llm-providers"></dl>
    </section>

    <section aria-labelledby="llm-calls-title">
      <div class="section-heading">
        <div><p class="index">02</p><h2 id="llm-calls-title">Daftar call</h2></div>
      </div>
      <div class="llm-filters">
        <label>Operasi
          <select id="filter-operation">
            <option value="">Semua</option>
            <option value="nlp_parse">nlp_parse</option>
            <option value="affirmation">affirmation</option>
            <option value="reminder_message">reminder_message</option>
            <option value="morning_motivation">morning_motivation</option>
            <option value="vision_screen">vision_screen</option>
          </select>
        </label>
        <label>Provider
          <select id="filter-provider">
            <option value="">Semua</option>
            <option value="gemini">gemini</option>
            <option value="openai">openai</option>
            <option value="anthropic">anthropic</option>
            <option value="antigravity">antigravity</option>
            <option value="local">local</option>
          </select>
        </label>
        <label>Hasil
          <select id="filter-outcome">
            <option value="">Semua</option>
            <option value="success">Sukses</option>
            <option value="error">Gagal</option>
            <option value="fallback">Fallback lokal</option>
            <option value="skipped">Dilewati</option>
          </select>
        </label>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th scope="col">Waktu</th><th scope="col">ID</th><th scope="col">Operasi</th><th scope="col">Provider · model</th>
            <th scope="col">Hasil</th><th scope="col" class="text-right">Latensi</th><th scope="col" class="text-right">Request</th>
            <th scope="col" class="text-right">Response</th><th scope="col" class="text-right">Token</th><th scope="col"></th>
          </tr></thead>
          <tbody id="llm-body"><tr><td colspan="10">Memuat…</td></tr></tbody>
        </table>
      </div>
    </section>

    <dialog id="llm-modal" class="task-modal" aria-labelledby="llm-modal-title">
      <div class="modal-header">
        <div>
          <span id="llm-modal-id" class="eyebrow block-eyebrow">CALL</span>
          <h3 id="llm-modal-title" class="modal-title">Detail call</h3>
        </div>
        <button type="button" id="llm-modal-close" class="modal-close" aria-label="Tutup dialog">✕</button>
      </div>
      <div id="llm-modal-body" class="modal-body"></div>
    </dialog>
  </main>
</body>
</html>`;

export const LLM_CSS = `
.llm-auto{display:flex;align-items:center;gap:.35rem;font-size:.8rem;color:var(--muted)}
.llm-filters{display:flex;flex-wrap:wrap;gap:1rem;margin-bottom:1rem}
.llm-filters label{display:flex;flex-direction:column;gap:.3rem;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.llm-filters select{background:var(--bg);color:var(--text);border:1px solid var(--line);padding:.45rem .6rem;font:inherit;font-size:.85rem;text-transform:none;letter-spacing:0}
.llm-outcome{display:inline-block;padding:.12rem .5rem;border:1px solid var(--line);font-size:.75rem;font-family:ui-monospace,monospace;white-space:nowrap}
.llm-outcome.ok{color:var(--accent);border-color:var(--accent)}
.llm-outcome.fail{color:var(--danger);border-color:var(--danger)}
.llm-outcome.fallback{color:var(--warn);border-color:var(--warn)}
.llm-outcome.skip{color:var(--muted)}
.llm-mono{font-family:ui-monospace,monospace;font-size:.78rem}
.llm-payload{background:rgba(0,0,0,.3);border:1px solid var(--line);padding:.85rem;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,monospace;font-size:.78rem;max-height:320px;overflow:auto;margin:0}
.llm-section-title{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 .5rem}
#llm-body tr{cursor:pointer}
#llm-body tr:hover td{background:rgba(255,255,255,.03)}
`;

export const LLM_JS = `(() => {
  const el = (id) => document.getElementById(id);
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtMs = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : ms + ' ms');
  const fmtKb = (b) => Math.max(1, Math.round(b / 1024)) + ' KB';
  const cell = (text, cls) => { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; return td; };
  const outcomeClass = (o) => (o === 'success' ? 'ok' : o === 'fallback' ? 'fallback' : o.startsWith('skipped') ? 'skip' : 'fail');
  const badge = (o) => { const s = document.createElement('span'); s.className = 'llm-outcome ' + outcomeClass(o); s.textContent = o; return s; };
  const requestText = (r) => {
    if (r.provider === 'local' || r.outcome.startsWith('skipped')) return '—';
    const chars = r.request.systemChars + r.request.userChars;
    return chars + ' chr' + (r.request.imageCount ? ' + ' + r.request.imageCount + ' img (' + fmtKb(r.request.imageBytes) + ')' : '');
  };
  const tokenText = (u) => (u && (u.promptTokens != null || u.outputTokens != null) ? (u.promptTokens ?? '?') + ' / ' + (u.outputTokens ?? '?') : '—');
  let timer = null;

  async function load() {
    const params = new URLSearchParams({ limit: '300' });
    for (const [key, id] of [['operation', 'filter-operation'], ['provider', 'filter-provider'], ['outcome', 'filter-outcome']]) {
      if (el(id).value) params.set(key, el(id).value);
    }
    el('refresh').disabled = true;
    try {
      const res = await fetch('/api/llm-calls?' + params.toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      render(data);
      el('last-updated').textContent = 'Diperbarui ' + new Date().toLocaleTimeString('id-ID');
    } catch {
      el('last-updated').textContent = 'Gagal memuat data';
    } finally {
      el('refresh').disabled = false;
    }
  }

  function render(data) {
    const calls = data.calls || [];
    const mode = el('payload-mode');
    mode.textContent = data.payloadLogging ? 'PAYLOAD LOGGING ON' : 'METADATA ONLY';
    mode.className = 'status' + (data.payloadLogging ? ' warn' : '');

    const attempts = calls.filter((c) => c.provider !== 'local' && !c.outcome.startsWith('skipped'));
    const success = attempts.filter((c) => c.outcome === 'success');
    el('sum-total').textContent = String(attempts.length);
    el('sum-success').textContent = attempts.length ? success.length + ' (' + Math.round((success.length / attempts.length) * 100) + '%)' : '0';
    el('sum-failed').textContent = String(attempts.length - success.length);
    el('sum-fallback').textContent = String(calls.filter((c) => c.outcome === 'fallback').length);
    el('sum-latency').textContent = success.length ? fmtMs(Math.round(success.reduce((s, c) => s + c.durationMs, 0) / success.length)) : '—';

    const providers = el('llm-providers');
    providers.replaceChildren();
    const byProvider = new Map();
    for (const c of attempts) {
      const p = byProvider.get(c.provider) || { total: 0, ok: 0, ms: 0 };
      p.total++; if (c.outcome === 'success') { p.ok++; p.ms += c.durationMs; }
      byProvider.set(c.provider, p);
    }
    for (const [name, p] of byProvider) {
      const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = name;
      dd.textContent = p.ok + '/' + p.total + ' sukses' + (p.ok ? ' · rata-rata ' + fmtMs(Math.round(p.ms / p.ok)) : '');
      row.append(dt, dd); providers.append(row);
    }

    const body = el('llm-body');
    body.replaceChildren();
    if (!calls.length) {
      const tr = document.createElement('tr'); const td = cell('Belum ada call LLM sejak bot terakhir dijalankan.'); td.colSpan = 10; tr.append(td); body.append(tr);
      return;
    }
    for (const c of calls) {
      const tr = document.createElement('tr');
      const outcomeTd = document.createElement('td'); outcomeTd.append(badge(c.outcome));
      const target = c.model ? c.provider + ' · ' + c.model : c.provider;
      tr.append(
        cell(fmtTime(c.at), 'llm-mono'),
        cell(c.id, 'llm-mono'),
        cell(c.operation),
        cell(target),
        outcomeTd,
        cell(c.provider === 'local' || c.outcome.startsWith('skipped') ? '—' : fmtMs(c.durationMs), 'text-right'),
        cell(requestText(c), 'text-right'),
        cell(c.response ? c.response.chars + ' chr' : '—', 'text-right'),
        cell(tokenText(c.usage), 'text-right'),
        cell(c.hasPayload ? '📄' : '')
      );
      tr.addEventListener('click', () => openDetail(c.id));
      body.append(tr);
    }
  }

  function section(title, node) {
    const wrap = document.createElement('div');
    const h = document.createElement('p'); h.className = 'llm-section-title'; h.textContent = title;
    wrap.append(h, node);
    return wrap;
  }

  function pre(text) { const p = document.createElement('pre'); p.className = 'llm-payload'; p.textContent = text; return p; }

  async function openDetail(id) {
    const modal = el('llm-modal'), body = el('llm-modal-body');
    el('llm-modal-id').textContent = 'CALL ' + id;
    el('llm-modal-title').textContent = 'Memuat…';
    body.replaceChildren();
    modal.showModal();
    try {
      const res = await fetch('/api/llm-calls/detail?id=' + encodeURIComponent(id), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const r = await res.json();
      el('llm-modal-title').textContent = r.operation + ' → ' + r.provider + (r.model ? ' (' + r.model + ')' : '');
      const grid = document.createElement('dl'); grid.className = 'detail-grid';
      const rows = [
        ['Waktu', new Date(r.at).toLocaleString('id-ID')],
        ['Hasil', r.outcome],
        ['Latensi', fmtMs(r.durationMs)],
        ['Chain / percobaan', r.chainId + ' / #' + r.seq],
        ['HTTP status', r.httpStatus ?? '—'],
        ['Upstream request ID', r.providerRequestId ?? '—'],
        ['System prompt', r.request.systemChars + ' karakter'],
        ['Pesan user', r.request.userChars + ' karakter'],
        ['Gambar', r.request.imageCount ? r.request.imageCount + ' (' + fmtKb(r.request.imageBytes) + ')' : '—'],
        ['Response', r.response ? r.response.chars + ' karakter' : '—'],
        ['Token (prompt / output)', tokenText(r.usage)],
        ['Total token', r.usage && r.usage.totalTokens != null ? r.usage.totalTokens : '—'],
      ];
      for (const [k, v] of rows) {
        const d = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
        dt.textContent = k; dd.textContent = String(v); d.append(dt, dd); grid.append(d);
      }
      body.append(grid);
      if (r.errorDetail) body.append(section('Detail error', pre(r.errorDetail)));
      if (r.payload) {
        body.append(section('Pesan user (disensor)', pre(r.payload.user)));
        if (r.payload.response !== null) body.append(section('Response mentah (disensor)', pre(r.payload.response)));
        body.append(section('System prompt (disensor)', pre(r.payload.system)));
      } else if (r.provider !== 'local' && !r.outcome.startsWith('skipped')) {
        const note = document.createElement('p'); note.className = 'muted';
        note.textContent = 'Isi prompt/response tidak dicatat. Set LLM_LOG_PAYLOADS=true untuk melihatnya (disensor & dipotong).';
        body.append(note);
      }
    } catch {
      el('llm-modal-title').textContent = 'Call tidak ditemukan (mungkin sudah tergeser call yang lebih baru)';
    }
  }

  function schedule() {
    if (timer) clearInterval(timer);
    timer = el('auto-refresh').checked ? setInterval(() => { if (!el('llm-modal').open) load(); }, 10000) : null;
  }

  el('refresh').addEventListener('click', load);
  for (const id of ['filter-operation', 'filter-provider', 'filter-outcome']) el(id).addEventListener('change', load);
  el('auto-refresh').addEventListener('change', schedule);
  el('llm-modal-close').addEventListener('click', () => el('llm-modal').close());
  el('llm-modal').addEventListener('click', (e) => { if (e.target === el('llm-modal')) el('llm-modal').close(); });
  load();
  schedule();
})();
`;
