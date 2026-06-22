/* BLACKLINE AI — app.js v1.4.2
   Stability + safety pack
   - marked.js + highlight.js markdown
   - conversation rename + search filter
   - Enter to send / Shift+Enter newline
   - Esc to close modal, keyboard nav
   - model select persistence
   - stop race fix, copy button class toggle
   - a11y improvements
   - removed dangerous "approval phrase" auto-detector (v1.4.0)
   - safer data-* attribute payload passing for plan retries (v1.4.0)
   - token counter labels estimates (v1.4.0)
   - auto-probe new models in background (v1.4.0)
   - v1.4.1: CSP regression fixed in server.js
   - v1.4.2: toast() inlined into app.js (was a separate file that got
             accidentally deleted during dead-code removal — caused every
             saveKey/probe call to throw ReferenceError)
*/

/* ── Toast queue (inlined, v1.4.2) ────────────────────────────────────────
   Previously lived in public/js/toast.js. Inlined here so it can't be
   accidentally removed again — every other module's code calls toast(),
   and the file MUST exist for the app to function. */
let toastQueue = [];
let toastTimer = null;
let isToastShowing = false;
function toast(msg, type) {
  const el = document.getElementById('toast');
  if (!el) return;
  toastQueue.push({ msg, type: type || 'ok' });
  if (!isToastShowing) showNextToast(el);
}
function showNextToast(el) {
  if (!toastQueue.length) { isToastShowing = false; return; }
  isToastShowing = true;
  const { msg, type } = toastQueue.shift();
  el.textContent = msg;
  el.className = `show ${type || 'ok'}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = '';
    setTimeout(() => showNextToast(el), 130);
  }, 2700);
}

/* ── State ──────────────────────────────────────────────────────────────────── */
let models = [];
let modelProbes = {};
let modelCenterFilter = 'recommended';
let customProviderPresets = [];
let currentModel = loadStoredJson('currentModel', null);
let conversations = loadStoredJson('conversations', []);
if (!Array.isArray(conversations)) conversations = [];
let currentConvId = null;
let convSearchFilter = '';
let systemPrompt = localStorage.getItem('systemPrompt') || '';
let appManifest = null;
let appManifestString = '';
let streaming = false;
let activeAbortController = null;

const PROVIDERS = [
  { id: 'anthropic',  label: 'Anthropic',   icon: '◖', placeholder: 'sk-ant-...' },
  { id: 'openai',     label: 'OpenAI',       icon: '◎', placeholder: 'sk-...' },
  { id: 'gemini',     label: 'Google Gemini',icon: '◇', placeholder: 'AIzaSy...' },
  { id: 'groq',       label: 'Groq',         icon: '⚡', placeholder: 'gsk_...' },
  { id: 'openrouter', label: 'OpenRouter',   icon: '⬡', placeholder: 'sk-or-...' },
  { id: 'deepseek',   label: 'DeepSeek',     icon: '▽', placeholder: 'sk-...' },
];

/* ── Markdown (marked + highlight.js) ───────────────────────────────────────── */
let mdReady = false;
function initMarkdown() {
  if (!window.marked) return;
  const renderer = new marked.Renderer();
  const origCode = renderer.code.bind(renderer);
  renderer.code = (code, lang) => {
    let highlighted = escHtml(code);
    try {
      if (window.hljs) {
        if (lang && hljs.getLanguage(lang)) {
          highlighted = hljs.highlight(code, { language: lang }).value;
        } else {
          highlighted = hljs.highlightAuto(code).value;
        }
      }
    } catch(e) {}
    const cleanLang = escHtml(lang || 'code');
    return `<div class="code-block"><div class="code-header"><span>${cleanLang}</span><button class="copy-code-btn" type="button" onclick="copyCode(this, event)">COPY</button></div><pre><code class="hljs language-${cleanLang}">${highlighted}</code></pre></div>`;
  };
  marked.setOptions({ renderer, gfm: true, breaks: true });
  mdReady = true;
}
function formatMd(text) {
  const src = String(text || '');
  if (window.marked && mdReady) {
    try { return marked.parse(src); } catch(e) {}
  }
  // fallback – very basic
  return escHtml(src).replace(/\n/g, '<br>');
}

/* ── Init ───────────────────────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  initMarkdown();
  renderConvList();
  loadModels();
  buildKeysList();
  loadCustomProviderPresets();
  buildCustomProvidersList();
  checkOllama();
  if (systemPrompt) {
    const si = document.getElementById('system-prompt-input');
    if (si) si.value = systemPrompt;
  }
  loadAppManifest();
  populateEvolveModelSelect();
  loadFileTree();
  initEvolveResizer();
  renderEvolveMessages();

  const msgInput = document.getElementById('msg-input');
  if (msgInput) msgInput.addEventListener('keydown', onInputKey);
  const evoInput = document.getElementById('evolve-input');
  if (evoInput) evoInput.addEventListener('keydown', onEvolveInputKey);

  // make suggestions keyboard accessible
  document.querySelectorAll('.suggestion').forEach(el => {
    el.setAttribute('tabindex', '0');
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); insertSuggestion(el); }});
  });

  // Global Esc handler
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // close rename input first
      const ren = document.querySelector('.conv-rename-input');
      if (ren) { cancelRenameConversation(); return; }
      // close modals
      closeModelInfoModal();
      closeModal();
    }
  });

  // Conversation list keyboard navigation
  const convList = document.getElementById('conv-list');
  if (convList) {
    convList.setAttribute('tabindex', '0');
    convList.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const visible = getFilteredConversations();
      if (!visible.length) return;
      let idx = visible.findIndex(c => c.id === currentConvId);
      if (idx === -1) idx = 0;
      idx += e.key === 'ArrowDown' ? 1 : -1;
      idx = Math.max(0, Math.min(visible.length - 1, idx));
      loadConversation(visible[idx].id);
    });
  }

  if (conversations.length === 0) newConversation(false);
  else loadConversation(conversations[0].id);
});

function initEvolveResizer() {
  const layout = document.querySelector('.evolve-layout');
  const left = document.querySelector('.evolve-left');
  const right = document.querySelector('.evolve-right');
  const resizer = document.getElementById('evolve-resizer');
  if (!layout || !left || !right || !resizer) return;

  const saved = Number(localStorage.getItem('evolveLeftWidthPct'));
  if (saved >= 35 && saved <= 78) {
    left.style.width = saved + '%';
    right.style.width = (100 - saved) + '%';
  }

  let dragging = false;
  const onMove = (event) => {
    if (!dragging) return;
    const rect = layout.getBoundingClientRect();
    const pct = ((event.clientX - rect.left) / rect.width) * 100;
    const clamped = Math.max(35, Math.min(78, pct));
    left.style.width = clamped.toFixed(2) + '%';
    right.style.width = (100 - clamped).toFixed(2) + '%';
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const pct = parseFloat(left.style.width);
    if (!Number.isNaN(pct)) localStorage.setItem('evolveLeftWidthPct', pct.toFixed(2));
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };

  resizer.addEventListener('pointerdown', (event) => {
    dragging = true;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    resizer.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

/* ── Panel navigation ───────────────────────────────────────────────────────── */
function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('visible'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const panel = document.getElementById(name + '-panel');
  if (panel) panel.classList.add('visible');
  const nav = document.querySelector(`[data-panel="${name}"]`);
  if (nav) nav.classList.add('active');

  const toolbar = document.getElementById('toolbar');
  if (toolbar) toolbar.classList.toggle('hidden', name !== 'chat');

  if (name === 'chat') document.getElementById('msg-input')?.focus();
  if (name === 'evolve') {
    document.getElementById('evolve-input')?.focus();
    loadFileTree();
  }
}

/* ── Model loading ──────────────────────────────────────────────────────────── */
async function loadModels(showToast = false) {
  const sel = document.getElementById('model-select');
  if (!sel) return;
  const previousVal = sel.value;
  const refreshBtn = document.getElementById('model-refresh-btn');
  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.textContent = 'REFRESHING…'; }
  const center = document.getElementById('model-center-list');
  if (center && showToast) center.innerHTML = '<div class="model-center-empty">Refreshing provider model catalogs…</div>';
  if (showToast) toast('Refreshing model catalog…', 'ok');
  sel.innerHTML = '<option value="">Loading models…</option>';
  try {
    const r = await fetch('/api/models');
    if (!r.ok) throw new Error(await apiErrorMessage(r, 'Could not load models'));
    models = await r.json();
    if (!Array.isArray(models)) throw new Error('Model response was not an array');
    await loadModelProbes();
    populateModelSelect(previousVal);
    renderModelCenter();
    buildCustomProvidersList();
    checkOllama();
    if (showToast) toast(`Model catalog refreshed: ${models.length} model/status entr${models.length === 1 ? 'y' : 'ies'}`, 'ok');
    // Kick off background probes for any model that has no probe record yet,
    // so users no longer have to manually click TEST for every model. v1.4.0.
    autoProbeMissingModels();
  } catch(e) {
    sel.innerHTML = '<option value="">Error loading models</option>';
    toast('Could not load models: ' + e.message, 'err');
  } finally {
    if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.textContent = 'REFRESH MODEL CATALOG'; }
  }
}

async function autoProbeMissingModels() {
  // Run probes sequentially in the background for any model that doesn't have
  // a probe record yet. We skip `disabled` entries (broken connections).
  const targets = models.filter(m => !m.disabled && !m.probe && !modelProbes[modelKey(m.provider, m.id)]);
  if (!targets.length) return;
  toast(`Auto-probing ${targets.length} new model${targets.length === 1 ? '' : 's'} in background…`, 'ok');
  let done = 0;
  for (const m of targets) {
    try {
      const r = await fetch('/api/models/probe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: m.provider, model: m.id })
      });
      if (r.ok) {
        const result = await r.json();
        modelProbes[modelKey(m.provider, m.id)] = result;
        m.probe = result;
      }
    } catch {}
    done++;
    // Refresh the dropdown periodically so newly-passing models become selectable
    // as soon as their probe completes.
    if (done % 3 === 0 || done === targets.length) {
      populateModelSelect();
      populateEvolveModelSelect();
      renderModelCenter();
    }
  }
  toast(`Auto-probe complete (${done} model${done === 1 ? '' : 's'})`, 'ok');
}

function populateModelSelect(preferredVal) {
  const sel = document.getElementById('model-select');
  const count = document.getElementById('model-count');
  if (!sel) return;
  sel.innerHTML = '';

  populateEvolveModelSelect();

  const selectableModels = models.filter(isModelSelectable);
  if (selectableModels.length === 0) {
    const hint = models.length
      ? '— Models found, but none are tested yet. Open API Keys & Models and click REFRESH. Probes run automatically in the background. —'
      : '— No models yet. Add an API key in Settings to unlock cloud providers. —';
    sel.innerHTML = `<option value="">${hint}</option>`;
    if (count) count.textContent = models.length ? `${models.length} found · 0 tested` : '';
    currentModel = null;
    localStorage.removeItem('currentModel');
    return;
  }

  const groups = {};
  for (const m of selectableModels) {
    if (!groups[m.provider]) groups[m.provider] = [];
    groups[m.provider].push(m);
  }
  for (const [prov, ms] of Object.entries(groups)) {
    const og = document.createElement('optgroup');
    og.label = providerLabel(prov);
    for (const m of ms) {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ id: m.id, provider: m.provider });
      opt.textContent = modelOptionText(m);
      opt.disabled = !!m.disabled;
      opt.title = capabilityBadges(m).join(' · ');
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  if (count) count.textContent = `${selectableModels.length}/${models.length} selectable`;

  // restore selection: preferredVal (from reload) > saved currentModel > first
  let toSelect = null;
  const tryVals = [preferredVal, currentModel ? JSON.stringify(currentModel) : null, localStorage.getItem('currentModel')].filter(Boolean);
  for (const v of tryVals) {
    if ([...sel.options].some(o => o.value === v)) { toSelect = v; break; }
  }
  if (toSelect) sel.value = toSelect;
  onModelChange();
}

function providerLabel(p) {
  if (String(p || '').startsWith('custom:')) {
    const found = models.find(m => m.provider === p && m.providerName);
    return found?.providerName || ('Custom: ' + String(p).slice(7));
  }
  return { anthropic:'Anthropic', openai:'OpenAI', gemini:'Google Gemini', groq:'Groq', openrouter:'OpenRouter', deepseek:'DeepSeek', ollama:'Local (Ollama)' }[p] || p;
}
function capabilityBadges(m) {
  const caps = m.capabilities || {};
  const pricing = m.pricing?.freeStatus || 'unknown';
  const badges = [];
  if (pricing === 'local') badges.push('LOCAL');
  else if (pricing === 'free') badges.push('FREE');
  else if (pricing === 'free-tier-or-paid') badges.push('FREE TIER/PAID');
  else if (pricing === 'paid') badges.push('PAID');
  else badges.push('UNKNOWN COST');
  if (caps.imageInput) badges.push('VISION');
  if (caps.audioInput) badges.push('AUDIO');
  if (caps.fileInput) badges.push('FILES');
  if (caps.toolUse) badges.push('TOOLS');
  if (caps.jsonMode) badges.push('JSON');
  if (caps.reasoning) badges.push('REASONING');
  if (m.evolve?.capable || m.updateCapable) badges.push('EVOLVE ' + Math.round(m.evolve?.score || 60));
  return badges;
}
function modelOptionText(m) {
  return `${m.name || m.id}`;
}
function isModelSelectable(m) {
  const probe = modelProbeFor(m);
  // Chat/Evolve dropdowns should only contain models that BLACKLINE has actually
  // verified with a live probe. Untested and failed models remain visible in
  // Model Center, but are not selectable for chats until they pass or partially pass.
  return !m.disabled && ['pass', 'partial'].includes(probe?.status);
}

function onModelChange() {
  const sel = document.getElementById('model-select');
  if (!sel) { currentModel = null; return; }
  const val = sel.value;
  if (!val) { currentModel = null; localStorage.removeItem('currentModel'); return; }
  try {
    currentModel = JSON.parse(val);
    localStorage.setItem('currentModel', val);
  } catch { currentModel = null; }
}

/* ── API Keys UI ────────────────────────────────────────────────────────────── */
async function buildKeysList() {
  const container = document.getElementById('keys-list');
  if (!container) return;
  let savedKeys = {};
  try {
    const r = await fetch('/api/keys');
    if (r.ok) savedKeys = await r.json();
  } catch (e) { console.warn('[keys] Failed to load keys:', e.message); }

  container.innerHTML = '';
  for (const p of PROVIDERS) {
    const isSet = !!savedKeys[p.id];
    const row = document.createElement('div');
    row.className = 'provider-row';
    row.innerHTML = `
      <div class="provider-label">${p.label}</div>
      <span class="key-status ${isSet ? 'set' : 'unset'}">${isSet ? 'SET' : 'NOT SET'}</span>
      <input type="password" class="key-input" id="key-${p.id}"
        placeholder="${isSet ? '(key saved — enter to replace)' : p.placeholder}" />
      <div class="key-actions">
        <button class="save-key-btn" onclick="saveKey('${p.id}')">SAVE</button>
        ${isSet ? `<button class="delete-key-btn" onclick="deleteKey('${p.id}')" title="Remove key">×</button>` : '<button class="delete-key-btn placeholder" tabindex="-1" aria-hidden="true">×</button>'}
      </div>`;
    container.appendChild(row);
    // Enter to save
    const input = row.querySelector('.key-input');
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveKey(p.id); }});
  }
}

async function saveKey(provider) {
  const input = document.getElementById('key-' + provider);
  if (!input) return;
  const key = input.value.trim();
  if (!key) { toast('Please enter a key first', 'err'); return; }
  try {
    const r = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, key }),
    });
    if (!r.ok) throw new Error(await apiErrorMessage(r, 'Save failed'));
    input.value = '';
    toast(`${provider} key saved ✓`, 'ok');
    await buildKeysList();
    await loadModels();
  } catch(e) { toast('Save failed: ' + e.message, 'err'); }
}

async function deleteKey(provider) {
  if (!confirm(`Remove ${provider} API key?`)) return;
  try {
    const r = await fetch(`/api/keys/${provider}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(await apiErrorMessage(r, 'Delete failed'));
    toast(`${provider} key removed`, 'ok');
    await buildKeysList();
    await loadModels();
  } catch(e) { toast('Delete failed: ' + e.message, 'err'); }
}

