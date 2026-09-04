/* Dispatch — Command Center controller. */
let D = {};
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function hermesPill(result) {
  if (!result) return '<span class="pill">Queued to Hermes</span>';
  if (result.ok) return `<span class="pill good" title="${esc(result.stdout || '')}">Hermes ✓${result.target ? ' · ' + esc(result.target) : ''}</span>`;
  return `<span class="pill bad" title="${esc(result.stderr || '')}">Hermes failed</span>`;
}

async function api(path, opt = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opt });
  const j = await r.json();
  if (!r.ok) throw new Error(j.stderr || j.error || 'Request failed');
  return j;
}

/* ---------------- shared progress-bar helper (mirrors setup.js) ---------------- */
function progressHTML(id, label) {
  return `<div class="progress-wrap enter" id="${id}">
    <div class="progress-head">
      <div class="progress-label"><span class="progress-spinner"></span><span>${esc(label)}</span></div>
      <span class="progress-eta" id="${id}-eta">estimating…</span>
    </div>
    <div class="progress-track"><div class="progress-fill" id="${id}-fill" style="width:2%"></div></div>
    <div class="progress-pct" id="${id}-pct">2%</div>
  </div>`;
}
function fmtEta(seconds) {
  if (seconds <= 1) return 'finishing up…';
  if (seconds < 60) return `~${Math.ceil(seconds)}s remaining`;
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return `~${m}m ${s}s remaining`;
}
async function trackJob(host, jobId, label, onDone) {
  const id = 'job-' + jobId;
  host.insertAdjacentHTML('afterbegin', progressHTML(id, label));
  const fill = $(`#${id}-fill`), eta = $(`#${id}-eta`), pct = $(`#${id}-pct`);
  const wrap = $(`#${id}`);
  const tick = async () => {
    let j;
    try { j = await api('/api/job?id=' + jobId); } catch (e) { wrap.remove(); return; }
    fill.style.width = j.progress + '%';
    pct.textContent = j.progress + '%';
    eta.textContent = j.done ? 'complete' : fmtEta(j.eta_seconds);
    if (j.done) {
      fill.classList.add('done');
      setTimeout(() => wrap.remove(), 900);
      if (onDone) onDone(j.result);
      await load();
      return;
    }
    setTimeout(tick, 350);
  };
  tick();
}

/* ---------------- nav ---------------- */
function goToView(view) {
  const btn = $$('.cc-sidebar [data-view]').find((x) => x.dataset.view === view);
  if (!btn) return;
  $$('.cc-sidebar [data-view]').forEach((x) => x.classList.remove('active'));
  btn.classList.add('active');
  $$('.cc-view').forEach((v) => v.classList.toggle('active', v.dataset.view === view));
  $('#viewTitle').textContent = btn.textContent.trim();
}
$$('.cc-sidebar [data-view]').forEach((b) => b.onclick = () => goToView(b.dataset.view));
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { e.preventDefault(); goToView(nav.dataset.nav); }
});
$('#refreshBtn').onclick = () => load();

/* ---------------- load & render ---------------- */
async function load() {
  D = await api('/api/command-center');
  render();
}

// One-time banner when arriving straight from a finished wizard run — the
// wizard hands this off via sessionStorage since it now navigates in-place
// (same tab) instead of opening a new one.
(function showSetupSummaryIfPresent() {
  let summary;
  try { summary = sessionStorage.getItem('dispatch_setup_summary'); } catch (e) { return; }
  if (!summary) return;
  try { sessionStorage.removeItem('dispatch_setup_summary'); } catch (e) {}
  const notice = $('#setupSummaryNotice');
  if (!notice) return;
  $('#setupSummaryText').textContent = summary;
  notice.style.display = 'flex';
})();

function render() {
  renderOverview();
  renderKanban();
  renderAgents();
  renderTickets();
  renderProjects();
  renderModels();
  renderTools();
  renderDiagnostics();
}

