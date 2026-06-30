/* ARKEL — models select (split from models.js, Phase 1B)
   Model selection, select-population, current model, evolve model.
   Note: #model-select may not exist in the DOM (floating panel era).
   loadModels must still fetch and populate data even without it. */

async function loadModels(showToast = false) {
  const sel = document.getElementById('model-select');
  const previousVal = sel ? sel.value : (currentModel ? JSON.stringify(currentModel) : '');
  const refreshBtn = document.getElementById('model-refresh-btn');
  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.textContent = 'REFRESHING…'; }
  const center = document.getElementById('model-center-list');
  if (center && showToast) center.innerHTML = '<div class="model-center-empty">Refreshing catalog…</div>';
  if (showToast) toast('Refreshing model catalog…', 'ok');
  if (sel) sel.innerHTML = '<option value="">Loading models…</option>';
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
    // Also refresh any open floating chat panel model selects
    refreshFloatingChatModelSelects();
    if (showToast) toast(`Catalog refreshed: ${models.length} model entries`, 'ok');
  } catch(e) {
    if (sel) sel.innerHTML = '<option value="">Error loading models</option>';
    toast('Could not load models: ' + e.message, 'err');
  } finally {
    if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.textContent = 'REFRESH MODEL CATALOG'; }
  }
}

function populateModelSelect(preferredVal) {
  const sel = document.getElementById('model-select');
  const count = document.getElementById('model-count');

  populateEvolveModelSelect();

  // If no static select, just set currentModel from localStorage and return
  if (!sel) {
    if (count) {
      const selectableModels = models.filter(isModelSelectable);
      count.textContent = `${selectableModels.length}/${models.length} selectable`;
    }
    // Restore currentModel from localStorage if not already set
    if (!currentModel) {
      try {
        const stored = localStorage.getItem('currentModel');
        if (stored) currentModel = JSON.parse(stored);
      } catch {}
    }
    return;
  }

  sel.innerHTML = '';

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
  if (!sel) {
    // No static select — keep currentModel from localStorage or leave as-is
    return;
  }
  const val = sel.value;
  if (!val) { currentModel = null; localStorage.removeItem('currentModel'); return; }
  try {
    currentModel = JSON.parse(val);
    localStorage.setItem('currentModel', val);
  } catch { currentModel = null; }
}

function currentModelObject() {
  if (!currentModel) return null;
  return models.find(m => m.id === currentModel.id && m.provider === currentModel.provider) || currentModel;
}

function getEvolveModel() {
  const assigned = typeof getAssignedRoleModel === 'function' ? getAssignedRoleModel('planner') : null;
  if (assigned) return { id: assigned.id, provider: assigned.provider };
  const val = document.getElementById('evolve-model-select')?.value;
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}

/* Refresh model selects in all open floating chat panels */
function refreshFloatingChatModelSelects() {
  document.querySelectorAll('.fp-chat-model-select').forEach(sel => {
    const prevVal = sel.value;
    populateChatModelSelectGeneric(sel);
    if (prevVal && [...sel.options].some(o => o.value === prevVal)) sel.value = prevVal;
  });
}

/* Populate any model select element with the current models list */
function populateChatModelSelectGeneric(sel) {
  if (!sel) return;
  const selectableModels = models.filter(isModelSelectable);
  sel.innerHTML = '';
  if (selectableModels.length === 0) {
    sel.innerHTML = '<option value="">— No models available —</option>';
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
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  // Set to current global model if available
  if (currentModel) {
    const val = JSON.stringify(currentModel);
    if ([...sel.options].some(o => o.value === val)) sel.value = val;
  }
}
