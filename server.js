const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
app.disable('x-powered-by');
const PORT = parseInt(process.env.PORT, 10) || 3737;
const DATA_FILE = path.join(__dirname, 'data', 'config.json');
const EVOLVE_EXECUTION_TIMEOUT_MS = 15 * 60 * 1000;
const ALLOWED_PROVIDERS = new Set(['anthropic', 'openai', 'gemini', 'groq', 'openrouter', 'deepseek']);
const MAX_BACKUPS_TO_KEEP = 5;
const MAX_PLAN_ITEMS = 25;

// ── Simple in-memory rate limiter ────────────────────────────────────
const rateLimitBuckets = new Map();
function rateLimiter(windowMs, max) {
  windowMs = windowMs || 60000;
  max = max || 100;
  return function rateLimitMW(req, res, next) {
    const key = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    if (!rateLimitBuckets.has(key)) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    const bucket = rateLimitBuckets.get(key);
    if (now > bucket.resetAt) {
      bucket.count = 1;
      bucket.resetAt = now + windowMs;
      return next();
    }
    bucket.count++;
    if (bucket.count > max) {
      return res.status(429).json({ error: 'Too many requests. Please wait before trying again.' });
    }
    next();
  };
}
// Periodic cleanup to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateLimitBuckets) {
    if (now > b.resetAt + 60000) rateLimitBuckets.delete(k);
  }
}, 5 * 60 * 1000).unref();

// ── Security headers middleware ───────────────────────────────────────
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // CSP note (v1.4.1):
  //   - `style-src 'unsafe-inline'` is required: the UI uses inline style="" attributes heavily.
  //   - `script-src 'unsafe-inline'` is ALSO required: index.html uses inline event
  //     handlers (`onclick="…"`, `onkeydown="…"`, `oninput="…"`) on dozens of elements.
  //     CSP's `script-src` governs inline event handlers just like it governs inline
  //     <script> tags — without 'unsafe-inline', every onclick silently fails and the
  //     UI appears frozen. (This is what v1.4.0 got wrong and v1.4.1 reverts.)
  //   The proper long-term fix is to refactor the HTML to use addEventListener instead
  //   of inline handlers, after which 'unsafe-inline' can be removed from script-src.
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://*.googleapis.com https://*.anthropic.com https://*.openai.com https://*.groq.com https://*.openrouter.ai https://*.deepseek.com http://localhost:11434; img-src 'self' data:;");
  next();
}