async function loadModelProbes() {
  try {
    const r = await fetch('/api/model-probes');
    if (r.ok) modelProbes = await r.json();
  } catch { modelProbes = {}; }
}
function modelKey(provider, id) { return `${provider}::${id}`; }
function modelProbeFor(m) { return m.probe || modelProbes[modelKey(m.provider, m.id)] || null; }
function setModelCenterFilter(filter) { modelCenterFilter = filter; renderModelCenter(); }
function modelMatchesCenterFilter(m) {
  const caps = m.capabilities || {};
  const pricing = m.pricing?.freeStatus;
  const probe = modelProbeFor(m);
  if (modelCenterFilter === 'all') return true;
  if (m.disabled) return modelCenterFilter === 'all';
  if (modelCenterFilter === 'recommended') return (m.evolve?.score || 0) >= 70 || m.updateCapable;
  if (modelCenterFilter === 'free') return ['local', 'free', 'free-tier-or-paid'].includes(pricing);
  if (modelCenterFilter === 'evolve') return !!(m.updateCapable || m.evolve?.capable || probe?.tests?.evolvePlan?.status === 'pass');
  if (modelCenterFilter === 'vision') return !!caps.imageInput;
  if (modelCenterFilter === 'tested') return !!probe;
  return true;
}
function renderModelCenter() {
  const container = document.getElementById('model-center-list');
  if (!container) return;
  const filtered = models.filter(m => modelMatchesCenterFilter(m));
  document.querySelectorAll('.model-center-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === modelCenterFilter));
  if (!filtered.length) {
    container.innerHTML = '<div class="model-center-empty">No models in this view. Add an API key, connect Ollama, or choose another filter.</div>';
    return;
  }
  container.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'model-center-table';
  table.innerHTML = '<thead><tr><th>Model</th><th>Provider</th><th>Cost</th><th>Capabilities</th><th>Evolve</th><th>Probe</th><th></th></tr></thead><tbody></tbody>';
  const tbody = table.querySelector('tbody');
  for (const m of filtered) {
    const tr = document.createElement('tr');
    const caps = capabilityBadges(m).filter(b => !['PAID','FREE','LOCAL','FREE TIER/PAID','UNKNOWN COST'].includes(b));
    const pricing = m.pricing?.freeStatus || 'unknown';
    const probe = modelProbeFor(m);
    tr.innerHTML = `
      <td><strong>${escHtml(m.name || m.id)}</strong><span>${escHtml(m.id)}</span></td>
      <td>${escHtml(providerLabel(m.provider))}</td>
      <td><span class="model-cost ${escHtml(pricing)}">${escHtml(pricing)}</span></td>
      <td><div class="mini-badges">${caps.slice(0, 5).map(b => `<span>${escHtml(b)}</span>`).join('')}</div></td>
      <td>${escHtml(m.evolve?.tier || 'unknown')}<span>${escHtml((m.evolve?.score ?? '?') + '/100')}</span></td>
      <td>${probe ? `<span class="probe-status ${escHtml(probe.status)}">${escHtml(probe.status)} ${escHtml(String(probe.score ?? '?'))}%</span>` : '<span class="probe-status none">not tested</span>'}</td>
      <td></td>`;
    if (m.disabled) tr.classList.add('disabled-model-row');
    const actions = tr.lastElementChild;
    const infoBtn = document.createElement('button');
    infoBtn.className = 'mini-action-btn';
    infoBtn.textContent = 'INFO';
    infoBtn.addEventListener('click', () => { currentModel = { id: m.id, provider: m.provider }; openModelInfoModal(); });
    const testBtn = document.createElement('button');
    testBtn.className = 'mini-action-btn';
    testBtn.textContent = 'TEST';
    testBtn.disabled = !!m.disabled;
    testBtn.title = m.disabled ? 'Fix provider connection before testing this model.' : 'Run live model probe';
    testBtn.addEventListener('click', () => probeModel(m, testBtn));
    actions.append(infoBtn, testBtn);
    tbody.appendChild(tr);
  }
  container.appendChild(table);
}
async function probeModel(m, btn) {
  if (!m || !m.id || !m.provider) return;
  const old = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'TESTING…'; }
  try {
    const r = await fetch('/api/models/probe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: m.provider, model: m.id })
    });
    if (!r.ok) throw new Error(await apiErrorMessage(r, 'Probe failed'));
    const result = await r.json();
    modelProbes[modelKey(m.provider, m.id)] = result;
    m.probe = result;
    toast(`Probe ${result.status}: ${result.score}%`, result.status === 'fail' ? 'err' : 'ok');
    populateModelSelect();
    populateEvolveModelSelect();
    renderModelCenter();
  } catch(e) { toast('Probe failed: ' + e.message, 'err'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = old || 'TEST'; } }
}

