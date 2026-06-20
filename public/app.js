/* ── State ──────────────────────────────────────────────────────────────────── */
let models = [];
let currentModel = null;
let conversations = loadStoredJson('conversations', []);
if (!Array.isArray(conversations)) conversations = [];
let currentConvId = null;
let systemPrompt = localStorage.getItem('systemPrompt') || '';
let appManifest = null;             // cached GET /api/manifest response
let appManifestString = '';         // pre-formatted codebase context for the Evolve panel
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

/* ── Init ───────────────────────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  renderConvList();
  loadModels();
  buildKeysList();
  checkOllama();
  if (systemPrompt) document.getElementById('system-prompt-input').value = systemPrompt;

  loadAppManifest();
  populateEvolveModelSelect();
  loadFileTree();
  initEvolveResizer();
  renderEvolveMessages();

  // Ctrl/Cmd+Enter support in both chat surfaces
  document.getElementById('msg-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendMessage();
    }
  });
  document.getElementById('evolve-input')?.addEventListener('keydown', onEvolveInputKey);

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
  document.getElementById(name + '-panel').classList.add('visible');
  document.querySelector(`[data-panel="${name}"]`).classList.add('active');

  // Keep each area focused on controls that actually affect it. The top toolbar
  // controls only the main Chat panel; Evolve and Settings have their own controls.
  const toolbar = document.getElementById('toolbar');
  if (toolbar) toolbar.classList.toggle('hidden', name !== 'chat');

  if (name === 'chat') document.getElementById('msg-input')?.focus();
  if (name === 'evolve') {
    document.getElementById('evolve-input')?.focus();
    loadFileTree();
  }
}

/* ── Model loading ──────────────────────────────────────────────────────────── */
async function loadModels() {
  const sel = document.getElementById('model-select');
  sel.innerHTML = '<option value="">Loading models…</option>';
  try {
    const r = await fetch('/api/models');
    if (!r.ok) throw new Error(await apiErrorMessage(r, 'Could not load models'));
    models = await r.json();
    if (!Array.isArray(models)) throw new Error('Model response was not an array');
    populateModelSelect();
    checkOllama();
  } catch(e) {
    sel.innerHTML = '<option value="">Error loading models</option>';
    toast('Could not load models: ' + e.message, 'err');
  }
}

function populateModelSelect() {
  const sel = document.getElementById('model-select');
  const count = document.getElementById('model-count');
  sel.innerHTML = '';

  populateEvolveModelSelect();

  if (models.length === 0) {
    sel.innerHTML = '<option value="" style="background: #1e2030; color: #ffffff;">— Add an API key in Settings —</option>';
    count.textContent = '';
    return;
  }

  const groups = {};
  for (const m of models) {
    if (!groups[m.provider]) groups[m.provider] = [];
    groups[m.provider].push(m);
  }
  for (const [prov, ms] of Object.entries(groups)) {
    const og = document.createElement('optgroup');
    og.label = providerLabel(prov);
    og.style.background = '#11131d';
    og.style.color = '#a5b4fc';
    og.style.fontWeight = '700';
    for (const m of ms) {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ id: m.id, provider: m.provider });
      opt.textContent = `${m.icon || ''} ${m.name}`;
      opt.style.background = '#1e2030';
      opt.style.color = '#ffffff';
      opt.style.padding = '6px';
      opt.style.fontWeight = '600';
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  count.textContent = `${models.length} model${models.length !== 1 ? 's' : ''}`;
  onModelChange();
}


function providerLabel(p) {
  return { anthropic:'Anthropic', openai:'OpenAI', gemini:'Google Gemini', groq:'Groq', openrouter:'OpenRouter', deepseek:'DeepSeek', ollama:'Local (Ollama)' }[p] || p;
}

function onModelChange() {
  const val = document.getElementById('model-select').value;
  if (!val) { currentModel = null; return; }
  try { currentModel = JSON.parse(val); } catch { currentModel = null; }
}

/* ── API Keys UI ────────────────────────────────────────────────────────────── */
async function buildKeysList() {
  const container = document.getElementById('keys-list');
  let savedKeys = {};
  try {
    const r = await fetch('/api/keys');
    if (r.ok) savedKeys = await r.json();
  } catch { /* ignore */ }

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
  }
}

async function saveKey(provider) {
  const input = document.getElementById('key-' + provider);
  const key = input.value.trim();
  if (!key) { toast('Please enter a key first', 'err'); return; }
  try {
    await fetch('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, key }),
    }).then(async r => {
      if (!r.ok) throw new Error(await apiErrorMessage(r, 'Save failed'));
    });
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

/* ── Ollama status ──────────────────────────────────────────────────────────── */
async function checkOllama() {
  const dot = document.getElementById('ollama-dot');
  const txt = document.getElementById('ollama-status-text');
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
    return;
  }
  const { prompt, completion, total } = conv.tokenUsage;
  badge.textContent = `Tokens: ${total.toLocaleString()} (${prompt.toLocaleString()} in / ${completion.toLocaleString()} out)`;
}

function deleteConversation(id, e) {
  e.stopPropagation();
  conversations = conversations.filter(c => c.id !== id);
  saveConversations();
  renderConvList();
  if (currentConvId === id) {
    if (conversations.length) loadConversation(conversations[0].id);
    else newConversation(true);
  }
}

