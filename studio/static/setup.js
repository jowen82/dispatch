/* Dispatch — Setup Wizard controller. */
let S = {};
let selectedTypes = [];
let step = 0;
const TOTAL_STEPS = 7;
let modelSource = 'local';
let frontierModels = {}; // { general: {provider, model}, coder: {...}, embedding: {...} }
let frontierApiKeys = {}; // { anthropic: '(entered this session)', ... } — never holds the real value after save
let frontierKeysSet = []; // providers that already have a saved key, per the server (no raw values)
// Provider ids match hermes_client.PROVIDER_ENV_KEY exactly — Dispatch writes
// these straight to Hermes via `hermes config set`, so the id here has to be
// the real provider id, not just a display label.
const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'openai-api', label: 'OpenAI' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'xai', label: 'xAI (Grok)' },
  { id: 'minimax', label: 'MiniMax' },
  { id: 'gemini', label: 'Google (Gemini)' },
];

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TYPE_META = {
  ios: { icon: '📱', name: 'iOS', desc: 'Native iPhone & iPad apps in Swift/SwiftUI.' },
  macos: { icon: '💻', name: 'macOS', desc: 'Native desktop apps for the Mac.' },
  web: { icon: '🌐', name: 'Web', desc: 'Browser apps, sites, and web services.' },
  android: { icon: '🤖', name: 'Android', desc: 'Native Android apps in Kotlin.' },
  game: { icon: '🎮', name: 'Game', desc: 'Real-time gameplay, rendering, and tooling.' },
  fullstack: { icon: '🧱', name: 'Full Stack', desc: 'Coordinated frontend, backend & infra.' },
  ai_ml: { icon: '🧠', name: 'AI / ML', desc: 'Model training, evaluation & inference.' },
};

async function api(path, opt = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opt });
  const j = await r.json();
  if (!r.ok) throw new Error(j.stderr || j.error || 'Request failed');
  return j;
}

/* ---------------- progress bar (job polling) ---------------- */
function progressHTML(id, label) {
  return `<div class="progress-wrap enter" id="${id}">
    <div class="progress-head">
      <div class="progress-label"><span class="progress-spinner"></span><span class="progress-text">${esc(label)}</span></div>
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

async function trackJob(containerSelector, jobId, label, onDone) {
  const host = $(containerSelector);
  const id = 'job-' + jobId;
  host.innerHTML = progressHTML(id, label);
  const fill = $(`#${id}-fill`), eta = $(`#${id}-eta`), pct = $(`#${id}-pct`);
  return new Promise((resolve) => {
    const tick = async () => {
      let j;
      try { j = await api('/api/job?id=' + jobId); } catch (e) { host.innerHTML = ''; resolve(); return; }
      fill.style.width = j.progress + '%';
      pct.textContent = j.progress + '%';
      eta.textContent = j.done ? 'complete' : fmtEta(j.eta_seconds);
      if (j.done) {
        fill.classList.add('done');
        setTimeout(() => { host.innerHTML = ''; }, 900);
        if (onDone) onDone(j.result);
        resolve(j.result);
        return;
      }
      setTimeout(tick, 350);
    };
    tick();
  });
}

/* ---------------- data load & render ---------------- */
async function load(fresh = false) {
  S = fresh ? await api('/api/state') : await api('/api/state');
  selectedTypes = (S.setup && S.setup.project_types) || (S.organization && S.organization.project_types) || ['ios'];
  modelSource = (S.setup && S.setup.model_source) || 'local';
  frontierModels = (S.setup && S.setup.frontier_models) || {};
  frontierKeysSet = (S.setup && S.setup.frontier_api_keys_set) || [];
  render();
}

function render() {
  renderSystem();
  renderTypeGrid();
  renderTools();
  renderModels();
  renderOrg();
  renderHermes();
  renderModelSource();
  renderAgentChecklist();
  renderVisualPanel();
}

function renderSystem() {
  const sys = S.scan.system || {};
  $('#system').innerHTML = [
    ['Computer', sys.chip || sys.machine],
    ['Memory', (sys.ram_gb || '?') + ' GB'],
    ['Free storage', (sys.disk_free_gb || '?') + ' GB'],
    ['Platform', sys.platform || '?'],
    ['Ollama models', (S.scan.models || []).length],
    ['Last scan', S.setup && S.setup.last_scan ? new Date(S.setup.last_scan * 1000).toLocaleTimeString() : '—'],
  ].map((x, i) => `<div class="card enter enter-${(i % 4) + 1}"><span class="muted">${x[0]}</span><b>${esc(x[1])}</b></div>`).join('');
}

