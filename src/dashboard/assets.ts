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

    <section aria-labelledby="users-management-title">
      <div class="section-heading">
        <div><p class="index">06</p><h2 id="users-management-title">User Whitelist & Access Management</h2></div>
        <span id="user-count-badge" class="status">0 USERS</span>
      </div>
      <p class="section-desc">Nomor WhatsApp yang menyapa bot otomatis dicatat. Akses awal dibatasi (Blocked) sampai Anda izinkan (Allow). Anda juga dapat menambahkan nomor baru langsung ke whitelist.</p>
      <form id="add-user-form" class="user-add-form" novalidate>
        <div class="input-field">
          <input id="new-phone" type="tel" placeholder="Nomor WhatsApp (misal: 08123456789 atau 628...)" required autocomplete="off">
        </div>
        <div class="input-field">
          <input id="new-name" type="text" placeholder="Nama / Panggilan (opsional)" autocomplete="off">
        </div>
        <button type="submit" id="add-user-btn">+ Tambah Whitelist</button>
      </form>
      <div id="user-feedback" class="user-feedback" hidden></div>
      <div class="table-wrap" style="margin-top:1.25rem">
        <table>
          <thead>
            <tr>
              <th scope="col">Kontak / Pengguna</th>
              <th scope="col">Status Whitelist</th>
              <th scope="col">Pengaturan</th>
              <th scope="col">Tugas</th>
              <th scope="col">Terdaftar</th>
              <th scope="col" style="text-align:right">Aksi</th>
            </tr>
          </thead>
          <tbody id="users-table-body">
            <tr><td colspan="6">Memuat data pengguna…</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section aria-labelledby="tasks-explorer-title">
      <div class="section-heading">
        <div><p class="index">07</p><h2 id="tasks-explorer-title">Task Explorer & Detail View</h2></div>
        <span id="tasks-count-badge" class="status">0 TASKS</span>
      </div>
      <p class="section-desc">Daftar seluruh tugas bot WhatsApp. Klik tombol Detail untuk melihat rincian sub-tugas, berkas lampiran, dan riwayat perubahannya.</p>

      <div class="task-toolbar">
        <div class="task-filters" role="group" aria-label="Filter status tugas">
          <button type="button" class="filter-btn active" data-status="all">Semua</button>
          <button type="button" class="filter-btn" data-status="active">Aktif</button>
          <button type="button" class="filter-btn" data-status="pending">Pending</button>
          <button type="button" class="filter-btn" data-status="pending_deadline">No Deadline</button>
          <button type="button" class="filter-btn" data-status="resolved">Selesai</button>
          <button type="button" class="filter-btn" data-status="cancelled">Batal</button>
        </div>
        <div class="task-search">
          <input id="task-search-input" type="search" placeholder="Cari teks tugas…" autocomplete="off">
        </div>
      </div>

      <div class="table-wrap" style="margin-top:1.25rem">
        <table>
          <thead>
            <tr>
              <th scope="col" style="width:4.5rem">ID</th>
              <th scope="col">Tugas</th>
              <th scope="col">Pengguna</th>
              <th scope="col">Target Waktu (Deadline)</th>
              <th scope="col">Status</th>
              <th scope="col">Info</th>
              <th scope="col" style="text-align:right">Aksi</th>
            </tr>
          </thead>
          <tbody id="tasks-table-body">
            <tr><td colspan="7">Memuat daftar tugas…</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section aria-labelledby="cron-monitoring-title">
      <div class="section-heading">
        <div><p class="index">08</p><h2 id="cron-monitoring-title">Cron & Automation Monitoring</h2></div>
        <span id="cron-status-badge" class="status">SCHEDULER RUNNING</span>
      </div>
      <p class="section-desc">Pantau status engine scheduler, jadwal pengingat tugas (reminder) yang belum terkirim, serta jadwal morning digest. Anda dapat mematikan jadwal pengingat yang berpotensi spam atau heavy sebelum dieksekusi.</p>

      <div class="split" style="margin-bottom:1.5rem">
        <article>
          <div class="section-heading compact">
            <h3>Background Cron Dispatchers</h3>
          </div>
          <div id="cron-engine-list" class="cron-engine-cards">
            <p class="muted">Memuat status background cron…</p>
          </div>
        </article>

        <article>
          <div class="section-heading compact">
            <h3>Jadwal Morning Digest Aktif</h3>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Pengguna</th>
                  <th scope="col">Jadwal Jam</th>
                  <th scope="col" style="text-align:right">Aksi</th>
                </tr>
              </thead>
              <tbody id="cron-digests-body">
                <tr><td colspan="3">Memuat jadwal digest…</td></tr>
              </tbody>
            </table>
          </div>
        </article>
      </div>

      <div class="section-heading compact" style="margin-top:1.5rem">
        <div>
          <h3>Antrean Pengingat Tugas yang Belum Berjalan (Upcoming Reminders)</h3>
          <span id="upcoming-reminders-badge" class="pill-count" style="margin-left:0.5rem">0 PENDING</span>
        </div>
      </div>
      <p class="section-desc">Daftar pengingat tugas otomatis yang dijadwalkan dan belum terkirim ke WhatsApp. Klik tombol Matikan jika ingin mencegah pengiriman pengingat.</p>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col" style="width:4.5rem">ID</th>
              <th scope="col">Tugas</th>
              <th scope="col">Pengguna</th>
              <th scope="col">Jadwal Kirim Cron</th>
              <th scope="col">Deadline Tugas</th>
              <th scope="col">Status</th>
              <th scope="col" style="text-align:right">Aksi</th>
            </tr>
          </thead>
          <tbody id="cron-reminders-body">
            <tr><td colspan="7">Memuat antrean pengingat…</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <dialog id="task-modal" class="task-modal">
      <div class="modal-header">
        <div>
          <span id="modal-task-id" class="eyebrow" style="margin-bottom:0.25rem;display:block">TASK #—</span>
          <h3 id="modal-task-title" class="modal-title">Judul Tugas</h3>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Tutup dialog">✕</button>
      </div>
      <div id="modal-body" class="modal-body">
        <p class="muted">Memuat detail tugas…</p>
      </div>
    </dialog>

    <dialog id="confirm-modal" class="confirm-modal" aria-labelledby="confirm-modal-title">
      <div class="confirm-content">
        <div class="confirm-icon">⚠️</div>
        <div>
          <h3 id="confirm-modal-title" class="confirm-title">Konfirmasi Tindakan</h3>
          <p id="confirm-modal-msg" class="confirm-msg">Apakah Anda yakin ingin melakukan tindakan ini?</p>
        </div>
      </div>
      <div class="confirm-actions">
        <button type="button" id="confirm-btn-cancel" class="btn-cancel">Batal</button>
        <button type="button" id="confirm-btn-ok" class="btn-confirm-danger">Ya, Matikan</button>
      </div>
    </dialog>

    <p id="page-error" class="page-error" role="alert" hidden></p>
  </main>
  <footer>Bot Control Room & Whitelist Manager · Keamanan & Monitoring</footer>