function renderOverview() {
  const openTickets = D.tickets.filter((x) => !['closed', 'resolved', 'approved', 'rejected'].includes(x.status)).length;
  const pendingApprovals = (D.approvals || []).filter((x) => !['closed', 'resolved', 'approved', 'rejected'].includes(x.status)).length;
  const metrics = [
    ['◉', 'Projects', D.projects.length],
    ['◈', 'Agents active', D.agents.length],
    ['☍', 'Open tickets', openTickets],
    ['✓', 'Pending approvals', pendingApprovals],
    ['▦', 'Tasks in flight', D.tasks.filter((t) => t.status !== 'done').length],
    ['🔗', 'Queued to Hermes', (D.hermes_bridge || {}).queued || 0],
  ];
  $('#ccMetrics').innerHTML = metrics.map(([icon, label, val], i) => `<div class="metric-card enter enter-${(i % 4) + 1}"><span class="metric-icon">${icon}</span><div class="metric-value">${val}</div><div class="metric-label">${label}</div></div>`).join('');
  const hb = D.hermes_bridge || {};
  const live = D.hermes_live || {};
  if (live.cli_available) {
    const serveUp = live.serve && live.serve.ok;
    $('#hermesBridgeNotice').classList.toggle('info', true);
    $('#hermesBridgeText').innerHTML = `<code>hermes</code> CLI detected — actions are sent live via <code>hermes send --to &lt;agent&gt;</code>${serveUp ? ' and the local Hermes backend is reachable' : ' (the local Hermes backend at 127.0.0.1:9119 did not respond — Hermes may not be running)'}. A durable copy of every job also lands in <code>projects/&lt;slug&gt;/hermes-inbox/</code>. ${hb.acknowledged || 0} of ${hb.queued || 0} queued job(s) have a recorded result — open a card to see whether Hermes accepted it.`;
  } else {
    $('#hermesBridgeText').innerHTML = `The <code>hermes</code> CLI isn't on this Mac's PATH, so actions can only queue as job files in <code>projects/&lt;slug&gt;/hermes-inbox/</code> — nothing is sent live yet. Install Hermes and the <code>hermes</code> CLI, then actions here will start dispatching automatically. See <a href="#" data-nav="settings">Settings</a>.`;
  }

  $('#ccEvents').innerHTML = (D.events || []).slice(0, 8).map((e) => `<div class="agent-row" style="grid-template-columns:1fr"><b style="font-size:12.5px">${esc(e.summary || e.type)}</b><span class="muted" style="font-size:11px">${esc(e.created_at || '')}</span></div>`).join('') || '<p class="muted">No events recorded yet.</p>';

  const o = D.organization || {};
  $('#ccOrgSnapshot').innerHTML = `<div class="pill accent">${(o.project_types || []).join(' + ') || '—'}</div><div class="pill">${esc(o.complexity || '—')}</div><div class="pill">${o.agent_count || 0} roles</div><p class="muted" style="margin-top:10px;font-size:12.5px">Adjust deployment targets from the Setup Wizard; this view always reflects the last activated roster.</p>`;

  // Always every project, regardless of the sidebar project switcher — Overview
  // is the one place meant to answer "how's everything doing" at a glance.
  $('#ccProjectStatusList').innerHTML = D.projects.map((p) => {
    const pct = projectPct(p);
    return `<div class="agent-row" style="grid-template-columns:1.4fr auto auto auto;align-items:center;gap:10px">
      <b style="font-size:12.5px">${esc(p.name)}</b>
      <span class="pill ${PROJECT_STATUS_PILL[p.status] || 'accent'}">${esc(p.status)}</span>
      <span class="muted" style="font-size:11px;min-width:120px">${agentCountForProject(p.id)} agent(s)</span>
      <div style="display:flex;align-items:center;gap:8px;min-width:120px">
        <div class="project-progress-track" style="flex:1"><div class="project-progress-fill" style="width:${pct}%"></div></div>
        <span class="muted" style="font-size:11px">${pct}%</span>
      </div>
    </div>`;
  }).join('') || '<p class="muted" style="font-size:12.5px">No projects yet — create one from the Projects view.</p>';
}

const KANBAN_COLS = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];

// The project context lives in one place — a single sidebar dropdown that's
// visible no matter which view you're on — rather than a filter buried inside
// the Kanban view alone. Kanban reads it to scope its board; Overview
// deliberately ignores it and always shows every project.
let kanbanProjectId = 'all';

function renderProjectSwitcher() {
  const sel = $('#ccProjectSwitcher');
  const prev = sel.value || kanbanProjectId;
  sel.innerHTML = ['<option value="all">All projects</option>']
    .concat(D.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)).join('');
  // Keep the previous selection if it still exists (e.g. after a reload), default to "all" otherwise.
  sel.value = Array.from(sel.options).some((o) => o.value === prev) ? prev : 'all';
  kanbanProjectId = sel.value;
}

