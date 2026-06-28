/* BLACKLINE AI — conversations module (Phase 2) */

const MAX_CONVERSATIONS = 50;

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

function deleteConversation(id, e) {
  e.stopPropagation();
  if (!confirm('Delete this conversation?')) return;
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
    while (conversations.length > MAX_CONVERSATIONS) {
      conversations.pop();
    }
    const serialized = JSON.stringify(conversations);
    const sizeBytes = new Blob([serialized]).size;
    if (sizeBytes > 4 * 1024 * 1024) {
      console.warn('[storage] Conversations size:', (sizeBytes / 1024 / 1024).toFixed(1), 'MB');
      toast('Conversations approaching localStorage limit', 'err');
    }
    localStorage.setItem('conversations', serialized);
  } catch(e) {
    toast('Could not save conversations locally: ' + e.message, 'err');
  }
}

function getFilteredConversations() {
  const q = convSearchFilter.trim().toLowerCase();
  if (!q) return conversations;
  return conversations.filter(c => (c.title || '').toLowerCase().includes(q));
}

function renderConvList() {
  const list = document.getElementById('conv-list');
  if (!list) return;
  const filtered = getFilteredConversations();
  list.innerHTML = '';
  for (const c of filtered) {
    const el = document.createElement('div');
    el.className = 'conv-item' + (c.id === currentConvId ? ' active' : '');
    el.setAttribute('data-id', c.id);
    el.setAttribute('role', 'listitem');
    el.setAttribute('tabindex', '0');
    el.innerHTML = `<span class="conv-item-title">${escHtml(c.title)}</span>
      <button class="conv-rename-btn" onclick="startRenameConversation('${c.id}', event)" title="Rename" aria-label="Rename conversation">✎</button>
      <button class="conv-delete" onclick="deleteConversation('${c.id}', event)" title="Delete" aria-label="Delete conversation">✕</button>`;
    el.addEventListener('click', (e) => { if (e.target.closest('button')) return; loadConversation(c.id); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadConversation(c.id); }});
    list.appendChild(el);
  }
  if (filtered.length === 0 && conversations.length > 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:8px 10px;color:var(--text-dim);font-size:11px;';
    empty.textContent = 'No matches';
    list.appendChild(empty);
  }
}

function filterConversations(q) {
  convSearchFilter = q || '';
  renderConvList();
}

function clearConvSearch() {
  const inp = document.getElementById('conv-search');
  if (inp) { inp.value = ''; filterConversations(''); inp.focus(); }
}

function startRenameConversation(id, e) {
  e.stopPropagation();
  const item = document.querySelector(`.conv-item[data-id="${CSS.escape(id)}"]`);
  if (!item) return;
  const titleEl = item.querySelector('.conv-item-title');
  const conv = conversations.find(c => c.id === id);
  if (!conv) return;
  renamingConvId = id;
  const input = document.createElement('input');
  input.className = 'conv-rename-input';
  input.value = conv.title;
  input.setAttribute('aria-label', 'Rename conversation');
  const finish = (save) => {
    if (renamingConvId !== id) return;
    renamingConvId = null;
    if (save) {
      const newTitle = input.value.trim();
      if (newTitle) {
        conv.title = newTitle.slice(0, 80);
        saveConversations();
      }
    }
    renderConvList();
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    ev.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  titleEl.replaceWith(input);
  input.focus();
  input.select();
}

function cancelRenameConversation() {
  if (!renamingConvId) return;
  const id = renamingConvId;
  renamingConvId = null;
  renderConvList();
}

function updateConvTitle(id, firstMsg) {
  const conv = conversations.find(c => c.id === id);
  if (!conv || conv.title !== 'New chat') return;
  conv.title = firstMsg.slice(0, 60) + (firstMsg.length > 60 ? '…' : '');
  saveConversations();
  renderConvList();
}

function updateTokenCounterUI() {
  const badge = document.getElementById('token-count-text');
  if (!badge) return;
  const conv = conversations.find(c => c.id === currentConvId);
  if (!conv || !conv.tokenUsage || conv.tokenUsage.total === 0) {
    badge.textContent = 'Tokens: 0';
    badge.title = 'Tokens spent in this conversation (Prompt in / Completion out)';
    return;
  }
  const { prompt, completion, total, estimated } = conv.tokenUsage;
  // v1.4.0: Surface when counts are an estimate (custom providers that don't
  // include stream_options.usage), so users aren't misled into thinking the
  // numbers are exact.
  const tag = estimated ? ' (est.)' : '';
  badge.textContent = `Tokens: ${total.toLocaleString()}${tag} (${prompt.toLocaleString()} in / ${completion.toLocaleString()} out)`;
  badge.title = estimated
    ? 'Token counts are estimated from text length / 4. The provider did not return exact usage.'
    : 'Tokens spent in this conversation (Prompt in / Completion out)';
}
