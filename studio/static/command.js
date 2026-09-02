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
  const btn = $$('#ccNav button').find((x) => x.dataset.view === view);
  if (!btn) return;
  $$('#ccNav button').forEach((x) => x.classList.remove('active'));
  btn.classList.add('active');
  $$('.cc-view').forEach((v) => v.classList.toggle('active', v.dataset.view === view));
  $('#viewTitle').textContent = btn.textContent.trim();
}
$$('#ccNav button').forEach((b) => b.onclick = () => goToView(b.dataset.view));
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

function render() {
  renderOverview();
  renderKanban();
  renderAgents();
  renderTickets();
  renderApprovals();
  renderProjects();
  renderModels();
  renderTools();
  renderDiagnostics();
}

function renderOverview() {
  const openTickets = D.tickets.filter((x) => !['closed', 'resolved'].includes(x.status)).length;
  const pendingApprovals = D.approvals.filter((x) => x.status === 'pending').length;
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
    $('#hermesBridgeText').innerHTML = `The <code>hermes</code> CLI isn't on this Mac's PATH, so actions can only queue as job files in <code>projects/&lt;slug&gt;/hermes-inbox/</code> — nothing is sent live yet. Install Hermes and the <code>hermes</code> CLI, then actions here will start dispatching automatically. See <a href="#" data-nav="tools">Tools &amp; Integration</a>.`;
  }

  $('#ccEvents').innerHTML = (D.events || []).slice(0, 8).map((e) => `<div class="agent-row" style="grid-template-columns:1fr"><b style="font-size:12.5px">${esc(e.summary || e.type)}</b><span class="muted" style="font-size:11px">${esc(e.created_at || '')}</span></div>`).join('') || '<p class="muted">No events recorded yet.</p>';

  const o = D.organization || {};
  $('#ccOrgSnapshot').innerHTML = `<div class="pill accent">${(o.project_types || []).join(' + ') || '—'}</div><div class="pill">${esc(o.complexity || '—')}</div><div class="pill">${o.agent_count || 0} roles</div><p class="muted" style="margin-top:10px;font-size:12.5px">Adjust deployment targets from the Setup Wizard; this view always reflects the last activated roster.</p>`;
}

const KANBAN_COLS = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];