const GEMINI_FALLBACK_MODELS = [
  { id: 'gemini-2.0-flash',      name: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash-Lite' },
  { id: 'gemini-1.5-flash',      name: 'Gemini 1.5 Flash' },
  { id: 'gemini-1.5-pro',        name: 'Gemini 1.5 Pro' },
  { id: 'gemini-2.5-flash',      name: 'Gemini 2.5 Flash' },
];

app.use(cors({
  origin(origin, cb) {
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return cb(null, true);
    cb(new Error('Origin not allowed'));
  },
}));
app.use(securityHeaders);
app.use(rateLimiter(60000, 90));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// -- Config persistence --------------------------------------------------------
function loadConfig() {
  if (!fs.existsSync(DATA_FILE)) return { keys: {}, conversations: [] };
  try {
    const cfg = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (cfg?.keys) {
      for (const [k, v] of Object.entries(cfg.keys)) {
        if (!v || v === 'ENTER_YOUR_API_KEY' || v.includes('••••')) delete cfg.keys[k];
      }
    }
    return cfg;
  }
  catch { return { keys: {}, conversations: [] }; }
}
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmpFile = DATA_FILE + '.tmp.' + Date.now();
  fs.writeFileSync(tmpFile, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmpFile, DATA_FILE);
}
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
    return data.error?.message || data.message || fallback;
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
function isAllowedProvider(provider) {
  return ALLOWED_PROVIDERS.has(provider);
}
function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return null;
  return messages
    .filter(m => m && ['user', 'assistant', 'system'].includes(m.role) && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 200000) }));
}
function safeResolve(base, rel) {
  if (!rel || typeof rel !== 'string' || rel.includes('\0')) return null;
  // Block absolute paths, including Windows drive letters
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
  const baseUrl = String(input?.baseUrl || existing?.baseUrl || '').trim().replace(/\/+$/g, '');
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
  return String(baseUrl || '').replace(/\/+$/g, '') + '/' + String(routePath || '').replace(/^\/+/, '');
}
function modelIntelligence(provider, id, name = '', raw = {}) {
  const full = `${provider} ${id} ${name}`.toLowerCase();
  const caps = {
    text: true,
    imageInput: /gpt-4o|gpt-4\.1|gemini|claude-3|claude-sonnet|claude-opus|vision|pixtral|qwen-vl|vl\b|llava/i.test(full),
    imageOutput: /image|dall-e|imagen|flux|stable-diffusion/i.test(full),
    audioInput: /gpt-4o|audio|realtime|gemini/i.test(full),
    audioOutput: /audio|tts|realtime/i.test(full),
    fileInput: /gpt-4|gpt-4o|gpt-4\.1|claude|gemini|openrouter/i.test(full),
    toolUse: !/ollama/i.test(provider) && !/embedding|tts|whisper|image/i.test(full),
    jsonMode: !/ollama/i.test(provider),
    streaming: true,
    reasoning: /o1|o3|o4|reasoner|thinking|r1|deepseek-r1|qwq/i.test(full),
    code: /coder|code|gpt-4|claude|sonnet|opus|gemini|deepseek|qwen|llama|mistral|mixtral|70b|405b/i.test(full),
    longContext: /gemini|claude|sonnet|opus|gpt-4|128k|200k|1m|long/i.test(full),
  };

  const contextWindow = raw.context_length || raw.contextWindow || raw.top_provider?.context_length || raw.architecture?.context_length || null;
  const promptPrice = raw.pricing?.prompt;
  const completionPrice = raw.pricing?.completion;
  let freeStatus = 'unknown';
  let pricingSource = 'estimated';
  if (provider === 'ollama') { freeStatus = 'local'; pricingSource = 'local'; }
  else if (String(id).includes(':free') || (promptPrice === '0' && completionPrice === '0')) { freeStatus = 'free'; pricingSource = 'provider-metadata'; }
  else if (provider === 'openai' || provider === 'anthropic' || provider === 'deepseek') { freeStatus = 'paid'; pricingSource = 'provider-policy-estimate'; }
  else if (provider === 'gemini' || provider === 'groq') { freeStatus = 'free-tier-or-paid'; pricingSource = 'provider-policy-estimate'; }

  let score = 0;
  if (caps.code) score += 30;
  if (caps.longContext) score += 18;
  if (caps.jsonMode) score += 15;
  if (caps.toolUse) score += 8;
  if (caps.reasoning) score += 10;
  if (/sonnet|opus|gpt-4|gpt-4\.1|o3|gemini-2\.5|deepseek|qwen.*coder|coder|70b|405b|mistral|mixtral/i.test(full)) score += 19;
  if (/mini|lite|8b|3b|haiku/i.test(full)) score -= 8;
  score = Math.max(0, Math.min(100, score));
  const capable = score >= 55;

  return {
    source: raw._source || 'provider-api-or-registry',
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
        caps.code ? 'coding-capable family/name' : 'limited coding signal',
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

// -- API Keys ------------------------------------------------------------------
app.get('/api/keys', (req, res) => {
  const cfg = loadConfig();
  const safe = {};
  for (const [k, v] of Object.entries(cfg.keys || {})) {
    safe[k] = v ? '••••' + v.slice(-4) : '';
  }
  res.json(safe);
});

app.post('/api/keys', (req, res) => {
  const { provider, key } = req.body;
  if (!isAllowedProvider(provider)) return res.status(400).json({ error: 'unknown provider' });
  if (!key || typeof key !== 'string' || !key.trim()) return res.status(400).json({ error: 'provider and key required' });
  const cfg = loadConfig();
  cfg.keys = cfg.keys || {};
  cfg.keys[provider] = key.trim();
  // Key changes can change model access; old probe results are no longer trustworthy.
  clearModelProbesForProvider(cfg, provider);
  saveConfig(cfg);
  res.json({ ok: true });
});

app.delete('/api/keys/:provider', (req, res) => {
  if (!isAllowedProvider(req.params.provider)) return res.status(400).json({ error: 'unknown provider' });
  const cfg = loadConfig();
  delete (cfg.keys || {})[req.params.provider];
  clearModelProbesForProvider(cfg, req.params.provider);
  saveConfig(cfg);
  res.json({ ok: true });
});

// -- Custom OpenAI-compatible providers ---------------------------------------
app.get('/api/custom-providers', (req, res) => {
  const cfg = loadConfig();
  res.json((cfg.customProviders || []).map(publicCustomProvider));
});

app.post('/api/custom-providers', (req, res) => {
  try {
    const cfg = loadConfig();
    cfg.customProviders = Array.isArray(cfg.customProviders) ? cfg.customProviders : [];
    const incomingId = String(req.body?.id || '').trim();
    const existing = incomingId ? cfg.customProviders.find(p => p.id === incomingId) : null;
    const provider = sanitizeCustomProviderInput(req.body, existing);
    const idx = cfg.customProviders.findIndex(p => p.id === provider.id);
    if (idx >= 0) cfg.customProviders[idx] = provider;
    else cfg.customProviders.push(provider);
    // Provider config/key changes can change model access; reset stale probe results.
    clearModelProbesForProvider(cfg, `custom:${provider.id}`);
    saveConfig(cfg);
    res.json({ ok: true, provider: publicCustomProvider(provider) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/custom-providers/:id', (req, res) => {
  const cfg = loadConfig();
  cfg.customProviders = (cfg.customProviders || []).filter(p => p.id !== req.params.id);
  clearModelProbesForProvider(cfg, `custom:${req.params.id}`);
  saveConfig(cfg);
  res.json({ ok: true });
});

const CUSTOM_PROVIDER_PRESETS = [
  { id: 'kimi', label: 'Kimi / Moonshot', icon: '◐', type: 'openai-compatible', baseUrl: 'https://api.moonshot.ai/v1', modelsPath: '/models', chatPath: '/chat/completions' },
  { id: 'qwen', label: 'Qwen / DashScope', icon: '◆', type: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelsPath: '/models', chatPath: '/chat/completions' },
  { id: 'mistral', label: 'Mistral AI', icon: '◩', type: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1', modelsPath: '/models', chatPath: '/chat/completions' },
  { id: 'together', label: 'Together AI', icon: '◬', type: 'openai-compatible', baseUrl: 'https://api.together.xyz/v1', modelsPath: '/models', chatPath: '/chat/completions' },
  { id: 'fireworks', label: 'Fireworks AI', icon: '✦', type: 'openai-compatible', baseUrl: 'https://api.fireworks.ai/inference/v1', modelsPath: '/models', chatPath: '/chat/completions' },
  { id: 'xai', label: 'xAI / Grok', icon: '✕', type: 'openai-compatible', baseUrl: 'https://api.x.ai/v1', modelsPath: '/models', chatPath: '/chat/completions' },
  { id: 'lmstudio', label: 'LM Studio Local', icon: '◌', type: 'openai-compatible-local', baseUrl: 'http://localhost:1234/v1', modelsPath: '/models', chatPath: '/chat/completions' },
  { id: 'vllm', label: 'vLLM Local Server', icon: '◌', type: 'openai-compatible-local', baseUrl: 'http://localhost:8000/v1', modelsPath: '/models', chatPath: '/chat/completions' },
  { id: 'llamacpp', label: 'llama.cpp Server', icon: '◌', type: 'openai-compatible-local', baseUrl: 'http://localhost:8080/v1', modelsPath: '/models', chatPath: '/chat/completions' }
];

app.get('/api/custom-provider-presets', (req, res) => {
  res.json(CUSTOM_PROVIDER_PRESETS);
});

app.get('/api/model-probes', (req, res) => {
  const cfg = loadConfig();
  res.json(cfg.modelProbes || {});
});

function modelProbeKey(provider, model) {
  return `${provider}::${model}`;
}
function clearModelProbesForProvider(cfg, providerPrefix) {
  if (!cfg.modelProbes) return;
  for (const key of Object.keys(cfg.modelProbes)) {
    if (key.startsWith(`${providerPrefix}::`)) delete cfg.modelProbes[key];
  }
}
function extractFirstJson(text) {
  const cleaned = String(text || '').replace(/```(?:json|plan)?\s*([\s\S]*?)```/i, '$1').trim();
  const firstObj = cleaned.indexOf('{');
  const lastObj = cleaned.lastIndexOf('}');
  const firstArr = cleaned.indexOf('[');
  const lastArr = cleaned.lastIndexOf(']');
  if (firstArr !== -1 && lastArr > firstArr && (firstObj === -1 || firstArr < firstObj)) return JSON.parse(cleaned.slice(firstArr, lastArr + 1));
  if (firstObj !== -1 && lastObj > firstObj) return JSON.parse(cleaned.slice(firstObj, lastObj + 1));
  return JSON.parse(cleaned);
}
async function runSelfChatProbe(provider, model, prompt, systemPrompt = '') {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, model, messages: [{ role: 'user', content: prompt }], systemPrompt, enableThinking: false }),
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw new Error(await readErrorMessage(r, 'Probe request failed'));
  let answer = '';
  for await (const chunk of r.body) {
    const lines = Buffer.from(chunk).toString().split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const d = JSON.parse(line.slice(6));
      if (d.error) throw new Error(d.error);
      if (d.text) answer += d.text;
    }
  }
  return answer.trim();
}

app.post('/api/models/probe', async (req, res) => {
  const { provider, model } = req.body || {};
  if (!provider || !model) return res.status(400).json({ error: 'provider and model required' });
  const cfg = loadConfig();
  const customProvider = getCustomProvider(cfg, provider);
  if (provider !== 'ollama' && !customProvider && !(cfg.keys || {})[provider]) {
    return res.status(400).json({ error: `A valid ${provider} API key is required before probing.` });
  }

  const startedAt = new Date().toISOString();
  const tests = {};
  const run = async (name, fn) => {
    const t0 = Date.now();
    try {
      const detail = await fn();
      tests[name] = { status: 'pass', ms: Date.now() - t0, detail };
    } catch (err) {
      tests[name] = { status: 'fail', ms: Date.now() - t0, error: err.message };
    }
  };

  await run('basicChat', async () => {
    const out = await runSelfChatProbe(provider, model, 'Reply with exactly BLACKLINE_OK and nothing else.');
    if (!/BLACKLINE_OK/i.test(out)) throw new Error(`Unexpected reply: ${out.slice(0, 120)}`);
    return 'Model completed a basic chat request.';
  });
  await run('json', async () => {
    const out = await runSelfChatProbe(provider, model, 'Return only valid JSON with exactly these fields: {"ok":true,"tool":"blackline"}. No markdown.');
    const parsed = extractFirstJson(out);
    if (parsed.ok !== true || parsed.tool !== 'blackline') throw new Error('JSON parsed, but expected fields were missing.');
    return 'Model returned parseable JSON.';
  });
  await run('evolvePlan', async () => {
    const out = await runSelfChatProbe(provider, model, 'Return exactly one fenced code block tagged plan containing a JSON array with one object: {"path":"public/app.js","action":"edit","description":"probe only"}. No other text.');
    const match = out.match(/```plan\s*([\s\S]*?)```/i);
    if (!match) throw new Error('No ```plan block found.');
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed) || parsed[0]?.path !== 'public/app.js') throw new Error('Plan JSON shape was invalid.');
    return 'Model produced a parseable Evolve plan block.';
  });
  await run('evolvePatch', async () => {
    const out = await runSelfChatProbe(provider, model, 'Return only valid JSON for a search/replace patch: {"path":"public/app.js","action":"edit","changes":[{"search":"const probe = false;","replace":"const probe = true;"}]}. No markdown.');
    const parsed = extractFirstJson(out);
    if (!Array.isArray(parsed.changes) || !parsed.changes[0]?.search || !parsed.changes[0]?.replace) throw new Error('Patch JSON shape was invalid.');
    return 'Model produced parseable search/replace patch JSON.';
  });

  const passCount = Object.values(tests).filter(t => t.status === 'pass').length;
  const result = {
    provider,
    model,
    startedAt,
    updatedAt: new Date().toISOString(),
    score: Math.round((passCount / Object.keys(tests).length) * 100),
    status: passCount === Object.keys(tests).length ? 'pass' : passCount ? 'partial' : 'fail',
    tests,
  };
  cfg.modelProbes = cfg.modelProbes || {};
  cfg.modelProbes[modelProbeKey(provider, model)] = result;
  saveConfig(cfg);
  res.json(result);
});

// -- Health --------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: '1.4.2', time: new Date().toISOString() });
});