function renderTypeGrid() {
  $('#typeGrid').innerHTML = Object.entries(TYPE_META).map(([id, meta]) => {
    const sel = selectedTypes.includes(id);
    return `<button type="button" class="type-card ${sel ? 'selected' : ''}" data-type="${id}">
      <div class="type-check"><svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div class="type-icon">${meta.icon}</div>
      <div class="type-name">${meta.name}</div>
      <div class="type-desc">${meta.desc}</div>
    </button>`;
  }).join('');
  $$('#typeGrid .type-card').forEach((b) => b.onclick = () => toggleType(b.dataset.type));
  updateAutoSummary();
}

async function toggleType(id) {
  if (selectedTypes.includes(id)) {
    selectedTypes = selectedTypes.filter((t) => t !== id);
  } else {
    selectedTypes = [...selectedTypes, id];
  }
  renderTypeGrid();
  if (selectedTypes.length) {
    S.organization = await api('/api/plan', { method: 'POST', body: JSON.stringify({ project_types: selectedTypes }) });
    renderOrg();
    updateAutoSummary();
  }
}

function updateAutoSummary() {
  const title = $('#autoSummaryTitle'), sub = $('#autoSummarySub');
  if (!selectedTypes.length) {
    title.textContent = 'Select at least one deployment type';
    sub.textContent = 'Organization size and complexity are decided for you based on your selection.';
    return;
  }
  const names = selectedTypes.map((t) => TYPE_META[t]?.name || t).join(', ');
  const o = S.organization || {};
  title.textContent = `${names} → ${o.complexity ? o.complexity[0].toUpperCase() + o.complexity.slice(1) : '…'} organization`;
  sub.textContent = `${o.agent_count || 0} roles activate automatically. Complexity and major-feature scope are computed for you — not a setting you manage.`;
}

function renderTools() {
  const tools = S.scan.tools || [];
  $('#toolsList').innerHTML = tools.map((t) => `<div class="card"><b>${esc(t.id)}</b><span class="pill ${t.installed ? 'good' : 'warn'}">${t.installed ? 'Installed' : 'Missing'}</span><div class="muted" style="margin:6px 0">${esc(t.version || '')}</div>${!t.installed ? `<button data-tool="${esc(t.brew)}">Install</button>` : ''}</div>`).join('');
  $$('[data-tool]').forEach((b) => b.onclick = () => installTool(b.dataset.tool, b));
  const gh = S.scan.github || {};
  $('#auth').innerHTML = `<div class="card"><b>GitHub</b><span class="pill ${gh.authenticated ? 'good' : 'warn'}">${gh.authenticated ? 'Authenticated' : 'Not authenticated'}</span><div class="formrow" style="margin-top:10px"><button id="ghAuth">${gh.authenticated ? 'Re-authenticate' : 'Connect GitHub'}</button><button id="ghVerify" class="secondary">Verify</button></div></div>`;
  $('#ghAuth')?.addEventListener('click', async () => { await api('/api/github-auth', { method: 'POST', body: '{}' }); });
  $('#ghVerify')?.addEventListener('click', () => rescan());
}

async function installTool(pkg, btn) {
  if (btn) btn.disabled = true;
  const { job_id } = await api('/api/install-tool/start', { method: 'POST', body: JSON.stringify({ package: pkg }) });
  await trackJob('#installProgress', job_id, `Installing ${pkg}`);
  await load();
}