function saveConversations() {
  try {
    localStorage.setItem('conversations', JSON.stringify(conversations));
  } catch(e) {
    toast('Could not save conversations locally: ' + e.message, 'err');
  }
}

function renderConvList() {
  const list = document.getElementById('conv-list');
  list.innerHTML = '';
  for (const c of conversations) {
    const el = document.createElement('div');
    el.className = 'conv-item' + (c.id === currentConvId ? ' active' : '');
    el.innerHTML = `<span class="conv-item-title">${escHtml(c.title)}</span>
      <span class="conv-delete" onclick="deleteConversation('${c.id}', event)">✕</span>`;
    el.onclick = () => loadConversation(c.id);
    list.appendChild(el);
  }
}

function updateConvTitle(id, firstMsg) {
  const conv = conversations.find(c => c.id === id);
  if (!conv || conv.title !== 'New chat') return;
  conv.title = firstMsg.slice(0, 40) + (firstMsg.length > 40 ? '…' : '');
  saveConversations();
  renderConvList();
}

/* ── Rendering messages ─────────────────────────────────────────────────────── */
function renderMessages(msgs) {
  const container = document.getElementById('messages');
  if (!msgs || msgs.length === 0) {
    container.innerHTML = `
      <div id="empty-state">
        <div class="hero">▰</div>
        <h2>Ready to chat</h2>
        <p>Select a model, then send a message. Add API keys in Settings to unlock cloud providers.</p>
        <div class="suggestions">
          <div class="suggestion" onclick="insertSuggestion(this)">Explain quantum computing</div>
          <div class="suggestion" onclick="insertSuggestion(this)">Write a Python script</div>
          <div class="suggestion" onclick="insertSuggestion(this)">Summarize a concept</div>
          <div class="suggestion" onclick="insertSuggestion(this)">Debug my code</div>
        </div>
      </div>`;
    return;
  }
  container.innerHTML = '';
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    const modelInfo = msg.model ? msg.model : null;
    appendMessage(msg.role, msg.content, false, modelInfo, i, msg.thinking, msg.thinkingTime);
  }
  scrollBottom();
}

