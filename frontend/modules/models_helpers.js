/* ARKEL — models helpers (split from models.js, Phase 1B)
   Shared utility functions used by models_select, models_center, models_actions. */

function providerLabel(p) {
  const found = models.find(m => m.provider === p && m.providerName);
  if (found && found.providerName) return found.providerName;
  if (String(p || '').startsWith('custom:')) {
    return 'Custom: ' + String(p).slice(7);
  }
  return { anthropic:'Anthropic', openai:'OpenAI', gemini:'Google Gemini', groq:'Groq', openrouter:'OpenRouter', deepseek:'DeepSeek', ollama:'Local (Ollama)' }[p] || p;
}

function capabilityBadges(m) {
  const caps = m.capabilities || {};
  const pricing = m.pricing?.freeStatus || 'unknown';
  const badges = [];
  if (pricing === 'local') badges.push('LOCAL');
  else if (pricing === 'free') badges.push('FREE');
  else if (pricing === 'paid') badges.push('PAID');
  else badges.push('UNKNOWN COST');
  if (caps.imageInput) badges.push('VISION');
  if (caps.reasoning) badges.push('REASON');
  if (caps.toolUse) badges.push('TOOLS');
  if (caps.code) badges.push('CODE');
  return badges;
}

function modelOptionText(m) { return `${m.name || m.id}`; }

function isModelSelectable(m) {
  if (m.disabled || m.enabled === false) return false;
  if (m.enabled === true || m.provider === 'ollama' || m.source === 'added-endpoint') return true;
  const probe = modelProbeFor(m);
  return ['pass', 'partial'].includes(probe?.status);
}

function modelKey(provider, id) { return `${provider}::${id}`; }

function modelProbeFor(m) { return m.probe || modelProbes[modelKey(m.provider, m.id)] || null; }

function setModelCenterFilter(filter) { modelCenterFilter = 'all'; renderModelCenter(); }

function modelMatchesCenterFilter(m) {
  return true;
}

function arenaEloValue(m, kind) {
  const leaderboards = m?.arena?.leaderboards || {};
  if (kind === 'chat') {
    if (Number.isFinite(leaderboards.text?.score)) return leaderboards.text.score;
    const chatScores = ['search', 'vision', 'document']
      .map(key => leaderboards[key]?.score)
      .filter(score => Number.isFinite(score));
    return chatScores.length ? Math.round(chatScores.reduce((sum, score) => sum + score, 0) / chatScores.length) : null;
  }
  if (kind === 'code') return Number.isFinite(leaderboards.code?.score) ? leaderboards.code.score : null;
  return null;
}

function arenaEloText(m, kind) {
  const value = arenaEloValue(m, kind);
  if (!m?.arena?.matched || !Number.isFinite(value)) return '—';
  return `ELO ${value}`;
}

function modelIdSubtitle(m) { return ''; }

function yesNoBadge(label, value) {
  return `<span class="model-cap ${value ? 'yes' : 'no'}">${value ? '✓' : '–'} ${escHtml(label)}</span>`;
}
