/* ARKEL — floating panel system v2 (Phase 3)
   Full windowed panel system for Engage.

   - Chat discussions are floating panels (one per conversation)
   - Nexus, Crew, Engineering are floating panels
   - Panels are draggable, resizable, minimizable
   - Panels snap to edges and can be maximized to fill the host
   - Panel bar at the top with: New Chat + Nexus + Crew + Engineering + open chat tabs
   - Sidebar conversations open their chat panel when clicked
   - Each chat panel has its own model select, system prompt, clear, export
*/

/* ── Panel type definitions ─────────────────────────────────────────────── */

const TOOL_PANEL_DEFS = {
  nexus: {
    title: 'NEXUS',
    icon: '◈',
    subtitle: 'File explorer',
    defaultWidth: 380,
    defaultHeight: 500,
    defaultX: 10,
    defaultY: 10,
    singleton: true,
  },
  crew: {
    title: 'CREW',
    icon: '◬',
    subtitle: 'Model teams',
    defaultWidth: 340,
    defaultHeight: 440,
    defaultX: 400,
    defaultY: 10,
    singleton: true,
  },
  engineering: {
    title: 'ENGINEERING',
    icon: '⬡',
    subtitle: 'Tasks & runs',
    defaultWidth: 420,
    defaultHeight: 500,
    defaultX: 200,
    defaultY: 40,
    singleton: true,
  },
};

const CHAT_PANEL_DEFAULTS = {
  defaultWidth: 520,
  defaultHeight: 520,
  minWidth: 320,
  minHeight: 280,
};

const TOOL_PANEL_MIN_SIZE = { width: 220, height: 180 };
const SNAP_THRESHOLD = 12; // pixels from edge to trigger snap
const FLOATING_PANEL_Z_BASE = 1000;
let floatingPanelZTop = FLOATING_PANEL_Z_BASE;

/* ── Layout persistence ──────────────────────────────────────────────────── */

function loadPanelLayout() {
  try {
    const raw = localStorage.getItem('arkelPanelLayout');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch { return {}; }
}

function savePanelLayout(layout) {
  try { localStorage.setItem('arkelPanelLayout', JSON.stringify(layout)); } catch {}
}

function getPanelGeom(id) {
  const layout = loadPanelLayout();
  const saved = layout[id];
  return saved ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height, maximized: !!saved.maximized } : null;
}

function setPanelGeom(id, patch) {
  const layout = loadPanelLayout();
  if (!layout[id]) layout[id] = {};
  Object.assign(layout[id], patch);
  savePanelLayout(layout);
}

function getOpenPanelIds() {
  const layout = loadPanelLayout();
  return Object.keys(layout).filter(k => layout[k].open);
}

/* ── Panel host dimensions ──────────────────────────────────────────────── */

function getPanelHostRect() {
  const host = document.getElementById('engage-panel-host');
  if (!host) return { width: 800, height: 600 };
  return { width: host.clientWidth, height: host.clientHeight };
}

/* ── Chat panel HTML ─────────────────────────────────────────────────────── */

function chatPanelHTML(convId, convTitle) {
  const safeTitle = escHtml(convTitle || 'New chat');
  return `
    <div class="fp-header" data-drag-handle>
      <div class="fp-title-wrap">
        <span class="fp-icon">◧</span>
        <span class="fp-title">${safeTitle}</span>
      </div>
      <div class="fp-header-actions">
        <button class="fp-maximize-btn" data-action="maximize-panel" title="Maximize">☐</button>
        <button class="fp-minimize-btn" data-action="minimize-panel" title="Minimize">─</button>
        <button class="fp-close-btn" data-action="close-panel" title="Close">✕</button>
      </div>
    </div>
    <div class="fp-body fp-chat-body">
      <div class="fp-chat-toolbar">
        <div class="fp-chat-model-bar">
          <label>Model:</label>
          <select class="fp-chat-model-select" aria-label="Select model for this chat"></select>
        </div>
        <div class="fp-chat-actions">
          <button class="fp-chat-action-btn" data-action="chat-system-prompt" title="System Prompt">System</button>
          <button class="fp-chat-action-btn" data-action="chat-clear" title="Clear messages">Clear</button>
          <button class="fp-chat-action-btn" data-action="chat-export" title="Export to Markdown">Export</button>
        </div>
      </div>
      <div class="fp-chat-messages" id="fp-chat-msgs-${escHtml(convId)}"></div>
      <div class="fp-chat-input-area">
        <textarea class="fp-chat-input" rows="1" placeholder="Type a message… (Enter to send)"></textarea>
        <button class="fp-chat-send-btn" data-action="chat-send">Send</button>
      </div>
    </div>`;
}

/* ── Tool panel HTML ─────────────────────────────────────────────────────── */