function renderKanban() {
  $('#kanban').innerHTML = KANBAN_COLS.map((col) => {
    const items = D.tasks.filter((t) => (t.status || 'backlog') === col.id);
    return `<div class="kanban-col" data-status="${col.id}">
      <div class="kanban-col-head"><b>${col.label}</b><span class="kanban-count">${items.length}</span></div>
      <div class="kanban-drop" data-status="${col.id}">
        ${items.map(taskCardHTML).join('') || '<div class="kanban-empty">No tasks</div>'}
      </div>
    </div>`;
  }).join('');
  bindKanbanDnD();

  const agentOpts = ['<option value="">Unassigned</option>'].concat(D.agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`));
  $('#newTaskAgent').innerHTML = agentOpts.join('');
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

$('#addTaskBtn').onclick = async () => {
  const title = $('#newTaskTitle').value.trim();
  if (!title) return;
  await api('/api/task', { method: 'POST', body: JSON.stringify({ title, priority: $('#newTaskPriority').value, agent: $('#newTaskAgent').value || null }) });
  $('#newTaskTitle').value = '';
  await load();
};

function renderAgents() {
  const byAgent = {};
  (D.project_agents || []).forEach((pa) => (byAgent[pa.agent_id] ??= []).push(pa.project_id));
  $('#ccAgents').innerHTML = D.agents.map((a) => {
    const projectNames = (byAgent[a.id] || []).map((pid) => D.projects.find((p) => p.id === pid)?.name).filter(Boolean);
    return `<div class="card"><b>${esc(a.name)}</b><span class="pill accent">${esc(a.department)}</span><span class="pill">${esc(a.status)}</span><div class="muted" style="margin-top:6px">${esc(a.activity || '')}</div>${projectNames.length ? `<div style="margin-top:8px">${projectNames.map((n) => `<span class="pill">${esc(n)}</span>`).join('')}</div>` : ''}</div>`;
  }).join('') || '<div class="empty-state">Activate a generated roster from the Setup Wizard first.</div>';
}

function renderTickets() {
  $('#ccTickets').innerHTML = D.tickets.map((t) => `<div class="card"><b>${esc(t.key)} · ${esc(t.title)}</b><span class="pill ${t.status === 'closed' ? 'good' : 'warn'}">${esc(t.status)}</span>${hermesPill(t.hermes_result)}<p class="muted" style="font-size:12.5px">${esc(t.problem || '')}</p></div>`).join('') || '<div class="empty-state">No tickets yet.</div>';
}
$('#addTicketBtn').onclick = async () => {
  const title = $('#newTicketTitle').value.trim();
  if (!title) return;
  await api('/api/ticket', { method: 'POST', body: JSON.stringify({ title, priority: $('#newTicketPriority').value, category: 'incident' }) });
  $('#newTicketTitle').value = '';
  await load();
};

function renderApprovals() {
  $('#ccApprovals').innerHTML = D.approvals.map((a) => `<div class="card"><b>${esc(a.key)} · ${esc(a.title)}</b><span class="pill ${a.status === 'approved' ? 'good' : a.status === 'rejected' ? 'bad' : 'warn'}">${esc(a.status)}</span>${hermesPill(a.hermes_result)}<p class="muted" style="font-size:12.5px">${esc(a.description || '')}</p>${a.status === 'pending' ? `<div class="formrow"><button data-approve="${esc(a.key)}">Approve</button><button class="secondary" data-reject="${esc(a.key)}">Reject</button></div>` : ''}</div>`).join('') || '<div class="empty-state">No approvals yet.</div>';
  $$('[data-approve]').forEach((b) => b.onclick = () => decide(b.dataset.approve, 'approved'));
  $$('[data-reject]').forEach((b) => b.onclick = () => decide(b.dataset.reject, 'rejected'));
}
async function decide(key, status) {
  await api('/api/approval-decision', { method: 'POST', body: JSON.stringify({ key, status }) });
  await load();
}
$('#addApprovalBtn').onclick = async () => {
  const title = $('#newApprovalTitle').value.trim();
  if (!title) return;
  await api('/api/approval', { method: 'POST', body: JSON.stringify({ title, type: 'change' }) });
  $('#newApprovalTitle').value = '';
  await load();
};

function agentCountForProject(pid) {
  return (D.project_agents || []).filter((pa) => pa.project_id === pid).length;
}

function renderProjects() {
  $('#ccProjects').innerHTML = D.projects.map((p) => `<div class="card" data-project="${p.id}" style="cursor:pointer">
    <b>${esc(p.name)}</b>
    <span class="pill">${esc(p.project_type)}</span>
    <span class="pill ${p.status === 'archived' ? 'warn' : 'accent'}">${esc(p.status)}</span>
    <span class="pill">${agentCountForProject(p.id)} agent(s)</span>
    <p class="muted" style="font-size:12.5px;margin-top:8px">${esc((p.description || '').slice(0, 90)) || 'No description yet — click to add one.'}${(p.description || '').length > 90 ? '…' : ''}</p>
  </div>`).join('') || '<div class="empty-state">No projects yet.</div>';
  $$('[data-project]').forEach((c) => c.onclick = () => openProjectDialog(Number(c.dataset.project)));
  $('#newProjectAgents').innerHTML = D.agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name)} — ${esc(a.department)}</option>`).join('') || '<option disabled>Activate a roster first</option>';
}
$('#addProjectBtn').onclick = async () => {
  const name = $('#newProjectName').value.trim();
  if (!name) return;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'project';
  const description = $('#newProjectDesc').value.trim();
  const agent_ids = Array.from($('#newProjectAgents').selectedOptions).map((o) => o.value);
  await api('/api/project', { method: 'POST', body: JSON.stringify({ name, slug, description, agent_ids }) });
  $('#newProjectName').value = '';
  $('#newProjectDesc').value = '';
  await load();
};

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
