export const ACTIVITY_HTML = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Todo Bot · Activity (APM)</title>
  <link rel="stylesheet" href="/dashboard.css">
  <link rel="stylesheet" href="/activity.css">
  <script src="/activity.js" defer></script>
</head>
<body class="activity-page">
  <a class="skip-link" href="#main">Lewati ke konten</a>
  <header class="topbar">
    <div class="topbar-brand">
      <p class="eyebrow">WHATSAPP TASK SERVICE · OBSERVABILITY</p>
      <div class="title-with-badge">
        <h1>Activity</h1>
        <span class="pro-badge">PRO</span>
      </div>
    </div>
    <nav class="topbar-nav" aria-label="Navigasi Halaman">
      <a href="/" class="nav-tab">Overview & Controls</a>
      <a href="/activity" class="nav-tab active">Activity (APM)</a>
      <a href="/settings" class="nav-tab">Settings</a>
    </nav>
    <div class="topbar-actions">
      <div class="filter-dropdown-wrap">
        <label for="path-filter" class="filter-label">Path:</label>
        <select id="path-filter" class="path-select" aria-label="Filter berdasarkan path">
          <option value="all">All</option>
          <option value="http">HTTP APIs</option>
          <option value="bot">Bot & AI Operations</option>
        </select>
      </div>
      <span id="last-updated" class="muted" aria-live="polite">Memuat data…</span>
      <button id="refresh" type="button">Refresh</button>
    </div>
  </header>

  <main id="main" class="activity-main">
    <!-- Top Card: Requests -->
    <section class="activity-card requests-card" aria-labelledby="requests-heading">
      <div class="activity-card-header">
        <div class="metric-lead">
          <h2 id="requests-heading" class="card-title">Requests</h2>
          <div class="stat-columns">
            <div class="stat-col">
              <span class="stat-label">Total requests</span>
              <span id="total-requests" class="stat-value">—</span>
            </div>
            <div class="stat-col">
              <span class="stat-label">Error rate</span>
              <span id="error-rate" class="stat-value">—</span>
            </div>
          </div>
        </div>
        <div class="legend-group">
          <span class="legend-item"><span class="legend-dot dot-2xx"></span> 2XX</span>
          <span class="legend-item"><span class="legend-dot dot-4xx"></span> 4XX</span>
          <span class="legend-item"><span class="legend-dot dot-5xx"></span> 5XX</span>
        </div>
      </div>
      <div class="chart-container" id="requests-chart-wrap">
        <div id="requests-chart-view" class="chart-view">
          <p class="chart-loading">Memuat grafik requests…</p>
        </div>
        <div id="requests-tooltip" class="activity-tooltip" hidden></div>
      </div>
    </section>

    <!-- Bottom Split Grid: Response Latency & Paths -->
    <div class="activity-split-grid">
      <!-- Response Latency Card -->
      <section class="activity-card latency-card" aria-labelledby="latency-heading">
        <div class="activity-card-header">
          <div class="metric-lead">
            <h2 id="latency-heading" class="card-title">Response Latency</h2>
            <div class="stat-columns">
              <div class="stat-col">
                <span class="stat-label">Latest P50</span>
                <span id="latest-p50" class="stat-value">—</span>
              </div>
              <div class="stat-col">
                <span class="stat-label">Latest P95</span>
                <span id="latest-p95" class="stat-value">—</span>
              </div>
            </div>
          </div>
          <div class="legend-group">
            <span class="legend-item"><span class="legend-dot dot-p50"></span> p50</span>
            <span class="legend-item"><span class="legend-dot dot-p95"></span> p95</span>
          </div>
        </div>
        <div class="chart-container" id="latency-chart-wrap">
          <div id="latency-chart-view" class="chart-view">
            <p class="chart-loading">Memuat grafik latency…</p>
          </div>
          <div id="latency-tooltip" class="activity-tooltip" hidden></div>
        </div>
      </section>

      <!-- Paths Card -->
      <section class="activity-card paths-card" aria-labelledby="paths-heading">
        <div class="activity-card-header">
          <h2 id="paths-heading" class="card-title">Paths</h2>
        </div>
        <div class="table-wrap paths-table-wrap">
          <table class="paths-table" id="paths-table">
            <thead>
              <tr>
                <th scope="col" class="th-sortable" data-sort="path">Path</th>
                <th scope="col" class="th-sortable text-right" data-sort="requests">Requests <span class="sort-icon" id="sort-requests-icon">↓</span></th>
                <th scope="col" class="th-sortable text-right" data-sort="errorRate">Error rate <span class="sort-icon" id="sort-error-icon">⇅</span></th>
                <th scope="col" class="th-sortable text-right" data-sort="p95">P95 latency <span class="sort-icon" id="sort-p95-icon">⇅</span></th>
              </tr>
            </thead>
            <tbody id="paths-table-body">
              <tr><td colspan="4" class="text-center muted">Memuat data paths…</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </main>
  <footer>Bot Control Room & APM Observability · OpenTelemetry Activity Dashboard</footer>
