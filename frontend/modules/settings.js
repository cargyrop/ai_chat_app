/* BLACKLINE AI — settings module (Phase 2 + Endpoint management) */

let lastTestedEndpoint = null;
let addedEndpointsList = [];

function makeEndpointInstanceId(providerType) {
  if (providerType === 'ollama') return 'ollama';
  const clean = String(providerType || 'endpoint').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'endpoint';
  return `${clean}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function onEndpointProviderChange() {
  const sel = document.getElementById('endpoint-provider');
  const urlIn = document.getElementById('endpoint-url');
  if (!sel || !urlIn) return;
  const opt = sel.options[sel.selectedIndex];
  const defaultUrl = opt?.getAttribute('data-url') || '';
  if (defaultUrl) urlIn.value = defaultUrl;
  const addBtn = document.getElementById('endpoint-add-btn');
  if (addBtn) addBtn.disabled = true;
  const status = document.getElementById('endpoint-status-line');
  if (status) status.innerHTML = '<span class="status-offline">Offline</span> — enter API key and click Test to discover models';
}

async function testEndpoint() {
  const providerSel = document.getElementById('endpoint-provider');
  const urlIn = document.getElementById('endpoint-url');
  const keyIn = document.getElementById('endpoint-key');
  const testBtn = document.getElementById('endpoint-test-btn');
  const addBtn = document.getElementById('endpoint-add-btn');
  const status = document.getElementById('endpoint-status-line');

  if (!providerSel || !urlIn || !keyIn) return;
  const id = providerSel.value;
  const label = providerSel.options[providerSel.selectedIndex]?.text || id;
  const baseUrl = urlIn.value.trim();
  const apiKey = keyIn.value.trim();
  const category = 'All';

  if (!apiKey) {
    toast('Please enter an API key first', 'err');
    return;
  }

  if (testBtn) { testBtn.disabled = true; testBtn.textContent = 'Testing…'; }
  if (status) status.innerHTML = '<span class="status-offline testing-status">Testing…</span> querying provider API';

  try {
    const r = await fetch('/api/endpoints/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: id, baseUrl, apiKey, category })
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || 'Connection failed');

    lastTestedEndpoint = {
      id: makeEndpointInstanceId(id),
      providerType: id,
      label,
      baseUrl,
      apiKey,
      category,
      models: data.models || [],
      disabledModels: []
    };

    if (addBtn) addBtn.disabled = false;
    const previewTxt = (data.preview || []).slice(0, 4).join(', ');
    if (status) {
      status.innerHTML = `<span class="status-online">Online</span> — found ${data.count} models: ${escHtml(previewTxt)}${data.count > 4 ? ', ...' : ''}`;
    }
    toast(`Successfully discovered ${data.count} models! Click Add.`, 'ok');
  } catch (err) {
    lastTestedEndpoint = null;
    if (addBtn) addBtn.disabled = true;
    if (status) {
      status.innerHTML = `<span class="status-offline">Offline</span> — error: ${escHtml(err.message)}`;
    }
    toast('Test failed: ' + err.message, 'err');
  } finally {
    if (testBtn) { testBtn.disabled = false; testBtn.textContent = 'Test'; }
  }
}

async function testLocalEndpoint() {
  toast('Checking local Ollama instance…', 'ok');
  try {
    const r = await fetch('/api/endpoints/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', apiKey: 'none' })
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || 'Ollama not detected');

    await fetch('/api/endpoints', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'ollama', providerType: 'ollama', label: 'Local (Ollama)', icon: '◌',
        baseUrl: 'http://127.0.0.1:11434', apiKey: 'local',
        category: 'All', models: data.models || [], disabledModels: []
      })
    });
    modelCenterFilter = 'all';
    toast(`Ollama connected! Discovered ${data.count} local models.`, 'ok');
    await renderAddedEndpoints();
    await loadModels();
  } catch (err) {
    toast('Local check failed: Is Ollama running? ' + err.message, 'err');
  }
}

async function addEndpoint() {
  if (!lastTestedEndpoint) {
    toast('Please test the endpoint successfully before adding.', 'err');
    return;
  }
  const addBtn = document.getElementById('endpoint-add-btn');
  const keyIn = document.getElementById('endpoint-key');
  if (addBtn) { addBtn.disabled = true; addBtn.textContent = 'Adding…'; }

  try {
    const r = await fetch('/api/endpoints', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lastTestedEndpoint)
    });
    if (!r.ok) throw new Error('Failed to save endpoint');

    if (keyIn) keyIn.value = '';
    toast(`${lastTestedEndpoint.label} added! Models unlocked.`, 'ok');
    lastTestedEndpoint = null;
    if (addBtn) { addBtn.disabled = true; addBtn.textContent = 'Add'; }
    const status = document.getElementById('endpoint-status-line');
    if (status) status.innerHTML = '<span class="status-offline">Offline</span> — enter API key and click Test to discover models';

    modelCenterFilter = 'all';
    await renderAddedEndpoints();
    await loadModels();
  } catch (err) {
    toast('Add endpoint failed: ' + err.message, 'err');
    if (addBtn) { addBtn.disabled = false; addBtn.textContent = 'Add'; }
  }
}

async function renderAddedEndpoints() {
  const container = document.getElementById('endpoint-added-list');
  if (!container) return;

  try {
    const r = await fetch('/api/endpoints');
    if (r.ok) addedEndpointsList = await r.json();
  } catch {}

  if (!addedEndpointsList || !addedEndpointsList.length) {
    container.innerHTML = '<div class="endpoint-empty-hint">No endpoints added yet. Select a provider above, test, and click Add.</div>';
    return;
  }

  container.innerHTML = '';
  for (const ep of addedEndpointsList) {
    const card = document.createElement('div');
    card.className = 'endpoint-card';
    const enabledCount = ep.enabledModels ?? ep.totalModels;
    const isEnabled = ep.enabled !== false;

    card.innerHTML = `
      <div class="endpoint-card-main">
        <div class="endpoint-card-info" data-action="toggle-endpoint-models" data-endpoint-id="${escHtml(ep.id)}">
          <div class="endpoint-card-title">
            <span class="globe-icon">${escHtml(ep.icon || '🌐')}</span>
            <strong class="provider-name">${escHtml(ep.label)}</strong>
            <span class="models-badge ${isEnabled ? 'enabled' : ''}">${isEnabled ? `${enabledCount}/${ep.totalModels} models enabled` : 'DISABLED'}</span>
          </div>
          <div class="endpoint-card-subtitle">
            <span>${escHtml(ep.baseUrl)} (${ep.keySet ? 'key set' : 'no key'})</span>
            <span class="click-manage-hint">Click to manage models</span>
          </div>
        </div>
        <div class="endpoint-card-actions">
          <button class="btn-endpoint-disable" data-action="toggle-endpoint-status" data-endpoint-id="${escHtml(ep.id)}">${isEnabled ? 'Disable' : 'Enable'}</button>
          <button class="btn-endpoint-delete" data-action="delete-endpoint" data-endpoint-id="${escHtml(ep.id)}">Delete</button>
          <button class="btn-endpoint-expand" data-action="toggle-endpoint-models" data-endpoint-id="${escHtml(ep.id)}">˅</button>
        </div>
      </div>
      <div class="endpoint-models-drawer" id="drawer-${escHtml(ep.id)}">
        <div class="drawer-toolbar">
          <div class="drawer-bulk">
            <button data-action="set-all-endpoint-models" data-endpoint-id="${escHtml(ep.id)}" data-enable="true">Enable All</button>
            <button data-action="set-all-endpoint-models" data-endpoint-id="${escHtml(ep.id)}" data-enable="false">Disable All</button>
          </div>
        </div>
        <div class="drawer-models-grid" id="grid-${escHtml(ep.id)}"></div>
      </div>
    `;
    container.appendChild(card);

    card.querySelectorAll('[data-action="toggle-endpoint-models"]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.endpoint-card-actions button')) e.stopPropagation();
        toggleEndpointModels(ep.id);
      });
    });
    card.querySelector('[data-action="toggle-endpoint-status"]')?.addEventListener('click', () => toggleEndpointStatus(ep.id));
    card.querySelector('[data-action="delete-endpoint"]')?.addEventListener('click', () => deleteEndpoint(ep.id));
    card.querySelectorAll('[data-action="set-all-endpoint-models"]').forEach(btn => {
      btn.addEventListener('click', () => setAllEndpointModels(ep.id, btn.dataset.enable === 'true'));
    });

    renderDrawerGrid(ep, '');
  }
}

function renderDrawerGrid(ep, filterQuery) {
  const grid = document.getElementById(`grid-${ep.id}`);
  if (!grid) return;
  grid.innerHTML = '';
  const q = (filterQuery || '').toLowerCase();
  const models = (ep.models || []).filter(m => !q || (m.name || m.id).toLowerCase().includes(q));

  for (const m of models) {
    const isChecked = !(ep.disabledModels || []).includes(m.id);
    const item = document.createElement('label');
    item.className = 'drawer-model-item';
    item.innerHTML = `
      <input type="checkbox" ${isChecked ? 'checked' : ''} />
      <span>${escHtml(m.name || m.id)}</span>
    `;
    const checkbox = item.querySelector('input');
    if (checkbox) checkbox.addEventListener('change', () => toggleSingleEndpointModel(ep.id, m.id, checkbox.checked));
    grid.appendChild(item);
  }
}

function filterDrawerModels(id, q) {
  const ep = addedEndpointsList.find(x => x.id === id);
  if (ep) renderDrawerGrid(ep, q);
}

function toggleEndpointModels(id) {
  const drawer = document.getElementById(`drawer-${id}`);
  if (!drawer) return;
  drawer.style.display = drawer.style.display !== 'block' ? 'block' : 'none';
}

async function toggleEndpointStatus(id) {
  try {
    const r = await fetch(`/api/endpoints/${encodeURIComponent(id)}/toggle`, { method: 'PUT' });
    if (r.ok) {
      toast('Endpoint status updated', 'ok');
      await renderAddedEndpoints();
      await loadModels();
    }
  } catch(e) { toast('Error toggling endpoint: ' + e.message, 'err'); }
}

async function deleteEndpoint(id) {
  if (!confirm('Remove this endpoint and its models?')) return;
  try {
    const r = await fetch(`/api/endpoints/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (r.ok) {
      toast('Endpoint removed', 'ok');
      await renderAddedEndpoints();
      await loadModels();
    }
  } catch(e) { toast('Error deleting endpoint: ' + e.message, 'err'); }
}

