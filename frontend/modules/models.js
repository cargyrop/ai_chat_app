/* BLACKLINE AI — models module (Phase 2 + Technopunk Master Arena Catalog) */

async function loadModels(showToast = false) {
  const sel = document.getElementById('model-select');
  if (!sel) return;
  const previousVal = sel.value;
  const refreshBtn = document.getElementById('model-refresh-btn');
  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.textContent = 'REFRESHING…'; }
  const center = document.getElementById('model-center-list');
  if (center && showToast) center.innerHTML = '<div class="model-center-empty">Refreshing catalog…</div>';
  if (showToast) toast('Refreshing model catalog…', 'ok');
  sel.innerHTML = '<option value="">Loading models…</option>';
  try {
    const r = await fetch('/api/models');
    if (!r.ok) throw new Error(await apiErrorMessage(r, 'Could not load models'));
    models = await r.json();
    if (!Array.isArray(models)) throw new Error('Model response was not an array');
    await loadModelProbes();
    if (typeof autoAssignModelRoles === 'function') autoAssignModelRoles(false);
    populateModelSelect(previousVal);
    renderModelCenter();
    if (typeof renderModelRoles === 'function') renderModelRoles();
    renderAddedEndpoints();
    buildCustomProvidersList();
    checkOllama();
    if (showToast) toast(`Catalog refreshed: ${models.length} model entries`, 'ok');
  } catch(e) {
    sel.innerHTML = '<option value="">Error loading models</option>';
    toast('Could not load models: ' + e.message, 'err');
  } finally {
    if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.textContent = 'REFRESH MODEL CATALOG'; }
  }
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
      ? '— Models found, but all are disabled. Open Model Center and tick checkboxes on the left. —'
      : '— No models yet. Add an API key or connect Ollama in Settings —';
    sel.innerHTML = `<option value="">${hint}</option>`;
    if (count) count.textContent = models.length ? `${models.length} found · 0 enabled` : '';
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
      opt.title = `${m.arena?.textElo ? `[ELO ${m.arena.textElo}] ` : ''}${capabilityBadges(m).join(' · ')}`;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  if (count) count.textContent = `${selectableModels.length}/${models.length} selectable`;

  let toSelect = null;
  const tryVals = [preferredVal, currentModel ? JSON.stringify(currentModel) : null, localStorage.getItem('currentModel')].filter(Boolean);
  for (const v of tryVals) {
    if ([...sel.options].some(o => o.value === v)) { toSelect = v; break; }
  }
  if (toSelect) sel.value = toSelect;
  onModelChange();
}