</body>
</html>`;

export const ACTIVITY_CSS = `
/* Activity APM Specific Styling */
.activity-page {
  background: #090a0d;
  color: #f1f5f9;
}
.activity-main {
  max-width: 1440px;
  margin: 0 auto;
  padding: 1.5rem clamp(1rem, 4vw, 4rem);
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.title-with-badge {
  display: flex;
  align-items: center;
  gap: .65rem;
}
.title-with-badge h1 {
  font-size: clamp(1.8rem, 4vw, 2.5rem);
  font-weight: 700;
  letter-spacing: -0.03em;
  margin: 0;
}
.pro-badge {
  display: inline-block;
  background: #1e2229;
  color: #94a3b8;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .65rem;
  font-weight: 700;
  padding: .15rem .45rem;
  border-radius: 4px;
  border: 1px solid #333942;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.filter-dropdown-wrap {
  display: flex;
  align-items: center;
  gap: .4rem;
  font-size: .82rem;
  color: #94a3b8;
}
.path-select {
  background: #14171d;
  border: 1px solid #282f3a;
  color: #e2e8f0;
  padding: .4rem .75rem;
  border-radius: 6px;
  font: inherit;
  font-size: .82rem;
  cursor: pointer;
}
.path-select:focus {
  outline: 2px solid #8ee3b0;
  border-color: transparent;
}
.activity-card {
  background: #0f1115;
  border: 1px solid #1f242d;
  border-radius: 8px;
  padding: 1.5rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  position: relative;
}
.activity-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
}
.card-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: #f1f5f9;
  letter-spacing: -0.01em;
  margin: 0;
}
.metric-lead {
  display: flex;
  flex-direction: column;
  gap: .75rem;
}
.stat-columns {
  display: flex;
  align-items: flex-end;
  gap: 3rem;
  flex-wrap: wrap;
}
.stat-col {
  display: flex;
  flex-direction: column;
  gap: .2rem;
}
.stat-label {
  font-size: .78rem;
  color: #94a3b8;
  font-weight: 500;
}
.stat-value {
  font-size: 1.75rem;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: -0.03em;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  line-height: 1;
}
.legend-group {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  font-size: .78rem;
  color: #94a3b8;
  font-weight: 600;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: .45rem;
}
.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.dot-2xx { background: #22c55e; }
.dot-4xx { background: #f59e0b; }
.dot-5xx { background: #ef4444; }
.dot-p50 { background: #10b981; }
.dot-p95 { background: #f59e0b; }

.chart-container {
  position: relative;
  width: 100%;
  min-height: 220px;
}
.chart-view {
  width: 100%;
  overflow-x: auto;
}
.chart-view svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}
.chart-loading {
  color: #64748b;
  font-size: .85rem;
  padding: 3rem 0;
  text-align: center;
}

.activity-split-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
}
.paths-table-wrap {
  overflow-x: auto;
  margin-top: .5rem;
  border: 1px solid #1f242d;
  border-radius: 6px;
}
.paths-table {
  width: 100%;
  border-collapse: collapse;
  font-size: .82rem;
}
.paths-table th, .paths-table td {
  padding: .75rem 1rem;
  border-bottom: 1px solid #1a1e26;
}
.paths-table th {
  background: #14171d;
  color: #94a3b8;
  font-size: .75rem;
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
}
.paths-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.02);
}
.path-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #e2e8f0;
}
.th-sortable {
  cursor: pointer;
  user-select: none;
}
.th-sortable:hover {
  color: #ffffff;
}
.sort-icon {
  display: inline-block;
  font-size: .75rem;
  opacity: .7;
}

/* Tooltip */
.activity-tooltip {
  position: absolute;
  background: #181b22;
  border: 1px solid #2e3543;
  color: #f8fafc;
  padding: .5rem .75rem;
  border-radius: 6px;
  font-size: .75rem;
  pointer-events: none;
  z-index: 100;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  white-space: nowrap;
  font-family: ui-sans-serif, system-ui, sans-serif;
  transform: translate(-50%, -105%);
}
.tooltip-title {
  font-weight: 700;
  color: #94a3b8;
  margin-bottom: .3rem;
  font-size: .7rem;
}
.tooltip-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  line-height: 1.4;
}

