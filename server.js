const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = 3737;
const DATA_FILE = path.join(__dirname, 'data', 'config.json');
const EVOLVE_EXECUTION_TIMEOUT_MS = 15 * 60 * 1000; // Large plans (docs/wiki files) can exceed five minutes.
const ALLOWED_PROVIDERS = new Set(['anthropic', 'openai', 'gemini', 'groq', 'openrouter', 'deepseek']);
const GEMINI_FALLBACK_MODELS = [
  { id: 'gemini-2.0-flash',      name: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash-Lite' },
  { id: 'gemini-2.0-pro-exp',    name: 'Gemini 2.0 Pro Exp' },
  { id: 'gemini-1.5-flash',      name: 'Gemini 1.5 Flash' },
  { id: 'gemini-1.5-pro',        name: 'Gemini 1.5 Pro' },
  { id: 'gemini-3.5-flash',      name: 'Gemini 3.5 Flash' },
  { id: 'gemini-2.5-flash',      name: 'Gemini 2.5 Flash' },
];

app.use(cors({
  origin(origin, cb) {
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return cb(null, true);
    cb(new Error('Origin not allowed'));
  },
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
  fs.writeFileSync(DATA_FILE, JSON.stringify(cfg, null, 2));
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
  if (!rel || typeof rel !== 'string' || path.isAbsolute(rel) || rel.includes('\0')) return null;

  const normalizedBase = path.resolve(base);
  const normalizedRel = path.normalize(rel).replace(/^([.][\/])+/, '');
  const segments = normalizedRel.split(/[\/]+/).filter(Boolean);
  const blocked = new Set(['node_modules', '.git', 'data', '.arena', '.cache', 'dist', 'build', 'coverage']);
  if (segments.length === 0 || segments.some(seg => seg === '..' || blocked.has(seg))) return null;

  const target = path.resolve(normalizedBase, normalizedRel);
  const relative = path.relative(normalizedBase, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return target;
}

// -- API Keys ------------------------------------------------------------------
app.get('/api/keys', (req, res) => {
  const cfg = loadConfig();
  const safe = {};
  for (const [k, v] of Object.entries(cfg.keys || {})) {
    safe[k] = v ? '????????' + v.slice(-4) : '';
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
  saveConfig(cfg);
  res.json({ ok: true });
});

app.delete('/api/keys/:provider', (req, res) => {
  if (!isAllowedProvider(req.params.provider)) return res.status(400).json({ error: 'unknown provider' });
  const cfg = loadConfig();
  delete (cfg.keys || {})[req.params.provider];
  saveConfig(cfg);
  res.json({ ok: true });
});

// -- Model discovery -----------------------------------------------------------
app.get('/api/models', async (req, res) => {
  const cfg = loadConfig();
  const keys = cfg.keys || {};
  const models = [];

  // Helper to determine if a model is capable of self-updating (~70KB code / structured JSON)
  const isUpdateCapable = (provider, id, name = '') => {
    const full = `${id} ${name}`.toLowerCase();
    // Evolve to empower any capable/modern AI provider model
    if (provider === 'gemini') return true;
    if (provider === 'anthropic') return true;
    if (provider === 'openai') return /gpt-4|o1|o3|gpt-4\.5/i.test(full);
    if (provider === 'groq') return /70b|deepseek|3\.3|mixtral/i.test(full);
    if (provider === 'openrouter') return /sonnet|opus|gpt-4|o1|o3|gemini|70b|405b|deepseek|coder/i.test(full);
    if (provider === 'ollama') return /70b|deepseek|qwen|coder|llama3\.3|phi4/i.test(full);
    if (provider === 'deepseek') return true;
    return true;
  };

  // Anthropic
  if (keys.anthropic) {
    models.push(
      { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', provider: 'anthropic', icon: '◖' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic', icon: '◖' },
      { id: 'claude-3-opus-20240229',    name: 'Claude 3 Opus',     provider: 'anthropic', icon: '◖' },
      { id: 'claude-3-5-haiku-20241022',  name: 'Claude 3.5 Haiku',  provider: 'anthropic', icon: '◖' },
      { id: 'claude-sonnet-4-6',          name: 'Claude Sonnet 4.6 (Legacy)', provider: 'anthropic', icon: '◖' },
    );
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
          .sort((a, b) => b.created - a.created)
          .slice(0, 15);
        chat.forEach(m => models.push({ id: m.id, name: m.id, provider: 'openai', icon: '◎' }));
      } else {
        throw new Error('OpenAI fetch failed');
      }
    } catch {
      models.push(
        { id: 'gpt-4o',         name: 'GPT-4o',         provider: 'openai', icon: '◎' },
        { id: 'gpt-4o-mini',    name: 'GPT-4o mini',    provider: 'openai', icon: '◎' },
        { id: 'o1',             name: 'o1',             provider: 'openai', icon: '◎' },
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
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
        'gemini-2.0-pro-exp',
        'gemini-1.5-flash',
        'gemini-1.5-pro',
        'gemini-3.5-flash',
        'gemini-3.1-pro',
        'gemini-3-flash',
        'gemini-3.1-flash-lite',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.5-pro',
      ];
      discovered.sort((a, b) => {
        const ai = preferredOrder.indexOf(a.id);
        const bi = preferredOrder.indexOf(b.id);
        if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        return a.name.localeCompare(b.name);
      });
      models.push(...discovered.slice(0, 15));
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
      const preferred = ['openai/', 'anthropic/', 'google/', 'meta-llama/', 'deepseek/', 'mistralai/'];
      (data.data || [])
        .filter(m => preferred.some(prefix => m.id?.startsWith(prefix)))
        .filter(m => !/image|audio|embedding|moderation|tts|whisper/i.test(`${m.id} ${m.name}`))
        .slice(0, 25)
        .forEach(m => models.push({ id: m.id, provider: 'openrouter', name: `${m.name || m.id} (OR)`, icon: '⬡' }));
    } catch {
      models.push(
        { id: 'openai/gpt-4o',                    provider: 'openrouter', name: 'GPT-4o (via OpenRouter)',       icon: '⬡' },
        { id: 'anthropic/claude-sonnet-4',         provider: 'openrouter', name: 'Claude Sonnet 4 (OR)',          icon: '⬡' },
        { id: 'google/gemini-2.5-flash',           provider: 'openrouter', name: 'Gemini 2.5 Flash (OR)',        icon: '⬡' },
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

  // Apply updateCapable flag
  models.forEach(m => {
    m.updateCapable = isUpdateCapable(m.provider, m.id, m.name);
  });

  res.json(models);
});

// -- Chat ----------------------------------------------------------------------
app.post('/api/chat', async (req, res) => {
  const { provider, model, systemPrompt } = req.body;
  const messages = sanitizeMessages(req.body.messages);
  const safeSystemPrompt = typeof systemPrompt === 'string' ? systemPrompt.slice(0, 200000) : '';
  const cfg = loadConfig();
  const keys = cfg.keys || {};

  if (!['anthropic', 'openai', 'gemini', 'groq', 'openrouter', 'ollama', 'deepseek'].includes(provider)) {
    return res.status(400).json({ error: 'unknown provider' });
  }
  if (!model || typeof model !== 'string') return res.status(400).json({ error: 'model required' });
  if (!messages) return res.status(400).json({ error: 'messages must be an array' });
  if (provider !== 'ollama' && !keys[provider]) return res.status(400).json({ error: `${provider} API key is not configured` });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  let promptTokens = 0;
  let completionTokens = 0;
  let assistantAnswer = '';
  let usageReported = false;

  const reportUsageAndFinish = () => {
    if (usageReported) return;
    usageReported = true;

    if (promptTokens === 0) {
      const promptText = safeSystemPrompt + ' ' + messages.map(m => m.content).join(' ');
      promptTokens = Math.max(1, Math.round(promptText.length / 4));
    }
    if (completionTokens === 0) {
      completionTokens = Math.max(1, Math.round(assistantAnswer.length / 4));
    }
    send({
      type: 'usage',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens
      }
    });
    send({ done: true });
  };

  try {
    if (provider === 'anthropic') {
      const body = {
        model,
        max_tokens: req.body.enableThinking ? 8192 : 4096,
        stream: true,
        messages: messages.filter(m => m.role !== 'system'),
      };
      if (req.body.enableThinking && model === 'claude-3-7-sonnet-20250219') {
        body.thinking = { type: 'enabled', budget_tokens: 4096 };
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

    } else if (provider === 'openai' || provider === 'groq' || provider === 'openrouter' || provider === 'deepseek') {
      const endpoints = {
        openai:     'https://api.openai.com/v1/chat/completions',
        groq:       'https://api.groq.com/openai/v1/chat/completions',
        openrouter: 'https://openrouter.ai/api/v1/chat/completions',
        deepseek:   'https://api.deepseek.com/v1/chat/completions',
      };
      const msgs = safeSystemPrompt
        ? [{ role: 'system', content: safeSystemPrompt }, ...messages]
        : messages;

      const r = await fetch(endpoints[provider], {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${keys[provider]}`,
          'Content-Type': 'application/json',
          ...(provider === 'openrouter' ? { 'HTTP-Referer': 'http://localhost:3737' } : {}),
        },
        body: JSON.stringify({
          model,
          messages: msgs,
          stream: true,
          stream_options: { include_usage: true }
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
      const msgs = messages.map(m => ({
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
            if (d.candidates?.[0]?.finishReason) reportUsageAndFinish();
          } catch { /* skip */ }
        }
      }
      reportUsageAndFinish();

    } else if (provider === 'ollama') {
      const msgs = safeSystemPrompt
        ? [{ role: 'system', content: safeSystemPrompt }, ...messages]
        : messages;
      const r = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: msgs, stream: true }),
        signal: AbortSignal.timeout(120000),
      });
      if (!r.ok) {
        send({ error: 'Ollama request failed' });
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

// -- App Manifest (lets the chat model know what the app is) -------------------
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

    // Auto-derive file map (line counts only — no source content shipped)
    const readFileMap = (dir, base = '') => {
      const out = [];
      for (const entry of fs.readdirSync(dir)) {
        if (['node_modules', '.git', 'data', '.arena', '.cache', 'package-lock.json'].includes(entry)) continue;
        const full = path.join(dir, entry);
        const rel = path.join(base, entry);
        if (fs.statSync(full).isDirectory()) out.push(...readFileMap(full, rel));
        else out.push({ path: rel, lines: fs.readFileSync(full, 'utf8').split('\n').length });
      }
      return out;
    };

    // Auto-derive API routes
    const endpoints = [...serverSrc.matchAll(/app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g)]
      .map(m => ({ method: m[1].toUpperCase(), path: m[2] }));

    // Auto-derive frontend panels (data-panel="...") and JS functions
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

// -- File tree (full contents for Evolve App) --------------------------------
app.get('/api/files', (req, res) => {
  try {
    const appDir = __dirname;
    const readDir = (dir, base = '') => {
      const results = [];
      for (const entry of fs.readdirSync(dir)) {
        if (['node_modules', '.git', 'data', '.arena', '.cache', 'package-lock.json', 'dist', 'build', 'coverage'].includes(entry)) continue;
        const full = path.join(dir, entry);
        const rel = path.join(base, entry);
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

// -- Evolve Execute (single-step: plan -> live code generation -> writes) ----
app.post('/api/evolve/execute', async (req, res) => {
  const { provider, model, plan } = req.body;
  if (!provider || !model) return res.status(400).json({ error: 'provider and model required' });
  if (!Array.isArray(plan) || plan.length === 0) return res.status(400).json({ error: 'plan must be a non-empty array' });

  const cfg = loadConfig();
  const keys = cfg.keys || {};
  if (provider !== 'ollama' && !keys[provider]) {
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
    send({ type: 'backup', dir: backupDir });
  } catch (err) {
    send({ type: 'error', message: 'Backup failed: ' + err.message });
    return res.end();
  }

  // Read current files for context
  const readDir = (dir, base = '') => {
    const results = [];
    for (const entry of fs.readdirSync(dir)) {
      if (['node_modules', '.git', 'data'].includes(entry)) continue;
      const full = path.join(dir, entry);
      const rel = path.join(base, entry);
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

  const renderFilesDump = () => files.map(f => `=== FILE: ${f.path} ===
${f.content}`).join('\n\n');
  let filesDump = renderFilesDump();

  function stripGeneratedFileContent(text, filePath) {
    let out = String(text || '').replace(/\r\n/g, '\n').trim();

    // If the model ignored instructions and wrapped the answer in a code fence,
    // prefer the fenced payload. This is common for markdown files.
    const fenced = out.match(/^```[\w-]*\n([\s\S]*?)\n```\s*$/);
    if (fenced) out = fenced[1].trim();

    // If it included our marker anyway, remove only the marker for this file.
    out = out.replace(/^=== FILE:\s*.+?\s*===\n/i, '').trim();

    // Remove accidental trailing fences/explanations in the most common forms.
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

    if (provider === 'openai' || provider === 'groq' || provider === 'openrouter' || provider === 'deepseek') {
      const endpoints = {
        openai:     'https://api.openai.com/v1/chat/completions',
        groq:       'https://api.groq.com/openai/v1/chat/completions',
        openrouter: 'https://openrouter.ai/api/v1/chat/completions',
        deepseek:   'https://api.deepseek.com/v1/chat/completions',
      };
      const r = await fetch(endpoints[provider], {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${keys[provider]}`,
          'Content-Type': 'application/json',
          ...(provider === 'openrouter' ? { 'HTTP-Referer': 'http://localhost:3737' } : {}),
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

      // Keep context current for subsequent files in the same plan.
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
  // Try to open browser automatically
  if (!process.env.NO_OPEN_BROWSER) {
    const url = `http://localhost:${PORT}`;
    const cmd = process.platform === 'win32' ? `start ${url}` :
                 process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
    exec(cmd, () => {});
  }
});