async function loadCustomProviderPresets() {
  try {
    const r = await fetch('/api/custom-provider-presets');
    if (!r.ok) throw new Error('Could not load presets');
    customProviderPresets = await r.json();
    const sel = document.getElementById('custom-provider-preset');
    if (sel) {
      sel.innerHTML = '<option value="">Preset…</option>' + customProviderPresets.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.label)}</option>`).join('');
    }
  } catch(e) { console.warn('[custom provider presets]', e.message); }
}
function applyCustomProviderPreset() {
  const id = document.getElementById('custom-provider-preset')?.value;
  const p = customProviderPresets.find(x => x.id === id);
  if (!p) return;
  const label = document.getElementById('custom-provider-label');
  const base = document.getElementById('custom-provider-base-url');
  if (label) label.value = p.label;
  if (base) base.value = p.baseUrl;
}

async function buildCustomProvidersList() {
  const container = document.getElementById('custom-providers-list');
  if (!container) return;
  container.innerHTML = '<div class="custom-provider-empty">Loading custom providers…</div>';
  try {
    const r = await fetch('/api/custom-providers');
    if (!r.ok) throw new Error(await apiErrorMessage(r, 'Could not load custom providers'));
    const providers = await r.json();
    if (!providers.length) {
      container.innerHTML = '<div class="custom-provider-empty">No custom providers yet.</div>';
      return;
    }
    container.innerHTML = '';
    for (const p of providers) {
      const providerId = `custom:${p.id}`;
      const providerModels = models.filter(m => m.provider === providerId);
      const listedCount = providerModels.filter(m => !m.disabled).length;
      const errorEntry = providerModels.find(m => m.disabled);
      const statusText = errorEntry
        ? `connection/model-list error: ${errorEntry.name}`
        : listedCount > 0
          ? `${listedCount} listed model${listedCount === 1 ? '' : 's'}`
          : 'not refreshed yet / no listed models';
      const row = document.createElement('div');
      row.className = 'custom-provider-row';
      row.innerHTML = `<div><strong>${escHtml(p.label)}</strong><span>${escHtml(p.baseUrl)} · key ${escHtml(p.keyMasked || 'not set')}</span><span class="custom-provider-status">${escHtml(statusText)}</span></div><button class="delete-key-btn" onclick="deleteCustomProvider('${escHtml(p.id)}')">×</button>`;
      container.appendChild(row);
    }
  } catch(e) {
    container.innerHTML = `<div class="custom-provider-empty" style="color:var(--red)">${escHtml(e.message)}</div>`;
  }
}
async function saveCustomProvider() {
  const label = document.getElementById('custom-provider-label')?.value.trim();
  const baseUrl = document.getElementById('custom-provider-base-url')?.value.trim();
  const apiKey = document.getElementById('custom-provider-key')?.value.trim();
  if (!label || !baseUrl || !apiKey) { toast('Provider name, base URL, and API key are required', 'err'); return; }
  try {
    const r = await fetch('/api/custom-providers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, baseUrl, apiKey })
    });
    if (!r.ok) throw new Error(await apiErrorMessage(r, 'Could not save provider'));
    ['custom-provider-label','custom-provider-base-url','custom-provider-key'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    toast('Custom provider saved ✓', 'ok');
    await buildCustomProvidersList();
    await loadModels();
  } catch(e) { toast('Custom provider save failed: ' + e.message, 'err'); }
}
async function deleteCustomProvider(id) {
  if (!confirm('Remove this custom provider?')) return;
  try {
    const r = await fetch(`/api/custom-providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(await apiErrorMessage(r, 'Delete failed'));
    toast('Custom provider removed', 'ok');
    await buildCustomProvidersList();
    await loadModels();
  } catch(e) { toast('Delete failed: ' + e.message, 'err'); }
}

/* ── Ollama status ──────────────────────────────────────────────────────────── */
async function checkOllama() {
  const dot = document.getElementById('ollama-dot');
  const txt = document.getElementById('ollama-status-text');
  if (!dot || !txt) return;
  const localModels = models.filter(m => m.provider === 'ollama');
  if (localModels.length > 0) {
    dot.className = 'status-dot online';
    txt.textContent = `Ollama online — ${localModels.length} local model${localModels.length !== 1 ? 's' : ''} ready`;
  } else {
    try {
      await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) });
      dot.className = 'status-dot online';
      txt.textContent = 'Ollama running — no models downloaded yet. Run: ollama pull llama3.2';
    } catch {
      dot.className = 'status-dot offline';
      txt.textContent = 'Ollama not detected. Install from ollama.com to use local models.';
    }
  }
}

/* ── Conversations ──────────────────────────────────────────────────────────── */
function newConversation(switchTo = true) {
  const id = Date.now().toString();
  const conv = { id, title: 'New chat', messages: [], created: Date.now() };
  conversations.unshift(conv);
  saveConversations();
  renderConvList();
  if (switchTo) loadConversation(id);
}

function loadConversation(id) {
  currentConvId = id;
  renderConvList();
  const conv = conversations.find(c => c.id === id);
  if (!conv) return;
  renderMessages(conv.messages);
  updateTokenCounterUI();
}

function updateTokenCounterUI() {
  const badge = document.getElementById('token-count-text');
  if (!badge) return;
  const conv = conversations.find(c => c.id === currentConvId);
  if (!conv || !conv.tokenUsage || conv.tokenUsage.total === 0) {
    badge.textContent = 'Tokens: 0';
    badge.title = 'Tokens spent in this conversation (Prompt in / Completion out)';
    return;
  }
  const { prompt, completion, total, estimated } = conv.tokenUsage;
  // v1.4.0: Surface when counts are an estimate (custom providers that don't
  // include stream_options.usage), so users aren't misled into thinking the
  // numbers are exact.
  const tag = estimated ? ' (est.)' : '';
  badge.textContent = `Tokens: ${total.toLocaleString()}${tag} (${prompt.toLocaleString()} in / ${completion.toLocaleString()} out)`;
  badge.title = estimated
    ? 'Token counts are estimated from text length / 4. The provider did not return exact usage.'
    : 'Tokens spent in this conversation (Prompt in / Completion out)';
}

function deleteConversation(id, e) {
  e.stopPropagation();
  if (!confirm('Delete this conversation?')) return;
  conversations = conversations.filter(c => c.id !== id);
  saveConversations();
  renderConvList();
  if (currentConvId === id) {
    if (conversations.length) loadConversation(conversations[0].id);
    else newConversation(true);
  }
}

const MAX_CONVERSATIONS = 50;
function saveConversations() {
  try {
    while (conversations.length > MAX_CONVERSATIONS) {
      conversations.pop();
    }
    const serialized = JSON.stringify(conversations);
    const sizeBytes = new Blob([serialized]).size;
    if (sizeBytes > 4 * 1024 * 1024) {
      console.warn('[storage] Conversations size:', (sizeBytes / 1024 / 1024).toFixed(1), 'MB');
      toast('Conversations approaching localStorage limit', 'err');
    }
    localStorage.setItem('conversations', serialized);
  } catch(e) {
    toast('Could not save conversations locally: ' + e.message, 'err');
  }
}

function getFilteredConversations() {
  const q = convSearchFilter.trim().toLowerCase();
  if (!q) return conversations;
  return conversations.filter(c => (c.title || '').toLowerCase().includes(q));
}

function renderConvList() {
  const list = document.getElementById('conv-list');
  if (!list) return;
  const filtered = getFilteredConversations();
  list.innerHTML = '';
  for (const c of filtered) {
    const el = document.createElement('div');
    el.className = 'conv-item' + (c.id === currentConvId ? ' active' : '');
    el.setAttribute('data-id', c.id);
    el.setAttribute('role', 'listitem');
    el.setAttribute('tabindex', '0');
    el.innerHTML = `<span class="conv-item-title">${escHtml(c.title)}</span>
      <button class="conv-rename-btn" onclick="startRenameConversation('${c.id}', event)" title="Rename" aria-label="Rename conversation">✎</button>
      <button class="conv-delete" onclick="deleteConversation('${c.id}', event)" title="Delete" aria-label="Delete conversation">✕</button>`;
    el.addEventListener('click', (e) => { if (e.target.closest('button')) return; loadConversation(c.id); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadConversation(c.id); }});
    list.appendChild(el);
  }
  if (filtered.length === 0 && conversations.length > 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:8px 10px;color:var(--text-dim);font-size:11px;';
    empty.textContent = 'No matches';
    list.appendChild(empty);
  }
}

function filterConversations(q) {
  convSearchFilter = q || '';
  renderConvList();
}
function clearConvSearch() {
  const inp = document.getElementById('conv-search');
  if (inp) { inp.value = ''; filterConversations(''); inp.focus(); }
}