@media (max-width: 960px) {
  .activity-split-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 600px) {
  .stat-columns {
    gap: 1.5rem;
  }
  .stat-value {
    font-size: 1.4rem;
  }
}
`;

export const ACTIVITY_JS = `
const el = id => document.getElementById(id);
const text = (id, val) => { const node = el(id); if (node) node.textContent = val ?? '—'; };
const fmtNum = n => {
  if (n === null || n === undefined) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\\.0$/, '') + 'K';
  return String(n);
};

let rawActivityData = null;
let currentSort = { column: 'requests', asc: false };

async function fetchActivityData() {
  const filter = el('path-filter')?.value || 'all';
  text('last-updated', 'Memuat data…');
  try {
    const res = await fetch('/api/activity?filter=' + encodeURIComponent(filter));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    rawActivityData = data;
    renderActivity(data);
    text('last-updated', 'Diperbarui ' + new Date().toLocaleTimeString('id-ID'));
  } catch (err) {
    console.error('Failed to load activity data:', err);
    text('last-updated', 'Gagal memuat');
  }
}

function renderActivity(data) {
  if (!data) return;
  // Summary
  text('total-requests', fmtNum(data.summary.totalRequests));
  text('error-rate', (data.summary.errorRate < 0.1 && data.summary.errorRate > 0 ? '<0.1' : data.summary.errorRate.toFixed(1)) + '%');
  text('latest-p50', data.summary.latestP50 + ' ms');
  text('latest-p95', data.summary.latestP95 + ' ms');

  // Charts
  renderRequestsChart(data.series || []);
  renderLatencyChart(data.series || []);
  renderPathsTable(data.paths || []);
}