</body>
</html>`;

export const DASHBOARD_CSS = `
:root{--bg:#111513;--surface:#171c19;--line:#303832;--text:#edf3ef;--muted:#9ca9a1;--accent:#8ee3b0;--warn:#ffcf70;--danger:#ff8b84;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text);background:var(--bg)}
*{box-sizing:border-box}body{margin:0;min-width:320px;background:var(--bg);line-height:1.5}.skip-link{position:absolute;left:1rem;top:-4rem;background:var(--accent);color:#08110b;padding:.6rem 1rem;z-index:10}.skip-link:focus{top:1rem}.topbar{display:flex;justify-content:space-between;align-items:flex-end;gap:2rem;padding:2rem clamp(1rem,4vw,4rem);border-bottom:1px solid var(--line)}h1,h2,p{margin:0}h1{font-size:clamp(2rem,5vw,4.5rem);letter-spacing:-.055em;line-height:.95;font-weight:650}h2{font-size:1.05rem;letter-spacing:.02em}.eyebrow,.index{font:600 .7rem/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em;color:var(--accent);margin-bottom:.65rem}.topbar-actions{display:flex;align-items:center;gap:1rem}.muted{color:var(--muted);font-size:.85rem}button{font:inherit;font-weight:650;color:var(--bg);background:var(--accent);border:0;padding:.65rem 1rem;cursor:pointer}button:hover{filter:brightness(1.08)}button:focus-visible,a:focus-visible{outline:3px solid var(--warn);outline-offset:3px}main{max-width:1440px;margin:auto;padding:0 clamp(1rem,4vw,4rem)}section,article{padding:2rem 0;border-bottom:1px solid var(--line)}.section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem}.section-heading.compact{margin-bottom:.6rem}.section-heading>div{display:flex;align-items:baseline;gap:.8rem}.section-heading .index{margin:0}.status{font:700 .75rem ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent);border:1px solid currentColor;padding:.3rem .55rem}.status.warn{color:var(--warn)}.status.danger{color:var(--danger)}.metric-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin:0;border:1px solid var(--line)}.metric-strip>div{padding:1rem;border-right:1px solid var(--line)}.metric-strip>div:last-child{border:0}dt{color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.08em}dd{margin:.35rem 0 0;font-size:1.2rem;font-weight:650}.split{display:grid;grid-template-columns:1fr 1fr;gap:3rem}.split article{border:0;padding:0}.data-list{margin:0}.data-list>div{display:flex;justify-content:space-between;gap:1rem;padding:.8rem 0;border-bottom:1px solid var(--line)}.data-list dd{margin:0;font-size:1rem}.table-wrap{overflow-x:auto;border:1px solid var(--line)}table{width:100%;border-collapse:collapse;font-size:.85rem}th,td{text-align:left;padding:.75rem 1rem;border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;background:var(--surface)}td:nth-child(n+3),th:nth-child(n+3){text-align:right;font-variant-numeric:tabular-nums}.event-list{display:grid;gap:.5rem}.event{display:grid;grid-template-columns:minmax(10rem,.7fr) 1fr 1fr;gap:1rem;padding:.8rem 0;border-bottom:1px solid var(--line);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem}.event time,.empty{color:var(--muted)}.page-error{margin:1rem 0;padding:1rem;border:1px solid var(--danger);color:var(--danger)}footer{padding:2rem clamp(1rem,4vw,4rem);color:var(--muted);font-size:.75rem;text-align:center}
.section-desc{color:var(--muted);font-size:.85rem;margin-bottom:1.25rem}.user-add-form{display:flex;flex-wrap:wrap;gap:1rem;align-items:center}.input-field{flex:1;min-width:200px}.input-field input{width:100%;padding:.65rem 1rem;background:var(--surface);border:1px solid var(--line);color:var(--text);font:inherit;font-size:.9rem}.input-field input:focus{outline:2px solid var(--accent);border-color:transparent}.user-feedback{padding:.75rem 1rem;margin-top:.75rem;border:1px solid var(--line);font-size:.85rem}.user-feedback.success{border-color:var(--accent);color:var(--accent);background:rgba(142,227,176,.08)}.user-feedback.error{border-color:var(--danger);color:var(--danger);background:rgba(255,139,132,.08)}.badge{display:inline-block;padding:.2rem .5rem;font:700 .7rem ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.05em}.badge-allowed{color:var(--accent);border:1px solid var(--accent);background:rgba(142,227,176,.1)}.badge-blocked{color:var(--danger);border:1px solid var(--danger);background:rgba(255,139,132,.1)}.btn-sm{font:inherit;font-size:.78rem;font-weight:600;padding:.35rem .75rem;cursor:pointer;border:0}.btn-allow{background:var(--accent);color:var(--bg)}.btn-revoke{background:transparent;color:var(--warn);border:1px solid var(--warn)}.btn-revoke:hover{background:rgba(255,207,112,.1)}.btn-del{background:transparent;color:var(--danger);border:1px solid var(--danger);margin-left:.4rem}.btn-del:hover{background:rgba(255,139,132,.1)}.user-meta{display:flex;flex-direction:column;gap:.2rem}.user-phone{font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.user-name{font-size:.8rem;color:var(--muted)}
.task-toolbar{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;margin-bottom:1rem}.task-filters{display:flex;flex-wrap:wrap;gap:.4rem}.filter-btn{font:inherit;font-size:.78rem;font-weight:600;background:var(--surface);color:var(--muted);border:1px solid var(--line);padding:.4rem .8rem;cursor:pointer}.filter-btn:hover{color:var(--text);border-color:var(--muted)}.filter-btn.active{background:var(--accent);color:var(--bg);border-color:var(--accent)}.task-search{flex:1;min-width:220px;max-width:340px}.task-search input{width:100%;padding:.5rem .85rem;background:var(--surface);border:1px solid var(--line);color:var(--text);font:inherit;font-size:.85rem}.task-search input:focus{outline:2px solid var(--accent);border-color:transparent}.badge-pending{color:var(--warn);border:1px solid var(--warn);background:rgba(255,207,112,.1)}.badge-pending_deadline{color:#b3a0ff;border:1px solid #b3a0ff;background:rgba(179,160,255,.1)}.badge-resolved{color:var(--accent);border:1px solid var(--accent);background:rgba(142,227,176,.1)}.badge-cancelled{color:var(--danger);border:1px solid var(--danger);background:rgba(255,139,132,.1)}.pill-count{display:inline-flex;align-items:center;gap:.25rem;font:600 .75rem ui-monospace,monospace;color:var(--muted);background:rgba(255,255,255,.05);padding:.15rem .45rem;margin-right:.3rem}.btn-detail{background:transparent;color:var(--accent);border:1px solid var(--accent);font-size:.78rem;font-weight:600;padding:.35rem .75rem;cursor:pointer}.btn-detail:hover{background:rgba(142,227,176,.15)}.subtask-label{font-size:.75rem;color:var(--muted);margin-top:.2rem;display:block}
.task-modal{position:fixed;inset:0;margin:auto;max-width:760px;width:92%;background:var(--surface);border:1px solid var(--line);color:var(--text);padding:1.5rem;box-shadow:0 20px 40px rgba(0,0,0,.6);z-index:100}.task-modal::backdrop{background:rgba(0,0,0,.75);backdrop-filter:blur(3px)}.modal-header{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;border-bottom:1px solid var(--line);padding-bottom:1rem}.modal-title{font-size:1.25rem;font-weight:650;line-height:1.3;margin:0}.modal-close{background:transparent;border:0;color:var(--muted);font-size:1.4rem;line-height:1;padding:.2rem .5rem;cursor:pointer}.modal-close:hover{color:var(--text)}.modal-body{max-height:calc(85vh - 5rem);overflow-y:auto;padding-top:1.25rem;display:flex;flex-direction:column;gap:1.5rem}.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;background:rgba(0,0,0,.2);padding:1rem;border:1px solid var(--line)}.detail-grid dt{color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em}.detail-grid dd{margin:.25rem 0 0;font-size:.9rem;font-weight:500;word-break:break-word}.detail-card{border:1px solid var(--line);padding:1rem;background:rgba(0,0,0,.1)}.detail-card h4{margin:0 0 .75rem 0;font-size:.88rem;letter-spacing:.03em;color:var(--accent);text-transform:uppercase}.subtask-items{display:flex;flex-direction:column;gap:.5rem;margin:0;padding:0;list-style:none}.subtask-item{display:flex;justify-content:space-between;align-items:center;padding:.5rem .75rem;background:var(--bg);border:1px solid var(--line);font-size:.85rem}.attachment-card{border:1px solid var(--line);background:var(--bg);padding:.75rem;margin-bottom:.75rem}.attachment-header{display:flex;justify-content:space-between;font-size:.8rem;color:var(--muted);margin-bottom:.5rem}.attachment-name{font-weight:600;color:var(--text);font-family:ui-monospace,monospace}.ocr-box{background:var(--surface);border:1px solid var(--line);padding:.6rem .8rem;font-size:.78rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;color:#c0cdc5;max-height:160px;overflow-y:auto;margin-top:.5rem}.timeline{display:flex;flex-direction:column;gap:.8rem;border-left:2px solid var(--line);padding-left:1rem;margin-left:.5rem}.timeline-item{font-size:.8rem;position:relative}.timeline-item::before{content:"";position:absolute;left:-1.35rem;top:.35rem;width:8px;height:8px;border-radius:50%;background:var(--accent)}.timeline-time{color:var(--muted);font-family:ui-monospace,monospace;font-size:.72rem;margin-bottom:.2rem}.timeline-content{color:var(--text);line-height:1.4}.parent-pill{display:inline-block;padding:.4rem .75rem;background:rgba(142,227,176,.08);border:1px solid var(--line);font-size:.82rem}
.cron-engine-cards{display:flex;flex-direction:column;gap:.75rem}.cron-card{border:1px solid var(--line);background:var(--surface);padding:1rem;display:flex;justify-content:space-between;align-items:center;gap:1rem}.cron-card-info{display:flex;flex-direction:column;gap:.25rem}.cron-card-title{font-weight:650;font-size:.9rem;display:flex;align-items:center;gap:.5rem}.cron-card-desc{font-size:.78rem;color:var(--muted)}.cron-card-meta{font-size:.75rem;color:var(--muted);font-family:ui-monospace,monospace}.confirm-modal{position:fixed;inset:0;margin:auto;max-width:480px;width:90%;background:var(--surface);border:1px solid var(--line);color:var(--text);padding:1.5rem;box-shadow:0 24px 48px rgba(0,0,0,.7);z-index:200}.confirm-modal::backdrop{background:rgba(0,0,0,.8);backdrop-filter:blur(4px)}.confirm-content{display:flex;gap:1rem;align-items:flex-start;margin-bottom:1.5rem}.confirm-icon{font-size:2rem;line-height:1}.confirm-title{font-size:1.1rem;font-weight:650;margin:0 0 .4rem 0}.confirm-msg{font-size:.85rem;color:var(--muted);line-height:1.45;margin:0}.confirm-actions{display:flex;justify-content:flex-end;gap:.75rem}.btn-cancel{background:transparent;border:1px solid var(--line);color:var(--text);padding:.5rem 1rem;font-weight:600;cursor:pointer}.btn-cancel:hover{border-color:var(--muted)}.btn-confirm-danger{background:var(--danger);color:#08110b;border:0;padding:.5rem 1rem;font-weight:650;cursor:pointer}.btn-confirm-danger:hover{filter:brightness(1.1)}
@media(max-width:800px){.topbar{align-items:flex-start;flex-direction:column}.topbar-actions{width:100%;justify-content:space-between}.metric-strip{grid-template-columns:1fr 1fr}.metric-strip>div{border-bottom:1px solid var(--line)}.split{grid-template-columns:1fr;gap:0}.event{grid-template-columns:1fr}.event span{overflow-wrap:anywhere}.user-add-form{flex-direction:column;align-items:stretch}.task-toolbar{flex-direction:column;align-items:stretch}.task-search{max-width:none}.cron-card{flex-direction:column;align-items:flex-start}}@media(max-width:420px){.metric-strip{grid-template-columns:1fr}.metric-strip>div{border-right:0}}
`;

export const DASHBOARD_JS = `
const el=id=>document.getElementById(id);const text=(id,value)=>{el(id).textContent=value??'—'};const number=value=>new Intl.NumberFormat('id-ID').format(value||0);const bytes=value=>{const units=['B','KB','MB','GB'];let n=Number(value||0),i=0;while(n>=1024&&i<units.length-1){n/=1024;i++}return n.toFixed(i?1:0)+' '+units[i]};const ago=value=>value?new Intl.RelativeTimeFormat('id-ID',{numeric:'auto'}).format(-Math.max(0,Math.round((Date.now()-new Date(value).getTime())/60000)),'minute'):'belum ada';
function render(data){text('last-updated','Diperbarui '+new Date(data.generatedAt).toLocaleTimeString('id-ID'));text('whatsapp-status',data.health.whatsappStatus);text('uptime',Math.floor(data.health.uptimeSeconds/3600)+'j '+Math.floor((data.health.uptimeSeconds%3600)/60)+'m');text('memory',bytes(data.health.rssBytes));text('reminder-cycle',ago(data.health.lastReminderCycleAt));text('digest-cycle',ago(data.health.lastMorningDigestCycleAt));const status=el('overall-status');status.className='status '+(data.health.whatsappStatus==='connected'?'':'warn');status.textContent=data.health.whatsappStatus==='connected'?'OPERATIONAL':'DEGRADED';
const tasks=el('task-metrics');tasks.replaceChildren();for(const [key,value] of Object.entries(data.tasks)){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key.replaceAll('_',' ');dd.textContent=number(value);row.append(dt,dd);tasks.append(row)}text('allowed-users',number(data.users.allowed));text('digest-users',number(data.users.morningDigestEnabled));text('attachments',number(data.storage.attachments));text('attachment-bytes',bytes(data.storage.bytes));
const usage=el('usage-body');usage.replaceChildren();if(!data.usage.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=5;cell.textContent='Belum ada telemetry pada 24 jam terakhir.';row.append(cell);usage.append(row)}for(const item of data.usage){const row=document.createElement('tr');for(const value of [item.metric,item.dimension||'—',number(item.count),number(item.sumValue),number(item.maxValue)]){const cell=document.createElement('td');cell.textContent=value;row.append(cell)}usage.append(row)}
const errors=el('errors');errors.replaceChildren();if(!data.recentErrors.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='Tidak ada error tersanitasi yang tercatat.';errors.append(empty)}for(const item of data.recentErrors){const row=document.createElement('div');row.className='event';const time=document.createElement('time');time.dateTime=item.occurredAt;time.textContent=new Date(item.occurredAt).toLocaleString('id-ID');const op=document.createElement('span');op.textContent=item.component+' / '+item.operation;const code=document.createElement('span');code.textContent=item.errorCode||item.outcome;row.append(time,op,code);errors.append(row)}}

function showUserFeedback(msg,isErr=false){const fb=el('user-feedback');fb.textContent=msg;fb.className='user-feedback '+(isErr?'error':'success');fb.hidden=false;setTimeout(()=>{fb.hidden=true},5000)}

function renderUsers(users){
const tbody=el('users-table-body');tbody.replaceChildren();
text('user-count-badge',users.length+' USERS');
if(!users.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.textContent='Belum ada pengguna yang menghubungi bot.';tr.append(td);tbody.append(tr);return}
for(const u of users){
const tr=document.createElement('tr');
const tdUser=document.createElement('td');const meta=document.createElement('div');meta.className='user-meta';const phone=document.createElement('span');phone.className='user-phone';phone.textContent='+'+u.phoneNumber;const name=document.createElement('span');name.className='user-name';name.textContent=u.name||'(Belum set nama)';meta.append(phone,name);tdUser.append(meta);
const tdStatus=document.createElement('td');const badge=document.createElement('span');badge.className='badge '+(u.isAllowed?'badge-allowed':'badge-blocked');badge.textContent=u.isAllowed?'DIIZINKAN':'DIBATASI';tdStatus.append(badge);
const tdSettings=document.createElement('td');tdSettings.textContent=u.leadReminderMinutes+'m reminder · Pagi: '+(u.morningDigestEnabled?u.morningDigestTime:'off');
const tdTasks=document.createElement('td');tdTasks.textContent=number(u.taskCount);
const tdCreated=document.createElement('td');tdCreated.textContent=u.createdAt?new Date(u.createdAt).toLocaleDateString('id-ID'):'—';
const tdAction=document.createElement('td');tdAction.style.textAlign='right';
const btnToggle=document.createElement('button');btnToggle.type='button';btnToggle.className='btn-sm '+(u.isAllowed?'btn-revoke':'btn-allow');btnToggle.textContent=u.isAllowed?'Cabut Akses':'Izinkan';btnToggle.onclick=async()=>{
  btnToggle.disabled=true;try{const res=await fetch('/api/users/toggle',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userJid:u.userJid})});const data=await res.json();if(data.success){showUserFeedback('Status akses '+u.phoneNumber+' berhasil diperbarui.');await loadUsers();await loadSnapshot()}else{showUserFeedback(data.error||'Gagal update status',true)}}catch{showUserFeedback('Terjadi kesalahan jaringan',true)}finally{btnToggle.disabled=false}
};
const btnDel=document.createElement('button');btnDel.type='button';btnDel.className='btn-sm btn-del';btnDel.textContent='Hapus';btnDel.onclick=async()=>{
  if(!confirm('Hapus kontak '+u.phoneNumber+' dari database? Semua data terkait pengguna ini akan dihapus.'))return;
  btnDel.disabled=true;try{const res=await fetch('/api/users/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userJid:u.userJid})});const data=await res.json();if(data.success){showUserFeedback('Kontak '+u.phoneNumber+' berhasil dihapus.');await loadUsers();await loadSnapshot()}else{showUserFeedback(data.error||'Gagal menghapus kontak',true)}}catch{showUserFeedback('Terjadi kesalahan jaringan',true)}finally{btnDel.disabled=false}
};
tdAction.append(btnToggle,btnDel);
tr.append(tdUser,tdStatus,tdSettings,tdTasks,tdCreated,tdAction);tbody.append(tr)}
}

async function loadUsers(){try{const res=await fetch('/api/users',{cache:'no-store'});if(res.ok){renderUsers(await res.json())}}catch(e){console.warn('Failed to load users:',e)}}

let currentTaskStatus='all';
let taskSearchQuery='';
let searchDebounceTimer=null;

const statusMap={
  pending:{label:'Pending',cls:'badge-pending'},
  pending_deadline:{label:'No Deadline',cls:'badge-pending_deadline'},
  resolved:{label:'Selesai',cls:'badge-resolved'},
  cancelled:{label:'Batal',cls:'badge-cancelled'},
};

function renderTasks(taskList){
  const tbody=el('tasks-table-body');tbody.replaceChildren();
  text('tasks-count-badge',taskList.length+' TASKS');
  if(!taskList.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=7;td.textContent='Tidak ada tugas yang sesuai kriteria.';tr.append(td);tbody.append(tr);return}
  for(const t of taskList){
    const tr=document.createElement('tr');
    const tdId=document.createElement('td');tdId.style.fontFamily='ui-monospace,SFMono-Regular,Menlo,monospace';tdId.textContent='#'+t.id;
    const tdTask=document.createElement('td');const titleDiv=document.createElement('div');titleDiv.style.fontWeight='600';titleDiv.textContent=t.task;tdTask.append(titleDiv);
    if(t.parentId){const subNote=document.createElement('span');subNote.className='subtask-label';subNote.textContent='↳ Sub-tugas dari #'+t.parentId;tdTask.append(subNote)}
    const tdUser=document.createElement('td');const meta=document.createElement('div');meta.className='user-meta';const phone=document.createElement('span');phone.className='user-phone';phone.textContent='+'+t.phoneNumber;const name=document.createElement('span');name.className='user-name';name.textContent=t.userName||'(Tanpa nama)';meta.append(phone,name);tdUser.append(meta);
    const tdDeadline=document.createElement('td');tdDeadline.textContent=t.deadline?new Date(t.deadline).toLocaleString('id-ID'):'—';
    const tdStatus=document.createElement('td');const st=statusMap[t.status]||{label:t.status,cls:'badge-pending'};const badge=document.createElement('span');badge.className='badge '+st.cls;badge.textContent=st.label;tdStatus.append(badge);
    const tdInfo=document.createElement('td');
    if(t.subtaskCount>0){const pSub=document.createElement('span');pSub.className='pill-count';pSub.title=t.subtaskCount+' Sub-tugas';pSub.textContent='☑ '+t.subtaskCount;tdInfo.append(pSub)}
    if(t.attachmentCount>0){const pAtt=document.createElement('span');pAtt.className='pill-count';pAtt.title=t.attachmentCount+' Lampiran';pAtt.textContent='📎 '+t.attachmentCount;tdInfo.append(pAtt)}
    if(!t.subtaskCount&&!t.attachmentCount){tdInfo.textContent='—'}
    const tdAction=document.createElement('td');tdAction.style.textAlign='right';
    const btnDetail=document.createElement('button');btnDetail.type='button';btnDetail.className='btn-detail';btnDetail.textContent='Detail';btnDetail.onclick=()=>openTaskDetail(t.id);
    tdAction.append(btnDetail);
    tr.append(tdId,tdTask,tdUser,tdDeadline,tdStatus,tdInfo,tdAction);tbody.append(tr)
  }
}

async function loadTasks(){
  try{
    const params=new URLSearchParams();
    if(currentTaskStatus)params.set('status',currentTaskStatus);
    if(taskSearchQuery)params.set('search',taskSearchQuery);
    const res=await fetch('/api/tasks?'+params.toString(),{cache:'no-store'});
    if(res.ok){renderTasks(await res.json())}
  }catch(e){console.warn('Failed to load tasks:',e)}
}

async function openTaskDetail(taskId){
  const modal=el('task-modal'),modalId=el('modal-task-id'),modalTitle=el('modal-task-title'),modalBody=el('modal-body');
  modalId.textContent='TASK #'+taskId;modalTitle.textContent='Memuat rincian…';modalBody.replaceChildren();
  const loadingP=document.createElement('p');loadingP.className='muted';loadingP.textContent='Memuat data lengkap dari server…';modalBody.append(loadingP);
  modal.showModal();
  try{
    const res=await fetch('/api/tasks/detail?id='+encodeURIComponent(taskId),{cache:'no-store'});
    if(!res.ok)throw new Error('HTTP '+res.status);
    const data=await res.json();
    const t=data.task;
    modalTitle.textContent=t.task;
    modalBody.replaceChildren();
    if(data.parentTask){
      const pWrap=document.createElement('div');pWrap.className='parent-pill';
      pWrap.textContent='↳ Tugas Induk: #'+data.parentTask.id+' — '+(data.parentTask.task||'')+' ('+(statusMap[data.parentTask.status]?.label||data.parentTask.status)+')';
      modalBody.append(pWrap);
    }
    const grid=document.createElement('dl');grid.className='detail-grid';
    const st=statusMap[t.status]||{label:t.status,cls:''};
    const items=[
      ['STATUS',st.label],
      ['PEMILIK','+'+t.phoneNumber+(t.userName?' ('+t.userName+')':'')],
      ['TARGET WAKTU (DEADLINE)',t.deadline?new Date(t.deadline).toLocaleString('id-ID'):'Belum ditentukan'],
      ['JADWAL REMINDER',t.remindAt?new Date(t.remindAt).toLocaleString('id-ID'):'—'],
      ['STATUS NOTIFIKASI',t.reminded?'Sudah terkirim':'Belum terkirim'],
      ['DIBUAT PADA',t.createdAt?new Date(t.createdAt).toLocaleString('id-ID'):'—'],
    ];
    for(const [k,v] of items){
      const d=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');
      dt.textContent=k;dd.textContent=v;d.append(dt,dd);grid.append(d);
    }
    modalBody.append(grid);

    if(data.subtasks&&data.subtasks.length>0){
      const sec=document.createElement('div');sec.className='detail-card';
      const h4=document.createElement('h4');h4.textContent='Sub-tugas ('+data.subtasks.length+')';sec.append(h4);
      const ul=document.createElement('ul');ul.className='subtask-items';
      for(const s of data.subtasks){
        const li=document.createElement('li');li.className='subtask-item';
        const sText=document.createElement('span');sText.textContent='#'+s.id+' '+s.task;
        const sBadge=document.createElement('span');const sSt=statusMap[s.status]||{label:s.status,cls:''};
        sBadge.className='badge '+sSt.cls;sBadge.textContent=sSt.label;
        li.append(sText,sBadge);ul.append(li);
      }
      sec.append(ul);modalBody.append(sec);
    }

    if(data.attachments&&data.attachments.length>0){
      const sec=document.createElement('div');sec.className='detail-card';
      const h4=document.createElement('h4');h4.textContent='Lampiran & OCR ('+data.attachments.length+')';sec.append(h4);
      for(const a of data.attachments){
        const card=document.createElement('div');card.className='attachment-card';
        const head=document.createElement('div');head.className='attachment-header';
        const name=document.createElement('span');name.className='attachment-name';name.textContent=a.fileName||('Berkas #'+a.id);
        const meta=document.createElement('span');meta.textContent=(a.fileType||a.mimeType||'')+' · '+bytes(a.fileSize)+' · '+(a.safetyStatus||'safe');
        head.append(name,meta);card.append(head);
        if(a.ocrExtractedText&&a.ocrExtractedText.trim()){
          const ocrBox=document.createElement('div');ocrBox.className='ocr-box';ocrBox.textContent='Hasil OCR:\n'+a.ocrExtractedText;
          card.append(ocrBox);
        }
        sec.append(card);
      }
      modalBody.append(sec);
    }

    if(data.history&&data.history.length>0){
      const sec=document.createElement('div');sec.className='detail-card';
      const h4=document.createElement('h4');h4.textContent='Riwayat Perubahan ('+data.history.length+')';sec.append(h4);
      const tl=document.createElement('div');tl.className='timeline';
      for(const h of data.history){
        const item=document.createElement('div');item.className='timeline-item';
        const time=document.createElement('div');time.className='timeline-time';time.textContent=new Date(h.createdAt).toLocaleString('id-ID')+' · '+h.changeType;
        const content=document.createElement('div');content.className='timeline-content';
        let desc=(h.fieldChanged?h.fieldChanged+': ':'')+(h.oldValue?h.oldValue+' → ':'')+(h.newValue||'');
        if(h.rawInput)desc+=' (Input: "'+h.rawInput+'")';
        content.textContent=desc||h.changeType;
        item.append(time,content);tl.append(item);
      }
      sec.append(tl);modalBody.append(sec);
    }
  }catch(err){
    modalBody.replaceChildren();
    const errP=document.createElement('p');errP.className='page-error';errP.textContent='Gagal memuat detail tugas: '+(err.message||'Terjadi kesalahan');
    modalBody.append(errP);
  }
}

function askAdminConfirmation(title, message, confirmLabel='Ya, Lanjutkan', isDanger=true){
  return new Promise(resolve=>{
    const modal=el('confirm-modal');
    const titleEl=el('confirm-modal-title');
    const msgEl=el('confirm-modal-msg');
    const okBtn=el('confirm-btn-ok');
    const cancelBtn=el('confirm-btn-cancel');

    titleEl.textContent=title;
    msgEl.textContent=message;
    okBtn.textContent=confirmLabel;
    okBtn.className=isDanger?'btn-confirm-danger':'btn-allow';

    const cleanup=()=>{
      okBtn.onclick=null;
      cancelBtn.onclick=null;
      modal.onclose=null;
    };

    okBtn.onclick=()=>{
      cleanup();
      modal.close();
      resolve(true);
    };

    cancelBtn.onclick=()=>{
      cleanup();
      modal.close();
      resolve(false);
    };

    modal.onclose=()=>{
      cleanup();
      resolve(false);
    };

    modal.showModal();
  });
}

function renderCrons(data){
  const stBadge=el('cron-status-badge');
  if(stBadge){
    stBadge.className='status '+(data.schedulerPaused?'warn':'');
    stBadge.textContent=data.schedulerPaused?'SCHEDULER DIJEDA':'SCHEDULER RUNNING';
  }

  const engineContainer=el('cron-engine-list');
  engineContainer.replaceChildren();
  if(!data.engine||!data.engine.length){
    const p=document.createElement('p');p.className='muted';p.textContent='Tidak ada cron dispatcher terdaftar.';
    engineContainer.append(p);
  } else {
    for(const item of data.engine){
      const card=document.createElement('div');card.className='cron-card';
      const info=document.createElement('div');info.className='cron-card-info';
      
      const title=document.createElement('div');title.className='cron-card-title';
      title.textContent=item.name;
      const badge=document.createElement('span');
      badge.className='badge '+(item.enabled?'badge-allowed':'badge-blocked');
      badge.textContent=item.enabled?'AKTIF':'DIJEDA';
      title.append(badge);

      const desc=document.createElement('div');desc.className='cron-card-desc';
      desc.textContent=item.description;

      const meta=document.createElement('div');meta.className='cron-card-meta';
      meta.textContent=item.interval+' · Terakhir jalan: '+ago(item.lastRunAt);

      info.append(title,desc,meta);

      const action=document.createElement('div');
      const btn=document.createElement('button');btn.type='button';
      btn.className='btn-sm '+(item.enabled?'btn-revoke':'btn-allow');
      btn.textContent=item.enabled?'Jeda Cron':'Aktifkan Cron';
      btn.onclick=async()=>{
        const actionWord=item.enabled?'menjeda':'mengaktifkan kembali';
        const ok=await askAdminConfirmation(
          (item.enabled?'Jeda ':'Aktifkan ')+item.name,
          'Apakah Anda yakin ingin '+actionWord+' cron dispatcher "'+item.name+'"? '+(item.enabled?'Proses otomatis pengiriman pengingat akan berhenti sementara untuk mengurangi beban server atau spam.':'Proses background akan berjalan kembali secara normal.'),
          item.enabled?'Ya, Jeda Cron':'Ya, Aktifkan',
          item.enabled
        );
        if(!ok)return;
        btn.disabled=true;
        try{
          const res=await fetch('/api/crons/engine/toggle',{
            method:'POST',
            headers:{'content-type':'application/json'},
            body:JSON.stringify({cronId:item.id,enabled:!item.enabled})
          });
          const resData=await res.json();
          if(resData.success){
            showUserFeedback('Status cron "'+item.name+'" berhasil diubah.');
            await loadCrons();
            await loadSnapshot();
          }else{
            showUserFeedback(resData.error||'Gagal mengubah status cron',true);
          }
        }catch{
          showUserFeedback('Terjadi kesalahan jaringan',true);
        }finally{
          btn.disabled=false;
        }
      };
      action.append(btn);
      card.append(info,action);
      engineContainer.append(card);
    }
  }

  const digestsTbody=el('cron-digests-body');
  digestsTbody.replaceChildren();
  if(!data.upcomingDigests||!data.upcomingDigests.length){
    const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=3;
    td.textContent='Tidak ada pengguna dengan morning digest aktif.';tr.append(td);digestsTbody.append(tr);
  } else {
    for(const d of data.upcomingDigests){
      const tr=document.createElement('tr');
      const tdUser=document.createElement('td');
      const meta=document.createElement('div');meta.className='user-meta';
      const phone=document.createElement('span');phone.className='user-phone';phone.textContent='+'+d.phoneNumber;
      const name=document.createElement('span');name.className='user-name';name.textContent=d.name||'(Tanpa nama)';
      meta.append(phone,name);tdUser.append(meta);

      const tdTime=document.createElement('td');
      tdTime.textContent=d.morningDigestTime+' ('+d.timezone+')';

      const tdAct=document.createElement('td');tdAct.style.textAlign='right';
      const btn=document.createElement('button');btn.type='button';btn.className='btn-sm btn-revoke';
      btn.textContent='Matikan Digest';
      btn.onclick=async()=>{
        const ok=await askAdminConfirmation(
          'Matikan Morning Digest',
          'Apakah Anda yakin ingin menonaktifkan morning digest otomatis untuk nomor +'+d.phoneNumber+'? Pengguna tidak akan menerima ringkasan pagi lagi.',
          'Ya, Matikan',
          true
        );
        if(!ok)return;
        btn.disabled=true;
        try{
          const res=await fetch('/api/crons/digest/toggle',{
            method:'POST',
            headers:{'content-type':'application/json'},
            body:JSON.stringify({userJid:d.userJid,enabled:false})
          });
          const resData=await res.json();
          if(resData.success){
            showUserFeedback('Morning digest untuk +'+d.phoneNumber+' dinonaktifkan.');
            await Promise.all([loadCrons(),loadUsers(),loadSnapshot()]);
          }else{
            showUserFeedback(resData.error||'Gagal mematikan digest',true);
          }
        }catch{
          showUserFeedback('Terjadi kesalahan jaringan',true);
        }finally{
          btn.disabled=false;
        }
      };
      tdAct.append(btn);
      tr.append(tdUser,tdTime,tdAct);
      digestsTbody.append(tr);
    }
  }

  const remindersTbody=el('cron-reminders-body');
  remindersTbody.replaceChildren();
  const upCount=data.upcomingReminders?data.upcomingReminders.length:0;
  text('upcoming-reminders-badge',upCount+' PENDING');
  if(!upCount){
    const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=7;
    td.textContent='Tidak ada antrean pengingat yang belum berjalan saat ini.';tr.append(td);remindersTbody.append(tr);
  } else {
    for(const r of data.upcomingReminders){
      const tr=document.createElement('tr');
      const tdId=document.createElement('td');tdId.style.fontFamily='ui-monospace,monospace';tdId.textContent='#'+r.id;

      const tdTask=document.createElement('td');
      const title=document.createElement('div');title.style.fontWeight='600';title.textContent=r.task;
      tdTask.append(title);

      const tdUser=document.createElement('td');
      const uMeta=document.createElement('div');uMeta.className='user-meta';
      const uPhone=document.createElement('span');uPhone.className='user-phone';uPhone.textContent='+'+r.phoneNumber;
      const uName=document.createElement('span');uName.className='user-name';uName.textContent=r.userName||'(Tanpa nama)';
      uMeta.append(uPhone,uName);tdUser.append(uMeta);

      const tdRemind=document.createElement('td');
      tdRemind.textContent=r.remindAt?new Date(r.remindAt).toLocaleString('id-ID'):'—';

      const tdDeadline=document.createElement('td');
      tdDeadline.textContent=r.deadline?new Date(r.deadline).toLocaleString('id-ID'):'—';

      const tdStatus=document.createElement('td');
      const b=document.createElement('span');
      if(r.isDue){
        b.className='badge badge-blocked';b.textContent='SIAP DIKIRIM';
      }else{
        b.className='badge badge-pending';b.textContent='MENUNGGU JADWAL';
      }
      tdStatus.append(b);

      const tdAct=document.createElement('td');tdAct.style.textAlign='right';
      const btnDisable=document.createElement('button');btnDisable.type='button';
      btnDisable.className='btn-sm btn-del';btnDisable.textContent='Matikan Reminder';
      btnDisable.onclick=async()=>{
        const ok=await askAdminConfirmation(
          'Matikan Pengingat Tugas #'+r.id,
          'Apakah Anda yakin ingin mematikan pengingat otomatis untuk tugas: "'+r.task+'" (Pengguna: +'+r.phoneNumber+')? Tindakan ini akan menghentikan notifikasi pengingat ke WhatsApp untuk mencegah spam atau beban berat server.',
          'Ya, Matikan Pengingat',
          true
        );
        if(!ok)return;
        btnDisable.disabled=true;
        try{
          const res=await fetch('/api/crons/reminders/disable',{
            method:'POST',
            headers:{'content-type':'application/json'},
            body:JSON.stringify({taskId:r.id})
          });
          const resData=await res.json();
          if(resData.success){
            showUserFeedback('Pengingat tugas #'+r.id+' berhasil dimatikan.');
            await Promise.all([loadCrons(),loadTasks(),loadSnapshot()]);
          }else{
            showUserFeedback(resData.error||'Gagal mematikan pengingat',true);
          }
        }catch{
          showUserFeedback('Terjadi kesalahan jaringan',true);
        }finally{
          btnDisable.disabled=false;
        }
      };
      tdAct.append(btnDisable);

      tr.append(tdId,tdTask,tdUser,tdRemind,tdDeadline,tdStatus,tdAct);
      remindersTbody.append(tr);
    }
  }
}

async function loadCrons(){
  try{
    const res=await fetch('/api/crons',{cache:'no-store'});
    if(res.ok){
      renderCrons(await res.json());
    }
  }catch(e){
    console.warn('Failed to load crons:',e);
  }
}

async function loadSnapshot(){el('refresh').disabled=true;el('page-error').hidden=true;try{const response=await fetch('/api/snapshot',{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);render(await response.json())}catch{el('page-error').textContent='Dashboard tidak dapat memuat data. Coba refresh kembali.';el('page-error').hidden=false}finally{el('refresh').disabled=false}}

async function load(){await Promise.all([loadSnapshot(),loadUsers(),loadTasks(),loadCrons()])}

el('refresh').addEventListener('click',load);
el('add-user-form').addEventListener('submit',async(e)=>{
  e.preventDefault();const phoneInput=el('new-phone');const nameInput=el('new-name');const btn=el('add-user-btn');
  const phone=phoneInput.value.trim();const name=nameInput.value.trim();if(!phone)return;
  btn.disabled=true;try{const res=await fetch('/api/users/add',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone,name})});const data=await res.json();if(data.success){showUserFeedback('Nomor '+phone+' berhasil ditambahkan ke whitelist!');phoneInput.value='';nameInput.value='';await loadUsers();await loadSnapshot()}else{showUserFeedback(data.error||'Gagal menambahkan pengguna',true)}}catch{showUserFeedback('Terjadi kesalahan jaringan',true)}finally{btn.disabled=false}
});

document.querySelectorAll('.filter-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentTaskStatus=btn.dataset.status;
    loadTasks();
  });
});

el('task-search-input').addEventListener('input',(e)=>{
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer=setTimeout(()=>{
    taskSearchQuery=e.target.value.trim();
    loadTasks();
  },300);
});

el('modal-close-btn').addEventListener('click',()=>el('task-modal').close());
el('task-modal').addEventListener('click',(e)=>{if(e.target===el('task-modal'))el('task-modal').close()});

load();setInterval(load,60000);
`;

