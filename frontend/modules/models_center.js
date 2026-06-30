/* ARKEL — models center (split from models.js, Phase 1B)
   Model Center catalog rendering, provider blocks, model rows. */

function modelRowHtml(m, isEnabled, textEloTxt, codeEloTxt, caps, reactHtml) {
  return `
        <td class="td-center"><input type="checkbox" class="tp-checkbox" ${isEnabled ? 'checked' : ''} /></td>
        <td title="${escHtml(providerLabel(m.provider))} · ${escHtml(m.id)}"><strong>${escHtml(m.name || m.id)}</strong>${modelIdSubtitle(m)}</td>
        <td><span class="tp-elo-num">${textEloTxt}</span></td>
        <td><span class="tp-elo-num">${codeEloTxt}</span></td>
        <td><div class="mini-badges">${caps}</div></td>
        <td class="react-cell">${reactHtml}</td>
        <td class="td-actions"></td>
      `;
}

function bindProviderHeaderActions(block, prov, isAddedEndpoint) {
  const header = block.querySelector('.tp-provider-header');
  const actionsWrap = block.querySelector('.tp-provider-actions');
  if (header) header.addEventListener('click', () => toggleProviderTable(prov));
  if (actionsWrap) actionsWrap.addEventListener('click', (e) => e.stopPropagation());
  block.querySelectorAll('[data-action="toggle-provider-enable"]').forEach(btn => {
    btn.addEventListener('click', () => toggleEntireProvider(prov, btn.dataset.enable === 'true'));
  });
  if (isAddedEndpoint) {
    block.querySelector('[data-action="delete-provider-endpoint"]')?.addEventListener('click', () => deleteEndpoint(prov));
  }
}

function bindModelRowActions(tr, m) {
  const checkbox = tr.querySelector('.tp-checkbox');
  if (checkbox) checkbox.addEventListener('change', () => toggleModelEnabled(m.provider, m.id, checkbox.checked));

  const opsCell = tr.lastElementChild;
  const pingBtn = document.createElement('button');
  pingBtn.className = 'btn-tp-ping';
  pingBtn.textContent = 'PING';
  pingBtn.title = 'Tier 1 latency reaction ping (1 token)';
  pingBtn.addEventListener('click', () => pingModel(m, pingBtn, tr.querySelector('.react-cell')));

  const infoBtn = document.createElement('button');
  infoBtn.className = 'btn-tp-info';
  infoBtn.textContent = 'INFO';
  infoBtn.addEventListener('click', () => { currentModel = { id: m.id, provider: m.provider }; openModelInfoModal(); });

  opsCell.append(pingBtn, infoBtn);
}

function renderModelCenter() {
  const container = document.getElementById('model-center-list');
  if (!container) return;
  modelCenterFilter = 'all';

  const filtered = models.filter(m => modelMatchesCenterFilter(m));
  const countHint = document.getElementById('catalog-counts-hint');
  const enabledInView = filtered.filter(m => m.enabled !== false).length;
  if (countHint) countHint.textContent = `${filtered.length} MODELS (${enabledInView} ACTIVE)`;

  if (!filtered.length) {
    container.innerHTML = '<div class="model-center-empty">No models found yet. Test and add an endpoint above, then click Refresh Catalog if needed.</div>';
    return;
  }

  container.innerHTML = '';
  const provGroups = {};
  for (const m of filtered) {
    if (!provGroups[m.provider]) provGroups[m.provider] = [];
    provGroups[m.provider].push(m);
  }

  for (const [prov, ms] of Object.entries(provGroups)) {
    ms.sort((a, b) => {
      const aElo = a.arena?.matched ? (arenaEloValue(a, 'chat') || 1000) : 1000;
      const bElo = b.arena?.matched ? (arenaEloValue(b, 'chat') || 1000) : 1000;
      if (aElo !== bElo) return bElo - aElo;
      return (a.name || a.id).localeCompare(b.name || b.id);
    });

    const totalInProv = models.filter(x => x.provider === prov).length;
    const enabledInProv = models.filter(x => x.provider === prov && x.enabled !== false).length;
    const isAddedEndpoint = ms.some(x => x.source === 'added-endpoint');

    const block = document.createElement('div');
    block.className = 'tp-provider-block';
    block.id = `tp-prov-${prov}`;

    block.innerHTML = `
      <div class="tp-provider-header">
        <div class="tp-provider-title-wrap">
          <span class="tp-prov-symbol">▪</span>
          <span class="tp-prov-name">${escHtml(providerLabel(prov))}</span>
          <span class="tp-prov-count">${enabledInProv}/${totalInProv} ACTIVE</span>
        </div>
        <div class="tp-provider-meta">
          <div class="tp-provider-actions">
            <button type="button" class="tp-provider-mini-btn" data-action="toggle-provider-enable" data-provider="${escHtml(prov)}" data-enable="true">ENABLE ALL</button>
            <button type="button" class="tp-provider-mini-btn" data-action="toggle-provider-enable" data-provider="${escHtml(prov)}" data-enable="false">DISABLE ALL</button>
            ${isAddedEndpoint ? `<button type="button" class="tp-provider-mini-btn danger" data-action="delete-provider-endpoint" data-provider="${escHtml(prov)}">DELETE</button>` : ''}
          </div>
          <span class="tp-prov-url">${escHtml(ms[0]?.baseUrl || prov)}</span>
          <span class="tp-collapse-arrow" id="arrow-${escHtml(prov)}">˅</span>
        </div>
      </div>
      <div class="tp-provider-body" id="body-${escHtml(prov)}">
        <table class="tp-catalog-table">
          <thead>
            <tr>
              <th class="th-act">ACT</th>
              <th>MODEL IDENTIFIER</th>
              <th>CHAT ELO</th>
              <th>CODE ELO</th>
              <th>CAPABILITIES</th>
              <th>REACTION STATUS</th>
              <th class="th-actions">ACTIONS</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    `;

    bindProviderHeaderActions(block, prov, isAddedEndpoint);

    applyProviderTableCollapsedState(
      prov,
      block.querySelector('.tp-provider-body'),
      block.querySelector('.tp-collapse-arrow')
    );

    const tbody = block.querySelector('tbody');
    for (const m of ms) {
      const isEnabled = m.enabled !== false;
      const tr = document.createElement('tr');
      if (!isEnabled) tr.className = 'disabled-row';

      const textEloTxt = arenaEloText(m, 'chat');
      const codeEloTxt = arenaEloText(m, 'code');
      const caps = capabilityBadges(m).map(b => `<span>${escHtml(b)}</span>`).join('');
      const probe = modelProbeFor(m);

      let reactHtml = '<span class="tp-status-dim">— UNTESTED</span>';
      if (probe?.pingStatus === 'ok' || probe?.status === 'pass') {
        reactHtml = `<span class="tp-status-ok">▪ PONG (${probe.pingMs || 18}MS)</span>`;
      } else if (probe?.pingStatus === 'err' || probe?.status === 'fail') {
        reactHtml = `<span class="tp-status-err">× ERR</span>`;
      }

      tr.innerHTML = modelRowHtml(m, isEnabled, textEloTxt, codeEloTxt, caps, reactHtml);
      bindModelRowActions(tr, m);
      tbody.appendChild(tr);
    }

    container.appendChild(block);
  }
}