let renamingConvId = null;
function startRenameConversation(id, e) {
  e.stopPropagation();
  const item = document.querySelector(`.conv-item[data-id="${CSS.escape(id)}"]`);
  if (!item) return;
  const titleEl = item.querySelector('.conv-item-title');
  const conv = conversations.find(c => c.id === id);
  if (!conv) return;
  renamingConvId = id;
  const input = document.createElement('input');
  input.className = 'conv-rename-input';
  input.value = conv.title;
  input.setAttribute('aria-label', 'Rename conversation');
  const finish = (save) => {
    if (renamingConvId !== id) return;
    renamingConvId = null;
    if (save) {
      const newTitle = input.value.trim();
      if (newTitle) {
        conv.title = newTitle.slice(0, 80);
        saveConversations();
      }
    }
    renderConvList();
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    ev.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  titleEl.replaceWith(input);
  input.focus();
  input.select();
}
function cancelRenameConversation() {
  if (!renamingConvId) return;
  const id = renamingConvId;
  renamingConvId = null;
  renderConvList();
}

function updateConvTitle(id, firstMsg) {
  const conv = conversations.find(c => c.id === id);
  if (!conv || conv.title !== 'New chat') return;
  conv.title = firstMsg.slice(0, 60) + (firstMsg.length > 60 ? '…' : '');
  saveConversations();
  renderConvList();
}

/* ── Rendering messages ─────────────────────────────────────────────────────── */
function renderMessages(msgs) {
  const container = document.getElementById('messages');
  if (!container) return;
  if (!msgs || msgs.length === 0) {
    container.innerHTML = `
      <div id="empty-state">
        <div class="hero" aria-hidden="true">▰</div>
        <h2>Ready to chat</h2>
        <p>Select a model, then send a message. Add API keys in Settings to unlock cloud providers.</p>
        <div class="suggestions">
          <div class="suggestion" onclick="insertSuggestion(this)" role="button" tabindex="0">Explain quantum computing</div>
          <div class="suggestion" onclick="insertSuggestion(this)" role="button" tabindex="0">Write a Python script</div>
          <div class="suggestion" onclick="insertSuggestion(this)" role="button" tabindex="0">Summarize a concept</div>
          <div class="suggestion" onclick="insertSuggestion(this)" role="button" tabindex="0">Debug my code</div>
        </div>
      </div>`;
    document.querySelectorAll('#empty-state .suggestion').forEach(el => {
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); insertSuggestion(el); }});
    });
    return;
  }
  container.innerHTML = '';
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    appendMessage(msg.role, msg.content, false, msg.model || null, i, msg.thinking, msg.thinkingTime);
  }
  scrollBottom();
}

function appendMessage(role, content, animate = true, model = null, msgIdx = null, thinking = null, thinkingTime = null) {
  const container = document.getElementById('messages');
  if (!container) return null;
  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = `message ${role}`;
  if (msgIdx !== null) div.dataset.msgIdx = String(msgIdx);

  const avatar = role === 'user' ? 'USR' : 'AI';
  let bubbleContent = role === 'assistant' ? formatMd(content) : escHtml(content).replace(/\n/g, '<br>');

  if (role === 'assistant' && model) {
    const modelName = model.name || model.id || 'Unknown model';
    const providerIcon = model.icon || '';
    bubbleContent += `<span class="model-label">${providerIcon} ${escHtml(modelName)}</span>`;
  }

  let thinkingHtml = '';
  if (role === 'assistant' && thinking && thinking.trim()) {
    thinkingHtml = `
      <div class="thinking-container permanent-thinking collapsed">
        <div class="thinking-header" onclick="toggleThinking(this)" role="button" tabindex="0">
          <div class="thinking-status">
            <span class="thinking-spinner" aria-hidden="true">⚡</span>
            <span class="thinking-title">Chain of Thought (${thinkingTime ? thinkingTime + 's' : '–'})</span>
          </div>
          <span class="thinking-toggle-btn" aria-hidden="true">▼</span>
        </div>
        <div class="thinking-content">
          <pre><code>${escHtml(thinking.trim())}</code></pre>
        </div>
      </div>`;
  }

  let actionsHtml = `<div class="msg-actions">`;
  if (msgIdx !== null) {
    if (role === 'user') {
      actionsHtml += `<button class="msg-action-btn" type="button" onclick="copyMsgAction(${msgIdx}, this)">COPY</button>`;
      actionsHtml += `<button class="msg-action-btn" type="button" onclick="editMsgAction(${msgIdx})">EDIT</button>`;
    } else if (role === 'assistant') {
      actionsHtml += `<button class="msg-action-btn" type="button" onclick="copyMsgAction(${msgIdx}, this)">COPY</button>`;
      actionsHtml += `<button class="msg-action-btn" type="button" onclick="regenMsgAction(${msgIdx})">REGEN</button>`;
    }
  }
  actionsHtml += `</div>`;

  div.innerHTML = `
    <div class="msg-avatar" aria-hidden="true">${avatar}</div>
    <div class="msg-bubble-container">
      ${thinkingHtml}
      <div class="msg-bubble">${bubbleContent}</div>
      ${msgIdx !== null ? actionsHtml : ''}
    </div>`;
  container.appendChild(div);
  if (animate) scrollBottom();
  return div;
}

function appendTypingBubble() {
  const container = document.getElementById('messages');
  if (!container) return null;
  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = 'active-assistant-message';
  div.innerHTML = `<div class="msg-avatar" aria-hidden="true">AI</div>
    <div class="msg-bubble-container" id="active-assistant-container">
      <div id="live-action-ticker" class="action-ticker">
        <span class="ticker-spinner" aria-hidden="true">⚙️</span>
        <span id="action-ticker-text">Connecting…</span>
      </div>
      <div id="live-thinking-container" class="thinking-container" style="display: none;">
        <div class="thinking-header" onclick="toggleThinking(this)" role="button" tabindex="0">
          <div class="thinking-status">
            <span class="thinking-spinner active" aria-hidden="true">⚡</span>
            <span class="thinking-title">Chain of Thought (<span id="thinking-timer">0.0s</span>)</span>
          </div>
          <span class="thinking-toggle-btn" aria-hidden="true">▼</span>
        </div>
        <div class="thinking-content" id="thinking-scroll-box">
          <pre><code id="thinking-content-text"></code></pre>
        </div>
      </div>
      <div class="msg-bubble" id="live-answer-bubble" style="display: none;">
        <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
      </div>
    </div>`;
  container.appendChild(div);
  scrollBottom();
  return div;
}

function scrollBottom() {
  const c = document.getElementById('messages');
  if (c) c.scrollTop = c.scrollHeight;
}

/* ── Send message ───────────────────────────────────────────────────────────── */
function extractThinkAndClean(raw) {
  let clean = '';
  let think = '';
  let currentlyInThink = false;
  let pos = 0;
  while (pos < raw.length) {
    if (!currentlyInThink) {
      const startIdx = raw.indexOf('<think>', pos);
      if (startIdx === -1) { clean += raw.slice(pos); break; }
      else { clean += raw.slice(pos, startIdx); pos = startIdx + 7; currentlyInThink = true; }
    } else {
      const endIdx = raw.indexOf('</think>', pos);
      if (endIdx === -1) { think += raw.slice(pos); break; }
      else { think += raw.slice(pos, endIdx); pos = endIdx + 8; currentlyInThink = false; }
    }
  }
  return { clean, think, currentlyInThink };
}

