/* BLACKLINE AI — model role matrix */

const MODEL_ROLE_DEFS = [
  {
    id: 'planner', label: 'Planner', requiredFor: 'Evolve planning chat',
    description: 'Understands the request, chooses the safest approach, and proposes the high-level update.',
    minChatElo: 1250, minCodeElo: 1200, weights: { chat: 0.55, code: 0.45 }
  },
  {
    id: 'executor', label: 'Executor', requiredFor: 'Approved Evolve execution',
    description: 'Generates exact per-file edits with a clean context for each task.',
    minChatElo: 1150, minCodeElo: 1250, weights: { chat: 0.25, code: 0.75 }
  },
  {
    id: 'reviewer', label: 'Reviewer', requiredFor: 'Future review loops',
    description: 'Reviews diffs and explains whether the change matches the intent.',
    minChatElo: 1250, minCodeElo: 1200, weights: { chat: 0.5, code: 0.5 }
  },
  {
    id: 'repair', label: 'Repair Agent', requiredFor: 'Future automatic repair loops',
    description: 'Investigates failed patches/tests and attempts a focused repair.',
    minChatElo: 1150, minCodeElo: 1250, weights: { chat: 0.35, code: 0.65 }
  },
  {
    id: 'micro', label: 'Micro Editor', requiredFor: 'Future tiny deterministic edits',
    description: 'Handles very small scoped edits when a large planner has already found the file.',
    minChatElo: 1050, minCodeElo: 1100, weights: { chat: 0.2, code: 0.8 }
  },
];

function roleModelValue(m) { return JSON.stringify({ provider: m.provider, id: m.id }); }
function roleModelKeyFromParts(provider, id) { return `${provider}::${id}`; }
function roleModelKeyFromValue(value) {
  try { const parsed = JSON.parse(value || '{}'); return roleModelKeyFromParts(parsed.provider, parsed.id); }
  catch { return ''; }
}

function enabledRoleModels() { return models.filter(isModelSelectable); }
function roleModelByValue(value) {
  const key = roleModelKeyFromValue(value);
  if (!key) return null;
  return enabledRoleModels().find(m => roleModelKeyFromParts(m.provider, m.id) === key) || null;
}

function roleElo(m, kind) {
  if (!m?.arena?.matched) return 0;
  if (typeof arenaEloValue === 'function') return arenaEloValue(m, kind) || 0;
  if (kind === 'chat') return m.arena?.chatElo || m.arena?.textElo || 0;
  return m.arena?.codeElo || m.arena?.codingElo || 0;
}

function roleSuitabilityScore(m, roleDef) {
  const chat = roleElo(m, 'chat') || 1000;
  const code = roleElo(m, 'code') || 1000;
  const weighted = (chat * roleDef.weights.chat) + (code * roleDef.weights.code);
  const contextBonus = m.capabilities?.longContext ? 30 : 0;
  const jsonPenalty = m.capabilities?.jsonMode === false ? 80 : 0;
  const localSmallPenalty = /(^|[^0-9])3b|7b|8b/i.test(`${m.id} ${m.name}`) ? 120 : 0;
  return Math.round(weighted + contextBonus - jsonPenalty - localSmallPenalty);
}

function isSuitableForRole(m, roleDef) {
  return roleElo(m, 'chat') >= roleDef.minChatElo && roleElo(m, 'code') >= roleDef.minCodeElo;
}

function bestModelForRole(roleDef) {
  const candidates = enabledRoleModels()
    .filter(m => isSuitableForRole(m, roleDef))
    .sort((a, b) => roleSuitabilityScore(b, roleDef) - roleSuitabilityScore(a, roleDef));
  return candidates[0] || null;
}

function saveModelRoles() { localStorage.setItem('modelRoles', JSON.stringify(modelRoles)); }

function autoAssignModelRoles(force = false) {
  for (const role of MODEL_ROLE_DEFS) {
    const current = roleModelByValue(modelRoles[role.id]);
    if (!force && current) continue;
    const best = bestModelForRole(role);
    if (best) modelRoles[role.id] = roleModelValue(best);
    else delete modelRoles[role.id];
  }
  saveModelRoles();
  populateEvolveModelSelect();
  renderEvolveRoleSummary();
}

function clearModelRoles() {
  if (!confirm('Clear all model role assignments?')) return;
  modelRoles = {};
  saveModelRoles();
  populateEvolveModelSelect();
  renderEvolveRoleSummary();
  renderModelRoles();
}