async function setAllEndpointModels(id, enable) {
  const ep = addedEndpointsList.find(x => x.id === id);
  if (!ep) return;
  const disabledModels = enable ? [] : (ep.models || []).map(m => m.id);
  try {
    const r = await fetch(`/api/endpoints/${encodeURIComponent(id)}/models`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabledModels })
    });
    if (r.ok) {
      ep.disabledModels = disabledModels;
      ep.enabledModels = enable ? (ep.models || []).length : 0;
      await renderAddedEndpoints();
      await loadModels();
    }
  } catch(e) { toast('Error updating models: ' + e.message, 'err'); }
}

async function toggleSingleEndpointModel(id, modelId, isChecked) {
  const ep = addedEndpointsList.find(x => x.id === id);
  if (!ep) return;
  let disabledModels = [...(ep.disabledModels || [])];
  if (isChecked) {
    disabledModels = disabledModels.filter(x => x !== modelId);
  } else if (!disabledModels.includes(modelId)) {
    disabledModels.push(modelId);
  }
  try {
    await fetch(`/api/endpoints/${encodeURIComponent(id)}/models`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabledModels })
    });
    ep.disabledModels = disabledModels;
    ep.enabledModels = (ep.models || []).length - disabledModels.length;
    const card = document.getElementById(`drawer-${id}`)?.previousElementSibling;
    const badge = card?.querySelector('.models-badge');
    if (badge) badge.textContent = `${ep.enabledModels}/${ep.totalModels} models enabled`;
    loadModels();
  } catch(e) { toast('Error updating model: ' + e.message, 'err'); }
}

async function buildKeysList() { await renderAddedEndpoints(); }
async function loadCustomProviderPresets() {
  try {
    const r = await fetch('/api/custom-provider-presets');
    customProviderPresets = r.ok ? await r.json() : [];
  } catch { customProviderPresets = []; }
}
function applyCustomProviderPreset() {}
async function saveKey() {}
async function deleteKey() {}
async function buildCustomProvidersList() { await renderAddedEndpoints(); }
async function saveCustomProvider() {}
async function deleteCustomProvider() {}