async function sendMessage(overrideText) {
  if (streaming) return;
  const input = document.getElementById('msg-input');
  const text = (overrideText !== undefined ? overrideText : (input ? input.value.trim() : '')).trim();
  if (!text) return;
  if (!currentModel) { toast('Please select a model first', 'err'); return; }
  if (!currentConvId) newConversation(true);

  if (input && overrideText === undefined) { input.value = ''; autoResize(input); }

  const conv = conversations.find(c => c.id === currentConvId);
  if (!conv) return;

  conv.messages.push({ role: 'user', content: text });
  saveConversations();
  updateConvTitle(currentConvId, text);
  appendMessage('user', text, true, null, conv.messages.length - 1);

  appendTypingBubble();
  const actionTickerText = document.getElementById('action-ticker-text');
  const thinkingContainer = document.getElementById('live-thinking-container');
  const thinkingTimerEl = document.getElementById('thinking-timer');
  const thinkingContentText = document.getElementById('thinking-content-text');
  const thinkingScrollBox = document.getElementById('thinking-scroll-box');
  const answerBubble = document.getElementById('live-answer-bubble');

  const sendBtn = document.getElementById('send-btn');
  const stopBtn = document.getElementById('stop-btn');
  if (sendBtn) sendBtn.style.display = 'none';
  if (stopBtn) stopBtn.style.display = 'flex';
  streaming = true;
  activeAbortController = new AbortController();

  let totalRawContent = '';
  let dedicatedReasoning = '';
  let thinkingStartTime = null;
  let thinkingTimerInterval = null;
  let hasCollapsedThinking = false;
  let streamError = '';

  thinkingTimerInterval = setInterval(() => {
    if (thinkingStartTime && thinkingTimerEl) {
      thinkingTimerEl.textContent = ((Date.now() - thinkingStartTime) / 1000).toFixed(1) + 's';
    }
  }, 100);

  const dynamicSystemPrompt = systemPrompt;

  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: currentModel.provider,
        model: currentModel.id,
        messages: conv.messages,
        systemPrompt: dynamicSystemPrompt,
        enableThinking: false
      }),
      signal: activeAbortController.signal
    });
    if (!r.ok) throw new Error(await apiErrorMessage(r, 'Chat request failed'));
    if (!r.body) throw new Error('Chat response did not include a stream');

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.error) {
            streamError = d.error;
            if (actionTickerText) actionTickerText.textContent = 'Error';
            if (answerBubble) {
              answerBubble.style.display = 'block';
              answerBubble.innerHTML = `<span style="color:var(--red)">Error: ${escHtml(d.error)}</span>`;
            }
            scrollBottom();
            break;
          }
          if (d.type === 'usage' && d.usage) {
            if (!conv.tokenUsage) conv.tokenUsage = { prompt: 0, completion: 0, total: 0, estimated: false };
            conv.tokenUsage.prompt += (d.usage.promptTokens || 0);
            conv.tokenUsage.completion += (d.usage.completionTokens || 0);
            conv.tokenUsage.total += (d.usage.totalTokens || 0);
            // Estimated flag is sticky: once any provider returns a heuristic
            // count, we label the whole conversation estimate for that turn.
            if (d.usage.estimated) conv.tokenUsage.estimated = true;
            saveConversations();
            updateTokenCounterUI();
          }
          if (d.reasoning) {
            dedicatedReasoning += d.reasoning;
            if (!thinkingStartTime) thinkingStartTime = Date.now();
          }
          if (d.text) totalRawContent += d.text;

          const { clean, think, currentlyInThink } = extractThinkAndClean(totalRawContent);
          const liveThink = (dedicatedReasoning + (think ? '\n' + think : '')).trim();
          const liveClean = clean.trim();

          if (liveThink || currentlyInThink) {
            if (!thinkingStartTime) thinkingStartTime = Date.now();
            if (thinkingContainer) thinkingContainer.style.display = 'block';
            if (thinkingContentText) thinkingContentText.textContent = liveThink;
            if (thinkingScrollBox) thinkingScrollBox.scrollTop = thinkingScrollBox.scrollHeight;
            if (actionTickerText) actionTickerText.textContent = 'Thinking…';
          }
          if (liveClean || (!currentlyInThink && liveClean.length > 0)) {
            if (answerBubble) {
              answerBubble.style.display = 'block';
              answerBubble.innerHTML = formatMd(liveClean);
            }
            if (actionTickerText) actionTickerText.textContent = 'Writing…';
            scrollBottom();
            if (thinkingContainer && !currentlyInThink && liveThink && !hasCollapsedThinking && liveClean.length > 40) {
              thinkingContainer.classList.add('collapsed');
              hasCollapsedThinking = true;
            }
          }
        } catch {}
      }
      if (streamError) break;
    }
  } catch(e) {
    if (e.name === 'AbortError') {
      streamError = 'Stopped by user';
    } else {
      if (actionTickerText) actionTickerText.textContent = 'Network error';
      if (answerBubble) {
        answerBubble.style.display = 'block';
        answerBubble.innerHTML = `<span style="color:var(--red)">Network error: ${escHtml(e.message)}</span>`;
      }
      streamError = e.message;
    }
  }

  if (thinkingTimerInterval) { clearInterval(thinkingTimerInterval); thinkingTimerInterval = null; }
  const thinkingFinalDuration = thinkingStartTime ? ((Date.now() - thinkingStartTime) / 1000).toFixed(1) : 0;
  if (actionTickerText) actionTickerText.textContent = 'Done';
  setTimeout(() => { document.getElementById('live-action-ticker')?.remove(); }, 900);

  const { clean: finalCleanParsed, think: finalThinkParsed } = extractThinkAndClean(totalRawContent);
  const finalLiveThink = (dedicatedReasoning + (finalThinkParsed ? '\n' + finalThinkParsed : '')).trim();
  let finalLiveClean = finalCleanParsed.trim();

  if (streamError === 'Stopped by user') {
    finalLiveClean += '\n\n*[Stopped by user]*';
  } else if (streamError && !finalLiveClean) {
    finalLiveClean = '[Error: ' + streamError + ']';
  } else if (!finalLiveClean && finalLiveThink) {
    finalLiveClean = '*[No final answer provided]*';
  }

  const modelInfo = { ...currentModel };
  const modelObj = models.find(m => m.id === currentModel.id && m.provider === currentModel.provider);
  if (modelObj) { modelInfo.icon = modelObj.icon || ''; modelInfo.name = modelObj.name || modelObj.id; }

  const finalMsgObj = {
    role: 'assistant',
    content: finalLiveClean,
    thinking: finalLiveThink,
    thinkingTime: thinkingFinalDuration,
    model: modelInfo
  };

  conv.messages.push(finalMsgObj);
  saveConversations();

  const newBubble = appendMessage('assistant', finalMsgObj.content, false, modelInfo, conv.messages.length - 1, finalMsgObj.thinking, finalMsgObj.thinkingTime);
  document.getElementById('active-assistant-message')?.replaceWith(newBubble);

  setStreamingUI(false);
  activeAbortController = null;
}

function setStreamingUI(isStreaming) {
  streaming = isStreaming;
  const sendBtn = document.getElementById('send-btn');
  const stopBtn = document.getElementById('stop-btn');
  if (sendBtn) sendBtn.style.display = isStreaming ? 'none' : 'flex';
  if (stopBtn) stopBtn.style.display = isStreaming ? 'flex' : 'none';
  if (sendBtn) sendBtn.disabled = false;
}

/* ── Evolve App ─────────────────────────────────────────────────────────────── */
let evolveMessages = loadStoredJson('evolveMessages', []);
if (!Array.isArray(evolveMessages)) evolveMessages = [];
let evolvePlanStates = loadStoredJson('evolvePlanStates', {});
if (!evolvePlanStates || typeof evolvePlanStates !== 'object' || Array.isArray(evolvePlanStates)) evolvePlanStates = {};
let evolveStreaming = false;
let evolveAbortController = null;

const EVOLVE_SYSTEM_PROMPT = `You are the Evolve AI — an expert software architect and full-stack developer embedded inside BLACKLINE AI.
You help the user understand, plan, and evolve this codebase.
You have read-only awareness of the codebase via the structured manifest below.

RULES:
1. Answer questions about the codebase clearly and concisely.
2. When the user asks for a feature or change, first analyze feasibility. If it violates hard constraints (e.g., requires new npm packages, tries to modify node_modules/.git/data), say so clearly and refuse.
3. You CAN create new files, edit existing files, and delete existing files. Do not refuse file creation.
4. When you propose concrete file changes, output them inside a JSON code block tagged exactly as \`plan. Include an array of objects: { "path": "...", "action": "create|edit|delete", "description": "..." }. Do NOT include full file content in the plan.
5. CRITICAL: After outputting a plan, STOP. The user will see an inline APPROVE & EXECUTE button in the chat. Explicitly tell them to click it. Do NOT output another plan unless they ask for changes.
6. The user CANNOT execute a plan by typing words like "proceed", "do it", "yes", or "execute" — plans only run when the user clicks the button. If they type those words, remind them to use the button. Do not invent a workflow that relies on text approval.
7. If a task is impossible, explain why instead of guessing.
8. Prefer small, focused edit actions. The executor applies existing-file edits as targeted search/replace patches when possible; creates still generate complete new files.`;

function populateEvolveModelSelect() {
  const sel = document.getElementById('evolve-model-select');
  if (!sel) return;
  const previousValue = sel.value;
  const showAll = document.getElementById('show-all-evolve-models')?.checked;
  const selectableModels = models.filter(isModelSelectable);
  const targetModels = showAll ? selectableModels : selectableModels.filter(m => m.updateCapable);
  sel.innerHTML = '';
  if (targetModels.length === 0) {
    sel.innerHTML = '<option value="">— No capable models available —</option>';
    return;
  }
  const groups = {};
  for (const m of targetModels) {
    if (!groups[m.provider]) groups[m.provider] = [];
    groups[m.provider].push(m);
  }
  for (const [prov, ms] of Object.entries(groups)) {
    const og = document.createElement('optgroup');
    og.label = providerLabel(prov);
    for (const m of ms) {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ id: m.id, provider: m.provider });
      opt.textContent = `${modelOptionText(m)}${m.updateCapable ? '' : ' (not recommended)'}`;
      opt.disabled = !!m.disabled;
      opt.title = `Evolve: ${m.evolve?.tier || 'unknown'} (${m.evolve?.score ?? '?'}/100) · ${capabilityBadges(m).join(' · ')}`;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  if (previousValue && [...sel.options].some(o => o.value === previousValue)) {
    sel.value = previousValue;
  }
}

function getEvolveModel() {
  const val = document.getElementById('evolve-model-select')?.value;
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}

async function loadFileTree() {
  const container = document.getElementById('evolve-file-tree');
  if (!container) return;
  container.innerHTML = '<div class="evolve-pending-empty">Loading...</div>';
  try {
    const r = await fetch('/api/files');
    if (!r.ok) throw new Error('Failed to load file tree');
    const tree = await r.json();
    container.innerHTML = '';
    renderFileTreeNodes(tree, container, 0);
  } catch (e) {
    container.innerHTML = `<div class="evolve-pending-empty" style="color:var(--red)">Error: ${escHtml(e.message)}</div>`;
  }
}

function fileTreeLabel(fullPath) {
  const normalized = String(fullPath || '').replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || normalized;
}

function renderFileTreeNodes(nodes, container, level) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    const normalizedPath = String(node.path || '').replace(/\\/g, '/');
    node.path = normalizedPath;

    const div = document.createElement('div');
    div.className = 'evolve-tree-item';
    if (level === 0) div.classList.add('evolve-tree-root-item');
    div.style.paddingLeft = (level * 14 + 8) + 'px';
    div.title = normalizedPath;

    if (node.type === 'dir') {
      div.classList.add('evolve-tree-dir');
      div.innerHTML = `<span class="evolve-tree-icon">DIR</span><span class="evolve-tree-name">${escHtml(fileTreeLabel(normalizedPath))}</span>`;
      const childContainer = document.createElement('div');
      childContainer.className = 'evolve-tree-children';
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        childContainer.style.display = childContainer.style.display === 'none' ? 'block' : 'none';
      });
      container.appendChild(div);
      container.appendChild(childContainer);
      renderFileTreeNodes(node.children, childContainer, level + 1);
    } else {
      div.classList.add('evolve-tree-file');
      div.innerHTML = `<span class="evolve-tree-icon">FILE</span><span class="evolve-tree-name">${escHtml(fileTreeLabel(normalizedPath))}</span>`;
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        showFileViewer(normalizedPath, node.content);
        document.querySelectorAll('.evolve-tree-file').forEach(el => el.classList.remove('active'));
        div.classList.add('active');
      });
      container.appendChild(div);
    }
  }
}

function showFileViewer(path, content) {
  const viewer = document.getElementById('evolve-file-viewer');
  if (!viewer) return;
  viewer.innerHTML = `<div class="evolve-file-viewer-title">${escHtml(path)}</div><pre>${escHtml(content)}</pre>`;
  viewer.style.display = 'block';
}

const MAX_EVOLVE_MSGS = 200;
function saveEvolveMessages() {
  try {
    while (evolveMessages.length > MAX_EVOLVE_MSGS) evolveMessages.shift();
    localStorage.setItem('evolveMessages', JSON.stringify(evolveMessages));
  } catch(e) { toast('Could not save Evolve chat locally: ' + e.message, 'err'); }
}

