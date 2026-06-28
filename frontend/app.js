/* BLACKLINE AI — app.js v1.4.3
   Phase 2: Frontend modularization
   - All logic moved to frontend/modules/
   - This file is the thin bootstrap that wires everything on DOMContentLoaded
*/

function disableStaleAppCaches() {
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then(registrations => registrations.forEach(reg => reg.unregister()))
        .catch(() => {});
    }
    if (window.caches?.keys) {
      caches.keys()
        .then(keys => keys.filter(key => /blackline|workbox|precache|runtime/i.test(key)).forEach(key => caches.delete(key)))
        .catch(() => {});
    }
  } catch {}
}

window.addEventListener('DOMContentLoaded', () => {
  disableStaleAppCaches();
  initMarkdown();
  renderConvList();
  loadModels();
  buildKeysList();
  loadCustomProviderPresets();
  buildCustomProvidersList();
  checkOllama();
  if (systemPrompt) {
    const si = document.getElementById('system-prompt-input');
    if (si) si.value = systemPrompt;
  }
  loadAppManifest();
  populateEvolveModelSelect();
  if (typeof renderEvolveRoleSummary === 'function') renderEvolveRoleSummary();
  if (typeof renderModelRoles === 'function') renderModelRoles();
  loadFileTree();
  initEvolveResizer();
  renderEvolveMessages();

  const msgInput = document.getElementById('msg-input');
  if (msgInput) msgInput.addEventListener('keydown', onInputKey);
  const evoInput = document.getElementById('evolve-input');
  if (evoInput) evoInput.addEventListener('keydown', onEvolveInputKey);

  // make suggestions keyboard accessible
  document.querySelectorAll('.suggestion').forEach(el => {
    el.setAttribute('tabindex', '0');
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); insertSuggestion(el); }});
  });

  // Global Esc handler
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // close rename input first
      const ren = document.querySelector('.conv-rename-input');
      if (ren) { cancelRenameConversation(); return; }
      // close modals
      closeModelInfoModal();
      closeModal();
    }
  });

  // Conversation list keyboard navigation
  const convList = document.getElementById('conv-list');
  if (convList) {
    convList.setAttribute('tabindex', '0');
    convList.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const visible = getFilteredConversations();
      if (!visible.length) return;
      let idx = visible.findIndex(c => c.id === currentConvId);
      if (idx === -1) idx = 0;
      idx += e.key === 'ArrowDown' ? 1 : -1;
      idx = Math.max(0, Math.min(visible.length - 1, idx));
      loadConversation(visible[idx].id);
    });
  }

  if (conversations.length === 0) newConversation(false);
  else loadConversation(conversations[0].id);
});