function toolPanelHTML(id) {
  const def = TOOL_PANEL_DEFS[id];
  return `
    <div class="fp-header" data-drag-handle>
      <div class="fp-title-wrap">
        <span class="fp-icon">${def.icon}</span>
        <span class="fp-title">${def.title}</span>
        <span class="fp-subtitle">${def.subtitle}</span>
      </div>
      <div class="fp-header-actions">
        <button class="fp-maximize-btn" data-action="maximize-panel" title="Maximize">☐</button>
        <button class="fp-minimize-btn" data-action="minimize-panel" title="Minimize">─</button>
        <button class="fp-close-btn" data-action="close-panel" title="Close">✕</button>
      </div>
    </div>
    <div class="fp-body" id="fp-body-${id}">
      <div class="fp-placeholder">Panel content will appear here as features are built.</div>
    </div>`;
}

/* ── Create panel element ─────────────────────────────────────────────────── */

function createFloatingPanel(id, type, opts) {
  const host = document.getElementById('engage-panel-host');
  if (!host) return null;

  // Don't duplicate singleton panels
  if (type === 'tool' && TOOL_PANEL_DEFS[id]?.singleton && document.getElementById(`fp-${id}`)) {
    return document.getElementById(`fp-${id}`);
  }

  const panel = document.createElement('div');
  panel.className = 'floating-panel';
  panel.id = `fp-${id}`;
  panel.dataset.panelId = id;
  panel.dataset.panelType = type;

  // Position & size
  const geom = getPanelGeom(id);
  const defaults = type === 'chat' ? CHAT_PANEL_DEFAULTS : TOOL_PANEL_DEFS[id];
  const minSize = type === 'chat' ? { width: CHAT_PANEL_DEFAULTS.minWidth, height: CHAT_PANEL_DEFAULTS.minHeight } : TOOL_PANEL_MIN_SIZE;
  const hostRect = getPanelHostRect();

  const x = geom?.x ?? (opts?.x ?? defaults.defaultX);
  const y = geom?.y ?? (opts?.y ?? defaults.defaultY);
  const w = geom?.width ?? (opts?.width ?? defaults.defaultWidth);
  const h = geom?.height ?? (opts?.height ?? defaults.defaultHeight);

  panel.style.left = Math.min(x, hostRect.width - 100) + 'px';
  panel.style.top = Math.min(y, hostRect.height - 60) + 'px';
  panel.style.width = w + 'px';
  panel.style.height = h + 'px';
  panel.style.minWidth = minSize.width + 'px';
  panel.style.minHeight = minSize.height + 'px';
  panel.style.zIndex = ++floatingPanelZTop;

  // Content
  if (type === 'chat') {
    panel.innerHTML = chatPanelHTML(id, opts?.title);
  } else {
    panel.innerHTML = toolPanelHTML(id);
  }

  // Bind header actions
  panel.querySelector('[data-action="close-panel"]')?.addEventListener('click', e => { e.stopPropagation(); closeFloatingPanel(id); });
  panel.querySelector('[data-action="minimize-panel"]')?.addEventListener('click', e => { e.stopPropagation(); minimizeFloatingPanel(id); });
  panel.querySelector('[data-action="maximize-panel"]')?.addEventListener('click', e => { e.stopPropagation(); maximizeFloatingPanel(id); });

  // Drag & resize
  bindFloatingPanelDrag(panel);
  bindFloatingPanelResize(panel);

  // Bring to front on click
  panel.addEventListener('mousedown', () => bringPanelToFront(id), true);

  host.appendChild(panel);
  return panel;
}

/* ── Drag system ──────────────────────────────────────────────────────────── */

function bindFloatingPanelDrag(panel) {
  const handle = panel.querySelector('[data-drag-handle]');
  if (!handle) return;

  let dragging = false, startX, startY, startLeft, startTop;

  handle.addEventListener('mousedown', (e) => {
    if (e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) return;
    // Un-maximize on drag if maximized
    if (panel.dataset.maximized === '1') {
      unmaximizeFloatingPanel(panel.dataset.panelId, e.clientX, e.clientY);
    }
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = panel.offsetLeft;
    startTop = panel.offsetTop;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    let newX = startLeft + dx;
    let newY = startTop + dy;
    // Snap to edges
    const host = document.getElementById('engage-panel-host');
    if (host) {
      const hostW = host.clientWidth;
      const hostH = host.clientHeight;
      if (newX < SNAP_THRESHOLD) newX = 0;
      if (newY < SNAP_THRESHOLD) newY = 0;
      if (newX + panel.offsetWidth > hostW - SNAP_THRESHOLD) newX = hostW - panel.offsetWidth;
      if (newY + panel.offsetHeight > hostH - SNAP_THRESHOLD) newY = hostH - panel.offsetHeight;
    }
    panel.style.left = newX + 'px';
    panel.style.top = newY + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    setPanelGeom(panel.dataset.panelId, { x: panel.offsetLeft, y: panel.offsetTop });
  });
}

/* ── Resize system ────────────────────────────────────────────────────────── */