function renderEvolveMessages() {
  const container = document.getElementById('evolve-messages');
  if (!container) return;
  container.innerHTML = '';
  if (!Array.isArray(evolveMessages) || evolveMessages.length === 0) {
    container.innerHTML = `
      <div class="evolve-empty-state" id="evolve-empty-state">
        <div class="hero" aria-hidden="true">⬡</div>
        <h3>Plan safe app improvements</h3>
        <p>Select an Evolve model below, describe one clear change, review the generated plan, then approve it to execute.</p>
      </div>`;
    return;
  }
  for (const msg of evolveMessages) {
    if (msg && ['user', 'assistant'].includes(msg.role) && typeof msg.content === 'string') {
      appendEvolveMessage(msg.role, msg.content);
    }
  }
  container.scrollTop = container.scrollHeight;
}

function addEvolveMessage(role, content) {
  evolveMessages.push({ role, content, created: Date.now() });
  saveEvolveMessages();
  appendEvolveMessage(role, content);
}

function appendEvolveMessage(role, content) {
  const container = document.getElementById('evolve-messages');
  if (!container) return;
  document.getElementById('evolve-empty-state')?.remove();

  const div = document.createElement('div');
  div.className = `evolve-msg ${role}`;
  const bubbleWrap = document.createElement('div');
  bubbleWrap.style.display = 'flex';
  bubbleWrap.style.flexDirection = 'column';
  bubbleWrap.style.gap = '4px';
  bubbleWrap.style.maxWidth = '85%';
  if (role === 'user') bubbleWrap.style.alignItems = 'flex-end';

  const bubble = document.createElement('div');
  bubble.className = 'evolve-msg-bubble';

  let cleanContent = content;
  let foundPlans = [];
  if (role === 'assistant') {
    const planRegex = /\n?\n?```plan\s*([\s\S]*?)```/g;
    let match;
    while ((match = planRegex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed)) { foundPlans.push(parsed); cleanContent = cleanContent.replace(match[0], ''); }
      } catch {}
    }
    cleanContent = cleanContent.trim();
  }

  bubble.innerHTML = formatMd(cleanContent || (foundPlans.length ? 'Review the proposed plan below.' : ''));
  bubbleWrap.appendChild(bubble);

  const actions = document.createElement('div');
  actions.className = 'evolve-msg-actions';
  const copyBtn = document.createElement('button');
  copyBtn.className = 'evolve-msg-action-btn';
  copyBtn.type = 'button';
  copyBtn.textContent = 'COPY';
  copyBtn.addEventListener('click', () => copyTextToClipboard(content, copyBtn));
  actions.appendChild(copyBtn);
  bubbleWrap.appendChild(actions);

  div.appendChild(bubbleWrap);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  for (const plan of foundPlans) renderPlanInChat(plan);
}

function planStateKey(plan) {
  const raw = JSON.stringify(plan || []);
  let hash = 0;
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  return 'plan-' + Math.abs(hash).toString(36);
}
function saveEvolvePlanStates() { localStorage.setItem('evolvePlanStates', JSON.stringify(evolvePlanStates)); }
function setPlanState(planKey, status, note = '') { evolvePlanStates[planKey] = { status, note, updated: Date.now() }; saveEvolvePlanStates(); }
function setPlanCardStatus(planId, status, note) {
  const card = document.querySelector(`[data-plan-id="${planId}"]`);
  if (!card) return;
  const actions = card.querySelector('.evolve-plan-actions');
  if (actions) actions.remove();
  let statusEl = card.querySelector('.evolve-plan-status');
  if (!statusEl) { statusEl = document.createElement('div'); statusEl.className = 'evolve-plan-status'; card.appendChild(statusEl); }
  statusEl.textContent = note || status;
  statusEl.dataset.status = status;
}
function rejectPlan(planId) {
  const plan = window._evolvePlans?.[planId];
  if (!plan) return;
  const key = planStateKey(plan);
  setPlanState(key, 'rejected', 'Plan rejected by user.');
  setPlanCardStatus(planId, 'rejected', 'REJECTED — this plan will not be executed.');
  addEvolveMessage('assistant', 'Plan rejected. Tell me what to change, or ask for a revised plan.');
}