function roleOptionText(m, roleDef, recommendedValue) {
  const tag = roleModelValue(m) === recommendedValue ? ' ★ recommended' : '';
  return `${providerLabel(m.provider)} · ${m.name || m.id} — Chat ${roleElo(m, 'chat') || '?'} / Code ${roleElo(m, 'code') || '?'}${tag}`;
}

function setModelRole(roleId, value) {
  if (value) modelRoles[roleId] = value;
  else delete modelRoles[roleId];
  saveModelRoles();
  populateEvolveModelSelect();
  renderEvolveRoleSummary();
  renderModelRoles();
}

function roleSummaryText(roleId) {
  const role = MODEL_ROLE_DEFS.find(r => r.id === roleId);
  const model = getAssignedRoleModel(roleId);
  return `${role?.label || roleId}: ${model ? `${providerLabel(model.provider)} · ${model.name || model.id}` : 'not assigned'}`;
}

function renderEvolveRoleSummary() {
  const el = document.getElementById('evolve-role-summary');
  if (!el) return;
  const planner = roleSummaryText('planner');
  const executor = roleSummaryText('executor');
  el.innerHTML = `<span>${escHtml(planner)}</span><span>${escHtml(executor)}</span><button type="button" data-action="open-roles-panel">Change in Role Matrix</button>`;
  const btn = el.querySelector('[data-action="open-roles-panel"]');
  if (btn) btn.addEventListener('click', () => showPanel('roles'));
}

function renderModelRoles() {
  const container = document.getElementById('role-matrix-list');
  if (!container) return;
  const enabled = enabledRoleModels();
  if (!enabled.length) {
    container.innerHTML = '<div class="role-empty">No enabled models available. Enable models in Model Hub first.</div>';
    return;
  }

  container.innerHTML = '';
  for (const role of MODEL_ROLE_DEFS) {
    const best = bestModelForRole(role);
    const recommendedValue = best ? roleModelValue(best) : '';
    const selected = roleModelByValue(modelRoles[role.id]) ? modelRoles[role.id] : '';
    const sorted = [...enabled].sort((a, b) => roleSuitabilityScore(b, role) - roleSuitabilityScore(a, role));
    const activeNow = ['planner', 'executor'].includes(role.id);
    const card = document.createElement('div');
    card.className = `role-card ${activeNow ? 'active-role' : 'future-role'}`;
    card.innerHTML = `
      <div class="role-card-copy">
        <div class="role-card-title">${escHtml(role.label)}</div>
        <div class="role-card-desc">${escHtml(role.description)}</div>
        <div class="role-card-meta">${activeNow ? 'Required now' : 'Reserved for upcoming agentic loops'}: ${escHtml(role.requiredFor)} · Minimum auto-pick: Chat ${role.minChatElo}, Code ${role.minCodeElo}</div>
        <div class="role-card-rec">${best ? `Recommended: ${escHtml(providerLabel(best.provider))} · ${escHtml(best.name || best.id)}` : '<span class="role-warning">No suitable auto recommendation from enabled models.</span>'}</div>
      </div>
      <div class="role-card-control">
        <select class="role-select" aria-label="${escHtml(role.label)} model" data-role-id="${escHtml(role.id)}">
          <option value="">— No model assigned —</option>
          ${sorted.map(m => `<option value="${escHtml(roleModelValue(m))}" ${roleModelValue(m) === selected ? 'selected' : ''}>${escHtml(roleOptionText(m, role, recommendedValue))}</option>`).join('')}
        </select>
      </div>`;
    container.appendChild(card);
    const select = card.querySelector('.role-select');
    if (select) select.addEventListener('change', () => setModelRole(role.id, select.value));
  }
}

function getAssignedRoleModel(roleId) {
  return roleModelByValue(modelRoles[roleId]);
}

function requireModelRole(roleId, workflowName) {
  const role = MODEL_ROLE_DEFS.find(r => r.id === roleId);
  const model = getAssignedRoleModel(roleId);
  if (model) return { id: model.id, provider: model.provider };
  toast(`${workflowName} requires a ${role?.label || roleId} model. Open Role Matrix and assign one.`, 'err');
  showPanel('roles');
  return null;
}

function assignPlannerFromEvolveSelect() {
  const value = document.getElementById('evolve-model-select')?.value || '';
  setModelRole('planner', value);
}