function populateEvolveModelSelect() {
  const sel = document.getElementById('evolve-model-select');
  if (!sel) return;
  const previousValue = sel.value;
  const showAll = document.getElementById('show-all-evolve-models')?.checked;
  const selectableModels = models.filter(isModelSelectable);
  const targetModels = showAll ? selectableModels : selectableModels.filter(m => m.updateCapable);
  sel.innerHTML = '';
  if (targetModels.length === 0) {
    sel.innerHTML = '<option value="">— No capable models enabled —</option>';
    return;
  }
  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = '— Select / assign Planner role —';
  sel.appendChild(emptyOpt);
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
      opt.title = `Evolve: ELO ${m.arena?.textElo || '?'} · ${capabilityBadges(m).join(' · ')}`;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  const plannerValue = modelRoles?.planner || '';
  if (plannerValue && [...sel.options].some(o => o.value === plannerValue)) {
    sel.value = plannerValue;
  } else if (previousValue && [...sel.options].some(o => o.value === previousValue)) {
    sel.value = previousValue;
    modelRoles.planner = previousValue;
    try { localStorage.setItem('modelRoles', JSON.stringify(modelRoles)); } catch {}
  }
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

function providerLabel(p) {
  const found = models.find(m => m.provider === p && m.providerName);
  if (found && found.providerName) return found.providerName;
  if (String(p || '').startsWith('custom:')) {
    return 'Custom: ' + String(p).slice(7);
  }
  return { anthropic:'Anthropic', openai:'OpenAI', gemini:'Google Gemini', groq:'Groq', openrouter:'OpenRouter', deepseek:'DeepSeek', ollama:'Local (Ollama)' }[p] || p;
}

function capabilityBadges(m) {
  const caps = m.capabilities || {};
  const pricing = m.pricing?.freeStatus || 'unknown';
  const badges = [];
  if (pricing === 'local') badges.push('LOCAL');
  else if (pricing === 'free') badges.push('FREE');
  else if (pricing === 'paid') badges.push('PAID');
  else badges.push('UNKNOWN COST');
  if (caps.imageInput) badges.push('VISION');
  if (caps.reasoning) badges.push('REASON');
  if (caps.toolUse) badges.push('TOOLS');
  if (caps.code) badges.push('CODE');
  return badges;
}

function modelOptionText(m) { return `${m.name || m.id}`; }

function isModelSelectable(m) {
  if (m.disabled || m.enabled === false) return false;
  if (m.enabled === true || m.provider === 'ollama' || m.source === 'added-endpoint') return true;
  const probe = modelProbeFor(m);
  return ['pass', 'partial'].includes(probe?.status);
}

function modelKey(provider, id) { return `${provider}::${id}`; }

function modelProbeFor(m) { return m.probe || modelProbes[modelKey(m.provider, m.id)] || null; }

function setModelCenterFilter(filter) { modelCenterFilter = 'all'; renderModelCenter(); }

function providerCollapseKey(prov) { return String(prov || ''); }

function isProviderTableCollapsed(prov) {
  return providerTableCollapsed[providerCollapseKey(prov)] === true;
}

function saveProviderTableCollapsed() {
  try { localStorage.setItem('providerTableCollapsed', JSON.stringify(providerTableCollapsed)); } catch {}
}

function setProviderTableCollapsed(prov, collapsed) {
  providerTableCollapsed[providerCollapseKey(prov)] = !!collapsed;
  saveProviderTableCollapsed();
}

function applyProviderTableCollapsedState(prov, body, arrow) {
  const collapsed = isProviderTableCollapsed(prov);
  if (body) body.style.display = collapsed ? 'none' : 'block';
  if (arrow) arrow.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
}

function modelMatchesCenterFilter(m) {
  // Filters were removed from Model Center by design; always show every discovered model.
  return true;
}

function arenaEloValue(m, kind) {
  const leaderboards = m?.arena?.leaderboards || {};
  if (kind === 'chat') {
    if (Number.isFinite(leaderboards.text?.score)) return leaderboards.text.score;
    const chatScores = ['search', 'vision', 'document']
      .map(key => leaderboards[key]?.score)
      .filter(score => Number.isFinite(score));
    return chatScores.length ? Math.round(chatScores.reduce((sum, score) => sum + score, 0) / chatScores.length) : null;
  }
  if (kind === 'code') return Number.isFinite(leaderboards.code?.score) ? leaderboards.code.score : null;
  return null;
}

function arenaEloText(m, kind) {
  const value = arenaEloValue(m, kind);
  if (!m?.arena?.matched || !Number.isFinite(value)) return '—';
  return `ELO ${value}`;
}

function modelIdSubtitle(m) {
  // Model Center optimizes for the human-readable model name. Exact provider/model
  // ids remain available in the row tooltip and Model Info modal.
  return '';
}

function renderModelCenter() {
  const container = document.getElementById('model-center-list');
  if (!container) return;
  modelCenterFilter = 'all';
  
  const filtered = models.filter(m => modelMatchesCenterFilter(m));
  const countHint = document.getElementById('catalog-counts-hint');
  const enabledInView = filtered.filter(m => m.enabled !== false).length;
  if (countHint) countHint.textContent = `${filtered.length} MODELS (${enabledInView} ACTIVE)`;

  if (!filtered.length) {
    container.innerHTML = '<div class="model-center-empty">No models found yet. Test and add an endpoint above, then click Refresh Catalog if needed.</div>';
    return;
  }

  container.innerHTML = '';
  
  // Group filtered by provider
  const provGroups = {};
  for (const m of filtered) {
    if (!provGroups[m.provider]) provGroups[m.provider] = [];
    provGroups[m.provider].push(m);
  }

  for (const [prov, ms] of Object.entries(provGroups)) {
    // Strictly stable sort: Text ELO descending > name ascending (independent of enabled state)
    ms.sort((a, b) => {
      const aElo = a.arena?.matched ? (arenaEloValue(a, 'chat') || 1000) : 1000;
      const bElo = b.arena?.matched ? (arenaEloValue(b, 'chat') || 1000) : 1000;
      if (aElo !== bElo) return bElo - aElo;
      return (a.name || a.id).localeCompare(b.name || b.id);
    });

    const totalInProv = models.filter(x => x.provider === prov).length;
    const enabledInProv = models.filter(x => x.provider === prov && x.enabled !== false).length;
    const isAddedEndpoint = ms.some(x => x.source === 'added-endpoint');

    const block = document.createElement('div');
    block.className = 'tp-provider-block';
    block.id = `tp-prov-${prov}`;

    block.innerHTML = `
      <div class="tp-provider-header" onclick="toggleProviderTable('${escHtml(prov)}')">
        <div class="tp-provider-title-wrap">
          <span class="tp-prov-symbol">▪</span>
          <span class="tp-prov-name">${escHtml(providerLabel(prov))}</span>
          <span class="tp-prov-count">${enabledInProv}/${totalInProv} ACTIVE</span>
        </div>
        <div class="tp-provider-meta">
          <div class="tp-provider-actions" onclick="event.stopPropagation()">
            <button type="button" class="tp-provider-mini-btn" onclick="toggleEntireProvider('${escHtml(prov)}', true)">ENABLE ALL</button>
            <button type="button" class="tp-provider-mini-btn" onclick="toggleEntireProvider('${escHtml(prov)}', false)">DISABLE ALL</button>
            ${isAddedEndpoint ? `<button type="button" class="tp-provider-mini-btn danger" onclick="deleteEndpoint('${escHtml(prov)}')">DELETE</button>` : ''}
          </div>
          <span class="tp-prov-url">${escHtml(ms[0]?.baseUrl || prov)}</span>
          <span class="tp-collapse-arrow" id="arrow-${escHtml(prov)}">˅</span>
        </div>
      </div>
      <div class="tp-provider-body" id="body-${escHtml(prov)}">
        <table class="tp-catalog-table">
          <thead>
            <tr>
              <th style="width:36px; text-align:center;">ACT</th>
              <th>MODEL IDENTIFIER</th>
              <th>CHAT ELO</th>
              <th>CODE ELO</th>
              <th>CAPABILITIES</th>
              <th>REACTION STATUS</th>
              <th style="text-align:right;">ACTIONS</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    `;

    applyProviderTableCollapsedState(
      prov,
      block.querySelector('.tp-provider-body'),
      block.querySelector('.tp-collapse-arrow')
    );

    const tbody = block.querySelector('tbody');
    for (const m of ms) {
      const isEnabled = m.enabled !== false;
      const tr = document.createElement('tr');
      if (!isEnabled) tr.className = 'disabled-row';

      const textEloTxt = arenaEloText(m, 'chat');
      const codeEloTxt = arenaEloText(m, 'code');

      const caps = capabilityBadges(m).map(b => `<span>${escHtml(b)}</span>`).join('');
      const probe = modelProbeFor(m);
      
      let reactHtml = '<span class="tp-status-dim">— UNTESTED</span>';
      if (probe?.pingStatus === 'ok' || probe?.status === 'pass') {
        reactHtml = `<span class="tp-status-ok">▪ PONG (${probe.pingMs || 18}MS)</span>`;
      } else if (probe?.pingStatus === 'err' || probe?.status === 'fail') {
        reactHtml = `<span class="tp-status-err">× ERR</span>`;
      }

      tr.innerHTML = `
        <td style="text-align:center;"><input type="checkbox" class="tp-checkbox" ${isEnabled ? 'checked' : ''} onchange="toggleModelEnabled('${escHtml(m.provider)}', '${escHtml(m.id)}', this.checked)" /></td>
        <td title="${escHtml(providerLabel(m.provider))} · ${escHtml(m.id)}"><strong>${escHtml(m.name || m.id)}</strong>${modelIdSubtitle(m)}</td>
        <td><span class="tp-elo-num">${textEloTxt}</span></td>
        <td><span class="tp-elo-num">${codeEloTxt}</span></td>
        <td><div class="mini-badges">${caps}</div></td>
        <td class="react-cell">${reactHtml}</td>
        <td style="text-align:right; white-space:nowrap;"></td>
      `;

      const opsCell = tr.lastElementChild;
      const pingBtn = document.createElement('button');
      pingBtn.className = 'btn-tp-ping';
      pingBtn.textContent = 'PING';
      pingBtn.title = 'Tier 1 latency reaction ping (1 token)';
      pingBtn.onclick = () => pingModel(m, pingBtn, tr.querySelector('.react-cell'));

      const infoBtn = document.createElement('button');
      infoBtn.className = 'btn-tp-info';
      infoBtn.textContent = 'INFO';
      infoBtn.onclick = () => { currentModel = { id: m.id, provider: m.provider }; openModelInfoModal(); };

      opsCell.append(pingBtn, infoBtn);
      tbody.appendChild(tr);
    }

    container.appendChild(block);
  }
}

function toggleProviderTable(prov) {
  const body = document.getElementById(`body-${prov}`);
  const arrow = document.getElementById(`arrow-${prov}`);
  if (!body) return;
  const nextCollapsed = body.style.display !== 'none';
  setProviderTableCollapsed(prov, nextCollapsed);
  applyProviderTableCollapsedState(prov, body, arrow);
}

async function toggleEntireProvider(provider, enable) {
  const provModels = models.filter(x => x.provider === provider);
  provModels.forEach(m => { m.enabled = enable; m.disabled = !enable; });
  try {
    await fetch('/api/models/bulk-toggle', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, enable, modelIds: provModels.map(m => `${m.provider}::${m.id}`) })
    });
    populateModelSelect();
    renderModelCenter();
  } catch(e) {}
}

