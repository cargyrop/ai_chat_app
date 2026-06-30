/* BLACKLINE AI — evolve_plan module (Phase 2) */

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
    <div class="plan-investigation-title">INVESTIGATION REQUIRED</div>
    <div class="plan-investigation-desc">Some files failed while others were applied.</div>
    <button class="btn-primary investigate-btn" type="button">INVESTIGATE FAILED EDITS</button>
  </div>`;
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
        <button class="btn-primary" data-action="approve-plan" data-plan-id="${planId}">APPROVE & EXECUTE</button>
        <button class="btn-secondary" data-action="reject-plan" data-plan-id="${planId}">REJECT</button>
      </div>`;

  div.innerHTML = `<div class="evolve-msg-bubble" data-plan-id="${planId}">
    <div class="plan-proposed-title">PROPOSED PLAN</div>
    <div class="plan-proposed-desc">
      Review the changes below. Click <strong class="plan-text-accent">APPROVE & EXECUTE</strong> to start.
    </div>
    ${plan.map(p => `
      <div class="plan-change-card">
        <div class="plan-change-header">
          <span class="plan-change-action">${escHtml(p.action || 'edit')}</span>
          <span class="plan-change-path">${escHtml(p.path)}</span>
        </div>
        <div class="plan-change-desc">${escHtml(p.description || '')}</div>
      </div>
    `).join('')}
    ${stateHtml}
  </div>`;
  container.appendChild(div);
  const approveBtn = div.querySelector('[data-action="approve-plan"]');
  if (approveBtn) approveBtn.addEventListener('click', () => approvePlan(planId));
  const rejectBtn = div.querySelector('[data-action="reject-plan"]');
  if (rejectBtn) rejectBtn.addEventListener('click', () => rejectPlan(planId));
  container.scrollTop = container.scrollHeight;
}