function renderModels() {
  const rec = S.recommendation || {};
  $('#recommendedModels').innerHTML = '<div class="modelgrid">' + ['general', 'coder', 'embedding'].filter((k) => rec[k]).map((k) => {
    const m = rec[k];
    return `<div class="card"><span class="muted">${k.toUpperCase()}</span><b>${esc(m.id)}</b><p class="muted" style="font-size:12.5px">${esc(m.notes)}</p><div class="pill">Quality ${m.quality}</div><div class="pill">Speed ${m.speed}</div><div class="pill">~${m.disk_gb} GB</div><div style="margin-top:8px"><button data-pull="${esc(m.id)}" ${m.installed ? 'disabled' : ''}>${m.installed ? 'Installed' : 'Install Model'}</button></div></div>`;
  }).join('') + '</div>';
  $$('[data-pull]').forEach((b) => b.onclick = () => pullModel(b.dataset.pull, b));

  $('#existingModels').innerHTML = (S.existing_models || []).map((m) => `<div class="card"><b>${esc(m.name)}</b><span class="pill ${m.recommended ? 'good' : 'warn'}">${m.recommended ? 'Recommended' : 'Review'}</span><div class="muted" style="margin:6px 0">${esc(m.size || '')}</div>${m.recommended ? '' : `<button class="secondary" data-remove="${esc(m.name)}">Remove…</button>`}</div>`).join('') || '<p class="muted">No Ollama models detected.</p>';
  $$('[data-remove]').forEach((b) => b.onclick = () => openRemoveDialog(b.dataset.remove));
  renderRankedLocalModels();
}

const RUNTIME_LABEL = { ollama: 'Ollama', lmstudio: 'LM Studio', llamacpp: 'llama.cpp-style folder' };
const FIT_PILL = { comfortable: ['good', 'Comfortable fit'], tight: ['warn', 'Tight fit'], wont_fit: ['bad', "Won't fit"] };
function renderRankedLocalModels() {
  const ranked = S.ranked_local_models || [];
  $('#rankedLocalModels').innerHTML = ranked.length
    ? ranked.map((m) => {
        const [pillClass, pillLabel] = FIT_PILL[m.fit] || ['warn', m.fit];
        const hermesPill = m.meets_hermes_min_context === false
          ? `<span class="pill bad" title="Hermes Agent requires at least 64,000 tokens of context to initialize a model">Too short for Hermes (${m.context_length.toLocaleString()} ctx)</span>`
          : m.meets_hermes_min_context === true
          ? `<span class="pill good">Hermes-ready (${m.context_length.toLocaleString()} ctx)</span>`
          : '';
        return `<div class="card">
          <span class="muted">${esc(RUNTIME_LABEL[m.runtime] || m.runtime)}</span>
          <b>${esc(m.name || m.id)}</b>
          <span class="pill ${pillClass}">${pillLabel}</span>
          ${hermesPill}
          <div class="muted" style="margin:6px 0;font-size:12px">~${m.estimated_ram_gb} GB estimated RAM${m.disk_gb ? ` · ${m.disk_gb} GB on disk` : ''}</div>
        </div>`;
      }).join('')
    : '<p class="muted">No local models found yet — install Ollama, LM Studio, or point Dispatch at a folder of GGUF files, then rescan.</p>';
}

async function pullModel(model, btn) {
  if (btn) btn.disabled = true;
  const { job_id } = await api('/api/pull-model/start', { method: 'POST', body: JSON.stringify({ model }) });
  await trackJob('#pullProgress', job_id, `Pulling ${model}`);
  await load();
}

function openRemoveDialog(model) {
  $('#removeModelName').textContent = model;
  $('#removeConfirmInput').value = '';
  $('#removeDialog').showModal();
  $('#removeConfirm').onclick = async () => {
    const confirm = $('#removeConfirmInput').value;
    if (confirm !== model) return;
    $('#removeDialog').close();
    await api('/api/remove-model', { method: 'POST', body: JSON.stringify({ model, confirm }) });
    await load();
  };
  $('#removeCancel').onclick = () => $('#removeDialog').close();
}

function renderOrg() {
  const o = S.organization || {};
  const by = {};
  (o.agents || []).forEach((a) => (by[a.department] ??= []).push(a));
  $('#orgSummary').innerHTML = `<div class="card"><b>${(o.project_types || []).map((t) => TYPE_META[t]?.name || t).join(' + ') || '—'} · ${esc(o.complexity || '')}</b><span class="muted">${o.agent_count || 0} logical roles activate. This does not load one model per agent — roles share the model pool sized in the previous step.</span></div>`;
  $('#orgList').innerHTML = Object.entries(by).map(([d, as]) => `<div class="dept"><h3>${esc(d)}</h3>${as.map((a) => `<div class="agent-row"><b>${esc(a.name)}</b><span class="muted">${esc(a.level)}</span><span class="pill">${esc(a.model_capability)}</span></div>`).join('')}</div>`).join('');
}

