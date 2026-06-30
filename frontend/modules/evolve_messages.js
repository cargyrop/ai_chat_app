/* BLACKLINE AI — evolve_messages module (Phase 2) */

function parseJsonMaybe(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  try { return JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')); } catch {}
  return null;
}

function extractBalancedJsonSnippet(text, startIndex) {
  const raw = String(text || '');
  const first = raw[startIndex];
  if (first !== '{' && first !== '[') return '';
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let i = startIndex; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return '';
      if (stack.length === 0) return raw.slice(startIndex, i + 1);
    }
  }
  return '';
}

function parseJsonCandidateText(text) {
  const raw = String(text || '').replace(/\s*<think>[\s\S]*?<\/think>\s*/gi, '').trim();
  const out = [];
  const seen = new Set();
  const push = (snippet) => {
    const clean = String(snippet || '').trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    const value = parseJsonMaybe(clean);
    if (value !== null) out.push({ value, snippet: clean });
  };
  push(raw);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '{' && raw[i] !== '[') continue;
    const snippet = extractBalancedJsonSnippet(raw, i);
    if (snippet) push(snippet);
  }
  return out;
}

function normalizeEvolvePlanCandidate(candidate) {
  const arrays = [];
  if (Array.isArray(candidate)) arrays.push(candidate);
  else if (candidate && typeof candidate === 'object') {
    if (candidate.path || candidate.file || candidate.filename || candidate.filePath || candidate.file_path) arrays.push([candidate]);
    for (const key of ['plan', 'actions', 'files', 'changes']) {
      if (Array.isArray(candidate[key])) arrays.push(candidate[key]);
    }
  }

  for (const arr of arrays) {
    const normalized = arr
      .filter(item => item && typeof item === 'object')
      .map(item => {
        const rawPath = item.path || item.file || item.filename || item.filePath || item.file_path;
        if (typeof rawPath !== 'string' || !rawPath.trim()) return null;
        let action = String(item.action || 'edit').toLowerCase().trim();
        if (!['create', 'edit', 'delete'].includes(action)) action = 'edit';
        return {
          ...item,
          path: rawPath.trim(),
          action,
          description: typeof item.description === 'string'
            ? item.description
            : (typeof item.change === 'string' ? item.change : '')
        };
      })
      .filter(Boolean);
    if (normalized.length) return normalized;
  }
  return null;
}

function extractEvolvePlans(content) {
  let cleanContent = String(content || '');
  const foundPlans = [];
  const seenPlans = new Set();
  const planContains = (larger, smaller) => smaller.every(item =>
    larger.some(existing => existing.path === item.path && existing.action === item.action)
  );
  const acceptCandidate = (candidate, sourceText) => {
    const plan = normalizeEvolvePlanCandidate(candidate);
    if (!plan) return false;
    // Some models output a valid array and our balanced-JSON scanner can also
    // see each object inside that array. Keep the broad plan and suppress the
    // nested single-file duplicates so users get exactly one approval card.
    if (foundPlans.some(existing => planContains(existing, plan))) return true;
    for (let i = foundPlans.length - 1; i >= 0; i--) {
      if (planContains(plan, foundPlans[i])) foundPlans.splice(i, 1);
    }
    const key = JSON.stringify(plan);
    if (seenPlans.has(key)) return true;
    seenPlans.add(key);
    foundPlans.push(plan);
    if (sourceText) cleanContent = cleanContent.replace(sourceText, '');
    return true;
  }; 

  const codeBlockRegex = /```([\w-]*)\s*\n?([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const tag = String(match[1] || '').toLowerCase();
    if (tag && !['plan', 'json', 'javascript', 'js'].includes(tag)) continue;
    let matchedPlan = false;
    for (const parsed of parseJsonCandidateText(match[2])) {
      if (acceptCandidate(parsed.value, null)) {
        matchedPlan = true;
        break;
      }
    }
    if (matchedPlan) cleanContent = cleanContent.replace(match[0], '');
  }

  if (!foundPlans.length) {
    for (const parsed of parseJsonCandidateText(content)) {
      acceptCandidate(parsed.value, parsed.snippet);
    }
  }

  if (foundPlans.length > 1) {
    const merged = [];
    for (const plan of foundPlans) {
      for (const item of plan) {
        if (!merged.some(existing => existing.path === item.path && existing.action === item.action)) merged.push(item);
      }
    }
    return { plans: merged.length ? [merged] : [], content: cleanContent.trim() };
  }

  return { plans: foundPlans, content: cleanContent.trim() };
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
    const extracted = extractEvolvePlans(content);
    cleanContent = extracted.content;
    foundPlans = extracted.plans;
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

function appendEvolveLoading(modelName) {
  const container = document.getElementById('evolve-messages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'evolve-msg assistant';
  div.id = 'evolve-loading-msg';
  div.innerHTML = `<div class="evolve-msg-bubble"><div class="action-ticker"><span class="ticker-spinner">▪</span><span>${escHtml(modelName)} is thinking…</span></div></div>`;
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

function renderEvolveMessages() {
  const container = document.getElementById('evolve-messages');
  if (!container) return;
  container.innerHTML = '';
  if (!Array.isArray(evolveMessages) || evolveMessages.length === 0) {
    container.innerHTML = `
      <div class="evolve-empty-state" id="evolve-empty-state">
        <div class="hero" aria-hidden="true">⬡</div>
        <h3>Plan safe app improvements</h3>
        <p>Assign Planner and Executor in Role Matrix, describe one clear change, review the generated plan, then approve it to execute.</p>
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

function saveEvolveMessages() {
  try {
    const MAX = 200;
    while (evolveMessages.length > MAX) evolveMessages.shift();
    localStorage.setItem('evolveMessages', JSON.stringify(evolveMessages));
  } catch(e) { toast('Could not save Evolve chat locally: ' + e.message, 'err'); }
}
