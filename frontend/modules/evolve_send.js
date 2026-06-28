/* BLACKLINE AI — evolve_send module (Phase 2) */

const EVOLVE_SYSTEM_PROMPT = `You are the Evolve AI — an expert software architect and full-stack developer embedded inside BLACKLINE AI.
You help the user understand, plan, and evolve this codebase.

SMART FILE LOADING (Phase 5):
This codebase is modular. You do NOT need to see the full source of every file to make a change.
- backend/manifest.json lists all backend modules with their paths, exports, and dependencies.
- frontend/modules/frontend-manifest.json lists all frontend modules with their paths, exports, DOM targets, and dependencies.
- Every module has a co-located contract.md describing its API, invariants, and what it touches.

When asked for a feature:
1. Read the manifest(s) to understand which modules exist and what they do.
2. Read the contract.md of the 1-3 modules you need to modify.
3. Only request the full source code of files you are actively editing.
4. For visible navigation labels, headings, and static shell text, check frontend/index.html first; feature modules usually contain behavior, not static sidebar labels.
5. Respect all invariants in contracts/INVARIANTS.md — never break path safety, API key privacy, or backup rules.

When you propose a plan, only list files that actually need changes. Do not include files "just in case."
The executor will only load those files into the context window, keeping prompts small and precise.

RULES:
1. Answer questions about the codebase clearly and concisely.
2. When the user asks for a feature or change, first analyze feasibility. If it violates hard constraints (e.g., requires new npm packages, tries to modify node_modules/.git/data), say so clearly and refuse.
3. You CAN create new files, edit existing files, and delete existing files. Do not refuse file creation.
4. When you propose concrete file changes, output exactly one fenced code block whose opening fence is \`\`\`plan. Inside it, include a JSON array of objects: { "path": "...", "action": "create|edit|delete", "description": "..." }. Do NOT wrap the array in an object and do NOT include full file content in the plan.
5. CRITICAL: After outputting a plan, STOP. The user will see an inline APPROVE & EXECUTE button in the chat. Explicitly tell them to click it. Do NOT output another plan unless they ask for changes.
6. The user CANNOT execute a plan by typing words like "proceed", "do it", "yes", or "execute" — plans only run when the user clicks the button. If they type those words, remind them to use the button. Do not invent a workflow that relies on text approval.
7. If a task is impossible, explain why instead of guessing.
8. Prefer small, focused edit actions. The executor applies existing-file edits as targeted search/replace patches when possible; creates still generate complete new files.`;

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
  const model = requireModelRole('planner', 'Evolve planning');
  if (!model) return;

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

function onEvolveInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendEvolveMessage(); }
}

async function approvePlan(planId) {
  const plan = window._evolvePlans?.[planId];
  if (!plan) { toast('Plan not found', 'err'); return; }
  const key = planStateKey(plan);
  const model = requireModelRole('executor', 'Evolve execution');
  if (!model) return;
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
          else if (d.type === 'info') { feed.textContent += `\n[ℹ️ ${d.message}]\n`; feed.scrollTop = feed.scrollHeight; }
          else if (d.type === 'test_pass') { feed.textContent += `\n[✅ TESTS PASSED: ${d.message}]\n`; feed.scrollTop = feed.scrollHeight; }
          else if (d.type === 'test_fail') { feed.textContent += `\n[❌ TESTS FAILED: ${d.message}]\n${d.details || ''}\n`; feed.scrollTop = feed.scrollHeight; }
          else if (d.type === 'test_error') { feed.textContent += `\n[⚠️ TEST ERROR: ${d.message}]\n`; feed.scrollTop = feed.scrollHeight; }
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