function renderHermes() {
  const h = S.scan.hermes || {};
  $('#hermes').innerHTML = `<div class="card"><b>Hermes Desktop/runtime</b><span class="pill ${h.installed ? 'good' : 'warn'}">${h.installed ? 'Detected' : 'CLI not detected'}</span><div class="muted" style="margin-top:6px">${esc(h.version || '')}</div><div class="muted">${esc((S.integration || {}).message || '')}</div><div class="muted" style="font-size:11px">${esc(h.config_path || '')}</div>${h.installed ? '' : '<div style="margin-top:10px"><button id="installHermesBtn">Install Hermes</button></div>'}</div>`;
  $('#installHermesBtn')?.addEventListener('click', installHermes);
  renderHarnesses();
}

async function installHermes() {
  const btn = $('#installHermesBtn');
  if (btn) btn.disabled = true;
  const { job_id } = await api('/api/install-hermes/start', { method: 'POST', body: '{}' });
  await trackJob('#hermesInstallProgress', job_id, 'Installing Hermes (running the official installer)');
  await load();
}

const AUTOMATION_PILL = { full: ['good', 'Fully automated'], detect_only: ['warn', 'Detected, manual setup'], manual_only: ['warn', 'Manual only'] };
function renderHarnesses() {
  const harnesses = S.scan.harnesses || [];
  $('#harnessList').innerHTML = harnesses.length
    ? harnesses.map((h) => {
        const [pillClass, pillLabel] = AUTOMATION_PILL[h.automation] || ['warn', h.automation];
        return `<div class="card">
          <b>${esc(h.name)}</b>
          <span class="muted" style="font-size:11.5px">${esc(h.vendor)}</span>
          <span class="pill ${pillClass}" style="margin-top:6px">${pillLabel}</span>
          <span class="pill ${h.installed ? 'good' : ''}" style="margin-top:6px">${h.installed ? 'Installed' : 'Not detected'}</span>
          <p class="muted" style="font-size:12px;margin-top:8px">${esc(h.rank_note)}</p>
          <a href="${esc(h.site)}" target="_blank" style="font-size:11.5px;color:var(--accent)">${esc(h.site)}</a>
        </div>`;
      }).join('')
    : '<p class="muted">No harness catalog loaded.</p>';
}

/* ---------------- model source (local / frontier / hybrid) ---------------- */
function renderModelSource() {
  $$('#modelSourceGrid .type-card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.source === modelSource);
    // Rebind on every render (not just once at load) so this never goes stale
    // if something else re-renders the wizard body around it.
    c.onclick = async () => {
      modelSource = c.dataset.source;
      renderModelSource();
      await saveModelSource();
    };
  });
  $('#frontierForm').classList.toggle('hidden', modelSource === 'local');
  if (modelSource === 'local') return;
  const roles = ['general', 'coder', 'embedding'];
  $('#frontierForm').innerHTML = roles.map((role) => {
    const f = frontierModels[role] || {};
    return `<div class="card">
      <span class="muted">${role.toUpperCase()}</span>
      <label style="display:block;margin:8px 0 4px;font-size:12px" class="muted">Provider</label>
      <select data-frontier-provider="${role}">${PROVIDERS.map((p) => `<option value="${p.id}" ${f.provider === p.id ? 'selected' : ''}>${p.label}</option>`).join('')}</select>
      <label style="display:block;margin:8px 0 4px;font-size:12px" class="muted">Model name</label>
      <input data-frontier-model="${role}" placeholder="e.g. claude-sonnet-4-6, gpt-5.4" value="${esc(f.model || '')}">
    </div>`;
  }).join('') + renderApiKeyFields();
  $$('[data-frontier-provider]').forEach((el) => el.onchange = () => saveModelSource());
  $$('[data-frontier-model]').forEach((el) => el.onchange = () => saveModelSource());
  $$('[data-frontier-key]').forEach((el) => el.onchange = () => saveModelSource());
}

