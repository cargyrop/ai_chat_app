/* BLACKLINE AI — evolve_tree module (Phase 2) */

function initEvolveResizer() {
  const layout = document.querySelector('.evolve-layout');
  const left = document.querySelector('.evolve-left');
  const right = document.querySelector('.evolve-right');
  const resizer = document.getElementById('evolve-resizer');
  if (!layout || !left || !right || !resizer) return;

  const setLeftWidth = (pct) => {
    const clamped = Math.max(20, Math.min(80, Number(pct) || 55));
    layout.style.setProperty('--evolve-left-width', `${clamped}%`);
    // Keep inline flex values in sync for browsers that do not re-evaluate CSS vars during drag.
    left.style.flex = `0 0 ${clamped}%`;
    right.style.flex = '1 1 0';
    return clamped;
  };

  const saved = Number(localStorage.getItem('evolveLeftWidthPct'));
  setLeftWidth(saved >= 20 && saved <= 80 ? saved : 55);

  if (resizer.dataset.resizeInitialized === 'true') return;
  resizer.dataset.resizeInitialized = 'true';

  let dragging = false;
  let lastPct = saved >= 20 && saved <= 80 ? saved : 55;
  const clientXFromEvent = (event) => event.touches?.[0]?.clientX ?? event.changedTouches?.[0]?.clientX ?? event.clientX;

  const onMove = (event) => {
    if (!dragging) return;
    const clientX = clientXFromEvent(event);
    if (typeof clientX !== 'number') return;
    event.preventDefault?.();
    const rect = layout.getBoundingClientRect();
    if (!rect.width) return;
    lastPct = setLeftWidth(((clientX - rect.left) / rect.width) * 100);
  };

  const stopDrag = () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem('evolveLeftWidthPct', lastPct.toFixed(2));
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', stopDrag);
    window.removeEventListener('pointercancel', stopDrag);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', stopDrag);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', stopDrag);
    window.removeEventListener('touchcancel', stopDrag);
  };

  const startDrag = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault?.();
    dragging = true;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    resizer.setPointerCapture?.(event.pointerId);
    if (event.type === 'pointerdown') {
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', stopDrag);
      window.addEventListener('pointercancel', stopDrag);
    } else if (event.type === 'touchstart') {
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', stopDrag);
      window.addEventListener('touchcancel', stopDrag);
    } else {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', stopDrag);
    }
  };

  if (window.PointerEvent) resizer.addEventListener('pointerdown', startDrag);
  else {
    resizer.addEventListener('mousedown', startDrag);
    resizer.addEventListener('touchstart', startDrag, { passive: false });
  }
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

function fileTreeLabel(fullPath) {
  const normalized = String(fullPath || '').replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || normalized;
}

function renderFileTreeNodes(nodes, container, level) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    const normalizedPath = String(node.path || '').replace(/\\/g, '/');
    node.path = normalizedPath;

    const div = document.createElement('div');
    div.className = 'evolve-tree-item';
    if (level === 0) div.classList.add('evolve-tree-root-item');
    div.style.paddingLeft = (level * 14 + 8) + 'px';
    div.title = normalizedPath;

    if (node.type === 'dir') {
      div.classList.add('evolve-tree-dir');
      div.innerHTML = `<span class="evolve-tree-icon">DIR</span><span class="evolve-tree-name">${escHtml(fileTreeLabel(normalizedPath))}</span>`;
      const childContainer = document.createElement('div');
      childContainer.className = 'evolve-tree-children';
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        childContainer.style.display = childContainer.style.display === 'none' ? 'block' : 'none';
      });
      container.appendChild(div);
      container.appendChild(childContainer);
      renderFileTreeNodes(node.children, childContainer, level + 1);
    } else {
      div.classList.add('evolve-tree-file');
      div.innerHTML = `<span class="evolve-tree-icon">FILE</span><span class="evolve-tree-name">${escHtml(fileTreeLabel(normalizedPath))}</span>`;
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        showFileViewer(normalizedPath, node.content);
        document.querySelectorAll('.evolve-tree-file').forEach(el => el.classList.remove('active'));
        div.classList.add('active');
      });
      container.appendChild(div);
    }
  }
}

function showFileViewer(path, content) {
  const viewer = document.getElementById('evolve-file-viewer');
  if (!viewer) return;
  viewer.innerHTML = `<div class="evolve-file-viewer-title">${escHtml(path)}</div><pre>${escHtml(content)}</pre>`;
  viewer.style.display = 'block';
}
