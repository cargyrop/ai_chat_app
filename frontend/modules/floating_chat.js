/* ── Chat panel model select population ──────────────────────────────────── */

function populateChatModelSelect(convId) {
  const select = document.querySelector(`#fp-${convId} .fp-chat-model-select`);
  populateChatModelSelectGeneric(select);
}

/* ── Chat panel event wiring ─────────────────────────────────────────────── */

function wireChatPanelEvents(convId) {
  const panel = document.getElementById(`fp-${convId}`);
  if (!panel) return;

  const input = panel.querySelector('.fp-chat-input');
  const sendBtn = panel.querySelector('[data-action="chat-send"]');
  const modelSelect = panel.querySelector('.fp-chat-model-select');

  if (input) {
    input.addEventListener('input', () => autoResize(input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendFloatingChatMessage(convId);
      }
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', () => sendFloatingChatMessage(convId));
  }

  if (modelSelect) {
    modelSelect.addEventListener('change', () => {
      try {
        const val = modelSelect.value;
        if (val) {
          const parsed = JSON.parse(val);
          setPanelGeom(convId, { modelId: parsed.id, modelProvider: parsed.provider });
        }
      } catch {}
    });
  }
}

/* ── Send chat message from floating panel ──────────────────────────────── */

async function sendFloatingChatMessage(convId) {
  const panel = document.getElementById(`fp-${convId}`);
  if (!panel) return;

  const input = panel.querySelector('.fp-chat-input');
  const modelSelect = panel.querySelector('.fp-chat-model-select');
  const msgsContainer = panel.querySelector('.fp-chat-messages');
  if (!input || !msgsContainer) return;

  const text = input.value.trim();
  if (!text) return;

  let panelModel = currentModel;
  if (modelSelect?.value) {
    try { panelModel = JSON.parse(modelSelect.value); } catch {}
  }

  // Find or load the conversation
  const conv = conversations.find(c => c.id === convId);
  if (!conv) return;

  // Add user message
  conv.messages.push({ role: 'user', content: text });
  saveConversations();

  // Render user message
  const userDiv = document.createElement('div');
  userDiv.className = 'fp-chat-msg user';
  userDiv.innerHTML = `<div class="fp-chat-msg-bubble user">${escHtml(text)}</div>`;
  msgsContainer.appendChild(userDiv);

  input.value = '';
  autoResize(input);

  // Add assistant placeholder
  const assistantDiv = document.createElement('div');
  assistantDiv.className = 'fp-chat-msg assistant';
  assistantDiv.innerHTML = `<div class="fp-chat-msg-bubble assistant"><span class="typing-indicator">●●●</span></div>`;
  msgsContainer.appendChild(assistantDiv);
  msgsContainer.scrollTop = msgsContainer.scrollHeight;

  try {
    const modelId = panelModel?.id;
    const provider = panelModel?.provider;
    if (!modelId || !provider) {
      assistantDiv.innerHTML = `<div class="fp-chat-msg-bubble assistant error-text">No model selected. Pick a model from the dropdown.</div>`;
      return;
    }

    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        model: modelId,
        messages: conv.messages.slice(-20),
        system: systemPrompt || undefined,
      }),
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: 'Request failed' }));
      assistantDiv.innerHTML = `<div class="fp-chat-msg-bubble assistant error-text">${escHtml(err.error || 'Unknown error')}</div>`;
      return;
    }

    // Stream response
    let fullText = '';
    const reader = r.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
        try {
          const d = JSON.parse(line.slice(6));
          const txt = d.choices?.[0]?.delta?.content || d.delta?.text || '';
          if (txt) {
            fullText += txt;
            assistantDiv.innerHTML = `<div class="fp-chat-msg-bubble assistant">${formatMd(fullText)}</div>`;
            msgsContainer.scrollTop = msgsContainer.scrollHeight;
          }
        } catch {}
      }
    }

    conv.messages.push({ role: 'assistant', content: fullText });
    saveConversations();
  } catch (e) {
    assistantDiv.innerHTML = `<div class="fp-chat-msg-bubble assistant error-text">Error: ${escHtml(e.message)}</div>`;
  }
}

/* ── Panel bar (top) ────────────────────────────────────────────────────── */

function updatePanelBar() {
  const bar = document.getElementById('engage-panel-bar');
  if (!bar) return;
  bar.innerHTML = '';

  // Tool panel buttons only — chat tabs are in the sidebar
  for (const [id, def] of Object.entries(TOOL_PANEL_DEFS)) {
    const btn = document.createElement('button');
    btn.className = 'engage-panel-btn';
    btn.dataset.panelId = id;
    const panel = document.getElementById(`fp-${id}`);
    const isOpen = panel && panel.style.display !== 'none';
    if (isOpen) btn.classList.add('active');
    btn.title = isOpen ? `Close ${def.title}` : `Open ${def.title}`;
    btn.innerHTML = `<span class="engage-panel-icon">${def.icon}</span> ${def.title}`;
    btn.addEventListener('click', () => toggleToolPanel(id));
    bar.appendChild(btn);
  }
}

/* ── Restore layout on init ──────────────────────────────────────────────── */

function restoreFloatingPanelLayout() {
  const layout = loadPanelLayout();
  for (const [id, state] of Object.entries(layout)) {
    if (!state.open) continue;
    if (state.type === 'chat') {
      const conv = conversations.find(c => c.id === id);
      const title = conv?.title || state.title || 'Chat';
      openChatPanel(id, title);
      // Restore messages
      if (conv?.messages?.length) {
        const msgsContainer = document.getElementById(`fp-chat-msgs-${id}`);
        if (msgsContainer) {
          for (const msg of conv.messages) {
            const div = document.createElement('div');
            div.className = `fp-chat-msg ${msg.role}`;
            div.innerHTML = `<div class="fp-chat-msg-bubble ${msg.role}">${msg.role === 'user' ? escHtml(msg.content) : formatMd(msg.content)}</div>`;
            msgsContainer.appendChild(div);
          }
        }
      }
    } else if (TOOL_PANEL_DEFS[id]) {
      openToolPanel(id);
    }
    if (state.maximized) maximizeFloatingPanel(id);
  }
}

/* ── Wire sidebar conversation clicks to open chat panels ──────────────── */

function openConversationAsPanel(convId) {
  const conv = conversations.find(c => c.id === convId);
  if (!conv) return;
  currentConvId = convId;
  openChatPanel(convId, conv.title);
  renderConvList();
}