function renderApiKeyFields() {
  // One key field per distinct provider actually selected across the three
  // roles — Dispatch writes it straight into Hermes's .env via
  // `hermes config set <ENV_VAR> ...` on finish, it's never stored as plaintext
  // in Dispatch's own state, and never re-displayed once saved.
  const usedProviders = [...new Set(['general', 'coder', 'embedding']
    .map((role) => document.querySelector(`[data-frontier-provider="${role}"]`)?.value || (frontierModels[role] || {}).provider)
    .filter(Boolean))];
  if (!usedProviders.length) return '';
  return `<div class="card" style="grid-column:1/-1">
    <span class="muted">API KEYS</span>
    <p class="muted" style="font-size:11.5px;margin:4px 0 10px">Saved straight into Hermes's own <code>~/.hermes/.env</code> when you finish setup — Dispatch doesn't keep a plaintext copy of its own.</p>
    ${usedProviders.map((pid) => {
      const label = PROVIDERS.find((p) => p.id === pid)?.label || pid;
      const already = frontierKeysSet.includes(pid);
      return `<label style="display:block;margin:8px 0 4px;font-size:12px" class="muted">${esc(label)} API key${already ? ' (already saved — leave blank to keep it)' : ''}</label>
        <input type="password" data-frontier-key="${pid}" placeholder="${already ? '••••••••••' : 'paste key here'}">`;
    }).join('')}
  </div>`;
}

async function saveModelSource() {
  const roles = ['general', 'coder', 'embedding'];
  roles.forEach((role) => {
    const provider = document.querySelector(`[data-frontier-provider="${role}"]`)?.value || 'anthropic';
    const model = document.querySelector(`[data-frontier-model="${role}"]`)?.value || '';
    frontierModels[role] = { provider, model };
  });
  const keys = {};
  $$('[data-frontier-key]').forEach((el) => { if (el.value) keys[el.dataset.frontierKey] = el.value; });
  await api('/api/model-source', {
    method: 'POST',
    body: JSON.stringify({ source: modelSource, frontier_models: frontierModels, frontier_api_keys: keys }),
  });
  // Clear key inputs immediately after a successful save so the raw value
  // never lingers in the DOM/memory longer than it has to.
  $$('[data-frontier-key]').forEach((el) => { el.value = ''; });
  await load();
  renderAgentChecklist();
}

/* ---------------- agent setup checklist ---------------- */
function resolveAgentModel(agent) {
  const role = agent.model_capability || 'general';
  const rec = S.recommendation || {};
  if (modelSource === 'frontier' || modelSource === 'hybrid') {
    const f = frontierModels[role];
    if (f && f.model) return `${f.provider}: ${f.model}`;
    if (modelSource === 'frontier') return '(frontier model not set)';
  }
  return rec[role] ? rec[role].id : '(no local model recommended)';
}

function agentChecklistText() {
  const o = S.organization || {};
  const lines = [`# Hermes agent setup checklist`, '', `Deployment target(s): ${(o.project_types || []).join(', ')} — complexity: ${o.complexity || '?'}`, `Model source: ${modelSource}`, ''];
  (o.agents || []).forEach((a) => {
    lines.push(`## ${a.name}`, `- Department: ${a.department}`, `- Level: ${a.level}`, `- Model: ${resolveAgentModel(a)}`, `- Tools: ${(a.tools || []).join(', ') || 'none listed'}`, `- Reports to: ${a.reports_to || 'top of the organization'}`, '');
  });
  return lines.join('\n');
}

function renderAgentChecklist() {
  const o = S.organization || {};
  $('#agentChecklist').innerHTML = (o.agents || []).map((a) => `<div class="card" style="margin:8px 0">
    <b>${esc(a.name)}</b>
    <span class="pill">${esc(a.department)}</span>
    <span class="pill">${esc(a.level)}</span>
    <div class="muted" style="font-size:12.5px;margin-top:6px">Model: <b style="color:var(--accent)">${esc(resolveAgentModel(a))}</b></div>
    <div class="muted" style="font-size:12.5px">Tools: ${esc((a.tools || []).join(', ') || 'none listed')}</div>
    <div style="margin-top:8px"><button class="secondary" data-copy-agent="${esc(a.id)}">Copy</button></div>
  </div>`).join('') || '<p class="muted">Select at least one deployment type to generate a roster.</p>';
  $$('[data-copy-agent]').forEach((b) => b.onclick = () => {
    const a = (S.organization.agents || []).find((x) => x.id === b.dataset.copyAgent);
    if (!a) return;
    const text = `Name: ${a.name}\nDepartment: ${a.department}\nLevel: ${a.level}\nModel: ${resolveAgentModel(a)}\nTools: ${(a.tools || []).join(', ')}\nReports to: ${a.reports_to || 'top of the organization'}`;
    navigator.clipboard?.writeText(text);
    b.textContent = 'Copied ✓';
    setTimeout(() => { b.textContent = 'Copy'; }, 1200);
  });
}

