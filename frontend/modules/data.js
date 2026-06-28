/* BLACKLINE AI — data module (Phase 2) */

function exportAllData() {
  const data = {
    app: 'BLACKLINE AI',
    version: 2,
    exportDate: new Date().toISOString(),
    includes: [
      'conversations',
      'systemPrompt',
      'currentModel',
      'evolveMessages',
      'evolvePlanStates',
      'modelRoles',
      'evolveLayout'
    ],
    excluded: {
      apiKeys: 'API keys are intentionally not exported for security. They remain only in data/config.json on this machine.'
    },
    conversations,
    systemPrompt: localStorage.getItem('systemPrompt') || '',
    currentModel: loadStoredJson('currentModel', null),
    evolveMessages: loadStoredJson('evolveMessages', []),
    evolvePlanStates: loadStoredJson('evolvePlanStates', {}),
    modelRoles: loadStoredJson('modelRoles', {}),
    evolveLayout: {
      leftWidthPct: localStorage.getItem('evolveLeftWidthPct') || null
    }
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `blackline_ai_backup_${new Date().toISOString().replace(/[:.]/g, '')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('BLACKLINE AI data exported ✓', 'ok');
}

function importAllData(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      if (data.conversations && Array.isArray(data.conversations)) {
        conversations = data.conversations;
        saveConversations();
      }
      if (typeof data.systemPrompt === 'string') {
        systemPrompt = data.systemPrompt;
        localStorage.setItem('systemPrompt', systemPrompt);
        const si = document.getElementById('system-prompt-input');
        if (si) si.value = systemPrompt;
      }
      if (data.currentModel && typeof data.currentModel === 'object') {
        currentModel = data.currentModel;
        localStorage.setItem('currentModel', JSON.stringify(data.currentModel));
        populateModelSelect(JSON.stringify(data.currentModel));
      }
      if (Array.isArray(data.evolveMessages)) {
        evolveMessages = data.evolveMessages;
        saveEvolveMessages();
        renderEvolveMessages();
      }
      if (data.evolvePlanStates && typeof data.evolvePlanStates === 'object' && !Array.isArray(data.evolvePlanStates)) {
        evolvePlanStates = data.evolvePlanStates;
        localStorage.setItem('evolvePlanStates', JSON.stringify(evolvePlanStates));
      }
      if (data.modelRoles && typeof data.modelRoles === 'object' && !Array.isArray(data.modelRoles)) {
        modelRoles = data.modelRoles;
        localStorage.setItem('modelRoles', JSON.stringify(modelRoles));
        if (typeof renderModelRoles === 'function') renderModelRoles();
      }
      if (data.evolveLayout && data.evolveLayout.leftWidthPct !== undefined && data.evolveLayout.leftWidthPct !== null) {
        localStorage.setItem('evolveLeftWidthPct', String(data.evolveLayout.leftWidthPct));
        initEvolveResizer();
      }
      renderConvList();
      if (conversations.length > 0) loadConversation(conversations[0].id);
      else newConversation(true);
      toast('BLACKLINE AI data restored ✓', 'ok');
    } catch(err) { toast('Failed to restore data: invalid JSON', 'err'); }
    e.target.value = '';
  };
  reader.readAsText(file);
}

async function loadAppManifest() {
  try {
    const r = await fetch('/api/manifest');
    if (!r.ok) throw new Error('manifest HTTP ' + r.status);
    appManifest = await r.json();
    appManifestString = renderManifestAsPrompt(appManifest);
  } catch (e) {
    console.warn('Could not load app manifest:', e.message);
    appManifest = null;
    appManifestString = '';
  }
}

function renderManifestAsPrompt(m) {
  if (!m) return '';
  const lines = [];
  lines.push('=== APP MANIFEST ===');
  lines.push(`You are embedded inside the running app "${m.name}" (${m.description || ''}, v${m.version}).`);
  lines.push('You have READ-ONLY awareness of the codebase via the structured manifest below.');
  lines.push('');
  lines.push('--- TECH STACK ---');
  (m.techStack || []).forEach(t => lines.push('• ' + t));
  lines.push(`Port: ${m.port}`);
  lines.push('');
  lines.push('--- STORAGE ---');
  if (m.storage) Object.entries(m.storage).forEach(([k, v]) => lines.push(`• ${k}: ${v}`));
  lines.push('');
  lines.push('--- FILES (line counts only) ---');
  (m.files || []).forEach(f => lines.push(`• ${f.path}  (${f.lines} lines)`));
  lines.push('');
  lines.push('--- API ENDPOINTS ---');
  (m.endpoints || []).forEach(e => lines.push(`• ${e.method} ${e.path}`));
  lines.push('');
  lines.push('--- FRONTEND ---');
  if (m.frontend) {
    lines.push(`Frontend: frontend/index.html (~${m.frontend.lineCount} lines), frontend/styles.css (~${m.frontend.styleLineCount || 0}), frontend/app.js bootstrap (~${m.frontend.scriptLineCount || 0})`);
    lines.push(`Panels: ${(m.frontend.panels || []).join(', ')}`);
    if (Array.isArray(m.frontend.navItems) && m.frontend.navItems.length) {
      lines.push('Navigation labels live in frontend/index.html:');
      m.frontend.navItems.forEach(item => lines.push(`• ${item.panel}: ${item.label} (${item.source || 'frontend/index.html'})`));
    }
  }
  if (m.architecture) {
    lines.push('');
    lines.push('--- MODULAR ARCHITECTURE MANIFESTS ---');
    lines.push(`Backend manifest: ${m.architecture.backendManifest || 'backend/manifest.json'}`);
    (m.architecture.backendModules || []).forEach(mod => lines.push(`• backend:${mod.name} → ${mod.path} (${mod.lines || '?'} lines)`));
    lines.push(`Frontend manifest: ${m.architecture.frontendManifest || 'frontend/modules/frontend-manifest.json'}`);
    (m.architecture.frontendModules || []).forEach(mod => {
      const dom = Array.isArray(mod.domTargets) && mod.domTargets.length ? ` DOM: ${mod.domTargets.join(', ')}` : '';
      lines.push(`• frontend:${mod.name} → ${mod.path} (${mod.lines || '?'} lines)${dom}`);
    });
  }
  lines.push('');
  lines.push('--- CAPABILITIES ---');
  (m.capabilities || []).forEach(c => lines.push('✓ ' + c));
  lines.push('');
  lines.push('--- HARD CONSTRAINTS ---');
  (m.hardConstraints || []).forEach(c => lines.push('✗ ' + c));
  lines.push('');
  lines.push('--- HOW UPDATES WORK ---');
  (m.updateWorkflow || []).forEach(s => lines.push(s));
  lines.push('');
  if (m.updatePromptGuide) {
    lines.push('--- HOW TO WRITE A GREAT PLAN ---');
    (m.updatePromptGuide.what_makes_a_great_prompt || []).forEach(t => lines.push('• ' + t));
    lines.push(''); lines.push('Format: ' + (m.updatePromptGuide.format || ''));
  }
  lines.push(''); lines.push('=== END APP MANIFEST ===');
  return lines.join('\n');
}
