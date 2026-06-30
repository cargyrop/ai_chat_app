const fs = require('fs');
const path = require('path');
const { getArenaRanking } = require('./arenaRegistry');

function prettyModelName(id) {
  return id
    .replace(/^models\//, '')
    .split('-')
    .map(part => part === 'tts' ? 'TTS' : part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function readErrorMessage(response, fallback) {
  try {
    const data = await response.json();
    return data.error?.message || (typeof data.error === 'string' ? data.error : '') || data.message || fallback;
  } catch {
    try { return await response.text() || fallback; }
    catch { return fallback; }
  }
}

function explainProviderError(provider, message) {
  if (provider === 'gemini' && /quota|rate limit|resource_exhausted/i.test(message)) {
    return `${message}\n\nGemini accepted the model request, but the key has hit its current quota/rate limit. Wait for the reset time shown by Google, add billing, or try a different Gemini model/key.`;
  }
  return message;
}

function isAllowedProvider(provider, allowedSet) {
  return allowedSet.has(provider);
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return null;
  return messages
    .filter(m => m && ['user', 'assistant', 'system'].includes(m.role) && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 200000) }));
}

function safeResolve(base, rel) {
  if (!rel || typeof rel !== 'string' || rel.includes('\0')) return null;
  if (path.isAbsolute(rel) || /^[a-zA-Z]:[\\/]/.test(rel)) return null;
  const normalizedBase = path.resolve(base);
  const normalizedRel = path.normalize(rel).replace(/^([.][\\/])+/, '');
  const segments = normalizedRel.split(/[\\/]+/).filter(Boolean);
  const blocked = new Set(['node_modules', '.git', 'data', '.arena', '.cache', 'dist', 'build', 'coverage', '.env']);
  if (segments.length === 0 || segments.some(seg => seg === '..' || blocked.has(seg.toLowerCase()))) return null;
  const target = path.resolve(normalizedBase, normalizedRel);
  const relative = path.relative(normalizedBase, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return target;
}

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function joinRelPath(base, entry) {
  return toPosixPath(path.join(base, entry));
}

function listVisibleEntries(dir, blockedEntries) {
  const blocked = new Set((blockedEntries || []).map(x => String(x).toLowerCase()));
  return fs.readdirSync(dir)
    .filter(entry => !blocked.has(entry.toLowerCase()))
    .sort((a, b) => {
      const aDir = fs.statSync(path.join(dir, a)).isDirectory();
      const bDir = fs.statSync(path.join(dir, b)).isDirectory();
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });
}

function customProviderKey(provider) {
  if (typeof provider !== 'string' || !provider.startsWith('custom:')) return '';
  return provider.slice('custom:'.length).trim();
}

function isCustomProviderId(provider) {
  return /^[a-z0-9_-]{2,40}$/i.test(customProviderKey(provider));
}

function getCustomProvider(cfg, provider) {
  const id = customProviderKey(provider);
  if (!id) return null;
  return (cfg.customProviders || []).find(p => p && p.id === id && p.enabled !== false) || null;
}

function sanitizeCustomProviderInput(input, existing = null) {
  const label = String(input?.label || existing?.label || '').trim().slice(0, 60);
  const rawId = String(input?.id || label || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const id = rawId || existing?.id;
  const baseUrl = String(input?.baseUrl || existing?.baseUrl || '').trim().replace(/\/+$/, '');
  const apiKey = String(input?.apiKey || existing?.apiKey || '').trim();
  if (!id || !/^[a-z0-9_-]{2,40}$/i.test(id)) throw new Error('Custom provider id must be 2-40 letters, numbers, dashes or underscores');
  if (!label) throw new Error('Custom provider label is required');
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('Custom provider base URL must start with http:// or https://');
  if (!apiKey) throw new Error('Custom provider API key is required');
  return {
    id,
    label,
    icon: String(input?.icon || existing?.icon || '◆').trim().slice(0, 2) || '◆',
    baseUrl,
    apiKey,
    modelsPath: String(input?.modelsPath || existing?.modelsPath || '/models').trim() || '/models',
    chatPath: String(input?.chatPath || existing?.chatPath || '/chat/completions').trim() || '/chat/completions',
    enabled: input?.enabled !== false,
  };
}

function publicCustomProvider(p) {
  return {
    id: p.id,
    label: p.label,
    icon: p.icon || '◆',
    baseUrl: p.baseUrl,
    modelsPath: p.modelsPath || '/models',
    chatPath: p.chatPath || '/chat/completions',
    enabled: p.enabled !== false,
    keyMasked: p.apiKey ? '••••' + p.apiKey.slice(-4) : '',
  };
}

function joinUrl(baseUrl, routePath) {
  return String(baseUrl || '').replace(/\/+$/, '') + '/' + String(routePath || '').replace(/^\/+/, '');
}

function defaultOllamaBaseUrl() {
  return String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
}

function ollamaBaseUrl(cfg, provider = 'ollama') {
  const ep = (cfg?.endpoints || []).find(e => e && e.id === provider && e.enabled !== false && (e.providerType || e.id) === 'ollama' && e.baseUrl);
  return String(ep?.baseUrl || defaultOllamaBaseUrl()).trim().replace(/\/+$/, '');
}

function ollamaBaseUrlCandidates(cfg, provider = 'ollama') {
  const candidates = [
    ollamaBaseUrl(cfg, provider),
    defaultOllamaBaseUrl(),
    'http://localhost:11434',
  ];
  return [...new Set(candidates.map(v => String(v || '').trim().replace(/\/+$/, '')).filter(Boolean))];
}

function modelIntelligence(provider, id, name = '', raw = {}) {
  const providerKind = raw.providerType || provider;
  const full = `${providerKind} ${provider} ${id} ${name}`.toLowerCase();
  const arena = getArenaRanking(provider, id, name);
  const caps = {
    text: true,
    imageInput: /gpt-4o|gpt-4\.1|gemini|claude-3|claude-sonnet|claude-opus|vision|pixtral|qwen-vl|vl\b|llava/i.test(full) || !!arena.caps?.vision,
    imageOutput: /image|dall-e|imagen|flux|stable-diffusion/i.test(full),
    audioInput: /gpt-4o|audio|realtime|gemini/i.test(full),
    audioOutput: /audio|tts|realtime/i.test(full),
    fileInput: /gpt-4|gpt-4o|gpt-4\.1|claude|gemini|openrouter/i.test(full),
    toolUse: !/ollama/i.test(providerKind) && !/embedding|tts|whisper|image/i.test(full),
    jsonMode: !/ollama/i.test(providerKind),
    streaming: true,
    reasoning: /o1|o3|o4|reasoner|thinking|r1|deepseek-r1|qwq/i.test(full) || !!arena.caps?.reasoning,
    code: /coder|code|gpt-4|claude|sonnet|opus|gemini|deepseek|qwen|llama|mistral|mixtral|70b|405b/i.test(full) || !!arena.caps?.code,
    longContext: /gemini|claude|sonnet|opus|gpt-4|128k|200k|1m|long/i.test(full) || !!arena.caps?.longContext,
  };

  const contextWindow = raw.context_length || raw.contextWindow || raw.top_provider?.context_length || raw.architecture?.context_length || null;
  const promptPrice = raw.pricing?.prompt;
  const completionPrice = raw.pricing?.completion;
  let freeStatus = 'unknown';
  let pricingSource = 'estimated';
  if (providerKind === 'ollama') { freeStatus = 'local'; pricingSource = 'local'; }
  else if (String(id).includes(':free') || (promptPrice === '0' && completionPrice === '0')) { freeStatus = 'free'; pricingSource = 'provider-metadata'; }
  else if (providerKind === 'openai' || providerKind === 'anthropic' || providerKind === 'deepseek') { freeStatus = 'paid'; pricingSource = 'provider-policy-estimate'; }
  else if (providerKind === 'gemini' || providerKind === 'groq') { freeStatus = 'free-tier-or-paid'; pricingSource = 'provider-policy-estimate'; }

  let score = 0;
  if (arena.matched) {
    score = arena.score;
  } else {
    if (caps.code) score += 30;
    if (caps.longContext) score += 18;
    if (caps.jsonMode) score += 15;
    if (caps.toolUse) score += 8;
    if (caps.reasoning) score += 10;
    if (/sonnet|opus|gpt-4|gpt-4\.1|o3|gemini-2\.5|deepseek|qwen.*coder|coder|70b|405b|mistral|mixtral/i.test(full)) score += 19;
    if (/mini|lite|8b|3b|haiku/i.test(full)) score -= 8;
    score = Math.max(0, Math.min(100, score));
  }
  const capable = score >= 55;

  const estTextElo = 1000 + Math.round(score * 2.5);
  const estCodingElo = caps.code ? estTextElo + 15 : estTextElo - 20;

  return {
    source: raw._source || 'provider-api-or-registry',
    arena: {
      matched: arena.matched,
      name: arena.matched ? arena.name : prettyModelName(id),
      textElo: arena.matched ? arena.textElo : estTextElo,
      codingElo: arena.matched ? arena.codingElo : estCodingElo
    },
    capabilities: caps,
    limits: { contextWindow },
    pricing: {
      freeStatus,
      source: pricingSource,
      prompt: promptPrice ?? null,
      completion: completionPrice ?? null,
      note: freeStatus === 'unknown' ? 'Pricing/cost status is unknown. Check provider billing before heavy use.' : undefined,
    },
    evolve: {
      capable,
      score,
      tier: score >= 80 ? 'recommended' : score >= 65 ? 'good' : score >= 55 ? 'experimental' : 'not-recommended',
      reasons: [
        arena.matched ? `LMSYS ELO ${arena.textElo}` : (caps.code ? 'coding-capable family/name' : 'limited coding signal'),
        caps.longContext ? 'long-context signal' : 'unknown/standard context',
        caps.jsonMode ? 'structured-output likely' : 'structured-output unknown',
      ]
    },
    updateCapable: capable,
  };
}

function enrichModel(m, raw = {}) {
  const intel = modelIntelligence(m.provider, m.id, m.name, { ...m, ...raw });
  return { ...m, ...intel, source: m.source || intel.source, updateCapable: intel.updateCapable };
}

module.exports = {
  prettyModelName,
  readErrorMessage,
  explainProviderError,
  isAllowedProvider,
  sanitizeMessages,
  safeResolve,
  toPosixPath,
  joinRelPath,
  listVisibleEntries,
  customProviderKey,
  isCustomProviderId,
  getCustomProvider,
  sanitizeCustomProviderInput,
  publicCustomProvider,
  joinUrl,
  defaultOllamaBaseUrl,
  ollamaBaseUrl,
  ollamaBaseUrlCandidates,
  modelIntelligence,
  enrichModel,
};