function renderKanban() {
  renderProjectSwitcher();
  const proj = kanbanProjectId === 'all' ? null : D.projects.find((p) => String(p.id) === String(kanbanProjectId));
  $('#kanbanProjectLabel').textContent = proj ? `Showing: ${proj.name}` : 'Showing: all projects — pick one from the sidebar to scope this board.';
  const tasks = kanbanProjectId === 'all' ? D.tasks : D.tasks.filter((t) => String(t.project_id) === String(kanbanProjectId));
  $('#kanban').innerHTML = KANBAN_COLS.map((col) => {
    const items = tasks.filter((t) => (t.status || 'backlog') === col.id);
    return `<div class="kanban-col" data-status="${col.id}">
      <div class="kanban-col-head"><b>${col.label}</b><span class="kanban-count">${items.length}</span></div>
      <div class="kanban-drop" data-status="${col.id}">
        ${items.map(taskCardHTML).join('') || '<div class="kanban-empty">No tasks</div>'}
      </div>
    </div>`;
  }).join('');
  bindKanbanDnD();
  renderKanbanSide(tasks);

  const agentOpts = ['<option value="">Unassigned</option>'].concat(D.agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`));
  $('#newTaskAgent').innerHTML = agentOpts.join('');
}

function renderKanbanSide(tasks) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const R = 44, C = 2 * Math.PI * R;
  const proj = kanbanProjectId === 'all' ? null : D.projects.find((p) => String(p.id) === String(kanbanProjectId));
  const counts = KANBAN_COLS.map((col) => [col.label, tasks.filter((t) => (t.status || 'backlog') === col.id).length]);
  const agentsOnProject = proj ? (D.project_agents || []).filter((pa) => pa.project_id === proj.id).length : null;
  $('#kanbanSide').innerHTML = `
    <h3 style="margin-bottom:2px">${proj ? esc(proj.name) : 'All projects'}</h3>
    <p class="muted" style="font-size:11.5px;margin-bottom:14px">${proj ? esc(proj.status) : `${D.projects.length} project(s)`}</p>
    <div class="progress-ring">
      <svg viewBox="0 0 104 104">
        <circle class="ring-track" cx="52" cy="52" r="${R}"></circle>
        <circle class="ring-fill" cx="52" cy="52" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C - (C * pct) / 100}"></circle>
      </svg>
      <div class="ring-pct">${pct}%</div>
    </div>
    ${counts.map(([label, n]) => `<div class="stat-line"><span class="muted">${esc(label)}</span><b>${n}</b></div>`).join('')}
    ${proj ? `<div class="stat-line"><span class="muted">Agents assigned</span><b>${agentsOnProject}</b></div>
      <div class="stat-line"><span class="muted">Hermes</span><b>${proj.hermes_result ? (proj.hermes_result.ok ? 'Working' : 'Failed') : 'Not sent'}</b></div>` : ''}
  `;
}

function taskCardHTML(t) {
  return `<div class="kanban-card" draggable="true" data-key="${esc(t.key)}">
    <b>${esc(t.title)}</b>
    <div class="meta"><span class="pill">${esc(t.priority || 'P3')}</span>${t.agent ? `<span class="pill accent">${esc(t.agent)}</span>` : ''}${hermesPill(t.hermes_result)}</div>
  </div>`;
}

function bindKanbanDnD() {
  let draggedKey = null;
  $$('.kanban-card').forEach((card) => {
    card.addEventListener('dragstart', () => { draggedKey = card.dataset.key; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
  $$('.kanban-col').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('dragover'); });
    col.addEventListener('dragleave', () => col.classList.remove('dragover'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('dragover');
      if (!draggedKey) return;
      const status = col.dataset.status;
      await api('/api/task-update', { method: 'POST', body: JSON.stringify({ key: draggedKey, status }) });
      draggedKey = null;
      await load();
    });
  });
}

$('#ccProjectSwitcher').onchange = () => { kanbanProjectId = $('#ccProjectSwitcher').value; renderKanban(); renderOverview(); };
$('#addTaskBtn').onclick = async () => {
  const title = $('#newTaskTitle').value.trim();
  if (!title) return;
  const body = { title, priority: $('#newTaskPriority').value, agent: $('#newTaskAgent').value || null };
  if (kanbanProjectId !== 'all') body.project_id = kanbanProjectId;
  await api('/api/task', { method: 'POST', body: JSON.stringify(body) });
  $('#newTaskTitle').value = '';
  await load();
};

const _agentLastSeenUpdate = {}; // agent id -> updated_at we last rendered, to flash only on a genuinely NEW dispatch
function renderAgents() {
  if (!D.agents.length) {
    $('#ccAgents').innerHTML = '<div class="empty-state">Activate a generated roster from the Setup Wizard first.</div>';
    return;
  }
  const byAgentProjects = {};
  (D.project_agents || []).forEach((pa) => (byAgentProjects[pa.agent_id] ??= []).push(pa.project_id));
  const projectNamesFor = (agentId) => (byAgentProjects[agentId] || []).map((pid) => D.projects.find((p) => p.id === pid)?.name).filter(Boolean);
  const byDept = {};
  D.agents.forEach((a) => (byDept[a.department || 'General'] ??= []).push(a));
  $('#ccAgents').innerHTML = `<div class="orgchart-root">Command Center</div>` + Object.entries(byDept).map(([dept, agents]) => `
    <div class="orgchart-dept">
      <div class="orgchart-dept-label">${esc(dept)}</div>
      <div class="orgchart-row">
        ${agents.map((a) => {
          const isNew = a.updated_at && _agentLastSeenUpdate[a.id] && _agentLastSeenUpdate[a.id] !== a.updated_at;
          _agentLastSeenUpdate[a.id] = a.updated_at;
          const projectNames = projectNamesFor(a.id);
          return `<div class="orgchart-node ${a.recently_active ? 'working' : ''} ${isNew ? 'just-dispatched' : ''}" data-agent="${esc(a.id)}">
            <b>${esc(a.name)}</b>
            <div class="role">${esc(a.level || '')}</div>
            <div class="activity">${a.recently_active ? esc(a.activity || 'Working…') : (projectNames[0] ? esc(projectNames[0]) : '')}</div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `).join('');
  // Wires need final layout (wrapping flex, so positions vary by window width) —
  // draw on the next frame once the browser has actually placed the nodes.
  requestAnimationFrame(renderDelegationWires);
}

function renderDelegationWires() {
  const svg = $('#orgchartWires');
  const wrap = $('#orgchartWrap');
  if (!svg || !wrap) return;
  const delegations = D.delegations || [];
  const wrapRect = wrap.getBoundingClientRect();
  svg.setAttribute('width', wrapRect.width);
  svg.setAttribute('height', wrapRect.height);
  const centerOf = (agentId) => {
    const el = wrap.querySelector(`.orgchart-node[data-agent="${CSS.escape(String(agentId))}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left - wrapRect.left + r.width / 2, y: r.top - wrapRect.top + r.height / 2 };
  };
  // De-dupe so two recent delegations between the same pair only draw one wire.
  const seen = new Set();
  const paths = [];
  for (const d of delegations) {
    const pairKey = [d.from_agent, d.to_agent].sort().join('::');
    if (seen.has(pairKey)) continue;
    const a = centerOf(d.from_agent), b = centerOf(d.to_agent);
    if (!a || !b) continue; // one side isn't on this org chart (e.g. filtered/unknown agent id)
    seen.add(pairKey);
    const midY = (a.y + b.y) / 2;
    paths.push(`<path class="orgchart-wire" d="M${a.x},${a.y} C${a.x},${midY} ${b.x},${midY} ${b.x},${b.y}"></path>`);
  }
  svg.innerHTML = `
    <defs>
      <linearGradient id="orgchartWireGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#6ea8ff"></stop>
        <stop offset="100%" stop-color="#9b7bff"></stop>
      </linearGradient>
    </defs>
    ${paths.join('')}
  `;
}
window.addEventListener('resize', () => { if ($('#orgchartWires')) renderDelegationWires(); });

let openTicketKey = null;

function renderTicketKpis() {
  const k = D.ticket_kpis || { open: 0, closed: 0, mttr_hours: null };
  const host = $('#ticketKpis');
  if (!host) return;
  const mttr = k.mttr_hours == null ? '—' : (k.mttr_hours < 1 ? `${Math.round(k.mttr_hours * 60)}m` : `${k.mttr_hours}h`);
  host.innerHTML = [
    ['☍', 'Open', k.open],
    ['✓', 'Closed', k.closed],
    ['⏱', 'MTTR', mttr],
  ].map(([icon, label, val]) => `<div class="metric-card"><span class="metric-icon">${icon}</span><div class="metric-value">${val}</div><div class="metric-label">${label}</div></div>`).join('');
}

function renderTickets() {
  renderTicketKpis();
  $('#ccTickets').innerHTML = D.tickets.map((t) => `<button type="button" class="desk-row ${t.key === openTicketKey ? 'active' : ''}" data-ticket="${esc(t.key)}">
      <b>${esc(t.key)} · ${esc(t.title)}</b>
      <span class="pill ${['closed', 'resolved', 'approved'].includes(t.status) ? 'good' : t.status === 'rejected' ? 'bad' : 'warn'}">${esc(t.status)}</span>
      <span class="pill">${t.category === 'approval' ? '✓ Approval' : esc(t.priority || 'P3')}</span>
    </button>`).join('') || '<div class="empty-state">No tickets yet.</div>';
  if (openTicketKey && !D.tickets.some((t) => t.key === openTicketKey)) openTicketKey = null;
  $$('[data-ticket]').forEach((b) => b.onclick = () => {
    openTicketKey = b.dataset.ticket === openTicketKey ? openTicketKey : b.dataset.ticket;
    renderTickets();
  });
  renderTicketDetail();
}

function renderTicketDetail() {
  const host = $('#ccTicketDetail');
  const t = D.tickets.find((x) => x.key === openTicketKey);
  if (!t) {
    host.classList.add('empty');
    host.innerHTML = '<span class="muted">Select a ticket to see its details, notes, and agent activity.</span>';
    return;
  }
  host.classList.remove('empty');
  const isApproval = t.category === 'approval';
  const isOpen = !['closed', 'resolved', 'approved', 'rejected'].includes(t.status);
  const timeline = [
    ['Opened', t.created_at],
    t.assigned_agent ? ['Assigned', `to ${t.assigned_agent}`] : null,
    t.hermes_result ? ['Sent to Hermes', t.hermes_result.ok ? `accepted by ${t.hermes_result.target || 'chief_of_staff'}` : (t.hermes_result.stderr || 'failed')] : null,
    t.resolution ? ['Resolution', t.resolution] : null,
    t.closed_at ? [isApproval ? 'Decided' : 'Closed', t.closed_at] : null,
  ].filter(Boolean);
  const notes = (t.notes || []);
  const attachments = (t.attachments || []);
  host.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div><h2 style="margin-bottom:4px">${esc(t.title)}</h2><span class="muted" style="font-size:12px">${esc(t.key)}${isApproval ? ' · Approval' : ''}</span></div>
      <span class="pill ${['closed', 'resolved', 'approved'].includes(t.status) ? 'good' : t.status === 'rejected' ? 'bad' : 'warn'}">${esc(t.status)}</span>
    </div>
    <p class="muted" style="margin-top:14px">${esc(t.problem || 'No details provided.')}</p>
    ${isApproval && isOpen ? `
      <div class="formrow" style="margin-top:10px">
        <button id="tdApprove">Approve</button>
        <button class="secondary" id="tdReject">Reject</button>
        <button class="ghost" id="tdChanges">Request Changes</button>
      </div>
    ` : `
      <div class="formrow" style="margin-top:10px">
        <label>Status
          <select id="tdStatus">${['new', 'in_progress', 'resolved', 'closed'].map((s) => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        </label>
        <button class="secondary" id="tdSave">Save</button>
      </div>
    `}
    <h3 style="margin-top:18px">Attachments</h3>
    <div class="formrow">
      <input type="file" id="tdFile">
    </div>
    ${attachments.length ? `<div class="formrow" style="flex-wrap:wrap">${attachments.map((f) => `<a href="/api/project-file/download?key=${encodeURIComponent(f.key)}" target="_blank" class="pill">📎 ${esc(f.filename)}</a>`).join('')}</div>` : '<p class="muted" style="font-size:12.5px">No files attached.</p>'}
    <h3 style="margin-top:18px">Notes</h3>
    <div class="desk-timeline">
      ${notes.map((n) => `<div class="desk-timeline-item"><b>${esc(n.author)}</b> — ${esc(n.body)} <span class="muted" style="font-size:11px">${esc(n.created_at || '')}</span></div>`).join('') || '<div class="desk-timeline-item muted">No notes yet — agents can post status updates here too.</div>'}
    </div>
    <div class="formrow" style="margin-top:8px">
      <input id="tdNoteBody" placeholder="Add a note…" style="min-width:260px">
      <button class="secondary" id="tdNoteSave">Add Note</button>
    </div>
    <h3 style="margin-top:18px">Activity</h3>
    <div class="desk-timeline">
      ${timeline.map(([label, val]) => `<div class="desk-timeline-item"><b>${esc(label)}</b> — ${esc(val || '')}</div>`).join('') || '<div class="desk-timeline-item muted">No activity recorded yet.</div>'}
    </div>
  `;
  const saveBtn = $('#tdSave');
  if (saveBtn) saveBtn.onclick = async () => {
    await api('/api/ticket-update', { method: 'POST', body: JSON.stringify({ key: t.key, status: $('#tdStatus').value }) });
    await load();
  };
  ['tdApprove', 'tdReject', 'tdChanges'].forEach((id, i) => {
    const btn = $('#' + id);
    if (!btn) return;
    const decision = ['approved', 'rejected', 'changes_requested'][i];
    btn.onclick = async () => {
      await api('/api/ticket-update', { method: 'POST', body: JSON.stringify({ key: t.key, decision }) });
      await load();
    };
  });
  $('#tdNoteSave').onclick = async () => {
    const body = $('#tdNoteBody').value.trim();
    if (!body) return;
    await api('/api/ticket-note', { method: 'POST', body: JSON.stringify({ ticket_key: t.key, body }) });
    await load();
  };
  $('#tdFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const data_base64 = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result.split(',')[1]);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
    await api('/api/project-file', { method: 'POST', body: JSON.stringify({ ticket_key: t.key, filename: file.name, content_type: file.type, data_base64 }) });
    await load();
  };
}

$('#addTicketBtn').onclick = async () => {
  const title = $('#newTicketTitle').value.trim();
  const hint = $('#addTicketHint');
  if (!title) {
    if (hint) { hint.textContent = 'Add a title first.'; hint.style.color = 'var(--bad, #d33)'; }
    $('#newTicketTitle').focus();
    return;
  }
  if (hint) hint.textContent = '';
  await api('/api/ticket', {
    method: 'POST',
    body: JSON.stringify({ title, priority: $('#newTicketPriority').value, category: $('#newTicketCategory').value }),
  });
  $('#newTicketTitle').value = '';
  await load();
};

function agentCountForProject(pid) {
  return (D.project_agents || []).filter((pa) => pa.project_id === pid).length;
}

const PROJECT_STATUS_PILL = { archived: 'warn', in_progress: 'good', planning: 'accent', active: 'accent', queued: 'warn' };
function projectHermesLine(p) {
  const r = p.hermes_result;
  if (!r) return 'Not sent to Hermes yet.';
  if (r.ok) return `Sent to Hermes (${esc(r.target || 'chief_of_staff')}) — working.`;
  return `Hermes dispatch failed: ${esc(r.stderr || 'unknown error')}`;
}
const PROJECT_COLS = [
  { label: 'Planning', match: (p) => ['planning', 'active', 'queued'].includes(p.status) },
  { label: 'In Progress', match: (p) => p.status === 'in_progress' },
  { label: 'Archived', match: (p) => p.status === 'archived' },
];
function projectPct(p) {
  const tasks = D.tasks.filter((t) => t.project_id === p.id);
  if (!tasks.length) return 0;
  return Math.round((tasks.filter((t) => t.status === 'done').length / tasks.length) * 100);
}
function projectCardHTML(p) {
  const pct = projectPct(p);
  return `<div class="card" data-project="${p.id}" style="cursor:pointer">
    <b>${esc(p.name)}</b>
    <span class="pill">${esc(p.project_type)}</span>
    <span class="pill ${PROJECT_STATUS_PILL[p.status] || 'accent'}">${esc(p.status)}</span>
    <span class="pill">${agentCountForProject(p.id)} agent(s)</span>
    <p class="muted" style="font-size:12.5px;margin-top:8px">${esc((p.description || '').slice(0, 90)) || 'No description yet — click to add one.'}${(p.description || '').length > 90 ? '…' : ''}</p>
    <p class="muted" style="font-size:11px;margin-top:4px">${projectHermesLine(p)}</p>
    <div class="project-progress-track"><div class="project-progress-fill" style="width:${pct}%"></div></div>
    <p class="muted" style="font-size:10.5px;margin-top:4px;text-align:right">${pct}% of tasks done</p>
  </div>`;
}
function renderProjects() {
  $('#ccProjects').innerHTML = PROJECT_COLS.map((col) => {
    const items = D.projects.filter(col.match);
    return `<div>
      <div class="projects-col-head"><span>${col.label}</span><span>${items.length}</span></div>
      <div style="display:flex;flex-direction:column;gap:12px">${items.map(projectCardHTML).join('') || '<p class="muted" style="font-size:12px">None</p>'}</div>
    </div>`;
  }).join('');
  $$('[data-project]').forEach((c) => c.onclick = () => openProjectDialog(Number(c.dataset.project)));
  renderNewProjectForm();

  const counts = { total: D.projects.length, in_progress: D.projects.filter((p) => p.status === 'in_progress').length, archived: D.projects.filter((p) => p.status === 'archived').length, queued: D.projects.filter((p) => p.status === 'queued').length, planning: D.projects.filter((p) => ['planning', 'active'].includes(p.status)).length };
  $('#ccProjectsSide').innerHTML = `
    <h3>Summary</h3>
    <div class="stat-line"><span class="muted">Total</span><b>${counts.total}</b></div>
    <div class="stat-line"><span class="muted">In progress</span><b>${counts.in_progress}</b></div>
    <div class="stat-line"><span class="muted">Planning</span><b>${counts.planning}</b></div>
    <div class="stat-line"><span class="muted">Queued (awaiting go-ahead)</span><b>${counts.queued}</b></div>
    <div class="stat-line"><span class="muted">Archived</span><b>${counts.archived}</b></div>
  `;
}

const DEPLOY_TYPES = [
  ['ios', 'iOS'], ['macos', 'macOS'], ['android', 'Android'], ['web', 'Web'],
  ['game', 'Game'], ['ai_ml', 'AI / ML'], ['fullstack', 'Full-stack'],
];
let selectedDeployTypes = new Set();
let selectedProjectAgents = new Set();

function renderNewProjectForm() {
  const typesHost = $('#newProjectTypes');
  if (typesHost && !typesHost.dataset.bound) {
    typesHost.innerHTML = DEPLOY_TYPES.map(([id, label]) => `<div class="deploy-type-chip" data-type="${id}">${esc(label)}</div>`).join('');
    typesHost.dataset.bound = '1';
    $$('.deploy-type-chip').forEach((chip) => chip.onclick = () => {
      chip.classList.toggle('selected');
      if (chip.classList.contains('selected')) selectedDeployTypes.add(chip.dataset.type);
      else selectedDeployTypes.delete(chip.dataset.type);
      renderAgentPreview();
    });
  }
  renderAgentPreview();
}

function renderAgentPreview() {
  const host = $('#newProjectAgentPreview');
  if (!host) return;
  if (!D.agents.length) {
    host.innerHTML = '<p class="muted" style="font-size:12px">Activate a roster from the Setup Wizard first.</p>';
    return;
  }
  host.innerHTML = D.agents.map((a) => {
    const suggested = selectedDeployTypes.size > 0 && (a.project_types || []).some((t) => selectedDeployTypes.has(t));
    const isSelected = selectedProjectAgents.has(a.id);
    return `<div class="agent-preview-chip ${isSelected ? 'selected' : ''} ${suggested ? 'suggested' : ''}" data-agent="${esc(a.id)}">${isSelected ? '<span class="tick">✓</span>' : ''}${esc(a.name)}</div>`;
  }).join('');
  $$('.agent-preview-chip').forEach((chip) => chip.onclick = () => {
    const id = chip.dataset.agent;
    if (selectedProjectAgents.has(id)) selectedProjectAgents.delete(id); else selectedProjectAgents.add(id);
    renderAgentPreview();
  });
}

async function submitNewProject(mode) {
  const name = $('#newProjectName').value.trim();
  const hint = $('#newProjectHint');
  if (!name) {
    if (hint) { hint.textContent = 'Add a project name first.'; hint.style.color = 'var(--bad, #d33)'; }
    $('#newProjectName').focus();
    return;
  }
  if (hint) hint.style.color = '';
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'project';
  const description = $('#newProjectDesc').value.trim();
  const project_types = Array.from(selectedDeployTypes);
  const agent_ids = Array.from(selectedProjectAgents);
  const r = await api('/api/project', { method: 'POST', body: JSON.stringify({ name, slug, description, project_types, agent_ids, mode }) });
  $('#newProjectName').value = '';
  $('#newProjectDesc').value = '';
  selectedDeployTypes = new Set();
  selectedProjectAgents = new Set();
  $$('.deploy-type-chip.selected').forEach((c) => c.classList.remove('selected'));
  await load();
  if (r.queued) {
    if (hint) { hint.style.color = ''; hint.textContent = `Queued — ticket ${r.ticket_key} is waiting on a go-ahead from the Chief of Staff before anything starts.`; }
  } else {
    const d = r.hermes_dispatch;
    if (d && !d.ok) alert(`Project created, but Hermes dispatch failed: ${d.stderr || 'unknown error'}\n\nYou can retry from the project's detail view.`);
  }
}
$('#startProjectBtn').onclick = () => submitNewProject('start');
$('#queueProjectBtn').onclick = () => submitNewProject('queue');

let openProjectId = null;
function openProjectDialog(id) {
  const p = D.projects.find((x) => x.id === id);
  if (!p) return;
  openProjectId = id;
  $('#pdName').textContent = p.name;
  $('#pdType').textContent = p.project_type;
  $('#pdStatus').textContent = p.status;
  $('#pdDescription').value = p.description || '';
  $('#pdMeta').textContent = `Created ${p.created_at || '—'}${p.archived_at ? ' · Archived ' + p.archived_at : ''}`;
  $('#pdArchive').textContent = p.status === 'archived' ? 'Unarchive' : 'Archive';
  $('#pdHermesStatus').textContent = projectHermesLine(p);
  renderProjectAgents(id);
  renderProjectFileAgentOptions(id);
  renderProjectFiles(id);
  $('#pdFileStatus').textContent = '';
  $('#pdFileInput').value = '';
  $('#pdFileNote').value = '';
  $('#projectDialog').showModal();
}

function renderProjectFileAgentOptions(projectId) {
  const assigned = new Set((D.project_agents || []).filter((pa) => pa.project_id === projectId).map((pa) => pa.agent_id));
  const assignedAgents = D.agents.filter((a) => assigned.has(a.id));
  $('#pdFileAgent').innerHTML = '<option value="">Route to: chief_of_staff</option>'
    + assignedAgents.map((a) => `<option value="${esc(a.id)}">Route to: ${esc(a.name)}</option>`).join('');
}

function renderProjectFiles(projectId) {
  const files = (D.files || []).filter((f) => f.project_id === projectId);
  $('#pdFiles').innerHTML = files.length
    ? files.map((f) => `<div class="card" style="padding:8px 10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <a href="/api/project-file/download?key=${encodeURIComponent(f.key)}" target="_blank" style="font-weight:600">${esc(f.filename)}</a>
        <span class="muted" style="font-size:11.5px">${(f.size_bytes / 1024).toFixed(1)} KB${f.agent ? ' · ' + esc(f.agent) : ''}</span>
        ${hermesPill(f.hermes_result)}
        <button type="button" class="ghost" data-del-file="${esc(f.key)}" style="margin-left:auto;font-size:11.5px">Remove</button>
      </div>`).join('')
    : '<span class="muted" style="font-size:12px">No files sent yet.</span>';
  $$('[data-del-file]').forEach((btn) => btn.onclick = async () => {
    await api('/api/project-file-delete', { method: 'POST', body: JSON.stringify({ key: btn.dataset.delFile }) });
    D = await api('/api/command-center');
    renderProjectFiles(projectId);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',').pop());
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

$('#pdFileUpload').onclick = async () => {
  const input = $('#pdFileInput');
  const file = input.files && input.files[0];
  if (!file) { $('#pdFileStatus').textContent = 'Choose a file first.'; return; }
  $('#pdFileUpload').disabled = true;
  $('#pdFileStatus').textContent = 'Uploading…';
  try {
    const data_base64 = await fileToBase64(file);
    const r = await api('/api/project-file', {
      method: 'POST',
      body: JSON.stringify({
        project_id: openProjectId,
        filename: file.name,
        content_type: file.type,
        data_base64,
        note: $('#pdFileNote').value,
        agent: $('#pdFileAgent').value,
      }),
    });
    if (!r.ok) {
      $('#pdFileStatus').textContent = r.stderr || 'Upload failed.';
    } else {
      $('#pdFileStatus').textContent = `Sent ${r.filename} to Hermes.`;
      input.value = '';
      $('#pdFileNote').value = '';
      D = await api('/api/command-center');
      renderProjectFiles(openProjectId);
    }
  } catch (e) {
    $('#pdFileStatus').textContent = 'Upload failed: ' + e;
  } finally {
    $('#pdFileUpload').disabled = false;
  }
};
function renderProjectAgents(projectId) {
  const assigned = new Set((D.project_agents || []).filter((pa) => pa.project_id === projectId).map((pa) => pa.agent_id));
  $('#pdAgents').innerHTML = D.agents.length
    ? D.agents.map((a) => `<button type="button" class="pill ${assigned.has(a.id) ? 'good' : ''}" data-toggle-agent="${esc(a.id)}" style="cursor:pointer;border:1px solid var(--line)">${assigned.has(a.id) ? '✓ ' : '+ '}${esc(a.name)}</button>`).join('')
    : '<span class="muted" style="font-size:12px">Activate a roster from the Setup Wizard first.</span>';
  $$('[data-toggle-agent]').forEach((btn) => btn.onclick = async () => {
    const agentId = btn.dataset.toggleAgent;
    const nowAssigned = new Set((D.project_agents || []).filter((pa) => pa.project_id === projectId).map((pa) => pa.agent_id));
    await api('/api/project-agent', { method: 'POST', body: JSON.stringify({ project_id: projectId, agent_id: agentId, assigned: !nowAssigned.has(agentId) }) });
    D = await api('/api/command-center');
    renderProjectAgents(projectId);
    renderProjects();
    renderAgents();
  });
}
$('#pdClose').onclick = () => $('#projectDialog').close();
$('#pdSave').onclick = async () => {
  await api('/api/project-update', { method: 'POST', body: JSON.stringify({ id: openProjectId, description: $('#pdDescription').value }) });
  $('#projectDialog').close();
  await load();
};
$('#pdSendHermes').onclick = async () => {
  const btn = $('#pdSendHermes');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  // Save whatever's in the prompt box first, so the dispatch uses the latest text.
  await api('/api/project-update', { method: 'POST', body: JSON.stringify({ id: openProjectId, description: $('#pdDescription').value }) });
  const r = await api('/api/project-dispatch', { method: 'POST', body: JSON.stringify({ id: openProjectId }) });
  $('#pdHermesStatus').textContent = r.ok
    ? `Sent to Hermes (${esc(r.target || 'chief_of_staff')}) — working.`
    : `Hermes dispatch failed: ${esc(r.stderr || 'unknown error')}`;
  btn.disabled = false;
  btn.textContent = 'Send to Hermes';
  D = await api('/api/command-center');
  renderProjects();
};
$('#pdArchive').onclick = async () => {
  const p = D.projects.find((x) => x.id === openProjectId);
  await api('/api/project-archive', { method: 'POST', body: JSON.stringify({ id: openProjectId, archived: p.status !== 'archived' }) });
  $('#projectDialog').close();
  await load();
};
$('#pdDelete').onclick = async () => {
  if (!confirm('Delete this project? This cannot be undone. Its tickets/tasks/approvals stay in history but lose their live project.')) return;
  const r = await api('/api/project-delete', { method: 'POST', body: JSON.stringify({ id: openProjectId }) });
  if (!r.ok) { alert(r.stderr || 'Could not delete project.'); return; }
  $('#projectDialog').close();
  await load();
};

function renderModels() {
  const rec = D.recommendation || {};
  $('#ccRecommendedModels').innerHTML = '<div class="modelgrid">' + ['general', 'coder', 'embedding'].filter((k) => rec[k]).map((k) => {
    const m = rec[k];
    return `<div class="card"><span class="muted">${k.toUpperCase()}</span><b>${esc(m.id)}</b><p class="muted" style="font-size:12.5px">${esc(m.notes)}</p><div class="pill">Quality ${m.quality}</div><div class="pill">~${m.disk_gb} GB</div><div style="margin-top:8px"><button data-pull="${esc(m.id)}" ${m.installed ? 'disabled' : ''}>${m.installed ? 'Installed' : 'Install Model'}</button></div></div>`;
  }).join('') + '</div>';
  $$('[data-pull]').forEach((b) => b.onclick = async () => {
    b.disabled = true;
    const { job_id } = await api('/api/pull-model/start', { method: 'POST', body: JSON.stringify({ model: b.dataset.pull }) });
    trackJob($('#ccRecommendedModels'), job_id, `Pulling ${b.dataset.pull}`);
  });
  const scan = D.scan || {};
  $('#ccExistingModels').innerHTML = (scan.models || []).map((m) => `<div class="card"><b>${esc(m.name)}</b><div class="muted">${esc(m.size || '')}</div></div>`).join('') || '<div class="empty-state">No Ollama models detected.</div>';
}

function renderTools() {
  const scan = D.scan || {};
  $('#ccTools').innerHTML = (scan.tools || []).map((t) => `<div class="card"><b>${esc(t.id)}</b><span class="pill ${t.installed ? 'good' : 'warn'}">${t.installed ? 'Installed' : 'Missing'}</span>${!t.installed ? `<div style="margin-top:8px"><button data-tool="${esc(t.brew)}">Install</button></div>` : ''}</div>`).join('');
  $$('[data-tool]').forEach((b) => b.onclick = async () => {
    b.disabled = true;
    const { job_id } = await api('/api/install-tool/start', { method: 'POST', body: JSON.stringify({ package: b.dataset.tool }) });
    trackJob($('#ccTools'), job_id, `Installing ${b.dataset.tool}`);
  });
  const h = (D.integration || {});
  $('#ccHermes').innerHTML = `<div class="card"><b>Integration status</b><div class="muted" style="margin-top:6px">${esc(h.message || '')}</div></div>`;
}

function renderDiagnostics() {
  $('#logs').textContent = JSON.stringify(D.logs || [], null, 2);
}
$('#reportBtn').onclick = async () => { $('#diag').textContent = JSON.stringify(await api('/api/report'), null, 2); };

load();
setInterval(() => { if (!$('.progress-wrap')) load(); }, 15000);