$('#copyAllAgents').onclick = () => {
  navigator.clipboard?.writeText(agentChecklistText());
  $('#copyAllAgents').textContent = 'Copied ✓';
  setTimeout(() => { $('#copyAllAgents').textContent = 'Copy full checklist'; }, 1200);
};

/* ---------------- wizard navigation ---------------- */
function goToStep(n) {
  step = Math.max(0, Math.min(TOTAL_STEPS - 1, n));
  $$('.wstep').forEach((s) => s.classList.toggle('hidden', Number(s.dataset.step) !== step));
  $$('.step').forEach((s) => {
    const i = Number(s.dataset.step);
    s.classList.toggle('active', i === step);
    s.classList.toggle('done', i < step);
  });
  $('#backBtn').disabled = step === 0;
  $('#wizardNav').classList.toggle('hidden', step === TOTAL_STEPS - 1);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  renderVisualPanel();
}

/* ---------------- right-hand visual panel — mirrors whatever the left side is
   configuring right now, live, per step ---------------- */
function renderVisualPanel() {
  const host = $('#visualPanel');
  if (!host) return;
  const sys = (S.scan && S.scan.system) || {};
  const panels = [
    // 0: System
    () => visualHTML('This machine', 'Dispatch scans hardware once, then only reacts to what changes.', [
      ['🖥️', sys.chip || sys.machine || 'Detecting…', 'Chip / model'],
      ['🧠', (sys.ram_gb || '?') + ' GB', 'Unified memory'],
      ['💾', (sys.disk_free_gb || '?') + ' GB free', 'Storage headroom'],
      ['🦙', `${(S.scan.models || []).length} Ollama model(s)`, 'Already installed'],
    ]),
    // 1: Deployment
    () => visualHTML('What you\'re shipping', 'Every target you select shapes the roster Dispatch builds next.', selectedTypes.length
      ? selectedTypes.map((id) => [TYPE_META[id]?.icon || '📦', TYPE_META[id]?.name || id, TYPE_META[id]?.desc || ''])
      : [['🧭', 'Nothing selected yet', 'Pick at least one deployment target on the left']]),
    // 2: Tools
    () => visualHTML('Developer tools', 'Anything already on your PATH is left exactly as it is.', (S.scan.tools || []).slice(0, 6).map((t) => [t.installed ? '✅' : '⬜', t.name || t.id, t.installed ? 'Installed' : 'Will be installed'])),
    // 3: Models
    () => visualHTML('Model plan', 'What Dispatch will run locally, sized to this Mac\'s RAM.', [
      ['🧠', (S.recommendation && S.recommendation.general && S.recommendation.general.id) || '—', 'General role'],
      ['🛠️', (S.recommendation && S.recommendation.coder && S.recommendation.coder.id) || '—', 'Coder role'],
      ['🔎', (S.recommendation && S.recommendation.embedding && S.recommendation.embedding.id) || '—', 'Embedding role'],
    ]),
    // 4: Organization
    () => visualHTML('Your organization', 'Size and complexity are derived automatically — not a dial you manage.', [
      ['🏢', (S.organization && S.organization.complexity) || '—', 'Complexity tier'],
      ['👥', `${(S.organization && S.organization.agents && S.organization.agents.length) || 0} role(s)`, 'Agents in the roster'],
      ['🎯', (S.organization && (S.organization.project_types || []).join(' + ')) || '—', 'Deployment coverage'],
    ]),
    // 5: Integration
    () => visualHTML('Hermes integration', 'Configured automatically on Finish — nothing to paste by hand.', [
      ['🤖', modelSource === 'local' ? 'Local models' : modelSource === 'frontier' ? 'Frontier models' : 'Hybrid', 'Model source'],
      ['🔌', (S.scan.harnesses || []).filter((h) => h.installed).length + ' detected', 'Agent harnesses'],
      ['🧩', 'filesystem · context7 · playwright · penpot', 'MCP tools wired in'],
    ]),
    // 6: Finish
    () => visualHTML('Ready to go', 'One click configures Hermes and opens the Command Center.', [
      ['✅', `${(S.organization && S.organization.agents && S.organization.agents.length) || 0} agents`, 'About to be activated'],
      ['🚀', 'Command Center', 'Where you\'ll manage everything next'],
    ]),
  ];
  host.innerHTML = (panels[step] || panels[0])();
}

