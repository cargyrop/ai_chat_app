/* ARKEL — models actions (split from models.js, Phase 1B)
   Provider toggle, model toggle, ping/probe, collapse, Ollama check. */

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