function renderInvestigationPrompt(failedPayload, appliedPayload) {
  const container = document.getElementById('evolve-messages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'evolve-msg assistant';
  div.innerHTML = `<div class="evolve-msg-bubble">
    <div style="font-weight:700;color:var(--yellow);margin-bottom:8px;">INVESTIGATION REQUIRED</div>
    <div style="font-size:12px;color:var(--text-muted);line-height:1.5;margin-bottom:10px;">Some files failed while others were applied.</div>
    <button class="btn-primary investigate-btn" type="button">INVESTIGATE FAILED EDITS</button>
  </div>`;
  // Use data-* attributes + addEventListener instead of interpolating the
  // payload into an inline onclick attribute. v1.4.0 — the old approach was
  // unsafe if any path contained a single quote.
  const btn = div.querySelector('.investigate-btn');
  if (btn) {
    btn.dataset.failed = failedPayload;
    btn.dataset.applied = appliedPayload;
    btn.addEventListener('click', () => requestFailedPlanRetry(failedPayload, appliedPayload));
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}
function requestFailedPlanRetry(encodedFailed, encodedApplied) {
  let failed = [], applied = [];
  try { failed = JSON.parse(decodeURIComponent(encodedFailed)); } catch {}
  try { applied = JSON.parse(decodeURIComponent(encodedApplied)); } catch {}
  const failedList = failed.map(f => `- ${f.path}: ${f.error}`).join('\n') || '- Unknown';
  const appliedList = applied.map(f => `- ${f.action?.toUpperCase?.() || 'UPDATE'} ${f.path}`).join('\n') || '- None';
  const prompt = `Please investigate the partial Evolve execution and propose a new minimal plan ONLY for the failed file(s).\n\nAlready applied:\n${appliedList}\n\nFailed:\n${failedList}\n\nExplain why the failed edit likely failed, then provide a revised plan.`;
  const input = document.getElementById('evolve-input');
  if (input) { input.value = prompt; autoResize(input); input.focus(); toast('Investigation prompt queued', 'ok'); setTimeout(() => sendEvolveMessage(), 50); }
}

function renderPlanInChat(plan) {
  const container = document.getElementById('evolve-messages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'evolve-msg assistant';
  const planId = 'plan-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const key = planStateKey(plan);
  const savedState = evolvePlanStates[key];
  if (!window._evolvePlans) window._evolvePlans = {};
  window._evolvePlans[planId] = plan;

  const stateHtml = savedState
    ? `<div class="evolve-plan-status" data-status="${escHtml(savedState.status)}">${escHtml(savedState.note || savedState.status)}</div>`
    : `<div class="evolve-plan-actions">
        <button class="btn-primary" onclick="approvePlan('${planId}')">APPROVE & EXECUTE</button>
        <button class="btn-secondary" onclick="rejectPlan('${planId}')">REJECT</button>
      </div>`;

  div.innerHTML = `<div class="evolve-msg-bubble" data-plan-id="${planId}">
    <div style="font-weight:600;margin-bottom:10px;font-size:14px;color:var(--accent2);">PROPOSED PLAN</div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;line-height:1.5;">
      Review the changes below. Click <strong style="color:var(--text);">APPROVE & EXECUTE</strong> to start.
    </div>
    ${plan.map(p => `
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-size:11px;color:var(--yellow);font-weight:600;text-transform:uppercase;">${escHtml(p.action || 'edit')}</span>
          <span style="font-family:var(--font-mono);font-size:11px;color:var(--accent2);">${escHtml(p.path)}</span>
        </div>
        <div style="font-size:12px;color:var(--text-muted);">${escHtml(p.description || '')}</div>
      </div>
    `).join('')}
    ${stateHtml}
  </div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function clearEvolveChat() {
  if (evolveStreaming) { toast('Stop the active Evolve run before clearing', 'err'); return; }
  if (evolveMessages.length && !confirm('Clear the Evolve chat and start a new update thread?')) return;
  evolveMessages = [];
  if (window._evolvePlans) window._evolvePlans = {};
  evolvePlanStates = {};
  localStorage.removeItem('evolvePlanStates');
  localStorage.removeItem('evolveMessages');
  renderEvolveMessages();
}

async function sendEvolveMessage() {
  if (evolveStreaming) return;
  const input = document.getElementById('evolve-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  const model = getEvolveModel();
  if (!model) { toast('Please select a model in the Evolve panel', 'err'); return; }

  input.value = ''; autoResize(input);

  // Note: As of v1.4.0, plans are only executed when the user clicks the
  // explicit APPROVE & EXECUTE button. We no longer auto-execute plans when
  // the user's typed message happens to contain words like "yes", "proceed",
  // or "execute" — that pattern was unsafe (e.g. "I do not want to proceed").
  // The model is told this in the EVOLVE_SYSTEM_PROMPT below.

  addEvolveMessage('user', text);
  const modelObj = models.find(m => m.id === model.id && m.provider === model.provider);
  const modelName = modelObj ? `${modelObj.icon || ''} ${modelObj.name || model.id}` : model.id;
  appendEvolveLoading(modelName);

  evolveStreaming = true;
  evolveAbortController = new AbortController();
  setEvolveStreamingUI(true);

  let dynamicSystem = EVOLVE_SYSTEM_PROMPT;
  if (appManifestString) dynamicSystem = dynamicSystem + '\n\n' + appManifestString;

  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: model.provider,
        model: model.id,
        messages: evolveMessages.slice(0, -1).concat([{ role: 'user', content: text }]),
        systemPrompt: dynamicSystem,
        enableThinking: false
      }),
      signal: evolveAbortController.signal
    });
    if (!r.ok) throw new Error(await apiErrorMessage(r, 'Evolve chat failed'));
    if (!r.body) throw new Error('No response stream');

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let assistantText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.error) { assistantText += '\n[Error: ' + d.error + ']'; break; }
          if (d.text) { assistantText += d.text; updateEvolveLoading(assistantText); }
        } catch {}
      }
    }
    removeEvolveLoading();
    addEvolveMessage('assistant', assistantText);
  } catch (e) {
    removeEvolveLoading();
    let msg = e.message;
    if (e.name === 'AbortError') msg = 'Stopped by user';
    addEvolveMessage('assistant', 'Error: ' + msg);
  }
  evolveStreaming = false;
  evolveAbortController = null;
  setEvolveStreamingUI(false);
}

function appendEvolveLoading(modelName) {
  const container = document.getElementById('evolve-messages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'evolve-msg assistant';
  div.id = 'evolve-loading-msg';
  div.innerHTML = `<div class="evolve-msg-bubble"><div class="action-ticker"><span class="ticker-spinner">⚙️</span><span>${escHtml(modelName)} is thinking…</span></div></div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}
function updateEvolveLoading(text) {
  const div = document.getElementById('evolve-loading-msg');
  if (!div) return;
  const bubble = div.querySelector('.evolve-msg-bubble');
  if (bubble) bubble.innerHTML = formatMd(text);
}
function removeEvolveLoading() { document.getElementById('evolve-loading-msg')?.remove(); }
function stopEvolveMessage() { if (evolveAbortController) { evolveAbortController.abort(); evolveAbortController = null; } }
function setEvolveStreamingUI(isStreaming) {
  const sendBtn = document.getElementById('evolve-send-btn');
  const stopBtn = document.getElementById('evolve-stop-btn');
  const input = document.getElementById('evolve-input');
  const modelSelect = document.getElementById('evolve-model-select');
  if (sendBtn) sendBtn.style.display = isStreaming ? 'none' : 'inline-flex';
  if (stopBtn) stopBtn.style.display = isStreaming ? 'inline-flex' : 'none';
  if (input) input.disabled = isStreaming;
  if (modelSelect) modelSelect.disabled = isStreaming;
}

async function approvePlan(planId) {
  const plan = window._evolvePlans?.[planId];
  if (!plan) { toast('Plan not found', 'err'); return; }
  const key = planStateKey(plan);
  const model = getEvolveModel();
  if (!model) { toast('Please select a model first', 'err'); return; }
  setPlanState(key, 'executing', 'EXECUTING…');
  setPlanCardStatus(planId, 'executing', 'EXECUTING…');

  const container = document.getElementById('evolve-messages');
  const div = document.createElement('div');
  div.className = 'evolve-msg assistant';
  div.id = 'evolve-execution-' + planId;
  div.innerHTML = `<div class="evolve-msg-bubble">
    <div style="color:var(--accent2);font-weight:600;margin-bottom:8px;">EXECUTION STARTED…</div>
    <pre style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px;max-height:400px;overflow-y:auto;font-family:var(--font-mono);font-size:12px;white-space:pre-wrap;word-break:break-word;" id="exec-feed-${planId}"></pre>
  </div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  const feed = document.getElementById('exec-feed-' + planId);

  try {
    const r = await fetch('/api/evolve/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: model.provider, model: model.id, plan })
    });
    if (!r.ok) throw new Error(await apiErrorMessage(r, 'Execution failed'));
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.type === 'chunk') { feed.textContent += d.text; feed.scrollTop = feed.scrollHeight; }
          else if (d.type === 'backup') { feed.textContent += `\n[Backup: ${d.dir}]\n`; feed.scrollTop = feed.scrollHeight; }
          else if (d.type === 'file_complete') { feed.textContent += `\n[✅ ${d.action.toUpperCase()} ${d.path}]\n`; feed.scrollTop = feed.scrollHeight; }
          else if (d.type === 'file_error') { feed.textContent += `\n[❌ ${d.path}: ${d.error}]\n`; feed.scrollTop = feed.scrollHeight; }
          else if (d.type === 'done' || d.type === 'partial') {
            feed.textContent += `\n\n${d.type === 'partial' ? 'PARTIAL: ' : ''}${d.message}`;
            const applied = Array.isArray(d.applied) ? d.applied : [];
            const failed = Array.isArray(d.failed) ? d.failed : [];
            const appliedList = applied.length ? applied.map(f => `- ${f.action?.toUpperCase?.() || 'UPDATE'} ${f.path}`).join('\n') : '- None';
            const failedList = failed.length ? failed.map(f => `- ${f.path}: ${f.error}`).join('\n') : '- None';
            if (d.type === 'partial') {
              toast('Partial update', 'err');
              setPlanState(key, 'partial', 'PARTIAL — investigation required');
              setPlanCardStatus(planId, 'partial', 'PARTIAL — investigation required');
              addEvolveMessage('assistant', `Partial execution.\n\n${d.message}\n\nApplied:\n${appliedList}\n\nFailed:\n${failedList}\n\nBackup: ${d.backupDir || 'n/a'}`);
              renderInvestigationPrompt(encodeURIComponent(JSON.stringify(failed)), encodeURIComponent(JSON.stringify(applied)));
            } else {
              toast(d.message, 'ok');
              setPlanState(key, 'executed', 'EXECUTED');
              setPlanCardStatus(planId, 'executed', 'EXECUTED');
              addEvolveMessage('assistant', `Execution complete.\n\nApplied:\n${appliedList}\n\nBackup: ${d.backupDir || 'n/a'}`);
            }
            loadFileTree();
          } else if (d.type === 'error') {
            feed.textContent += `\n\nERROR: ${d.message}`;
            setPlanState(key, 'failed', 'FAILED');
            setPlanCardStatus(planId, 'failed', 'FAILED');
            addEvolveMessage('assistant', `Execution failed.\n\n${d.message}`);
            toast(d.message, 'err');
          }
        } catch {}
      }
    }
  } catch (e) {
    if (feed) feed.textContent += `\n\nFailed: ${e.message}`;
    setPlanState(key, 'failed', 'FAILED');
    setPlanCardStatus(planId, 'failed', 'FAILED');
    addEvolveMessage('assistant', `Execution request failed.\n\n${e.message}`);
    toast('Execution failed: ' + e.message, 'err');
  }
}

/* ── Model info modal ──────────────────────────────────────────────────────── */
function currentModelObject() {
  if (!currentModel) return null;
  return models.find(m => m.id === currentModel.id && m.provider === currentModel.provider) || currentModel;
}
function yesNoBadge(label, value) {
  return `<span class="model-cap ${value ? 'yes' : 'no'}">${value ? '✓' : '–'} ${escHtml(label)}</span>`;
}
function openModelInfoModal() {
  const overlay = document.getElementById('model-info-overlay');
  const content = document.getElementById('model-info-content');
  const m = currentModelObject();
  if (!overlay || !content) return;
  if (!m) {
    content.innerHTML = '<p class="model-info-muted">Select a model first.</p>';
  } else {
    const caps = m.capabilities || {};
    const pricing = m.pricing || {};
    const evolve = m.evolve || {};
    const probe = modelProbeFor(m);
    const probeRows = probe?.tests ? Object.entries(probe.tests).map(([name, t]) =>
      `<div class="probe-detail-row"><span>${escHtml(name)}</span><strong class="${escHtml(t.status)}">${escHtml(t.status)}</strong><em>${escHtml(t.error || t.detail || '')}</em></div>`
    ).join('') : '<p class="model-info-muted">Not tested yet. Use TEST in Model Center to verify real access and Evolve behavior.</p>';
    content.innerHTML = `
      <div class="model-info-name">${escHtml(m.name || m.id)}</div>
      <div class="model-info-id">${escHtml(providerLabel(m.provider))} · ${escHtml(m.id)}</div>
      <div class="model-info-badges">${capabilityBadges(m).map(b => `<span>${escHtml(b)}</span>`).join('')}</div>
      <h4>Capabilities</h4>
      <div class="model-cap-grid">
        ${yesNoBadge('Text', caps.text !== false)}
        ${yesNoBadge('Vision / image input', caps.imageInput)}
        ${yesNoBadge('Audio input', caps.audioInput)}
        ${yesNoBadge('File input', caps.fileInput)}
        ${yesNoBadge('Tool use', caps.toolUse)}
        ${yesNoBadge('JSON / structured output', caps.jsonMode)}
        ${yesNoBadge('Reasoning signal', caps.reasoning)}
        ${yesNoBadge('Long-context signal', caps.longContext)}
      </div>
      <h4>Pricing / availability</h4>
      <p class="model-info-muted">Status: <strong>${escHtml(pricing.freeStatus || 'unknown')}</strong> · Source: ${escHtml(pricing.source || m.source || 'unknown')}</p>
      ${pricing.note ? `<p class="model-info-muted">${escHtml(pricing.note)}</p>` : ''}
      <h4>Evolve suitability</h4>
      <p class="model-info-muted"><strong>${escHtml(evolve.tier || 'unknown')}</strong> · Score: ${escHtml(evolve.score ?? '?')}/100</p>
      <div class="model-info-reasons">${(evolve.reasons || []).map(r => `<div>• ${escHtml(r)}</div>`).join('')}</div>
      <h4>Live probe</h4>
      <p class="model-info-muted">${probe ? `Status: <strong>${escHtml(probe.status)}</strong> · Score: ${escHtml(probe.score ?? '?')}% · ${escHtml(probe.updatedAt || '')}` : 'Not tested'}</p>
      <div class="probe-detail-grid">${probeRows}</div>
      <p class="model-info-warning">Capability and pricing data combine provider model-list APIs, provider metadata where available, BLACKLINE AI local metadata, and optional live probes. Treat pricing as a guide; provider billing pages remain authoritative.</p>`;
  }
  overlay.style.display = 'flex';
  overlay.classList.add('open');
}
function closeModelInfoModal() {
  const overlay = document.getElementById('model-info-overlay');
  if (overlay) { overlay.classList.remove('open'); overlay.style.display = 'none'; }
}
function closeModelInfoOutside(e) { if (e.target === document.getElementById('model-info-overlay')) closeModelInfoModal(); }

/* ── System prompt modal ───────────────────────────────────────────────────── */
function openSystemModal() {
  const inp = document.getElementById('system-prompt-input');
  if (inp) inp.value = systemPrompt;
  const overlay = document.getElementById('modal-overlay');
  if (overlay) { overlay.classList.add('open'); overlay.style.display = 'flex'; setTimeout(() => inp?.focus(), 30); }
}
function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) { overlay.classList.remove('open'); overlay.style.display = 'none'; }
}
function closeModalOutside(e) { if (e.target === document.getElementById('modal-overlay')) closeModal(); }
function saveSystemPrompt() {
  const inp = document.getElementById('system-prompt-input');
  systemPrompt = inp ? inp.value.trim() : '';
  localStorage.setItem('systemPrompt', systemPrompt);
  closeModal();
  toast('System prompt saved ✓', 'ok');
}

/* ── Message actions ───────────────────────────────────────────────────────── */
function toggleThinking(el) {
  const container = el.closest('.thinking-container');
  if (!container) return;
  container.classList.toggle('collapsed');
}

function stopGenerating() {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
  setStreamingUI(false);
}

function clearCurrentChat() {
  if (!currentConvId) return;
  const conv = conversations.find(c => c.id === currentConvId);
  if (!conv) return;
  if (!confirm('Clear all messages in this conversation?')) return;
  conv.messages = [];
  conv.title = 'New chat';
  if (conv.tokenUsage) conv.tokenUsage = { prompt: 0, completion: 0, total: 0, estimated: false };
  saveConversations();
  renderConvList();
  renderMessages(conv.messages);
  updateTokenCounterUI();
  toast('Chat cleared', 'ok');
}

function exportCurrentChat() {
  if (!currentConvId) return;
  const conv = conversations.find(c => c.id === currentConvId);
  if (!conv || conv.messages.length === 0) { toast('Nothing to export', 'err'); return; }
  let md = `# ${conv.title}\nExported on ${new Date().toLocaleString()}\n\n`;
  for (const m of conv.messages) {
    const roleName = m.role === 'user' ? 'User' : 'Assistant';
    md += `### ${roleName}\n${m.content}\n\n---\n\n`;
  }
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${conv.title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Exported to Markdown ✓', 'ok');
}

function exportAllData() {
  const data = {
    app: 'BLACKLINE AI',
    version: 2,
    exportDate: new Date().toISOString(),
    includes: [
      'conversations',
      'systemPrompt',
      'currentModel',
      'evolveMessages',
      'evolvePlanStates',
      'evolveLayout'
    ],
    excluded: {
      apiKeys: 'API keys are intentionally not exported for security. They remain only in data/config.json on this machine.'
    },
    conversations,
    systemPrompt: localStorage.getItem('systemPrompt') || '',
    currentModel: loadStoredJson('currentModel', null),
    evolveMessages: loadStoredJson('evolveMessages', []),
    evolvePlanStates: loadStoredJson('evolvePlanStates', {}),
    evolveLayout: {
      leftWidthPct: localStorage.getItem('evolveLeftWidthPct') || null
    }
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `blackline_ai_backup_${new Date().toISOString().replace(/[:.]/g, '')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('BLACKLINE AI data exported ✓', 'ok');
}

function importAllData(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      if (data.conversations && Array.isArray(data.conversations)) {
        conversations = data.conversations;
        saveConversations();
      }
      if (typeof data.systemPrompt === 'string') {
        systemPrompt = data.systemPrompt;
        localStorage.setItem('systemPrompt', systemPrompt);
        const si = document.getElementById('system-prompt-input');
        if (si) si.value = systemPrompt;
      }
      if (data.currentModel && typeof data.currentModel === 'object') {
        currentModel = data.currentModel;
        localStorage.setItem('currentModel', JSON.stringify(data.currentModel));
        populateModelSelect(JSON.stringify(data.currentModel));
      }
      if (Array.isArray(data.evolveMessages)) {
        evolveMessages = data.evolveMessages;
        saveEvolveMessages();
        renderEvolveMessages();
      }
      if (data.evolvePlanStates && typeof data.evolvePlanStates === 'object' && !Array.isArray(data.evolvePlanStates)) {
        evolvePlanStates = data.evolvePlanStates;
        localStorage.setItem('evolvePlanStates', JSON.stringify(evolvePlanStates));
      }
      if (data.evolveLayout && data.evolveLayout.leftWidthPct !== undefined && data.evolveLayout.leftWidthPct !== null) {
        localStorage.setItem('evolveLeftWidthPct', String(data.evolveLayout.leftWidthPct));
        initEvolveResizer();
      }
      renderConvList();
      if (conversations.length > 0) loadConversation(conversations[0].id);
      else newConversation(true);
      toast('BLACKLINE AI data restored ✓', 'ok');
    } catch(err) { toast('Failed to restore data: invalid JSON', 'err'); }
    e.target.value = '';
  };
  reader.readAsText(file);
}

function editMsgAction(idx) {
  const conv = conversations.find(c => c.id === currentConvId);
  if (!conv || !conv.messages[idx]) return;
  const targetMsg = conv.messages[idx];
  if (confirm('Edit this message and re-send? Later messages will be replaced.')) {
    const input = document.getElementById('msg-input');
    if (input) { input.value = targetMsg.content; autoResize(input); input.focus(); }
    conv.messages = conv.messages.slice(0, idx);
    saveConversations();
    renderMessages(conv.messages);
    updateTokenCounterUI();
  }
}

async function copyMsgAction(idx, btn) {
  const conv = conversations.find(c => c.id === currentConvId);
  if (!conv || !conv.messages[idx]) return;
  try {
    await navigator.clipboard.writeText(conv.messages[idx].content);
    flashCopied(btn);
  } catch { toast('Copy failed', 'err'); }
}

function regenMsgAction(idx) {
  const conv = conversations.find(c => c.id === currentConvId);
  if (!conv || !conv.messages[idx]) return;
  if (!confirm('Regenerate this assistant response?')) return;
  conv.messages = conv.messages.slice(0, idx);
  saveConversations();
  renderMessages(conv.messages);
  updateTokenCounterUI();
  const lastUserMsg = conv.messages[conv.messages.length - 1];
  if (lastUserMsg && lastUserMsg.role === 'user') {
    const textToResend = lastUserMsg.content;
    conv.messages.pop();
    saveConversations();
    sendMessage(textToResend);
  }
}

async function copyCode(btn, e) {
  if (e) e.stopPropagation();
  const pre = btn.closest('.code-block')?.querySelector('pre code');
  if (!pre) return;
  try { await navigator.clipboard.writeText(pre.textContent); flashCopied(btn); }
  catch { toast('Copy failed', 'err'); }
}

function flashCopied(btn) {
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = '✓ Copied';
  btn.classList.add('copied');
  setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1800);
}

/* ── Input helpers ──────────────────────────────────────────────────────────── */
function onInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}
function onEvolveInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendEvolveMessage(); }
}
async function copyTextToClipboard(text, btn) {
  try { await navigator.clipboard.writeText(text || ''); if (btn) flashCopied(btn); }
  catch { toast('Copy failed', 'err'); }
}
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}
function insertSuggestion(el) {
  const input = document.getElementById('msg-input');
  if (!input) return;
  input.value = el.textContent;
  autoResize(input);
  input.focus();
}

/* ── Utils ─────────────────────────────────────────────────────────────────── */
function loadStoredJson(key, fallback) {
  try { const parsed = JSON.parse(localStorage.getItem(key) || 'null'); return parsed ?? fallback; }
  catch (e) { console.warn('[storage] Failed to parse', key, e.message); localStorage.removeItem(key); return fallback; }
}
async function apiErrorMessage(response, fallback) {
  try { const data = await response.json(); return data.error || data.message || fallback; }
  catch { try { return await response.text() || fallback; } catch { return fallback; } }
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── App Manifest ──────────────────────────────────────────────────────────── */
async function loadAppManifest() {
  try {
    const r = await fetch('/api/manifest');
    if (!r.ok) throw new Error('manifest HTTP ' + r.status);
    appManifest = await r.json();
    appManifestString = renderManifestAsPrompt(appManifest);
  } catch (e) {
    console.warn('Could not load app manifest:', e.message);
    appManifest = null;
    appManifestString = '';
  }
}
function renderManifestAsPrompt(m) {
  if (!m) return '';
  const lines = [];
  lines.push('=== APP MANIFEST ===');
  lines.push(`You are embedded inside the running app "${m.name}" (${m.description || ''}, v${m.version}).`);
  lines.push('You have READ-ONLY awareness of the codebase via the structured manifest below.');
  lines.push('');
  lines.push('--- TECH STACK ---');
  (m.techStack || []).forEach(t => lines.push('• ' + t));
  lines.push(`Port: ${m.port}`);
  lines.push('');
  lines.push('--- STORAGE ---');
  if (m.storage) Object.entries(m.storage).forEach(([k, v]) => lines.push(`• ${k}: ${v}`));
  lines.push('');
  lines.push('--- FILES (line counts only) ---');
  (m.files || []).forEach(f => lines.push(`• ${f.path}  (${f.lines} lines)`));
  lines.push('');
  lines.push('--- API ENDPOINTS ---');
  (m.endpoints || []).forEach(e => lines.push(`• ${e.method} ${e.path}`));
  lines.push('');
  lines.push('--- FRONTEND ---');
  if (m.frontend) {
    lines.push(`Frontend: public/index.html (~${m.frontend.lineCount} lines), public/styles.css (~${m.frontend.styleLineCount || 0}), public/app.js (~${m.frontend.scriptLineCount || 0})`);
    lines.push(`Panels: ${(m.frontend.panels || []).join(', ')}`);
  }
  lines.push('');
  lines.push('--- CAPABILITIES ---');
  (m.capabilities || []).forEach(c => lines.push('✓ ' + c));
  lines.push('');
  lines.push('--- HARD CONSTRAINTS ---');
  (m.hardConstraints || []).forEach(c => lines.push('✗ ' + c));
  lines.push('');
  lines.push('--- HOW UPDATES WORK ---');
  (m.updateWorkflow || []).forEach(s => lines.push(s));
  lines.push('');
  if (m.updatePromptGuide) {
    lines.push('--- HOW TO WRITE A GREAT PLAN ---');
    (m.updatePromptGuide.what_makes_a_great_prompt || []).forEach(t => lines.push('• ' + t));
    lines.push(''); lines.push('Format: ' + (m.updatePromptGuide.format || ''));
  }
  lines.push(''); lines.push('=== END APP MANIFEST ===');
  return lines.join('\n');
}