function visualHTML(heading, sub, facts) {
  return `<div class="visual-eyebrow">Step ${step + 1} of ${TOTAL_STEPS}</div>
    <div class="visual-heading">${esc(heading)}</div>
    <div class="visual-sub">${esc(sub)}</div>
    <div class="visual-body">
      ${facts.map(([icon, title, sub2]) => `<div class="visual-fact">
        <div class="vf-icon">${icon}</div>
        <div><b>${esc(title)}</b><span>${esc(sub2)}</span></div>
      </div>`).join('')}
    </div>`;
}

function canAdvance() {
  if (step === 1) return selectedTypes.length > 0;
  return true;
}

async function rescan() {
  const { job_id } = await api('/api/scan/start', { method: 'POST', body: '{}' });
  await trackJob('#rescanProgress', job_id, 'Rescanning system');
  await load();
}

$('#rescan').onclick = () => rescan();
$('#nextBtn').onclick = () => { if (canAdvance()) goToStep(step + 1); };
$('#backBtn').onclick = () => goToStep(step - 1);
$('#backupHermes').onclick = async () => { await api('/api/backup-hermes', { method: 'POST', body: '{}' }); };
$('#generateIntegration').onclick = async () => {
  const r = await api('/api/generate-integration', { method: 'POST', body: '{}' });
  $('#integrationOutput').classList.remove('hidden');
  $('#integrationOutput').textContent = JSON.stringify(r, null, 2);
};
$('#finishBtn').onclick = async () => {
  $('#finishBtn').disabled = true;
  $('#finishBtn').textContent = 'Activating roster…';
  const r = await api('/api/apply-org', { method: 'POST', body: '{}' });

  let hermesNote = '';
  const hp = r && r.hermes_profiles;
  if (hp === null || hp === undefined) {
    hermesNote = ' Hermes CLI was not detected on PATH — nothing was auto-configured. See the manual steps above for the screen Hermes shows on first launch.';
  } else {
    const parts = [];
    if (hp.created && hp.created.length) parts.push(`created ${hp.created.length} new Hermes agent profile${hp.created.length === 1 ? '' : 's'}`);
    if (hp.refreshed && hp.refreshed.length) parts.push(`refreshed ${hp.refreshed.length} existing profile${hp.refreshed.length === 1 ? '' : 's'}`);
    if (hp.failed && hp.failed.length) parts.push(`${hp.failed.length} failed (see checklist)`);
    hermesNote = parts.length ? ` Hermes: ${parts.join(', ')}.` : ' Hermes: no agent profiles to create.';

    const mcp = r.hermes_mcp;
    if (mcp) {
      hermesNote += mcp.ok
        ? ` MCP tools: ${mcp.action}${mcp.added ? ' (' + mcp.added.join(', ') + ')' : ''}.`
        : ` MCP tools: setup failed (${esc(mcp.stderr || 'unknown error')}) — you can still merge hermes-mcp.yaml by hand.`;
    }
    const mm = r.hermes_main_model;
    if (mm) {
      if (mm.ok) {
        hermesNote += ` Main model: ${mm.provider}/${mm.model}, configured automatically — restart Hermes to pick it up.`;
      } else if (mm.reason === 'context_below_minimum') {
        hermesNote += ` Main model: skipped — ${esc(mm.stderr)}`;
      } else {
        hermesNote += ` Main model: automatic setup failed — check ${esc(mm.provider || '')} and try again, or set it from the screen Hermes shows on launch.`;
      }
    }
  }

  $('#finishBtn').textContent = 'Opening Command Center…';
  // Hand the summary to the Command Center via sessionStorage (survives an
  // in-tab navigation, unlike a variable) so it can show a one-time banner
  // instead of making the wizard try to display it in a tab about to leave.
  try { sessionStorage.setItem('dispatch_setup_summary', hermesNote.trim()); } catch (e) {}
  window.location.href = '/command-center';
};

goToStep(0);
load();
