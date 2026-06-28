/* BLACKLINE AI — chat_render module (Phase 2) */

function renderMessages(msgs) {
  const container = document.getElementById('messages');
  if (!container) return;
  if (!msgs || msgs.length === 0) {
    container.innerHTML = `
      <div id="empty-state">
        <div class="hero" aria-hidden="true">▰</div>
        <h2>Ready to chat</h2>
        <p>Select a model, then send a message. Add API keys in Settings to unlock cloud providers.</p>
        <div class="suggestions">
          <div class="suggestion" onclick="insertSuggestion(this)" role="button" tabindex="0">Explain quantum computing</div>
          <div class="suggestion" onclick="insertSuggestion(this)" role="button" tabindex="0">Write a Python script</div>
          <div class="suggestion" onclick="insertSuggestion(this)" role="button" tabindex="0">Summarize a concept</div>
          <div class="suggestion" onclick="insertSuggestion(this)" role="button" tabindex="0">Debug my code</div>
        </div>
      </div>`;
    document.querySelectorAll('#empty-state .suggestion').forEach(el => {
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); insertSuggestion(el); }});
    });
    return;
  }
  container.innerHTML = '';
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    appendMessage(msg.role, msg.content, false, msg.model || null, i, msg.thinking, msg.thinkingTime);
  }
  scrollBottom();
}

function appendMessage(role, content, animate = true, model = null, msgIdx = null, thinking = null, thinkingTime = null) {
  const container = document.getElementById('messages');
  if (!container) return null;
  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = `message ${role}`;
  if (msgIdx !== null) div.dataset.msgIdx = String(msgIdx);

  const avatar = role === 'user' ? 'USR' : 'AI';
  let bubbleContent = role === 'assistant' ? formatMd(content) : escHtml(content).replace(/\n/g, '<br>');

  if (role === 'assistant' && model) {
    const modelName = model.name || model.id || 'Unknown model';
    const providerIcon = model.icon || '';
    bubbleContent += `<span class="model-label">${providerIcon} ${escHtml(modelName)}</span>`;
  }

  let thinkingHtml = '';
  if (role === 'assistant' && thinking && thinking.trim()) {
    thinkingHtml = `
      <div class="thinking-container permanent-thinking collapsed">
        <div class="thinking-header" onclick="toggleThinking(this)" role="button" tabindex="0">
          <div class="thinking-status">
            <span class="thinking-spinner" aria-hidden="true">⚡</span>
            <span class="thinking-title">Chain of Thought (${thinkingTime ? thinkingTime + 's' : '–'})</span>
          </div>
          <span class="thinking-toggle-btn" aria-hidden="true">▼</span>
        </div>
        <div class="thinking-content">
          <pre><code>${escHtml(thinking.trim())}</code></pre>
        </div>
      </div>`;
  }

  let actionsHtml = `<div class="msg-actions">`;
  if (msgIdx !== null) {
    if (role === 'user') {
      actionsHtml += `<button class="msg-action-btn" type="button" onclick="copyMsgAction(${msgIdx}, this)">COPY</button>`;
      actionsHtml += `<button class="msg-action-btn" type="button" onclick="editMsgAction(${msgIdx})">EDIT</button>`;
    } else if (role === 'assistant') {
      actionsHtml += `<button class="msg-action-btn" type="button" onclick="copyMsgAction(${msgIdx}, this)">COPY</button>`;
      actionsHtml += `<button class="msg-action-btn" type="button" onclick="regenMsgAction(${msgIdx})">REGEN</button>`;
    }
  }
  actionsHtml += `</div>`;

  div.innerHTML = `
    <div class="msg-avatar" aria-hidden="true">${avatar}</div>
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
  if (!container) return null;
  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = 'active-assistant-message';
  div.innerHTML = `<div class="msg-avatar" aria-hidden="true">AI</div>
    <div class="msg-bubble-container" id="active-assistant-container">
      <div id="live-action-ticker" class="action-ticker">
        <span class="ticker-spinner" aria-hidden="true">⚙️</span>
        <span id="action-ticker-text">Connecting…</span>
      </div>
      <div id="live-thinking-container" class="thinking-container" style="display: none;">
        <div class="thinking-header" onclick="toggleThinking(this)" role="button" tabindex="0">
          <div class="thinking-status">
            <span class="thinking-spinner active" aria-hidden="true">⚡</span>
            <span class="thinking-title">Chain of Thought (<span id="thinking-timer">0.0s</span>)</span>
          </div>
          <span class="thinking-toggle-btn" aria-hidden="true">▼</span>
        </div>
        <div class="thinking-content" id="thinking-scroll-box">
          <pre><code id="thinking-content-text"></code></pre>
        </div>
      </div>
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
  if (c) c.scrollTop = c.scrollHeight;
}

function toggleThinking(el) {
  const container = el.closest('.thinking-container');
  if (!container) return;
  container.classList.toggle('collapsed');
}
