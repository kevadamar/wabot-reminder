export const DASHBOARD_HTML = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Todo Bot · Monitoring</title>
  <link rel="stylesheet" href="/dashboard.css">
  <script src="/dashboard.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#main">Lewati ke konten</a>
  <header class="topbar">
    <div>
      <p class="eyebrow">WHATSAPP TASK SERVICE</p>
      <h1>Bot Control Room</h1>
    </div>
    <div class="topbar-actions">
      <span id="last-updated" class="muted" aria-live="polite">Memuat data…</span>
      <button id="refresh" type="button">Refresh</button>
    </div>
  </header>
  <main id="main">
    <section aria-labelledby="health-title">
      <div class="section-heading">
        <div><p class="index">01</p><h2 id="health-title">Runtime health</h2></div>
        <span id="overall-status" class="status">CHECKING</span>
      </div>
      <dl class="metric-strip">
        <div><dt>WhatsApp</dt><dd id="whatsapp-status">—</dd></div>
        <div><dt>Uptime</dt><dd id="uptime">—</dd></div>
        <div><dt>Memory RSS</dt><dd id="memory">—</dd></div>
        <div><dt>Reminder cycle</dt><dd id="reminder-cycle">—</dd></div>
        <div><dt>Morning digest</dt><dd id="digest-cycle">—</dd></div>
      </dl>
    </section>

    <section class="split" aria-label="Operational summary">
      <article aria-labelledby="tasks-title">
        <div class="section-heading compact"><div><p class="index">02</p><h2 id="tasks-title">Task state</h2></div></div>
        <dl id="task-metrics" class="data-list"><div><dt>Memuat</dt><dd>—</dd></div></dl>
      </article>
      <article aria-labelledby="users-title">
        <div class="section-heading compact"><div><p class="index">03</p><h2 id="users-title">Adoption & storage</h2></div></div>
        <dl class="data-list">
          <div><dt>Allowed users</dt><dd id="allowed-users">—</dd></div>
          <div><dt>Morning digest aktif</dt><dd id="digest-users">—</dd></div>
          <div><dt>Attachments</dt><dd id="attachments">—</dd></div>
          <div><dt>Attachment bytes</dt><dd id="attachment-bytes">—</dd></div>
        </dl>
      </article>
    </section>

    <section aria-labelledby="usage-title">
      <div class="section-heading"><div><p class="index">04</p><h2 id="usage-title">Usage · 24 jam</h2></div></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th scope="col">Metric</th><th scope="col">Dimension</th><th scope="col">Count</th><th scope="col">Total</th><th scope="col">Max</th></tr></thead>
          <tbody id="usage-body"><tr><td colspan="5">Memuat telemetry…</td></tr></tbody>
        </table>
      </div>
    </section>

    <section aria-labelledby="errors-title">
      <div class="section-heading"><div><p class="index">05</p><h2 id="errors-title">Recent sanitized errors</h2></div></div>
      <div id="errors" class="event-list" aria-live="polite"><p class="empty">Memuat event…</p></div>
    </section>
    <p id="page-error" class="page-error" role="alert" hidden></p>
  </main>
  <footer>Read-only operational view · Tidak menyimpan isi pesan atau task</footer>