async function toggleModelEnabled(provider, id, isChecked) {
  const m = models.find(x => x.provider === provider && x.id === id);
  if (m) { m.enabled = isChecked; m.disabled = !isChecked; }
  try {
    await fetch('/api/models/toggle', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, id, enabled: isChecked })
    });
    populateModelSelect();
    renderModelCenter();
  } catch(e) {}
}

async function bulkToggleFiltered(enable) {
  const filtered = models.filter(m => modelMatchesCenterFilter(m));
  if (!filtered.length) return;
  filtered.forEach(m => { m.enabled = enable; m.disabled = !enable; });
  try {
    await fetch('/api/models/bulk-toggle', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'all', enable, modelIds: filtered.map(m => `${m.provider}::${m.id}`) })
    });
    populateModelSelect();
    renderModelCenter();
  } catch(e) {}
}

async function pingModel(m, btn, reactCell) {
  if (!m) return;
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = 'PING…';
  if (reactCell) reactCell.innerHTML = '<span class="tp-status-dim">▪ PING…</span>';
  try {
    const r = await fetch('/api/models/probe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: m.provider, model: m.id, tier: 'ping' })
    });
    const result = await r.json();
    modelProbes[modelKey(m.provider, m.id)] = result;
    m.probe = result;
    if (reactCell) {
      reactCell.innerHTML = result.status === 'pass' || result.pingStatus === 'ok'
        ? `<span class="tp-status-ok">▪ PONG (${result.pingMs || 22}MS)</span>`
        : `<span class="tp-status-err">× ERR</span>`;
    }
  } catch(e) {
    if (reactCell) reactCell.innerHTML = `<span class="tp-status-err">× FAIL</span>`;
  } finally { btn.disabled = false; btn.textContent = old; }
}

