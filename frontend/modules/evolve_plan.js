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
