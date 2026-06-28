/* BLACKLINE AI — panels module (Phase 2) */

function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('visible'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const panel = document.getElementById(name + '-panel');
  if (panel) panel.classList.add('visible');
  const nav = document.querySelector(`[data-panel="${name}"]`);
  if (nav) nav.classList.add('active');

  const toolbar = document.getElementById('toolbar');
  if (toolbar) toolbar.classList.toggle('hidden', name !== 'chat');

  if (name === 'chat') document.getElementById('msg-input')?.focus();
  if (name === 'roles') renderModelRoles();
  if (name === 'evolve') {
    document.getElementById('evolve-input')?.focus();
    requestAnimationFrame(() => initEvolveResizer());
    loadFileTree();
  }
}

function openSystemModal() {
  const inp = document.getElementById('system-prompt-input');
  if (inp) inp.value = systemPrompt;
  const overlay = document.getElementById('modal-overlay');
  if (overlay) { overlay.classList.add('open'); overlay.style.display = 'flex'; setTimeout(() => inp?.focus(), 30); }
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) { overlay.classList.remove('open'); overlay.style.display = 'none'; }
}

function closeModalOutside(e) { if (e.target === document.getElementById('modal-overlay')) closeModal(); }

function openModelInfoModal() {
  const overlay = document.getElementById('model-info-overlay');
  const content = document.getElementById('model-info-content');
  const m = currentModelObject();
  if (!overlay || !content) return;
  if (!m) {
    content.innerHTML = '<p class="model-info-muted">Select a model first.</p>';
  } else {
    const caps = m.capabilities || {};
    const pricing = m.pricing || {};
    const probe = modelProbeFor(m);
    const ping = probe?.tests?.ping;
    const pingInfo = probe?.type === 'ping' || ping
      ? `<h4>Last ping</h4>
        <p class="model-info-muted">Status: <strong>${escHtml(ping?.status || probe.status || 'unknown')}</strong>${probe.pingMs ? ` · ${escHtml(probe.pingMs)}ms` : ''}</p>
        ${ping?.error ? `<p class="model-info-muted"><strong>Error:</strong> ${escHtml(ping.error)}</p>` : ''}`
      : '';
    const arenaLabels = { text: 'Chat · Text', search: 'Chat · Search', vision: 'Chat · Vision', document: 'Chat · Document', code: 'Code · WebDev' };
    const arenaRows = m.arena?.leaderboards && Object.keys(m.arena.leaderboards).length
      ? Object.entries(arenaLabels).map(([key, label]) => {
          const item = m.arena.leaderboards[key];
          return `<div class="probe-detail-row"><span>${escHtml(label)}</span><strong>${item ? `ELO ${escHtml(item.score)}` : '—'}</strong><em>${item ? `#${escHtml(item.rank)} · ±${escHtml(item.ci ?? '?')} · ${escHtml(item.votes ?? '?')} votes` : 'No Arena match'}</em></div>`;
        }).join('')
      : `<p class="model-info-muted">No live Arena leaderboard match.</p>
         <p class="model-info-muted">Heuristic estimate: Chat ${escHtml(m.arena?.chatElo || m.arena?.textElo || '?')} · Code ${escHtml(m.arena?.codeElo || m.arena?.codingElo || '?')}. This is not a proven Arena ELO; BLACKLINE estimates it from provider/model-name signals such as code/reasoning keywords, long-context hints, JSON/tool support likelihood, model size, and known model-family patterns.</p>`;
    content.innerHTML = `
      <div class="model-info-name">${escHtml(m.name || m.id)}</div>
      <div class="model-info-id">${escHtml(providerLabel(m.provider))} · ${escHtml(m.id)}</div>
      <div class="model-info-badges">${capabilityBadges(m).map(b => `<span>${escHtml(b)}</span>`).join('')}</div>
      <h4>Capabilities</h4>
      <div class="model-cap-grid">
        ${yesNoBadge('Text', caps.text !== false)}
        ${yesNoBadge('Vision / image input', caps.imageInput)}
        ${yesNoBadge('Audio input', caps.audioInput)}
        ${yesNoBadge('File input', caps.fileInput)}
        ${yesNoBadge('Tool use', caps.toolUse)}
        ${yesNoBadge('JSON / structured output', caps.jsonMode)}
        ${yesNoBadge('Reasoning signal', caps.reasoning)}
        ${yesNoBadge('Long-context signal', caps.longContext)}
      </div>
      <h4>Arena ELOs</h4>
      <div class="probe-detail-grid">${arenaRows}</div>
      <p class="model-info-muted">Source: ${escHtml(m.arena?.source || 'local heuristic')} ${m.arena?.fetchedAt ? '· Fetched ' + escHtml(m.arena.fetchedAt) : ''}</p>
      <h4>Pricing / availability</h4>
      <p class="model-info-muted">Status: <strong>${escHtml(pricing.freeStatus || 'unknown')}</strong> · Source: ${escHtml(pricing.source || m.source || 'unknown')}</p>
      ${pricing.note ? `<p class="model-info-muted">${escHtml(pricing.note)}</p>` : ''}
      ${pingInfo}
      <p class="model-info-warning">Arena ELOs come from cached public Arena leaderboard snapshots when BLACKLINE can match the provider model name. Capabilities and pricing are provider metadata or local estimates, so verify pricing and limits with the provider before heavy use.</p>`;
  }
  overlay.style.display = 'flex';
  overlay.classList.add('open');
}

function closeModelInfoModal() {
  const overlay = document.getElementById('model-info-overlay');
  if (overlay) { overlay.classList.remove('open'); overlay.style.display = 'none'; }
}

function closeModelInfoOutside(e) { if (e.target === document.getElementById('model-info-overlay')) closeModelInfoModal(); }

function saveSystemPrompt() {
  const inp = document.getElementById('system-prompt-input');
  systemPrompt = inp ? inp.value.trim() : '';
  localStorage.setItem('systemPrompt', systemPrompt);
  closeModal();
  toast('System prompt saved ✓', 'ok');
}
