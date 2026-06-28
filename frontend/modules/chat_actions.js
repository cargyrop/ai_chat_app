/* BLACKLINE AI — chat_actions module (Phase 2) */

function editMsgAction(idx) {
  const conv = conversations.find(c => c.id === currentConvId);
  if (!conv || !conv.messages[idx]) return;
  const targetMsg = conv.messages[idx];
  if (confirm('Edit this message and re-send? Later messages will be replaced.')) {
    const input = document.getElementById('msg-input');
    if (input) { input.value = targetMsg.content; autoResize(input); input.focus(); }
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
    flashCopied(btn);
  } catch { toast('Copy failed', 'err'); }
}

function regenMsgAction(idx) {
  const conv = conversations.find(c => c.id === currentConvId);
  if (!conv || !conv.messages[idx]) return;
  if (!confirm('Regenerate this assistant response?')) return;
  conv.messages = conv.messages.slice(0, idx);
  saveConversations();
  renderMessages(conv.messages);
  updateTokenCounterUI();
  const lastUserMsg = conv.messages[conv.messages.length - 1];
  if (lastUserMsg && lastUserMsg.role === 'user') {
    const textToResend = lastUserMsg.content;
    conv.messages.pop();
    saveConversations();
    sendMessage(textToResend);
  }
}

async function copyCode(btn, e) {
  if (e) e.stopPropagation();
  const pre = btn.closest('.code-block')?.querySelector('pre code');
  if (!pre) return;
  try { await navigator.clipboard.writeText(pre.textContent); flashCopied(btn); }
  catch { toast('Copy failed', 'err'); }
}

function clearCurrentChat() {
  if (!currentConvId) return;
  const conv = conversations.find(c => c.id === currentConvId);
  if (!conv) return;
  if (!confirm('Clear all messages in this conversation?')) return;
  conv.messages = [];
  conv.title = 'New chat';
  if (conv.tokenUsage) conv.tokenUsage = { prompt: 0, completion: 0, total: 0, estimated: false };
  saveConversations();
  renderConvList();
  renderMessages(conv.messages);
  updateTokenCounterUI();
  toast('Chat cleared', 'ok');
}

function exportCurrentChat() {
  if (!currentConvId) return;
  const conv = conversations.find(c => c.id === currentConvId);
  if (!conv || conv.messages.length === 0) { toast('Nothing to export', 'err'); return; }
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

function insertSuggestion(el) {
  const input = document.getElementById('msg-input');
  if (!input) return;
  input.value = el.textContent;
  autoResize(input);
  input.focus();
}