function appendMessage(role, content, animate = true, model = null, msgIdx = null, thinking = null, thinkingTime = null) {
  const container = document.getElementById('messages');
  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = `message ${role}`;
  if (msgIdx !== null) div.dataset.msgIdx = msgIdx;

  const avatar = role === 'user' ? 'USR' : 'AI';
  let bubbleContent = role === 'assistant' ? formatMd(content) : escHtml(content);

  // Append model label to assistant messages if model info is present
  if (role === 'assistant' && model) {
    const modelName = model.name || model.id || 'Unknown model';
    const providerIcon = model.icon || '';
    bubbleContent += `<span class="model-label">${providerIcon} ${escHtml(modelName)}</span>`;
  }

  // Thinking box (if present)
  let thinkingHtml = '';
  if (role === 'assistant' && thinking && thinking.trim()) {
    thinkingHtml = `
      <div class="thinking-container permanent-thinking">
        <div class="thinking-header" onclick="toggleThinking(this)">
          <div class="thinking-status">
            <span class="thinking-spinner">CPU</span>
            <span class="thinking-title">Real-time Chain of Thought (${thinkingTime ? thinkingTime + 's' : 'Considered'})</span>
          </div>
          <span class="thinking-toggle-btn">▼</span>
        </div>
        <div class="thinking-content">
          <pre><code>${escHtml(thinking.trim())}</code></pre>
        </div>
      </div>`;
  }

  // Action buttons bar
  let actionsHtml = `<div class="msg-actions">`;
  if (role === 'user') {
    actionsHtml += `<button class="msg-action-btn" onclick="copyMsgAction(${msgIdx}, this)">COPY</button>`;
    actionsHtml += `<button class="msg-action-btn" onclick="editMsgAction(${msgIdx})">EDIT</button>`;
  } else if (role === 'assistant') {
    actionsHtml += `<button class="msg-action-btn" onclick="copyMsgAction(${msgIdx}, this)">COPY</button>`;
    actionsHtml += `<button class="msg-action-btn" onclick="regenMsgAction(${msgIdx})">REGEN</button>`;
  }
  actionsHtml += `</div>`;

  div.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
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
  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = 'active-assistant-message';
  div.innerHTML = `<div class="msg-avatar">AI</div>
    <div class="msg-bubble-container" id="active-assistant-container">
      <!-- Live Action Ticker -->
      <div id="live-action-ticker" class="action-ticker">
        <span class="ticker-spinner">⚙️</span>
        <span id="action-ticker-text">Executing: Handshaking with AI provider API...</span>
      </div>

      <!-- Live Real-Time Thoughts Box -->
      <div id="live-thinking-container" class="thinking-container" style="display: none;">
        <div class="thinking-header" onclick="toggleThinking(this)">
          <div class="thinking-status">
            <span class="thinking-spinner active">⚡</span>
            <span class="thinking-title">Real-time Chain of Thought (<span id="thinking-timer">0.0s</span>)</span>
          </div>
          <span class="thinking-toggle-btn">▼</span>
        </div>
        <div class="thinking-content" id="thinking-scroll-box">
          <pre><code id="thinking-content-text"></code></pre>
        </div>
      </div>

      <!-- Main Live Final Text Answer Bubble -->
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
  c.scrollTop = c.scrollHeight;
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
      if (startIdx === -1) {
        clean += raw.slice(pos);
        break;
      } else {
        clean += raw.slice(pos, startIdx);
        pos = startIdx + 7;
        currentlyInThink = true;
      }
    } else {
      const endIdx = raw.indexOf('</think>', pos);
      if (endIdx === -1) {
        think += raw.slice(pos);
        break;
      } else {
        think += raw.slice(pos, endIdx);
        pos = endIdx + 8;
        currentlyInThink = false;
      }
    }
  }
  return { clean, think, currentlyInThink };
}

async function sendMessage() {
  if (streaming) return;
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text) return;
  if (!currentModel) { toast('Please select a model first', 'err'); return; }
  if (!currentConvId) newConversation(false);

  input.value = '';
  autoResize(input);

  const conv = conversations.find(c => c.id === currentConvId);
  if (!conv) return;

  conv.messages.push({ role: 'user', content: text });
  saveConversations();
  updateConvTitle(currentConvId, text);
  appendMessage('user', text, true, null, conv.messages.length - 1);

  const typingDiv = appendTypingBubble();
  const actionTickerText = document.getElementById('action-ticker-text');
  const thinkingContainer = document.getElementById('live-thinking-container');
  const thinkingTimerEl = document.getElementById('thinking-timer');
  const thinkingContentText = document.getElementById('thinking-content-text');
  const thinkingScrollBox = document.getElementById('thinking-scroll-box');
  const answerBubble = document.getElementById('live-answer-bubble');

  document.getElementById('send-btn').style.display = 'none';
  if (document.getElementById('stop-btn')) document.getElementById('stop-btn').style.display = 'flex';
  streaming = true;

  activeAbortController = new AbortController();

  let totalRawContent = '';
  let dedicatedReasoning = '';
  let thinkingStartTime = null;
  let thinkingTimerInterval = null;
  let hasCollapsedThinking = false;
  let streamError = '';

  // Start live thinking timer
  thinkingTimerInterval = setInterval(() => {
    if (thinkingStartTime && thinkingTimerEl) {
      thinkingTimerEl.textContent = ((Date.now() - thinkingStartTime) / 1000).toFixed(1) + 's';
    }
  }, 100);

  // Main Chat uses only the user's conversation-level system prompt. Codebase
  // context is intentionally reserved for the Evolve App panel.
  const dynamicSystemPrompt = systemPrompt;
  const enableProviderThinking = false;

  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: currentModel.provider,
        model: currentModel.id,
        messages: conv.messages.slice(0, -1).concat([{ role: 'user', content: text }]),
        systemPrompt: dynamicSystemPrompt,
        enableThinking: enableProviderThinking
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
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.error) {
            streamError = d.error;
            if (actionTickerText) actionTickerText.textContent = '❌ Execution Error';
            answerBubble.style.display = 'block';
            answerBubble.innerHTML = `<span style="color:var(--red)">Error: ${escHtml(d.error)}</span>`;
            scrollBottom();
            break;
          }
          if (d.type === 'usage' && d.usage) {
            if (!conv.tokenUsage) conv.tokenUsage = { prompt: 0, completion: 0, total: 0 };
            conv.tokenUsage.prompt += (d.usage.promptTokens || 0);
            conv.tokenUsage.completion += (d.usage.completionTokens || 0);
            conv.tokenUsage.total += (d.usage.totalTokens || 0);
            saveConversations();
            updateTokenCounterUI();
          }

          if (d.reasoning) {
            dedicatedReasoning += d.reasoning;
            if (!thinkingStartTime) thinkingStartTime = Date.now();
          }
          if (d.text) {
            totalRawContent += d.text;
            if (actionTickerText && !totalRawContent) {
              actionTickerText.textContent = 'RX Stream active. Receiving tokens...';
            }
          }

          // Compute Think and Clean
          const { clean, think, currentlyInThink } = extractThinkAndClean(totalRawContent);
          const liveThink = (dedicatedReasoning + (think ? '\n' + think : '')).trim();
          const liveClean = clean.trim();

          // Update Thinking UI
          if (liveThink || currentlyInThink) {
            if (!thinkingStartTime) thinkingStartTime = Date.now();
            if (thinkingContainer) thinkingContainer.style.display = 'block';
            if (thinkingContentText) thinkingContentText.textContent = liveThink;
            if (thinkingScrollBox) thinkingScrollBox.scrollTop = thinkingScrollBox.scrollHeight;
            if (actionTickerText) actionTickerText.textContent = 'ANL Executing: Real-time deeper consideration & analysis...';
          }

          // Update Clean UI
          if (liveClean || (!currentlyInThink && liveClean.length > 0)) {
            if (answerBubble) answerBubble.style.display = 'block';
            if (answerBubble) answerBubble.innerHTML = formatMd(liveClean);
            if (actionTickerText) actionTickerText.textContent = 'TXT Executing: Formatting final polished Markdown response...';

            // Auto collapse thinking once main answer is smoothly flowing
            if (thinkingContainer && !currentlyInThink && liveThink && !hasCollapsedThinking && liveClean.length > 30) {
              thinkingContainer.classList.add('collapsed');
              hasCollapsedThinking = true;
            }
          }
        } catch { /* skip partial json */ }
      }
      if (streamError) break;
    }
  } catch(e) {
    if (e.name === 'AbortError') {
      streamError = 'Stopped by user';
    } else {
      if (actionTickerText) actionTickerText.textContent = '❌ Network Connection Error';
      answerBubble.style.display = 'block';
      answerBubble.innerHTML = `<span style="color:var(--red)">Network error: ${escHtml(e.message)}</span>`;
      streamError = e.message;
    }
  }

  // Finalize
  if (thinkingTimerInterval) {
    clearInterval(thinkingTimerInterval);
    thinkingTimerInterval = null;
  }
  const thinkingFinalDuration = thinkingStartTime ? ((Date.now() - thinkingStartTime) / 1000).toFixed(1) : 0;
  if (actionTickerText) actionTickerText.textContent = '✅ Action completed successfully';
  setTimeout(() => { document.getElementById('live-action-ticker')?.remove(); }, 1200);

  const { clean: finalCleanParsed, think: finalThinkParsed } = extractThinkAndClean(totalRawContent);
  const finalLiveThink = (dedicatedReasoning + (finalThinkParsed ? '\n' + finalThinkParsed : '')).trim();
  let finalLiveClean = finalCleanParsed.trim();

  if (streamError === 'Stopped by user') {
    finalLiveClean += '\n\n*[Stopped by user]*';
  } else if (streamError && !finalLiveClean) {
    finalLiveClean = '[Error: ' + streamError + ']';
  } else if (!finalLiveClean && finalLiveThink) {
    finalLiveClean = '*[Chain of Thought completed. No final summary provided]*';
  }

  const modelInfo = { ...currentModel };
  const modelObj = models.find(m => m.id === currentModel.id && m.provider === currentModel.provider);
  if (modelObj) {
    modelInfo.icon = modelObj.icon || '';
    modelInfo.name = modelObj.name || modelObj.id;
  }

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

  document.getElementById('send-btn').style.display = 'flex';
  if (document.getElementById('stop-btn')) document.getElementById('stop-btn').style.display = 'none';
  document.getElementById('send-btn').disabled = false;
  streaming = false;
  activeAbortController = null;
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
6. If the user says "proceed", "do it", "make the edit", "execute", "go ahead", "yes", or similar approval phrases, and you have already proposed a plan, do NOT plan again. Tell them: "Your plan is ready. Click the APPROVE & EXECUTE button above to execute it."
7. If a task is impossible, explain why instead of guessing.
8. Prefer small, focused edit actions. The executor applies existing-file edits as targeted search/replace patches when possible; creates still generate complete new files.`;

function populateEvolveModelSelect() {
  const sel = document.getElementById('evolve-model-select');
  if (!sel) return;
  const previousValue = sel.value;
  const showAll = document.getElementById('show-all-evolve-models')?.checked;
  const targetModels = showAll ? models : models.filter(m => m.updateCapable);
  sel.innerHTML = '';
  if (targetModels.length === 0) {
    sel.innerHTML = '<option value="" style="background: #1e2030; color: #ffffff;">— No capable models available (Add keys in Settings) —</option>';
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
    og.style.background = '#11131d';
    og.style.color = '#a5b4fc';
    og.style.fontWeight = '700';
    for (const m of ms) {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ id: m.id, provider: m.provider });
      opt.textContent = `${m.icon || ''} ${m.name}${m.updateCapable ? '' : ' (⚠️ May struggle)'}`;
      opt.style.background = '#1e2030';
      opt.style.color = '#ffffff';
      opt.style.padding = '6px';
      opt.style.fontWeight = '600';
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

function renderFileTreeNodes(nodes, container, level) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    const div = document.createElement('div');
    div.className = 'evolve-tree-item';
    div.style.paddingLeft = (level * 14 + 6) + 'px';
    if (node.type === 'dir') {
      div.className += ' evolve-tree-dir';
      div.innerHTML = `<span>DIR</span> <span>${escHtml(node.path)}</span>`;
      const childContainer = document.createElement('div');
      childContainer.className = 'evolve-tree-children';
      childContainer.style.display = 'block';
      div.onclick = (e) => {
        e.stopPropagation();
        childContainer.style.display = childContainer.style.display === 'none' ? 'block' : 'none';
      };
      container.appendChild(div);
      container.appendChild(childContainer);
      renderFileTreeNodes(node.children, childContainer, level + 1);
    } else {
      div.className += ' evolve-tree-file';
      div.innerHTML = `<span>FILE</span> <span>${escHtml(node.path)}</span>`;
      div.onclick = (e) => {
        e.stopPropagation();
        showFileViewer(node.path, node.content);
        document.querySelectorAll('.evolve-tree-file').forEach(el => el.classList.remove('active'));
        div.classList.add('active');
      };
      container.appendChild(div);
    }
  }
}

