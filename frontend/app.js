/* ARKEL — app.js v1.6.0
   Phase 3: Engage floating panel substrate
   - Chat is now inside floating panels (one per conversation)
   - Sidebar conversations open chat panels on click
   - Model Hub, Role Matrix, Evolve App remain as separate panels
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

function bindStaticShellEvents() {
  if (document.body?.dataset.staticShellBound === '1') return;
  if (document.body) document.body.dataset.staticShellBound = '1';

  document.querySelectorAll('[data-action="show-panel"]').forEach(btn => {
    btn.addEventListener('click', () => showPanel(btn.dataset.panel));
  });

  const convSearch = document.getElementById('conv-search');
  if (convSearch) convSearch.addEventListener('input', (e) => filterConversations(e.target.value));
  document.getElementById('conv-search-clear')?.addEventListener('click', clearConvSearch);
  const newChatBtn = document.getElementById('new-chat-btn');
  if (newChatBtn && !newChatBtn.dataset.boundClick) {
    newChatBtn.dataset.boundClick = '1';
    newChatBtn.addEventListener('click', () => {
      const id = 'conv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      conversations.unshift({ id, title: 'New chat', messages: [], created: Date.now() });
      saveConversations();
      renderConvList();
      if (typeof openChatPanel === 'function') openChatPanel(id, 'New chat');
    });
  }

  // Chat controls (system prompt, clear, export) are now inside floating chat panels — no static binding needed

  const localBox = document.getElementById('test-local-endpoint-box');
  if (localBox) {
    localBox.addEventListener('click', testLocalEndpoint);
    localBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        testLocalEndpoint();
      }
    });
  }
  document.getElementById('endpoint-provider')?.addEventListener('change', onEndpointProviderChange);
  document.getElementById('endpoint-test-btn')?.addEventListener('click', testEndpoint);
  document.getElementById('endpoint-add-btn')?.addEventListener('click', addEndpoint);
  document.getElementById('refresh-catalog-btn')?.addEventListener('click', () => loadModels(true));
  document.getElementById('export-all-data-btn')?.addEventListener('click', exportAllData);
  document.getElementById('import-data-file')?.addEventListener('change', importAllData);

  document.getElementById('auto-assign-roles-btn')?.addEventListener('click', () => { autoAssignModelRoles(true); renderModelRoles(); });
  document.getElementById('clear-roles-btn')?.addEventListener('click', clearModelRoles);

  document.getElementById('clear-evolve-chat-btn')?.addEventListener('click', clearEvolveChat);
  document.getElementById('evolve-model-select')?.addEventListener('change', assignPlannerFromEvolveSelect);
  const evoInput = document.getElementById('evolve-input');
  if (evoInput) {
    evoInput.addEventListener('keydown', onEvolveInputKey);
    evoInput.addEventListener('input', () => autoResize(evoInput));
  }
  document.getElementById('evolve-send-btn')?.addEventListener('click', sendEvolveMessage);
  document.getElementById('evolve-stop-btn')?.addEventListener('click', stopEvolveMessage);
  document.getElementById('refresh-file-tree-btn')?.addEventListener('click', loadFileTree);

  const modalOverlay = document.getElementById('modal-overlay');
  if (modalOverlay) modalOverlay.addEventListener('click', closeModalOutside);
  document.getElementById('close-system-modal-btn')?.addEventListener('click', closeModal);
  document.getElementById('save-system-prompt-btn')?.addEventListener('click', saveSystemPrompt);

  const modelInfoOverlay = document.getElementById('model-info-overlay');
  if (modelInfoOverlay) modelInfoOverlay.addEventListener('click', closeModelInfoOutside);
  document.getElementById('close-model-info-btn')?.addEventListener('click', closeModelInfoModal);
}

window.addEventListener('DOMContentLoaded', () => {
  disableStaleAppCaches();
  initMarkdown();
  bindStaticShellEvents();

  // Render panel bar (tool buttons only)
  renderEngagePanelBar();

  // Load models first — needed for chat panel model selects
  loadModels().then(() => {
    // After models are loaded, open a chat panel
    const restoredChatPanels = getOpenPanelIds().filter(pid => {
      const layout = loadPanelLayout();
      return layout[pid]?.type === 'chat';
    });

    if (restoredChatPanels.length > 0) {
      restoreFloatingPanelLayout();
    } else if (conversations.length > 0) {
      openConversationAsPanel(conversations[0].id);
    } else {
      const id = 'conv-' + Date.now();
      conversations.unshift({ id, title: 'New chat', messages: [], created: Date.now() });
      saveConversations();
      openChatPanel(id, 'New chat');
    }
    renderConvList();
  });

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

  // Global Esc handler
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const ren = document.querySelector('.conv-rename-input');
      if (ren) { cancelRenameConversation(); return; }
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
      openConversationAsPanel(visible[idx].id);
    });
  }
});