function renderRequestsChart(series) {
  const container = el('requests-chart-view');
  if (!container) return;
  if (!series.length) {
    container.innerHTML = '<p class="chart-loading">Belum ada telemetry requests.</p>';
    return;
  }

  // Dimensions
  const W = 1000;
  const H = 240;
  const padLeft = 45;
  const padBottom = 28;
  const padTop = 15;
  const padRight = 15;

  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  // Max total for Y-scale
  const maxVal = Math.max(...series.map(s => s.total || 0), 10);
  const yMax = Math.ceil(maxVal * 1.15);

  const numBuckets = series.length;
  const slotWidth = chartW / numBuckets;
  const barWidth = Math.max(3, Math.min(18, slotWidth * 0.65));

  // Y-axis step guides (4 grid lines)
  const gridSteps = 4;
  let gridSvg = '';
  for (let i = 0; i <= gridSteps; i++) {
    const val = Math.round((yMax / gridSteps) * i);
    const y = padTop + chartH - (i / gridSteps) * chartH;
    gridSvg += \`<line x1="\${padLeft}" y1="\${y}" x2="\${W - padRight}" y2="\${y}" stroke="#1f242d" stroke-width="1" stroke-dasharray="2 3"/>\`;
    gridSvg += \`<text x="\${padLeft - 8}" y="\${y + 4}" fill="#64748b" font-size="11" font-family="ui-sans-serif, system-ui" text-anchor="end">\${fmtNum(val)}</text>\`;
  }

  // Bars and X-labels
  let barsSvg = '';
  let labelsSvg = '';
  const tooltip = el('requests-tooltip');

  series.forEach((s, idx) => {
    const xCenter = padLeft + idx * slotWidth + slotWidth / 2;
    const x = xCenter - barWidth / 2;

    const hTotal = (s.total / yMax) * chartH;
    const h2xx = (s.status2xx / yMax) * chartH;
    const h4xx = (s.status4xx / yMax) * chartH;
    const h5xx = (s.status5xx / yMax) * chartH;

    const yBase = padTop + chartH;
    const y2xx = yBase - h2xx;
    const y4xx = y2xx - h4xx;
    const y5xx = y4xx - h5xx;

    // Segment 2XX
    if (h2xx > 0) {
      barsSvg += \`<rect class="bar-seg" x="\${x}" y="\${y2xx}" width="\${barWidth}" height="\${h2xx}" fill="#22c55e" rx="1.5"/>\`;
    }
    // Segment 4XX
    if (h4xx > 0) {
      barsSvg += \`<rect class="bar-seg" x="\${x}" y="\${y4xx}" width="\${barWidth}" height="\${h4xx}" fill="#f59e0b" rx="1"/>\`;
    }
    // Segment 5XX
    if (h5xx > 0) {
      barsSvg += \`<rect class="bar-seg" x="\${x}" y="\${y5xx}" width="\${barWidth}" height="\${h5xx}" fill="#ef4444" rx="1"/>\`;
    }

    // Invisible hover area
    barsSvg += \`<rect class="bar-hover-zone" data-idx="\${idx}" x="\${xCenter - slotWidth / 2}" y="\${padTop}" width="\${slotWidth}" height="\${chartH}" fill="transparent" style="cursor:pointer;"/>\`;

    // Show label every 2 buckets or at ends
    if (idx % 2 === 0 || idx === series.length - 1) {
      labelsSvg += \`<text x="\${xCenter}" y="\${H - 6}" fill="#64748b" font-size="11" font-family="ui-sans-serif, system-ui" text-anchor="middle">\${s.label}</text>\`;
    }
  });

  const svgHtml = \`
    <svg viewBox="0 0 \${W} \${H}" preserveAspectRatio="none" style="width:100%;height:220px;">
      \${gridSvg}
      \${barsSvg}
      \${labelsSvg}
    </svg>
  \`;

  container.innerHTML = svgHtml;

  // Add mouse listeners for hover zone
  container.querySelectorAll('.bar-hover-zone').forEach(zone => {
    zone.addEventListener('mouseenter', e => {
      const idx = parseInt(zone.dataset.idx, 10);
      const s = series[idx];
      if (!s || !tooltip) return;

      tooltip.innerHTML = \`
        <div class="tooltip-title">\${s.label} · \${new Date(s.timestamp).toLocaleDateString('id-ID')}</div>
        <div class="tooltip-row"><span style="color:#22c55e">● 2XX (Success):</span> <strong>\${s.status2xx}</strong></div>
        <div class="tooltip-row"><span style="color:#f59e0b">● 4XX (Client):</span> <strong>\${s.status4xx}</strong></div>
        <div class="tooltip-row"><span style="color:#ef4444">● 5XX (Error):</span> <strong>\${s.status5xx}</strong></div>
        <div class="tooltip-row" style="border-top:1px solid #333;margin-top:4px;padding-top:2px;"><span>Total:</span> <strong>\${s.total}</strong></div>
      \`;
      tooltip.hidden = false;

      const rect = zone.getBoundingClientRect();
      const parentRect = el('requests-chart-wrap').getBoundingClientRect();
      tooltip.style.left = (rect.left + rect.width / 2 - parentRect.left) + 'px';
      tooltip.style.top = (rect.top - parentRect.top - 10) + 'px';
    });

    zone.addEventListener('mouseleave', () => {
      if (tooltip) tooltip.hidden = true;
    });
  });
}

function renderLatencyChart(series) {
  const container = el('latency-chart-view');
  if (!container) return;
  if (!series.length) {
    container.innerHTML = '<p class="chart-loading">Belum ada telemetry latency.</p>';
    return;
  }

  const W = 500;
  const H = 220;
  const padLeft = 45;
  const padBottom = 28;
  const padTop = 15;
  const padRight = 15;

  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  const maxVal = Math.max(...series.map(s => Math.max(s.p95 || 0, s.p50 || 0)), 50);
  const yMax = Math.ceil((maxVal * 1.2) / 50) * 50;

  // Grid steps (0 ms, 75 ms, 150 ms, ...)
  const gridSteps = 4;
  let gridSvg = '';
  for (let i = 0; i <= gridSteps; i++) {
    const val = Math.round((yMax / gridSteps) * i);
    const y = padTop + chartH - (i / gridSteps) * chartH;
    gridSvg += \`<line x1="\${padLeft}" y1="\${y}" x2="\${W - padRight}" y2="\${y}" stroke="#1f242d" stroke-width="1" stroke-dasharray="2 3"/>\`;
    gridSvg += \`<text x="\${padLeft - 8}" y="\${y + 4}" fill="#64748b" font-size="10" font-family="ui-sans-serif, system-ui" text-anchor="end">\${val} ms</text>\`;
  }

  const numPoints = series.length;
  const slotWidth = chartW / (numPoints - 1 || 1);

  // Compute points
  const p50Points = [];
  const p95Points = [];

  series.forEach((s, idx) => {
    const x = padLeft + idx * slotWidth;
    const y50 = padTop + chartH - ((s.p50 || 0) / yMax) * chartH;
    const y95 = padTop + chartH - ((s.p95 || 0) / yMax) * chartH;
    p50Points.push(\`\${x.toFixed(1)},\${y50.toFixed(1)}\`);
    p95Points.push(\`\${x.toFixed(1)},\${y95.toFixed(1)}\`);
  });

  // Labels
  let labelsSvg = '';
  series.forEach((s, idx) => {
    if (idx % 4 === 0 || idx === series.length - 1) {
      const x = padLeft + idx * slotWidth;
      labelsSvg += \`<text x="\${x}" y="\${H - 6}" fill="#64748b" font-size="10" font-family="ui-sans-serif, system-ui" text-anchor="middle">\${s.label}</text>\`;
    }
  });

  const p50Poly = p50Points.join(' ');
  const p95Poly = p95Points.join(' ');

  // Hover target points
  let hoverSvg = '';
  series.forEach((s, idx) => {
    const x = padLeft + idx * slotWidth;
    hoverSvg += \`<circle class="latency-hover-node" data-idx="\${idx}" cx="\${x}" cy="\${padTop + chartH / 2}" r="8" fill="transparent" style="cursor:pointer;"/>\`;
  });

  const svgHtml = \`
    <svg viewBox="0 0 \${W} \${H}" preserveAspectRatio="none" style="width:100%;height:220px;">
      \${gridSvg}
      <polyline points="\${p50Poly}" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="\${p95Poly}" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      \${labelsSvg}
      \${hoverSvg}
    </svg>
  \`;

  container.innerHTML = svgHtml;

  const tooltip = el('latency-tooltip');
  container.querySelectorAll('.latency-hover-node').forEach(node => {
    node.addEventListener('mouseenter', () => {
      const idx = parseInt(node.dataset.idx, 10);
      const s = series[idx];
      if (!s || !tooltip) return;

      tooltip.innerHTML = \`
        <div class="tooltip-title">\${s.label} · Latency</div>
        <div class="tooltip-row"><span style="color:#10b981">● P50 Latency:</span> <strong>\${s.p50} ms</strong></div>
        <div class="tooltip-row"><span style="color:#f59e0b">● P95 Latency:</span> <strong>\${s.p95} ms</strong></div>
      \`;
      tooltip.hidden = false;

      const rect = node.getBoundingClientRect();
      const parentRect = el('latency-chart-wrap').getBoundingClientRect();
      tooltip.style.left = (rect.left - parentRect.left) + 'px';
      tooltip.style.top = (rect.top - parentRect.top - 10) + 'px';
    });

    node.addEventListener('mouseleave', () => {
      if (tooltip) tooltip.hidden = true;
    });
  });
}

function renderPathsTable(paths) {
  const tbody = el('paths-table-body');
  if (!tbody) return;

  if (!paths || !paths.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center muted">Belum ada data paths.</td></tr>';
    return;
  }

  // Apply sorting
  const sorted = [...paths].sort((a, b) => {
    let valA = a[currentSort.column];
    let valB = b[currentSort.column];
    if (typeof valA === 'string') {
      return currentSort.asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return currentSort.asc ? valA - valB : valB - valA;
  });

  tbody.innerHTML = sorted.map(item => {
    const errText = item.errorRate < 0.1 && item.errorRate > 0 ? '<0.1%' : (item.errorRate.toFixed(1) + '%');
    return \`
      <tr>
        <td class="path-code">\${item.path}</td>
        <td class="text-right">\${fmtNum(item.requests)}</td>
        <td class="text-right">\${errText}</td>
        <td class="text-right">\${item.p95Latency} ms</td>
      </tr>
    \`;
  }).join('');
}

// Setup sort listeners
document.querySelectorAll('.th-sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (currentSort.column === col) {
      currentSort.asc = !currentSort.asc;
    } else {
      currentSort.column = col;
      currentSort.asc = false;
    }

    // Update icons
    document.querySelectorAll('.sort-icon').forEach(icon => icon.textContent = '⇅');
    const activeIcon = th.querySelector('.sort-icon');
    if (activeIcon) activeIcon.textContent = currentSort.asc ? '↑' : '↓';

    if (rawActivityData?.paths) {
      renderPathsTable(rawActivityData.paths);
    }
  });
});

el('path-filter')?.addEventListener('change', fetchActivityData);
el('refresh')?.addEventListener('click', fetchActivityData);

fetchActivityData();
setInterval(fetchActivityData, 60000);
`;