function showFileViewer(path, content) {
  const viewer = document.getElementById('evolve-file-viewer');
  if (!viewer) return;
  viewer.innerHTML = `<div id="evolve-file-viewer-title" style="font-weight:600;margin-bottom:6px;color:var(--accent2);">${escHtml(path)}</div><pre style="margin:0;white-space:pre-wrap;word-break:break-word;">${escHtml(content)}</pre>`;
  viewer.style.display = 'block';
}

function saveEvolveMessages() {
  try {
    localStorage.setItem('evolveMessages', JSON.stringify(evolveMessages));
  } catch(e) {
    toast('Could not save Evolve chat locally: ' + e.message, 'err');
  }
}

function renderEvolveMessages() {
  const container = document.getElementById('evolve-messages');
  if (!container) return;
  container.innerHTML = '';
  if (!Array.isArray(evolveMessages) || evolveMessages.length === 0) {
    container.innerHTML = `
      <div class="evolve-empty-state" id="evolve-empty-state">
        <div class="hero">⬡</div>
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
  bubble.style.maxWidth = '100%';

  let cleanContent = content;
  let foundPlans = [];

  // Extract and remove plan blocks from the rendered text so they don't show as raw JSON
  if (role === 'assistant') {
    const planRegex = /\n?\n?```plan\s*([\s\S]*?)```/g;
    let match;
    while ((match = planRegex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed)) {
          foundPlans.push(parsed);
          cleanContent = cleanContent.replace(match[0], '');
        }
      } catch { /* ignore invalid */ }
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
  copyBtn.innerHTML = 'COPY';
  copyBtn.addEventListener('click', () => copyTextToClipboard(content, copyBtn));
  actions.appendChild(copyBtn);
  bubbleWrap.appendChild(actions);

  div.appendChild(bubbleWrap);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  // Render plan cards separately after the message
  for (const plan of foundPlans) {
    renderPlanInChat(plan);
  }
}


function planStateKey(plan) {
  const raw = JSON.stringify(plan || []);
  let hash = 0;
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  return 'plan-' + Math.abs(hash).toString(36);
}

function saveEvolvePlanStates() {
  localStorage.setItem('evolvePlanStates', JSON.stringify(evolvePlanStates));
}

function setPlanState(planKey, status, note = '') {
  evolvePlanStates[planKey] = { status, note, updated: Date.now() };
  saveEvolvePlanStates();
}

function setPlanCardStatus(planId, status, note) {
  const card = document.querySelector(`[data-plan-id="${planId}"]`);
  if (!card) return;
  const actions = card.querySelector('.evolve-plan-actions');
  if (actions) actions.remove();
  let statusEl = card.querySelector('.evolve-plan-status');
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.className = 'evolve-plan-status';
    card.appendChild(statusEl);
  }
  statusEl.textContent = note || status;
  statusEl.dataset.status = status;
}

function rejectPlan(planId) {
  const plan = window._evolvePlans?.[planId];
  if (!plan) return;
  const key = planStateKey(plan);
  setPlanState(key, 'rejected', 'Plan rejected by user.');
  setPlanCardStatus(planId, 'rejected', 'REJECTED — this plan will not be executed.');
  addEvolveMessage('assistant', 'Plan rejected by user. I will treat that plan as cancelled. Tell me what to change, or ask for a revised plan.');
}


function renderInvestigationPrompt(failedPayload, appliedPayload) {
  const container = document.getElementById('evolve-messages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'evolve-msg assistant';
  div.innerHTML = `<div class="evolve-msg-bubble">
    <div style="font-weight:700;color:var(--yellow);margin-bottom:8px;">INVESTIGATION REQUIRED</div>
    <div style="font-size:12px;color:var(--text-muted);line-height:1.5;margin-bottom:10px;">Some files failed while others were applied. Continue only if you want a diagnostic pass and a new repair plan for the failed files.</div>
    <button class="btn-primary" onclick="requestFailedPlanRetry('${failedPayload}', '${appliedPayload}')">INVESTIGATE FAILED EDITS</button>
  </div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function requestFailedPlanRetry(encodedFailed, encodedApplied) {
  let failed = [];
  let applied = [];
  try { failed = JSON.parse(decodeURIComponent(encodedFailed)); } catch { /* ignore */ }
  try { applied = JSON.parse(decodeURIComponent(encodedApplied)); } catch { /* ignore */ }
  const failedList = failed.map(f => `- ${f.path}: ${f.error}`).join('\n') || '- Unknown failed file';
  const appliedList = applied.map(f => `- ${f.action?.toUpperCase?.() || 'UPDATE'} ${f.path}`).join('\n') || '- None';
  const prompt = `Please investigate the partial Evolve execution and propose a new minimal plan ONLY for the failed file(s).

Already applied successfully:
${appliedList}

Failed file(s):
${failedList}

First explain why the failed edit likely failed, then provide a revised plan for only the failed work.`;
  const input = document.getElementById('evolve-input');
  if (input) {
    input.value = prompt;
    autoResize(input);
    input.focus();
    toast('Investigation prompt queued — sending now', 'ok');
    setTimeout(() => sendEvolveMessage(), 50);
  } else {
    toast('Could not find Evolve input', 'err');
  }
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
      Review the changes below. If they look correct, click <strong style="color:var(--text);">APPROVE & EXECUTE</strong> to start the live code generation.
    </div>
    ${plan.map((p, i) => `
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
  if (evolveStreaming) {
    toast('Stop the active Evolve run before clearing the chat', 'err');
    return;
  }
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
  const text = input.value.trim();
  if (!text) return;
  const model = getEvolveModel();
  if (!model) { toast('Please select a model in the Evolve panel', 'err'); return; }

  input.value = '';
  autoResize(input);

  // Auto-execute: if user types approval phrases and there's a pending plan, execute it directly
  const approvalPhrases = ['proceed', 'do it', 'make the edit', 'execute', 'go ahead', 'yes', 'approve', 'please proceed', 'make it', 'implement it'];
  const lowerText = text.toLowerCase();
  const pendingPlanIds = Object.keys(window._evolvePlans || {});
  if (pendingPlanIds.length > 0 && approvalPhrases.some(p => lowerText.includes(p))) {
    const latestPlanId = pendingPlanIds[pendingPlanIds.length - 1];
    addEvolveMessage('user', text);
    addEvolveMessage('assistant', 'ACK Executing your approved plan now...');
    approvePlan(latestPlanId);
    return;
  }

  addEvolveMessage('user', text);

  const modelObj = models.find(m => m.id === model.id && m.provider === model.provider);
  const modelName = modelObj ? `${modelObj.icon || ''} ${modelObj.name || model.id}` : model.id;

  appendEvolveLoading(modelName);

  evolveStreaming = true;
  evolveAbortController = new AbortController();
  setEvolveStreamingUI(true);

  let dynamicSystem = EVOLVE_SYSTEM_PROMPT;
  if (appManifestString) {
    dynamicSystem = dynamicSystem + '\n\n' + appManifestString;
  }

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
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.error) {
            assistantText += '\n[Error: ' + d.error + ']';
            break;
          }
          if (d.text) {
            assistantText += d.text;
            updateEvolveLoading(assistantText);
          }
        } catch { /* skip */ }
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
  div.innerHTML = `<div class="evolve-msg-bubble"><div class="action-ticker"><span class="ticker-spinner">⚙️</span><span>${escHtml(modelName)} is thinking...</span></div></div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function updateEvolveLoading(text) {
  const div = document.getElementById('evolve-loading-msg');
  if (!div) return;
  const bubble = div.querySelector('.evolve-msg-bubble');
  if (bubble) bubble.innerHTML = formatMd(text);
}

function removeEvolveLoading() {
  const div = document.getElementById('evolve-loading-msg');
  if (div) div.remove();
}

function stopEvolveMessage() {
  if (evolveAbortController) {
    evolveAbortController.abort();
    evolveAbortController = null;
  }
}

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
  const btn = document.querySelector(`[onclick*="approvePlan('${planId}')"]`);
  const model = getEvolveModel();
  if (!model) { toast('Please select a model first', 'err'); return; }
  setPlanState(key, 'executing', 'EXECUTING...');
  setPlanCardStatus(planId, 'executing', 'EXECUTING...');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'EXECUTING...';
  }

  const container = document.getElementById('evolve-messages');
  const div = document.createElement('div');
  div.className = 'evolve-msg assistant';
  div.id = 'evolve-execution-' + planId;
  div.innerHTML = `<div class="evolve-msg-bubble">
    <div style="color:var(--accent2);font-weight:600;margin-bottom:8px;">EXECUTION STARTED...</div>
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
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.type === 'chunk') {
            feed.textContent += d.text;
            feed.scrollTop = feed.scrollHeight;
          } else if (d.type === 'backup') {
            feed.textContent += `\n[Backup created: ${d.dir}]\n`;
            feed.scrollTop = feed.scrollHeight;
          } else if (d.type === 'file_complete') {
            feed.textContent += `\n[✅ ${d.action.toUpperCase()} ${d.path}]\n`;
            feed.scrollTop = feed.scrollHeight;
          } else if (d.type === 'file_error') {
            feed.textContent += `\n[❌ ERROR ${d.path}: ${d.error}]\n`;
            feed.scrollTop = feed.scrollHeight;
          } else if (d.type === 'done' || d.type === 'partial') {
            feed.textContent += `\n\n${d.type === 'partial' ? 'PARTIAL: ' : 'OK '}${d.message}`;
            feed.scrollTop = feed.scrollHeight;
            const applied = Array.isArray(d.applied) ? d.applied : [];
            const failed = Array.isArray(d.failed) ? d.failed : [];
            const appliedList = applied.length
              ? applied.map(f => `- ${f.action?.toUpperCase?.() || 'UPDATE'} ${f.path}`).join('\n')
              : '- None';
            const failedList = failed.length
              ? failed.map(f => `- ${f.path}: ${f.error}`).join('\n')
              : '- None';

            if (d.type === 'partial') {
              toast('Partial update: investigation required', 'err');
              setPlanState(key, 'partial', 'PARTIAL — some files failed. Investigation required.');
              setPlanCardStatus(planId, 'partial', 'PARTIAL — some files failed. Investigation required.');
              const failedPayload = encodeURIComponent(JSON.stringify(failed));
              const appliedPayload = encodeURIComponent(JSON.stringify(applied));
              addEvolveMessage('assistant', `Partial execution — this update is NOT fully complete.\n\n${d.message}\n\nApplied files:\n${appliedList}\n\nFailed files:\n${failedList}\n\nBackup: ${d.backupDir || 'not reported'}\n\nClick the investigation button below if you want me to diagnose the failed file(s) and propose a new minimal repair plan.`);
              renderInvestigationPrompt(failedPayload, appliedPayload);
            } else {
              toast(d.message, 'ok');
              setPlanState(key, 'executed', 'EXECUTED — plan completed.');
              setPlanCardStatus(planId, 'executed', 'EXECUTED — plan completed.');
              addEvolveMessage('assistant', `Execution complete.\n\n${d.message}\n\nApplied files:\n${appliedList}\n\nBackup: ${d.backupDir || 'not reported'}\n\nIf you do not see the change after reload, ask me here and I can inspect the updated codebase context with this execution record.`);
            }
            loadFileTree();
          } else if (d.type === 'error') {
            feed.textContent += `\n\nERROR: ${d.message}`;
            feed.scrollTop = feed.scrollHeight;
            setPlanState(key, 'failed', 'FAILED — execution did not complete.');
            setPlanCardStatus(planId, 'failed', 'FAILED — execution did not complete.');
            addEvolveMessage('assistant', `Execution failed.\n\n${d.message}\n\nYou can ask me to diagnose the failure from this same Evolve thread.`);
            toast(d.message, 'err');
          }
        } catch { /* skip */ }
      }
    }
  } catch (e) {
    feed.textContent += `\n\nFailed: ${e.message}`;
    setPlanState(key, 'failed', 'FAILED — execution request failed.');
    setPlanCardStatus(planId, 'failed', 'FAILED — execution request failed.');
    addEvolveMessage('assistant', `Execution request failed.\n\n${e.message}\n\nYou can ask me to diagnose the failure from this same Evolve thread.`);
    toast('Execution failed: ' + e.message, 'err');
  }
}

/* ── System prompt ──────────────────────────────────────────────────────────── */
function openSystemModal() {
  document.getElementById('system-prompt-input').value = systemPrompt;
  document.getElementById('modal-overlay').classList.add('open');
}
function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }
function closeModalOutside(e) { if (e.target === document.getElementById('modal-overlay')) closeModal(); }
function saveSystemPrompt() {
  systemPrompt = document.getElementById('system-prompt-input').value.trim();
  localStorage.setItem('systemPrompt', systemPrompt);
  closeModal();
  toast('System prompt saved ✓', 'ok');
}

/* ── Custom Interactive Actions (Copy, Edit, Regenerate, Stop) ──────────── */
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
}

function clearCurrentChat() {
  if (!currentConvId) return;
  const conv = conversations.find(c => c.id === currentConvId);
  if (!conv) return;
  if (!confirm('Clear all messages in this conversation?')) return;

  conv.messages = [];
  conv.title = 'New chat';
  if (conv.tokenUsage) conv.tokenUsage = { prompt: 0, completion: 0, total: 0 };
  saveConversations();
  renderConvList();
  renderMessages(conv.messages);
  updateTokenCounterUI();
  toast('Chat cleared', 'ok');
}

function exportCurrentChat() {
  if (!currentConvId) return;
  const conv = conversations.find(c => c.id === currentConvId);
  if (!conv || conv.messages.length === 0) {
    toast('Nothing to export', 'err');
    return;
  }

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
    version: 1,
    exportDate: new Date().toISOString(),
    conversations,
    systemPrompt: localStorage.getItem('systemPrompt') || ''
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aichat_backup_${new Date().toISOString().replace(/[:.]/g, '')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Data exported successfully ✓', 'ok');
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
        document.getElementById('system-prompt-input').value = systemPrompt;
      }
      renderConvList();
      if (conversations.length > 0) loadConversation(conversations[0].id);
      else newConversation(true);
      toast('Data restored successfully ✓', 'ok');
    } catch(err) {
      toast('Failed to restore data: invalid JSON', 'err');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

function editMsgAction(idx) {
  const conv = conversations.find(c => c.id === currentConvId);
  if (!conv || !conv.messages[idx]) return;
  const targetMsg = conv.messages[idx];

  if (confirm('Edit this message and re-send? (Later messages in this chat will be replaced)')) {
    document.getElementById('msg-input').value = targetMsg.content;
    autoResize(document.getElementById('msg-input'));
    document.getElementById('msg-input').focus();

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
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ Copied';
    btn.style.color = 'var(--green)';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 2000);
  } catch(err) {
    toast('Copy failed', 'err');
  }
}

function regenMsgAction(idx) {
  const conv = conversations.find(c => c.id === currentConvId);
  if (!conv || !conv.messages[idx]) return;

  if (confirm('Regenerate this assistant response?')) {
    conv.messages = conv.messages.slice(0, idx);
    saveConversations();
    renderMessages(conv.messages);
    updateTokenCounterUI();

    const lastUserMsg = conv.messages[conv.messages.length - 1];
    if (lastUserMsg && lastUserMsg.role === 'user') {
      const textToResend = lastUserMsg.content;
      conv.messages.pop();
      document.getElementById('msg-input').value = textToResend;
      sendMessage();
    }
  }
}

async function copyCode(btn, e) {
  if (e) e.stopPropagation();
  const pre = btn.closest('.code-block').querySelector('pre code');
  if (!pre) return;
  try {
    await navigator.clipboard.writeText(pre.textContent);
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ Copied';
    btn.style.color = 'var(--green)';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 2000);
  } catch(err) {
    toast('Copy failed', 'err');
  }
}

/* ── Input helpers ──────────────────────────────────────────────────────────── */
function onInputKey(e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendMessage(); }
}
function onEvolveInputKey(e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendEvolveMessage(); }
}
async function copyTextToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text || '');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '✓ Copied';
      btn.style.color = 'var(--green)';
      setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 2000);
    }
  } catch {
    toast('Copy failed', 'err');
  }
}
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}
function insertSuggestion(el) {
  document.getElementById('msg-input').value = el.textContent;
  autoResize(document.getElementById('msg-input'));
  document.getElementById('msg-input').focus();
}

/* ── Toast ──────────────────────────────────────────────────────────────────── */
let toastTimer;
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}

function loadStoredJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    return parsed ?? fallback;
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
}

async function apiErrorMessage(response, fallback) {
  try {
    const data = await response.json();
    return data.error || data.message || fallback;
  } catch {
    try { return await response.text() || fallback; }
    catch { return fallback; }
  }
}

/* ── Markdown renderer (lightweight) ───────────────────────────────────────── */
function formatMd(text) {
  let h = escHtml(text);
  // Code blocks
  h = h.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
    const cleanLang = escHtml(lang || 'code');
    const cleanCode = code.trim();
    return `<div class="code-block"><div class="code-header"><span>${cleanLang}</span><button class="copy-code-btn" onclick="copyCode(this, event)">COPY</button></div><pre><code>${cleanCode}</code></pre></div>`;
  });
  // Inline code
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Headings
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bullet lists
  h = h.replace(/^\s*[-*•] (.+)$/gm, '<li>$1</li>');
  h = h.replace(/(<li>.*<\/li>(\n|$))+/g, m => `<ul>${m}</ul>`);
  // Numbered lists
  h = h.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  // Paragraphs (double newlines)
  h = h.split(/\n{2,}/).map(block => {
    if (/^<(h[123]|ul|ol|pre|li)/.test(block.trim())) return block;
    return `<p>${block.replace(/\n/g, '<br/>')}</p>`;
  }).join('');
  return h;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── App Manifest (Evolve panel codebase context only) ─────────────────────── */
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
  lines.push('Use it to: answer "is X possible?", recommend features, audit the design, and — once a feature is agreed — output a fenced code block tagged ```plan containing a JSON array of proposed actions: {path, action, description}.');
  lines.push('');
  lines.push('--- TECH STACK ---');
  (m.techStack || []).forEach(t => lines.push('• ' + t));
  lines.push(`Port: ${m.port}`);
  lines.push('');
  lines.push('--- STORAGE ---');
  if (m.storage) {
    Object.entries(m.storage).forEach(([k, v]) => lines.push(`• ${k}: ${v}`));
  }
  lines.push('');
  lines.push('--- FILES (line counts only) ---');
  (m.files || []).forEach(f => lines.push(`• ${f.path}  (${f.lines} lines)`));
  lines.push('');
  lines.push('--- API ENDPOINTS ---');
  (m.endpoints || []).forEach(e => lines.push(`• ${e.method} ${e.path}`));
  lines.push('');
  lines.push('--- FRONTEND ---');
  if (m.frontend) {
    lines.push(`Frontend files: public/index.html (~${m.frontend.lineCount} lines), public/styles.css (~${m.frontend.styleLineCount || 0} lines), public/app.js (~${m.frontend.scriptLineCount || 0} lines).`);
    lines.push(`Panels: ${(m.frontend.panels || []).join(', ')}`);
    lines.push(`Key selectors: ${(m.frontend.keySelectors || []).join(', ')}`);
    lines.push(`Notable JS functions: ${(m.frontend.functions || []).slice(0, 30).join(', ')}${(m.frontend.functions || []).length > 30 ? ' …' : ''}`);
  }
  lines.push('');
  lines.push('--- CAPABILITIES (what this app can already do) ---');
  (m.capabilities || []).forEach(c => lines.push('✓ ' + c));
  lines.push('');
  lines.push('--- HARD CONSTRAINTS ---');
  (m.hardConstraints || []).forEach(c => lines.push('✗ ' + c));
  lines.push('');
  lines.push('--- HOW UPDATES WORK ---');
  (m.updateWorkflow || []).forEach(s => lines.push(s));
  lines.push('');
  lines.push('--- HOW TO WRITE A GREAT PLAN ---');
  if (m.updatePromptGuide) {
    (m.updatePromptGuide.what_makes_a_great_prompt || []).forEach(t => lines.push('• ' + t));
    lines.push('');
    lines.push('Format convention: ' + (m.updatePromptGuide.format || ''));
    lines.push('');
    lines.push('Example of a great plan:');
    lines.push('```plan');
    lines.push(JSON.stringify([
      { path: 'public/hello.md', action: 'create', description: 'Add a Hello World markdown file' },
      { path: 'server.js', action: 'edit', description: 'Add a route to serve the new file' }
    ], null, 2));
    lines.push('```');
  }
  lines.push('');
  lines.push('=== END APP MANIFEST ===');
  return lines.join('\n');
}