function bindFloatingPanelResize(panel) {
  // Add resize handle in bottom-right corner
  const handle = document.createElement('div');
  handle.className = 'fp-resize-handle';
  handle.title = 'Drag to resize';
  panel.appendChild(handle);

  let resizing = false, startX, startY, startW, startH;

  handle.addEventListener('mousedown', (e) => {
    resizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startW = panel.offsetWidth;
    startH = panel.offsetHeight;
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const newW = Math.max(parseInt(panel.style.minWidth) || 200, startW + (e.clientX - startX));
    const newH = Math.max(parseInt(panel.style.minHeight) || 180, startH + (e.clientY - startY));
    panel.style.width = newW + 'px';
    panel.style.height = newH + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    setPanelGeom(panel.dataset.panelId, { width: panel.offsetWidth, height: panel.offsetHeight });
  });
}

/* ── Maximize / unmaximize ──────────────────────────────────────────────── */

function maximizeFloatingPanel(id) {
  const panel = document.getElementById(`fp-${id}`);
  const host = document.getElementById('engage-panel-host');
  if (!panel || !host) return;

  // Save pre-maximize geometry for restore
  if (panel.dataset.maximized !== '1') {
    setPanelGeom(id, {
      preMaxX: panel.offsetLeft,
      preMaxY: panel.offsetTop,
      preMaxW: panel.offsetWidth,
      preMaxH: panel.offsetHeight,
    });
  }

  panel.style.left = '0px';
  panel.style.top = '0px';
  panel.style.width = host.clientWidth + 'px';
  panel.style.height = host.clientHeight + 'px';
  panel.dataset.maximized = '1';
  setPanelGeom(id, { maximized: true, x: 0, y: 0, width: host.clientWidth, height: host.clientHeight });
}

function unmaximizeFloatingPanel(id, mouseX, mouseY) {
  const panel = document.getElementById(`fp-${id}`);
  if (!panel) return;

  const geom = getPanelGeom(id);
  const w = geom?.preMaxW || 520;
  const h = geom?.preMaxH || 520;
  // Center the panel around the mouse position for natural feel
  const x = (mouseX !== undefined) ? Math.max(0, mouseX - w / 2) : (geom?.preMaxX || 40);
  const y = (mouseY !== undefined) ? Math.max(0, mouseY - 20) : (geom?.preMaxY || 40);

  panel.style.left = x + 'px';
  panel.style.top = y + 'px';
  panel.style.width = w + 'px';
  panel.style.height = h + 'px';
  panel.dataset.maximized = '0';
  setPanelGeom(id, { maximized: false, x, y, width: w, height: h });
}

/* ── Panel management ─────────────────────────────────────────────────────── */

function bringPanelToFront(id) {
  const panel = document.getElementById(`fp-${id}`);
  if (panel) panel.style.zIndex = ++floatingPanelZTop;
}

function openToolPanel(id) {
  const def = TOOL_PANEL_DEFS[id];
  if (!def) return;
  let panel = document.getElementById(`fp-${id}`);
  if (panel) {
    panel.style.display = '';
    panel.classList.remove('fp-minimized');
    bringPanelToFront(id);
    setPanelGeom(id, { open: true });
    return;
  }
  panel = createFloatingPanel(id, 'tool');
  if (panel) setPanelGeom(id, { open: true });
  updatePanelBar();
}

function openChatPanel(convId, convTitle) {
  let panel = document.getElementById(`fp-${convId}`);
  if (panel) {
    panel.style.display = '';
    panel.classList.remove('fp-minimized');
    bringPanelToFront(convId);
    setPanelGeom(convId, { open: true });
    updatePanelBar();
    return;
  }
  const hostRect = getPanelHostRect();
  const x = 20 + (Object.keys(getOpenPanelIds()).length % 5) * 30;
  const y = 20 + (Object.keys(getOpenPanelIds()).length % 5) * 30;
  panel = createFloatingPanel(convId, 'chat', { title: convTitle, x, y });
  if (panel) {
    populateChatModelSelect(convId);
    setPanelGeom(convId, { open: true, type: 'chat', title: convTitle });
    // Wire chat panel events
    wireChatPanelEvents(convId);
  }
  updatePanelBar();
}

function closeFloatingPanel(id) {
  const panel = document.getElementById(`fp-${id}`);
  if (panel) {
    panel.style.display = 'none';
    panel.classList.remove('fp-minimized');
    panel.dataset.maximized = '0';
    setPanelGeom(id, { open: false, maximized: false });
  }
  updatePanelBar();
}

function minimizeFloatingPanel(id) {
  const panel = document.getElementById(`fp-${id}`);
  if (!panel) return;
  panel.classList.toggle('fp-minimized');
}

function toggleToolPanel(id) {
  const panel = document.getElementById(`fp-${id}`);
  if (panel && panel.style.display !== 'none') closeFloatingPanel(id);
  else openToolPanel(id);
}