// -- Model discovery -----------------------------------------------------------
app.get('/api/models', async (req, res) => {
  const cfg = loadConfig();
  const keys = cfg.keys || {};
  const models = [];

  // Determine if a model is capable of self-updating
  const isUpdateCapable = (provider, id, name = '') => {
    const full = `${id} ${name}`.toLowerCase();
    if (provider === 'gemini' || provider === 'anthropic' || provider === 'deepseek') return true;
    if (provider === 'openai') return /gpt-4|o1|o3|gpt-5/i.test(full);
    if (provider === 'groq') return /70b|deepseek|3\.3|mixtral/i.test(full);
    if (provider === 'openrouter') return /sonnet|opus|gpt-4|o1|o3|gemini|70b|405b|deepseek|coder/i.test(full);
    if (provider === 'ollama') return /70b|deepseek|qwen|coder|llama3|phi4|mistral/i.test(full);
    return false;
  };

  // Anthropic – prefer live model discovery; fall back to a conservative local catalog.
  if (keys.anthropic) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': keys.anthropic,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(await readErrorMessage(r, 'Anthropic models request failed'));
      const data = await r.json();
      (data.data || [])
        .filter(m => !/embedding|image|audio/i.test(`${m.id} ${m.display_name}`))
        .slice(0, 30)
        .forEach(m => models.push({
          id: m.id,
          name: m.display_name || prettyModelName(m.id),
          provider: 'anthropic',
          icon: '◖',
          source: 'anthropic-models-api',
          createdAt: m.created_at || null,
        }));
      if (!models.some(m => m.provider === 'anthropic')) throw new Error('Anthropic returned no chat models');
    } catch (err) {
      models.push({
        id: 'model-list-error',
        name: `Anthropic model list error: ${err.message}`,
        provider: 'anthropic',
        icon: '◖',
        disabled: true,
        source: 'anthropic-models-api-error',
      });
    }
  }

  // OpenAI
  if (keys.openai) {
    try {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${keys.openai}` },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const data = await r.json();
        const chat = data.data
          .filter(m => m.id.startsWith('gpt') || /^o\d/.test(m.id))
          .filter(m => !/image|audio|realtime|transcribe|tts|embedding|moderation/i.test(m.id))
          .sort((a, b) => (b.created || 0) - (a.created || 0))
          .slice(0, 20);
        chat.forEach(m => models.push({ id: m.id, name: m.id, provider: 'openai', icon: '◎' }));
      } else {
        throw new Error('OpenAI fetch failed');
      }
    } catch {
      models.push(
        { id: 'gpt-4o',         name: 'GPT-4o',         provider: 'openai', icon: '◎' },
        { id: 'gpt-4o-mini',    name: 'GPT-4o mini',    provider: 'openai', icon: '◎' },
        { id: 'gpt-4.1',        name: 'GPT-4.1',        provider: 'openai', icon: '◎' },
        { id: 'o3-mini',        name: 'o3-mini',        provider: 'openai', icon: '◎' }
      );
    }
  }

  // Google Gemini
  if (keys.gemini) {
    try {
      const discovered = [];
      let pageToken = '';
      do {
        const params = new URLSearchParams({ key: keys.gemini, pageSize: '1000' });
        if (pageToken) params.set('pageToken', pageToken);
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?${params}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) throw new Error(await readErrorMessage(r, 'Could not list Gemini models'));

        const data = await r.json();
        (data.models || [])
          .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
          .filter(m => !/embedding|tts|image|veo|lyria|live|aqa/i.test(`${m.name} ${m.displayName}`))
          .forEach(m => {
            const id = (m.name || m.baseModelId || '').replace(/^models\//, '');
            if (!id || discovered.some(existing => existing.id === id)) return;
            discovered.push({
              id,
              name: m.displayName || prettyModelName(id),
              provider: 'gemini',
              icon: '◇',
            });
          });
        pageToken = data.nextPageToken || '';
      } while (pageToken);

      const preferredOrder = [
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
        'gemini-1.5-pro',
        'gemini-1.5-flash',
      ];
      discovered.sort((a, b) => {
        const ai = preferredOrder.indexOf(a.id);
        const bi = preferredOrder.indexOf(b.id);
        if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        return a.name.localeCompare(b.name);
      });
      models.push(...discovered.slice(0, 20));
    } catch {
      GEMINI_FALLBACK_MODELS.forEach(m =>
        models.push({ ...m, provider: 'gemini', icon: '◇' })
      );
    }
  }

  // Groq
  if (keys.groq) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${keys.groq}` },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const data = await r.json();
        data.data
          .filter(m => !/whisper|tts|audio|embedding|guard|moderation/i.test(m.id))
          .forEach(m => models.push({ id: m.id, name: m.id, provider: 'groq', icon: '⚡' }));
      } else {
        throw new Error('Groq fetch failed');
      }
    } catch {
      models.push(
        { id: 'llama-3.3-70b-versatile',       name: 'Llama 3.3 70B',       provider: 'groq', icon: '⚡' },
        { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 70B',     provider: 'groq', icon: '⚡' },
        { id: 'llama-3.1-8b-instant',          name: 'Llama 3.1 8B',        provider: 'groq', icon: '⚡' },
        { id: 'mixtral-8x7b-32768',            name: 'Mixtral 8x7B',        provider: 'groq', icon: '⚡' }
      );
    }
  }

  // OpenRouter
  if (keys.openrouter) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${keys.openrouter}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error('OpenRouter models request failed');
      const data = await r.json();
      const preferred = ['openai/', 'anthropic/', 'google/', 'meta-llama/', 'deepseek/', 'mistralai/', 'qwen/', 'moonshotai/', 'mistral/', 'z-ai/', 'nousresearch/'];
      const isFreeOpenRouterModel = (m) =>
        String(m.id || '').includes(':free') ||
        (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0);
      const isChatLikeOpenRouterModel = (m) => {
        const text = `${m.id || ''} ${m.name || ''}`;
        const inputModalities = m.architecture?.input_modalities || [];
        const outputModalities = m.architecture?.output_modalities || [];
        if (/embedding|moderation|tts|whisper|transcription|speech|rerank|lyria|music/i.test(text)) return false;
        if (outputModalities.length && !outputModalities.includes('text')) return false;
        return true;
      };
      (data.data || [])
        .filter(m => preferred.some(prefix => m.id?.startsWith(prefix)) || isFreeOpenRouterModel(m))
        .filter(isChatLikeOpenRouterModel)
        .sort((a, b) => {
          const af = isFreeOpenRouterModel(a) ? 0 : 1;
          const bf = isFreeOpenRouterModel(b) ? 0 : 1;
          if (af !== bf) return af - bf;
          return String(a.name || a.id).localeCompare(String(b.name || b.id));
        })
        .slice(0, 150)
        .forEach(m => models.push({
          id: m.id,
          provider: 'openrouter',
          name: `${m.name || m.id} (OR)`,
          icon: '⬡',
          source: 'openrouter-models-api',
          pricing: m.pricing || null,
          context_length: m.context_length || null,
          architecture: m.architecture || null,
          top_provider: m.top_provider || null,
        }));
    } catch {
      models.push(
        { id: 'openai/gpt-4o',                    provider: 'openrouter', name: 'GPT-4o (via OpenRouter)',       icon: '⬡' },
        { id: 'anthropic/claude-3.5-sonnet',      provider: 'openrouter', name: 'Claude 3.5 Sonnet (OR)',        icon: '⬡' },
        { id: 'google/gemini-2.0-flash-001',      provider: 'openrouter', name: 'Gemini 2.0 Flash (OR)',        icon: '⬡' },
        { id: 'meta-llama/llama-3.3-70b-instruct', provider: 'openrouter', name: 'Llama 3.3 70B (OR)',           icon: '⬡' },
        { id: 'deepseek/deepseek-chat',            provider: 'openrouter', name: 'DeepSeek Chat (OR)',           icon: '⬡' },
      );
    }
  }

  // DeepSeek
  if (keys.deepseek) {
    try {
      const r = await fetch('https://api.deepseek.com/models', {
        headers: { Authorization: `Bearer ${keys.deepseek}` },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const data = await r.json();
        (data.data || [])
          .forEach(m => models.push({ id: m.id, name: prettyModelName(m.id), provider: 'deepseek', icon: '▽' }));
      } else {
        throw new Error('DeepSeek fetch failed');
      }
    } catch {
      models.push(
        { id: 'deepseek-chat',     name: 'DeepSeek V3 (Chat)',    provider: 'deepseek', icon: '▽' },
        { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Reasoner)', provider: 'deepseek', icon: '▽' }
      );
    }
  }

  // Custom OpenAI-compatible providers
  for (const cp of (cfg.customProviders || []).filter(p => p && p.enabled !== false && p.apiKey && p.baseUrl)) {
    try {
      const r = await fetch(joinUrl(cp.baseUrl, cp.modelsPath || '/models'), {
        headers: { Authorization: `Bearer ${cp.apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(await readErrorMessage(r, 'Custom provider models request failed'));
      const data = await r.json();
      const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
      list
        .filter(m => !/embedding|moderation|tts|whisper/i.test(`${m.id || m.name}`))
        .slice(0, 60)
        .forEach(m => models.push({
          id: m.id || m.name,
          name: m.name || m.id,
          provider: `custom:${cp.id}`,
          providerName: cp.label,
          icon: cp.icon || '◆',
          custom: true,
          source: 'custom-provider-api',
        }));
    } catch (err) {
      models.push(enrichModel({
        id: 'connection-error',
        name: `${cp.label} connection error: ${err.message}`,
        provider: `custom:${cp.id}`,
        providerName: cp.label,
        icon: cp.icon || '◆',
        custom: true,
        disabled: true,
        source: 'custom-provider-error',
      }));
    }
  }

  // Ollama (local)
  try {
    const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) });
    if (r.ok) {
      const data = await r.json();
      (data.models || []).forEach(m =>
        models.push({ id: m.name, name: m.name, provider: 'ollama', icon: '◌', local: true })
      );
    }
  } catch { /* Ollama not running */ }

  // Apply normalized model intelligence metadata. Keep updateCapable for older UI code.
  const probes = cfg.modelProbes || {};
  for (let i = 0; i < models.length; i++) {
    const enriched = enrichModel(models[i], { _source: models[i].source || 'provider-api-or-fallback' });
    const probe = probes[modelProbeKey(enriched.provider, enriched.id)] || null;
    if (probe) {
      enriched.probe = { status: probe.status, score: probe.score, updatedAt: probe.updatedAt, tests: probe.tests };
      if (probe.tests?.evolvePlan?.status === 'pass' && probe.tests?.evolvePatch?.status === 'pass') {
        enriched.evolve.score = Math.max(enriched.evolve.score || 0, 88);
        enriched.evolve.tier = 'tested-recommended';
        enriched.evolve.capable = true;
        enriched.updateCapable = true;
      }
    }
    // Preserve the older explicit heuristic as a safety net for known providers.
    enriched.updateCapable = enriched.updateCapable || isUpdateCapable(enriched.provider, enriched.id, enriched.name);
    if (enriched.evolve) enriched.evolve.capable = enriched.updateCapable;
    models[i] = enriched;
  }

  res.json(models);
});

// -- Chat ----------------------------------------------------------------------
app.post("/api/chat", async (req, res) => {
  const cfg = loadConfig();
  const keys = cfg.keys || {};
  const { provider, model } = req.body || {};
  const messages = sanitizeMessages(req.body?.messages);
  const explicitSystemPrompt = typeof req.body?.systemPrompt === 'string' ? req.body.systemPrompt : '';
  const systemMessages = (messages || [])
    .filter(m => m.role === 'system')
    .map(m => m.content)
    .join('\n\n');
  const safeSystemPrompt = [explicitSystemPrompt, systemMessages]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 200000);
  const finalMessages = messages || [];

  const customProvider = getCustomProvider(cfg, provider);
  const knownProvider = ['anthropic', 'openai', 'gemini', 'groq', 'openrouter', 'ollama', 'deepseek'].includes(provider);
  if (!knownProvider && !customProvider) {
    return res.status(400).json({ error: 'unknown provider' });
  }
  if (!model || typeof model !== 'string') return res.status(400).json({ error: 'model required' });
  if (!messages) return res.status(400).json({ error: 'messages must be an array' });
  if (provider !== 'ollama' && !customProvider && !keys[provider]) return res.status(400).json({ error: `${provider} API key is not configured` });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  let promptTokens = 0;
  let completionTokens = 0;
  let assistantAnswer = '';
  let usageReported = false;
  let usageEstimated = false;

  const reportUsageAndFinish = () => {
    if (usageReported) return;
    usageReported = true;

    if (promptTokens === 0) {
      const promptText = safeSystemPrompt + ' ' + messages.map(m => m.content).join(' ');
      promptTokens = Math.max(1, Math.round(promptText.length / 4));
      usageEstimated = true;
    }
    if (completionTokens === 0) {
      completionTokens = Math.max(1, Math.round(assistantAnswer.length / 4));
      usageEstimated = true;
    }
    send({
      type: 'usage',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimated: usageEstimated
      }
    });
    send({ done: true });
  };

  try {
    if (provider === 'anthropic') {
      const body = {
        model,
        max_tokens: req.body.enableThinking ? 8192 : 4096,
        temperature: req.body.temperature ?? 0.7,
        top_p: req.body.top_p ?? 1.0,
        stream: true,
        messages: finalMessages.filter(m => m.role !== 'system'),
      };
      if (req.body.enableThinking && /sonnet-4|3-7-sonnet/.test(model)) {
        body.thinking = { type: 'enabled', budget_tokens: 2000 };
      }
      if (safeSystemPrompt) body.system = safeSystemPrompt;

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': keys.anthropic,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      if (!r.ok) {
        send({ error: await readErrorMessage(r, 'Anthropic error') });
        return res.end();
      }
      for await (const chunk of r.body) {
        const lines = Buffer.from(chunk).toString().split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.type === 'message_start' && d.message?.usage) {
              promptTokens = d.message.usage.input_tokens || 0;
            }
            if (d.type === 'message_delta' && d.usage?.output_tokens) {
              completionTokens = d.usage.output_tokens || 0;
            }
            if (d.type === 'content_block_delta' && d.delta?.type === 'thinking_delta' && d.delta?.thinking) {
              send({ reasoning: d.delta.thinking });
            }
            if (d.type === 'content_block_delta' && d.delta?.type === 'text_delta' && d.delta?.text) {
              const txt = d.delta.text;
              assistantAnswer += txt;
              send({ text: txt });
            }
            if (d.type === 'message_stop') reportUsageAndFinish();
          } catch { /* skip */ }
        }
      }
      reportUsageAndFinish();

    } else if (provider === 'openai' || provider === 'groq' || provider === 'openrouter' || provider === 'deepseek' || customProvider) {
      const endpoints = {
        openai:     'https://api.openai.com/v1/chat/completions',
        groq:       'https://api.groq.com/openai/v1/chat/completions',
        openrouter: 'https://openrouter.ai/api/v1/chat/completions',
        deepseek:   'https://api.deepseek.com/v1/chat/completions',
      };
      const endpoint = customProvider ? joinUrl(customProvider.baseUrl, customProvider.chatPath || '/chat/completions') : endpoints[provider];
      const authKey = customProvider ? customProvider.apiKey : keys[provider];
      const msgs = safeSystemPrompt
        ? [{ role: 'system', content: safeSystemPrompt }, ...messages.filter(m => m.role !== 'system')]
        : messages.filter(m => m.role !== 'system');

      const r = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authKey}`,
          'Content-Type': 'application/json',
          ...(provider === 'openrouter' ? { 'HTTP-Referer': 'http://localhost:3737', 'X-Title': 'BLACKLINE AI' } : {}),
        },
        body: JSON.stringify({
          model,
          messages: msgs,
          stream: true,
          ...(customProvider ? {} : { stream_options: { include_usage: true } })
        }),
        signal: AbortSignal.timeout(120000),
      });
      if (!r.ok) {
        send({ error: await readErrorMessage(r, `${provider} error`) });
        return res.end();
      }
      for await (const chunk of r.body) {
        const lines = Buffer.from(chunk).toString().split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.usage) {
              promptTokens = d.usage.prompt_tokens || 0;
              completionTokens = d.usage.completion_tokens || 0;
            }
            const reasoningTxt = d.choices?.[0]?.delta?.reasoning_content || d.choices?.[0]?.delta?.reasoning || d.choices?.[0]?.delta?.reasoning_text;
            if (reasoningTxt) {
              send({ reasoning: reasoningTxt });
            }
            const txt = d.choices?.[0]?.delta?.content;
            if (txt) {
              assistantAnswer += txt;
              send({ text: txt });
            }
            if (d.choices?.[0]?.finish_reason) reportUsageAndFinish();
          } catch { /* skip */ }
        }
      }
      reportUsageAndFinish();

    } else if (provider === 'gemini') {
      // Gemini expects only user/model turns; filter out stray system messages
      const chatMessages = messages.filter(m => m.role !== 'system');
      const msgs = chatMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      const body = { contents: msgs };
      if (safeSystemPrompt) body.systemInstruction = { parts: [{ text: safeSystemPrompt }] };

      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?key=${keys.gemini}&alt=sse`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) }
      );
      if (!r.ok) {
        const message = await readErrorMessage(r, 'Gemini error');
        send({ error: explainProviderError('gemini', message) });
        return res.end();
      }
      for await (const chunk of r.body) {
        const lines = Buffer.from(chunk).toString().split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.usageMetadata) {
              promptTokens = d.usageMetadata.promptTokenCount || 0;
              completionTokens = d.usageMetadata.candidatesTokenCount || 0;
            }
            const txt = d.candidates?.[0]?.content?.parts?.[0]?.text;
            if (txt) {
              assistantAnswer += txt;
              send({ text: txt });
            }
          } catch { /* skip */ }
        }
      }
      reportUsageAndFinish();

    } else if (provider === 'ollama') {
      const chatMessages = messages.filter(m => m.role !== 'system');
      const msgs = safeSystemPrompt
        ? [{ role: 'system', content: safeSystemPrompt }, ...chatMessages]
        : chatMessages;
      const r = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: msgs, stream: true }),
        signal: AbortSignal.timeout(120000),
      });
      if (!r.ok) {
        send({ error: 'Ollama request failed – is Ollama running on http://localhost:11434 ?' });
        return res.end();
      }
      for await (const chunk of r.body) {
        const lines = Buffer.from(chunk).toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const d = JSON.parse(line);
            if (d.prompt_eval_count) promptTokens = d.prompt_eval_count;
            if (d.eval_count) completionTokens = d.eval_count;
            if (d.message?.content) {
              const txt = d.message.content;
              assistantAnswer += txt;
              send({ text: txt });
            }
            if (d.done) reportUsageAndFinish();
          } catch { /* skip */ }
        }
      }
      reportUsageAndFinish();
    } else {
      send({ error: `Unknown provider: ${provider}` });
    }
  } catch (err) {
    send({ error: err.message });
  }
  res.end();
});

// -- App Manifest --------------------------------------------------------------
app.get('/api/manifest', (req, res) => {
  try {
    const appDir = __dirname;
    const serverSrc = fs.readFileSync(path.join(appDir, 'server.js'), 'utf8');
    const indexSrc  = fs.readFileSync(path.join(appDir, 'public', 'index.html'), 'utf8');
    const appJsSrc  = fs.existsSync(path.join(appDir, 'public', 'app.js'))
      ? fs.readFileSync(path.join(appDir, 'public', 'app.js'), 'utf8')
      : '';
    const stylesSrc = fs.existsSync(path.join(appDir, 'public', 'styles.css'))
      ? fs.readFileSync(path.join(appDir, 'public', 'styles.css'), 'utf8')
      : '';
    const pkg       = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));

    const readFileMap = (dir, base = '') => {
      const out = [];
      for (const entry of listVisibleEntries(dir, ['node_modules', '.git', 'data', '.arena', '.cache', 'package-lock.json'])) {
        const full = path.join(dir, entry);
        const rel = joinRelPath(base, entry);
        if (fs.statSync(full).isDirectory()) out.push(...readFileMap(full, rel));
        else out.push({ path: rel, lines: fs.readFileSync(full, 'utf8').split('\n').length });
      }
      return out;
    };

    const endpoints = [...serverSrc.matchAll(/app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g)]
      .map(m => ({ method: m[1].toUpperCase(), path: m[2] }));

    const panels    = [...new Set([...indexSrc.matchAll(/data-panel="([^"${}]+)"/g)].map(m => m[1]))];
    const functions = [...new Set([...appJsSrc.matchAll(/function\s+(\w+)\s*\(/g)].map(m => m[1]))].sort();

    res.json({
      name: pkg.name,
      description: pkg.description,
      version: pkg.version,
      techStack: ['Node.js + Express backend (single server.js)', 'vanilla HTML/CSS/JS frontend (public/index.html + public/styles.css + public/app.js)', 'no build step', 'Server-Sent Events for streaming chat and updates'],
      port: 3737,
      storage: {
        apiKeys: 'data/config.json (local disk, never sent anywhere except the provider APIs)',
        conversations: 'browser localStorage (per-device)',
        backups: 'a sibling folder like ../ai-chat-app-backup-<timestamp>/ created automatically before every update'
      },
      files: readFileMap(appDir),
      endpoints,
      frontend: {
        panels,
        functions,
        lineCount: indexSrc.split('\n').length,
        scriptLineCount: appJsSrc ? appJsSrc.split('\n').length : 0,
        styleLineCount: stylesSrc ? stylesSrc.split('\n').length : 0,
        keySelectors: ['#messages', '#msg-input', '#model-select', '#toolbar', '#system-prompt-input', '#keys-list', '#evolve-panel', '#evolve-messages', '#evolve-input', '#evolve-model-select', '#evolve-file-tree']
      },
      capabilities: [
        'Evolve server.js and any frontend/backend file via the Evolve App panel (guided planning + approval workflow).',
        'Create new files anywhere in the app folder (except blocked directories).',
        'Edit existing files using search/replace diffs (preferred) or full rewrites when necessary.',
        'Delete existing files.',
        'Add new UI panels, sidebar buttons, settings, modals, toasts.',
        'Add new API endpoints (express routes), modify existing ones.',
        'Change CSS / theme variables (--accent, --bg, etc. are CSS custom properties near the top of public/styles.css).',
        'Use the existing markdown renderer (formatMd) — code blocks render with a Copy button.',
        'Persist small client state via localStorage (already used for conversations, systemPrompt, and Evolve layout preferences).',
        'Stream both chat responses and update progress via Server-Sent Events.'
      ],
      hardConstraints: [
        'Cannot add new npm dependencies automatically. If you need one, the user must run `npm install <pkg>` themselves; after that the app can require() it.',
        'Cannot run shell commands or arbitrary code — only writes files inside the app folder.',
        'Files outside the app folder are rejected (safeResolve blocks path traversal).',
        'node_modules, .git, and data/ folders cannot be modified or created.'
      ],
      updateWorkflow: [
        '1. User opens the Evolve App panel, selects a capable model, and asks a question or describes a desired change.',
        '2. The Evolve AI (chat inside the panel) discusses the request, analyzes feasibility, and can propose a structured plan using a `plan` JSON block.',
        '3. The user reviews the proposed plan directly in the chat and clicks "Approve & Execute" to confirm.',
        '4. The server creates a timestamped backup, then calls the AI to generate the actual code for each file in the plan.',
        '5. The server streams the live code generation back to the client in real-time. The user sees exactly which file is being written and what code is being generated.',
        '6. The server writes each file to disk as it is generated.',
        '7. User reloads the browser tab. If server.js changed, the user restarts the Node process to pick up backend changes.'
      ],
      updatePromptGuide: {
        what_makes_a_great_prompt: [
          'State ONE clear feature (not three at once).',
          'Describe visible user behavior, not low-level implementation when possible.',
          'List exactly which files should change (server.js, public/index.html, public/styles.css, public/app.js, or new file).',
          'Specify UI placement: "in the chat header next to the existing buttons", "as a new sidebar nav item", etc.',
          'Mention constraints: "preserve existing functionality", "follow existing CSS variable names", "do not add new dependencies".',
          'If multiple providers/models are involved, specify each one\'s role.',
          'Be concrete about edge cases: empty input, long text, streaming already in progress, etc.',
          'Avoid vague verbs ("improve", "optimize") — replace with measurable behavior ("reduce time to first token by streaming headers earlier").'
        ],
        format: 'When the user agrees on a feature, your FINAL reply should end with EXACTLY one fenced code block tagged ```plan containing a JSON array of proposed actions. The frontend will detect this block and render an inline Approve & Execute button.',
        example: 'Add a "Rename conversation" action to each item in the left sidebar conversation list.\n\nUI behavior:\n- Right-clicking (or hovering + clicking a small pencil icon) a conversation item opens a small inline text input pre-filled with the current title.\n- Pressing Enter saves the new title and updates localStorage.\n- Pressing Escape cancels.\n- Empty titles are rejected.\n\nFiles to change: public/index.html, public/styles.css, public/app.js, server.js, or new files as needed.\nConstraints: preserve all existing chat, settings, and update-panel behavior; reuse the existing CSS variables (--accent, --surface2, etc.); do not add new dependencies.'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -- File tree ----------------------------------------------------------------
app.get('/api/files', (req, res) => {
  try {
    const appDir = __dirname;
    const readDir = (dir, base = '') => {
      const results = [];
      for (const entry of listVisibleEntries(dir, ['node_modules', '.git', 'data', '.arena', '.cache', 'package-lock.json', 'dist', 'build', 'coverage'])) {
        const full = path.join(dir, entry);
        const rel = joinRelPath(base, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          results.push({ path: rel, type: 'dir', children: readDir(full, rel) });
        } else {
          const content = fs.readFileSync(full, 'utf8');
          results.push({ path: rel, type: 'file', content, lines: content.split('\n').length });
        }
      }
      return results;
    };
    res.json(readDir(appDir));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -- Evolve Execute ------------------------------------------------------------
function cleanupOldBackups(parentDir, appName, currentBackupDir) {
  try {
    const entries = fs.readdirSync(parentDir)
      .filter(name => name.startsWith(`${appName}-backup-`))
      .map(name => ({ name, full: path.join(parentDir, name), mtime: fs.statSync(path.join(parentDir, name)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    // Newest is the current backup being created. Keep it + the next N-1.
    const toDelete = entries.slice(MAX_BACKUPS_TO_KEEP).filter(e => e.full !== currentBackupDir);
    for (const e of toDelete) {
      try { fs.rmSync(e.full, { recursive: true, force: true }); } catch {}
    }
    return toDelete.length;
  } catch {
    return 0;
  }
}

app.post('/api/evolve/execute', async (req, res) => {
  const { provider, model, plan } = req.body;
  if (!provider || !model) return res.status(400).json({ error: 'provider and model required' });
  if (!Array.isArray(plan) || plan.length === 0) return res.status(400).json({ error: 'plan must be a non-empty array' });
  if (plan.length > MAX_PLAN_ITEMS) return res.status(400).json({ error: `Plan is too large (${plan.length} items, max ${MAX_PLAN_ITEMS}). Split it into smaller updates.` });

  const cfg = loadConfig();
  const keys = cfg.keys || {};
  const customProvider = getCustomProvider(cfg, provider);
  if (provider !== 'ollama' && !customProvider && !keys[provider]) {
    return res.status(400).json({ error: `A valid ${provider} API key is required in Settings.` });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const appDir = __dirname;
  const parentDir = path.dirname(appDir);
  const appName = path.basename(appDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(parentDir, `${appName}-backup-${timestamp}`);

  // Backup
  try {
    fs.cpSync(appDir, backupDir, {
      recursive: true,
      filter: (src) => {
        const basename = path.basename(src);
        return !['node_modules', '.git', 'data', '.arena', '.cache'].includes(basename);
      }
    });
    const pruned = cleanupOldBackups(parentDir, appName, backupDir);
    send({ type: 'backup', dir: backupDir, prunedOldBackups: pruned });
  } catch (err) {
    send({ type: 'error', message: 'Backup failed: ' + err.message });
    return res.end();
  }

  // Read current files for context
  const readDir = (dir, base = '') => {
    const results = [];
    for (const entry of listVisibleEntries(dir, ['node_modules', '.git', 'data'])) {
      const full = path.join(dir, entry);
      const rel = joinRelPath(base, entry);
      if (fs.statSync(full).isDirectory()) results.push(...readDir(full, rel));
      else results.push({ path: rel, content: fs.readFileSync(full, 'utf8') });
    }
    return results;
  };

  let files;
  try {
    files = readDir(appDir);
  } catch (e) {
    send({ type: 'error', message: `Could not read app files: ${e.message}` });
    return res.end();
  }

  const renderFilesDump = () => files.map(f => `=== FILE: ${f.path} ===\n${f.content}`).join('\n\n');
  let filesDump = renderFilesDump();

  function stripGeneratedFileContent(text, filePath) {
    let out = String(text || '').replace(/\r\n/g, '\n').trim();
    const fenced = out.match(/^```[\w-]*\n([\s\S]*?)\n```\s*$/);
    if (fenced) out = fenced[1].trim();
    out = out.replace(/^=== FILE:\s*.+?\s*===\n/i, '').trim();
    out = out.replace(/\n```\s*$/g, '').trim();
    return out;
  }

  function extractJsonObject(text) {
    let cleaned = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) cleaned = fence[1].trim();
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) cleaned = cleaned.slice(first, last + 1);
    return JSON.parse(cleaned);
  }

  function applySearchReplacePatch(original, changes, filePath) {
    if (!Array.isArray(changes) || changes.length === 0) {
      throw new Error(`Edit patch for ${filePath} did not include any changes`);
    }
    let content = original;
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i] || {};
      if (typeof change.search !== 'string' || typeof change.replace !== 'string' || !change.search) {
        throw new Error(`Change ${i + 1} for ${filePath} must include non-empty search and replacement strings`);
      }
      const first = content.indexOf(change.search);
      if (first === -1) {
        throw new Error(`Search block ${i + 1} was not found in ${filePath}. The model must use exact current text with enough surrounding context.`);
      }
      if (content.indexOf(change.search, first + change.search.length) !== -1) {
        throw new Error(`Search block ${i + 1} matched multiple locations in ${filePath}. The model must include more surrounding context.`);
      }
      content = content.slice(0, first) + change.replace + content.slice(first + change.search.length);
    }
    return content;
  }

  async function streamModelText(prompt, onText) {
    let textResult = '';
    const push = (txt) => {
      if (!txt) return;
      textResult += txt;
      onText(txt);
    };

    if (provider === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': keys.anthropic,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 16384,
          stream: true,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(EVOLVE_EXECUTION_TIMEOUT_MS),
      });
      if (!r.ok) throw new Error(`Anthropic API error: ${await readErrorMessage(r, 'Execution failed')}`);
      for await (const chunk of r.body) {
        const lines = Buffer.from(chunk).toString().split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.type === 'content_block_delta' && d.delta?.text) push(d.delta.text);
          } catch { /* skip */ }
        }
      }
      return textResult;
    }

    if (provider === 'openai' || provider === 'groq' || provider === 'openrouter' || provider === 'deepseek' || customProvider) {
      const endpoints = {
        openai:     'https://api.openai.com/v1/chat/completions',
        groq:       'https://api.groq.com/openai/v1/chat/completions',
        openrouter: 'https://openrouter.ai/api/v1/chat/completions',
        deepseek:   'https://api.deepseek.com/v1/chat/completions',
      };
      const endpoint = customProvider ? joinUrl(customProvider.baseUrl, customProvider.chatPath || '/chat/completions') : endpoints[provider];
      const authKey = customProvider ? customProvider.apiKey : keys[provider];
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authKey}`,
          'Content-Type': 'application/json',
          ...(provider === 'openrouter' ? { 'HTTP-Referer': 'http://localhost:3737', 'X-Title': 'BLACKLINE AI' } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: true
        }),
        signal: AbortSignal.timeout(EVOLVE_EXECUTION_TIMEOUT_MS),
      });
      if (!r.ok) throw new Error(`${provider} API error: ${await readErrorMessage(r, 'Execution failed')}`);
      for await (const chunk of r.body) {
        const lines = Buffer.from(chunk).toString().split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
          try {
            const d = JSON.parse(line.slice(6));
            const txt = d.choices?.[0]?.delta?.content;
            if (txt) push(txt);
          } catch { /* skip */ }
        }
      }
      return textResult;
    }

    if (provider === 'gemini') {
      const callGemini = async (targetModel) => {
        let geminiText = '';
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:streamGenerateContent?key=${keys.gemini}&alt=sse`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
            signal: AbortSignal.timeout(EVOLVE_EXECUTION_TIMEOUT_MS)
          }
        );
        if (!r.ok) {
          const msg = await readErrorMessage(r, 'Gemini API error');
          throw new Error(explainProviderError('gemini', msg));
        }
        for await (const chunk of r.body) {
          const lines = Buffer.from(chunk).toString().split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const d = JSON.parse(line.slice(6));
              const txt = d.candidates?.[0]?.content?.parts?.[0]?.text;
              if (txt) { geminiText += txt; push(txt); }
            } catch { /* skip */ }
          }
        }
        return geminiText;
      };
      try {
        await callGemini(model);
      } catch (err) {
        if (/high demand|overloaded|429|503|400/i.test(err.message)) {
          send({ type: 'info', message: `${model} overloaded. Retrying with gemini-1.5-flash...` });
          await callGemini('gemini-1.5-flash');
        } else {
          throw err;
        }
      }
      return textResult;
    }

    if (provider === 'ollama') {
      const r = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: true }),
        signal: AbortSignal.timeout(EVOLVE_EXECUTION_TIMEOUT_MS)
      });
      if (!r.ok) throw new Error('Ollama local execution request failed');
      for await (const chunk of r.body) {
        const lines = Buffer.from(chunk).toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const d = JSON.parse(line);
            if (d.message?.content) push(d.message.content);
          } catch { /* skip */ }
        }
      }
      return textResult;
    }

    throw new Error(`Unknown provider for execution: ${provider}`);
  }

  try {
    const applied = [];
    const failed = [];
    const recordFailure = (pathValue, errorValue) => {
      const failure = { path: pathValue || '(missing path)', error: String(errorValue || 'Unknown error') };
      failed.push(failure);
      send({ type: 'file_error', path: failure.path, error: failure.error });
    };

    for (let i = 0; i < plan.length; i++) {
      const item = plan[i] || {};
      const filePath = String(item.path || '').trim();
      const action = String(item.action || 'edit').toLowerCase();
      const target = safeResolve(appDir, filePath);

      if (!target || !['create', 'edit', 'delete'].includes(action)) {
        recordFailure(filePath || '(missing path)', 'Unsafe path or invalid action');
        continue;
      }

      send({ type: 'chunk', text: `\n\n---\n[${i + 1}/${plan.length}] ${action.toUpperCase()} ${filePath}\n` });

      if (action === 'delete') {
        if (fs.existsSync(target)) fs.unlinkSync(target);
        applied.push({ path: filePath, action });
        send({ type: 'file_complete', path: filePath, action });
        continue;
      }

      const existingContent = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
      if (action === 'edit' && !fs.existsSync(target)) {
        recordFailure(filePath, 'Cannot edit a missing file. Use create instead.');
        continue;
      }

      let generated;

      if (action === 'edit') {
        const patchPrompt = `You are executing ONE approved BLACKLINE AI edit action.

TARGET FILE: ${filePath}
ACTION: edit
DESCRIPTION: ${item.description || ''}

CURRENT TARGET FILE CONTENT:
=== FILE: ${filePath} ===
${existingContent}

OUTPUT RULES:
- Respond ONLY with a valid JSON object. No markdown, no explanation.
- Prefer targeted edits. Use this format:
  { "path": "${filePath}", "action": "edit", "changes": [ { "search": "exact unique current text", "replace": "replacement text" } ] }
- Each search string must match the current file exactly and must be unique. Include enough surrounding context.
- Do NOT rewrite the whole file unless a targeted patch is genuinely impractical.
- If a full rewrite is genuinely necessary, use: { "path": "${filePath}", "action": "edit", "content": "complete final file content" }
- Preserve all unrelated behavior.`;

        const patchText = await streamModelText(patchPrompt, txt => send({ type: 'chunk', text: txt }));
        let patch;
        try {
          patch = extractJsonObject(patchText);
        } catch (err) {
          recordFailure(filePath, 'Could not parse edit patch JSON: ' + err.message);
          continue;
        }

        try {
          if (Array.isArray(patch.changes) && patch.changes.length > 0) {
            generated = applySearchReplacePatch(existingContent, patch.changes, filePath);
          } else if (typeof patch.content === 'string') {
            generated = patch.content;
            send({ type: 'chunk', text: `\n[Full rewrite fallback used for ${filePath}]\n` });
          } else {
            throw new Error('Patch must include either changes[] or content');
          }
        } catch (err) {
          recordFailure(filePath, err.message);
          continue;
        }
      } else {
        const filePrompt = `You are executing ONE approved BLACKLINE AI file creation action.

TARGET FILE: ${filePath}
ACTION: create
DESCRIPTION: ${item.description || ''}

CODEBASE CONTEXT:
${filesDump}

OUTPUT RULES:
- Output ONLY the complete final content for TARGET FILE.
- Do not output the file path marker.
- Do not wrap the content in markdown fences unless those fences are literally part of the file content.
- Do not explain what you changed.
- For Markdown documentation files, write useful complete Markdown content.`;

        generated = await streamModelText(filePrompt, txt => send({ type: 'chunk', text: txt }));
        generated = stripGeneratedFileContent(generated, filePath);
      }

      if (!generated || !generated.trim()) {
        recordFailure(filePath, 'Model returned empty file content');
        continue;
      }

      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, generated, 'utf8');
      applied.push({ path: filePath, action });
      send({ type: 'file_complete', path: filePath, action });

      const existingIdx = files.findIndex(f => f.path === filePath);
      if (existingIdx >= 0) files[existingIdx].content = generated;
      else files.push({ path: filePath, content: generated });
      filesDump = renderFilesDump();
    }

    let type = 'done';
    let message = `Successfully applied ${applied.length} file update(s)! Reload the page to see your evolved application.`;
    if (failed.length && applied.length) {
      type = 'partial';
      message = `Partially applied ${applied.length} file update(s), but ${failed.length} file(s) failed. Do not treat this update as complete until the failed file(s) are investigated and fixed.`;
    } else if (failed.length && !applied.length) {
      type = 'error';
      message = `No files were applied. ${failed.length} planned file(s) failed.`;
    } else if (!applied.length) {
      type = 'error';
      message = 'No files were applied. The model did not produce valid file content for any planned item.';
    }
    send({ type, applied, failed, backupDir, message });
  } catch (err) {
    const message = /timeout|aborted/i.test(err.message || '')
      ? `Execution timed out after ${Math.round(EVOLVE_EXECUTION_TIMEOUT_MS / 60000)} minutes. The plan may be too large for one model run; try splitting it into fewer files or using a faster/higher-output model. (${err.message})`
      : err.message;
    send({ type: 'error', message });
  }
  res.end();
});

// -- Serve index for all other routes -----------------------------------------
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n[OK]  BLACKLINE AI running at http://localhost:${PORT}\n`);
  if (!process.env.NO_OPEN_BROWSER) {
    const url = `http://localhost:${PORT}`;
    const cmd = process.platform === 'win32' ? `start ${url}` :
                 process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
    exec(cmd, () => {});
  }
});

// attachVisionContent() was removed in v1.4.0 — it was never called from any
// route and there was no client-side upload UI. If you want vision support,
// it should be designed deliberately (multipart uploads, file storage policy,
// UI for previewing, etc.) rather than retrofitted onto the current shape.