async function probeModel(m, btn) {
  if (!m || !m.id || !m.provider) return;
  const old = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'BENCH…'; }
  try {
    const r = await fetch('/api/models/probe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: m.provider, model: m.id, tier: 'benchmark' })
    });
    if (!r.ok) throw new Error(await apiErrorMessage(r, 'Benchmark failed'));
    const result = await r.json();
    modelProbes[modelKey(m.provider, m.id)] = result;
    m.probe = result;
    populateModelSelect();
    renderModelCenter();
  } catch(e) {}
  finally { if (btn) { btn.disabled = false; btn.textContent = old || 'BENCHMARK'; } }
}

async function loadModelProbes() {
  try {
    const r = await fetch('/api/model-probes');
    if (r.ok) modelProbes = await r.json();
  } catch { modelProbes = {}; }
}

function getEvolveModel() {
  const assigned = typeof getAssignedRoleModel === 'function' ? getAssignedRoleModel('planner') : null;
  if (assigned) return { id: assigned.id, provider: assigned.provider };
  const val = document.getElementById('evolve-model-select')?.value;
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}

async function checkOllama() {
  const dot = document.getElementById('ollama-dot');
  const txt = document.getElementById('ollama-status-text');
  if (!dot || !txt) return;
  const localModels = models.filter(m => m.provider === 'ollama');
  if (localModels.length > 0) {
    dot.className = 'status-dot online';
    txt.textContent = `Ollama online — ${localModels.length} local models ready`;
  } else {
    dot.className = 'status-dot offline';
    txt.textContent = 'Ollama running or offline.';
  }
}

function currentModelObject() {
  if (!currentModel) return null;
  return models.find(m => m.id === currentModel.id && m.provider === currentModel.provider) || currentModel;
}

function yesNoBadge(label, value) {
  return `<span class="model-cap ${value ? 'yes' : 'no'}">${value ? '✓' : '–'} ${escHtml(label)}</span>`;
}