</body>
</html>`;

export const DASHBOARD_CSS = `
:root{--bg:#111513;--surface:#171c19;--line:#303832;--text:#edf3ef;--muted:#9ca9a1;--accent:#8ee3b0;--warn:#ffcf70;--danger:#ff8b84;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text);background:var(--bg)}
*{box-sizing:border-box}body{margin:0;min-width:320px;background:var(--bg);line-height:1.5}.skip-link{position:absolute;left:1rem;top:-4rem;background:var(--accent);color:#08110b;padding:.6rem 1rem;z-index:10}.skip-link:focus{top:1rem}.topbar{display:flex;justify-content:space-between;align-items:flex-end;gap:2rem;padding:2rem clamp(1rem,4vw,4rem);border-bottom:1px solid var(--line)}h1,h2,p{margin:0}h1{font-size:clamp(2rem,5vw,4.5rem);letter-spacing:-.055em;line-height:.95;font-weight:650}h2{font-size:1.05rem;letter-spacing:.02em}.eyebrow,.index{font:600 .7rem/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em;color:var(--accent);margin-bottom:.65rem}.topbar-actions{display:flex;align-items:center;gap:1rem}.muted{color:var(--muted);font-size:.85rem}button{font:inherit;font-weight:650;color:var(--bg);background:var(--accent);border:0;padding:.65rem 1rem;cursor:pointer}button:hover{filter:brightness(1.08)}button:focus-visible,a:focus-visible{outline:3px solid var(--warn);outline-offset:3px}main{max-width:1440px;margin:auto;padding:0 clamp(1rem,4vw,4rem)}section,article{padding:2rem 0;border-bottom:1px solid var(--line)}.section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem}.section-heading.compact{margin-bottom:.6rem}.section-heading>div{display:flex;align-items:baseline;gap:.8rem}.section-heading .index{margin:0}.status{font:700 .75rem ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent);border:1px solid currentColor;padding:.3rem .55rem}.status.warn{color:var(--warn)}.status.danger{color:var(--danger)}.metric-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin:0;border:1px solid var(--line)}.metric-strip>div{padding:1rem;border-right:1px solid var(--line)}.metric-strip>div:last-child{border:0}dt{color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.08em}dd{margin:.35rem 0 0;font-size:1.2rem;font-weight:650}.split{display:grid;grid-template-columns:1fr 1fr;gap:3rem}.split article{border:0;padding:0}.data-list{margin:0}.data-list>div{display:flex;justify-content:space-between;gap:1rem;padding:.8rem 0;border-bottom:1px solid var(--line)}.data-list dd{margin:0;font-size:1rem}.table-wrap{overflow-x:auto;border:1px solid var(--line)}table{width:100%;border-collapse:collapse;font-size:.85rem}th,td{text-align:left;padding:.75rem 1rem;border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;background:var(--surface)}td:nth-child(n+3),th:nth-child(n+3){text-align:right;font-variant-numeric:tabular-nums}.event-list{display:grid;gap:.5rem}.event{display:grid;grid-template-columns:minmax(10rem,.7fr) 1fr 1fr;gap:1rem;padding:.8rem 0;border-bottom:1px solid var(--line);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem}.event time,.empty{color:var(--muted)}.page-error{margin:1rem 0;padding:1rem;border:1px solid var(--danger);color:var(--danger)}footer{padding:2rem clamp(1rem,4vw,4rem);color:var(--muted);font-size:.75rem;text-align:center}@media(max-width:800px){.topbar{align-items:flex-start;flex-direction:column}.topbar-actions{width:100%;justify-content:space-between}.metric-strip{grid-template-columns:1fr 1fr}.metric-strip>div{border-bottom:1px solid var(--line)}.split{grid-template-columns:1fr;gap:0}.event{grid-template-columns:1fr}.event span{overflow-wrap:anywhere}}@media(max-width:420px){.metric-strip{grid-template-columns:1fr}.metric-strip>div{border-right:0}}
`;

export const DASHBOARD_JS = `
const el=id=>document.getElementById(id);const text=(id,value)=>{el(id).textContent=value??'—'};const number=value=>new Intl.NumberFormat('id-ID').format(value||0);const bytes=value=>{const units=['B','KB','MB','GB'];let n=Number(value||0),i=0;while(n>=1024&&i<units.length-1){n/=1024;i++}return n.toFixed(i?1:0)+' '+units[i]};const ago=value=>value?new Intl.RelativeTimeFormat('id-ID',{numeric:'auto'}).format(-Math.max(0,Math.round((Date.now()-new Date(value).getTime())/60000)),'minute'):'belum ada';
function render(data){text('last-updated','Diperbarui '+new Date(data.generatedAt).toLocaleTimeString('id-ID'));text('whatsapp-status',data.health.whatsappStatus);text('uptime',Math.floor(data.health.uptimeSeconds/3600)+'j '+Math.floor((data.health.uptimeSeconds%3600)/60)+'m');text('memory',bytes(data.health.rssBytes));text('reminder-cycle',ago(data.health.lastReminderCycleAt));text('digest-cycle',ago(data.health.lastMorningDigestCycleAt));const status=el('overall-status');status.className='status '+(data.health.whatsappStatus==='connected'?'':'warn');status.textContent=data.health.whatsappStatus==='connected'?'OPERATIONAL':'DEGRADED';
const tasks=el('task-metrics');tasks.replaceChildren();for(const [key,value] of Object.entries(data.tasks)){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key.replaceAll('_',' ');dd.textContent=number(value);row.append(dt,dd);tasks.append(row)}text('allowed-users',number(data.users.allowed));text('digest-users',number(data.users.morningDigestEnabled));text('attachments',number(data.storage.attachments));text('attachment-bytes',bytes(data.storage.bytes));
const usage=el('usage-body');usage.replaceChildren();if(!data.usage.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=5;cell.textContent='Belum ada telemetry pada 24 jam terakhir.';row.append(cell);usage.append(row)}for(const item of data.usage){const row=document.createElement('tr');for(const value of [item.metric,item.dimension||'—',number(item.count),number(item.sumValue),number(item.maxValue)]){const cell=document.createElement('td');cell.textContent=value;row.append(cell)}usage.append(row)}
const errors=el('errors');errors.replaceChildren();if(!data.recentErrors.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='Tidak ada error tersanitasi yang tercatat.';errors.append(empty)}for(const item of data.recentErrors){const row=document.createElement('div');row.className='event';const time=document.createElement('time');time.dateTime=item.occurredAt;time.textContent=new Date(item.occurredAt).toLocaleString('id-ID');const op=document.createElement('span');op.textContent=item.component+' / '+item.operation;const code=document.createElement('span');code.textContent=item.errorCode||item.outcome;row.append(time,op,code);errors.append(row)}}
async function load(){el('refresh').disabled=true;el('page-error').hidden=true;try{const response=await fetch('/api/snapshot',{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);render(await response.json())}catch{el('page-error').textContent='Dashboard tidak dapat memuat data. Coba refresh kembali.';el('page-error').hidden=false}finally{el('refresh').disabled=false}}el('refresh').addEventListener('click',load);load();setInterval(load,60000);
`;
