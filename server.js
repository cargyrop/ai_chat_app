const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = 3737;
const DATA_FILE = path.join(__dirname, 'data', 'config.json');
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
  if (!rel || typeof rel !== 'string' || path.isAbsolute(rel)) return null;
  const target = path.resolve(base, rel);
  return target.startsWith(base + path.sep) ? target : null;
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
      { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', provider: 'anthropic', icon: '🟠' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic', icon: '🟠' },
      { id: 'claude-3-opus-20240229',    name: 'Claude 3 Opus',     provider: 'anthropic', icon: '🟠' },
      { id: 'claude-3-5-haiku-20241022',  name: 'Claude 3.5 Haiku',  provider: 'anthropic', icon: '🟠' },
      { id: 'claude-sonnet-4-6',          name: 'Claude Sonnet 4.6 (Legacy)', provider: 'anthropic', icon: '🟠' },
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
        chat.forEach(m => models.push({ id: m.id, name: m.id, provider: 'openai', icon: '🟢' }));
      } else {
        throw new Error('OpenAI fetch failed');
      }
    } catch {
      models.push(
        { id: 'gpt-4o',         name: 'GPT-4o',         provider: 'openai', icon: '🟢' },
        { id: 'gpt-4o-mini',    name: 'GPT-4o mini',    provider: 'openai', icon: '🟢' },
        { id: 'o1',             name: 'o1',             provider: 'openai', icon: '🟢' },
        { id: 'o3-mini',        name: 'o3-mini',        provider: 'openai', icon: '🟢' }
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
              icon: '🔵',
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
        models.push({ ...m, provider: 'gemini', icon: '🔵' })
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
        .forEach(m => models.push({ id: m.id, provider: 'openrouter', name: `${m.name || m.id} (OR)`, icon: '🌐' }));
    } catch {
      models.push(
        { id: 'openai/gpt-4o',                    provider: 'openrouter', name: 'GPT-4o (via OpenRouter)',       icon: '🌐' },
        { id: 'anthropic/claude-sonnet-4',         provider: 'openrouter', name: 'Claude Sonnet 4 (OR)',          icon: '🌐' },
        { id: 'google/gemini-2.5-flash',           provider: 'openrouter', name: 'Gemini 2.5 Flash (OR)',        icon: '🌐' },
        { id: 'meta-llama/llama-3.3-70b-instruct', provider: 'openrouter', name: 'Llama 3.3 70B (OR)',           icon: '🌐' },
        { id: 'deepseek/deepseek-chat',            provider: 'openrouter', name: 'DeepSeek Chat (OR)',           icon: '🌐' },
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
          .forEach(m => models.push({ id: m.id, name: prettyModelName(m.id), provider: 'deepseek', icon: '🐳' }));
      } else {
        throw new Error('DeepSeek fetch failed');
      }
    } catch {
      models.push(
        { id: 'deepseek-chat',     name: 'DeepSeek V3 (Chat)',    provider: 'deepseek', icon: '🐳' },
        { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Reasoner)', provider: 'deepseek', icon: '🐳' }
      );
    }
  }

  // Ollama (local)
  try {
    const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) });
    if (r.ok) {
      const data = await r.json();
      (data.models || []).forEach(m =>
        models.push({ id: m.name, name: m.name, provider: 'ollama', icon: '🦙', local: true })
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
        max_tokens: 4096,
        stream: true,
        messages: messages.filter(m => m.role !== 'system'),
      };
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
            if (d.type === 'content_block_delta' && d.delta?.text) {
              const txt = d.delta.text;
              assistantAnswer += txt;
              send({ text: txt });
            }
            if (d.type === 'message_stop') reportUsageAndFinish();
          } catch { /* skip */ }
        }
      }
      reportUsageAndFinish();

    } else if (provider === 'openai' || provider === 'groq' || provider === 'openrouter') {
      const endpoints = {
        openai:     'https://api.openai.com/v1/chat/completions',
        groq:       'https://api.groq.com/openai/v1/chat/completions',
        openrouter: 'https://openrouter.ai/api/v1/chat/completions',
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

// -- Self-update (with live real-time SSE feedback) ----------------------------
app.post('/api/update', async (req, res) => {
  const { featureRequest, provider, model } = req.body;
  if (!featureRequest) return res.status(400).json({ error: 'featureRequest required' });
  if (!provider || !model) return res.status(400).json({ error: 'provider and model required for updates' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const notify = (msg) => send({ type: 'info', message: msg });

  const appDir = __dirname;
  const parentDir = path.dirname(appDir);
  const appName = path.basename(appDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(parentDir, `${appName}-backup-${timestamp}`);

  // Step 1: backup
  notify('📦 Creating timestamped backup of current files...');
  try {
    fs.cpSync(appDir, backupDir, {
      recursive: true,
      filter: (src) => {
        const basename = path.basename(src);
        return !['node_modules', '.git', 'data', '.arena', '.cache'].includes(basename);
      }
    });
    notify(`✅ Backup successfully saved to: ${backupDir}`);
  } catch (err) {
    send({ type: 'error', message: `Backup failed: ${err.message}` });
    return res.end();
  }

  // Step 2: verify API key if not ollama
  const cfg = loadConfig();
  const keys = cfg.keys || {};
  if (provider !== 'ollama' && !keys[provider]) {
    send({ type: 'error', message: `A valid ${provider} API key is required in Settings.` });
    return res.end();
  }

  // Read current file contents
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

  notify(`🤖 Evolving codebase (${files.length} files) via ${provider} (${model})...`);
  const filesDump = files.map(f => `=== FILE: ${f.path} ===\n${f.content}`).join('\n\n');

  const prompt = `You are an expert Node.js / HTML / CSS / JS developer. You are given the full source code of a local AI chat application and a feature request. Your job is to output a JSON array of file patches to apply.

FEATURE REQUEST: ${featureRequest}

CURRENT SOURCE CODE:
${filesDump}

OUTPUT RULES:
- Respond ONLY with a valid JSON array, no markdown, no explanation.
- Each element: { "path": "relative/path/from/app/root", "content": "full new file content as string" }
- Only include files that need to change or new files to create.
- Preserve all existing functionality unless explicitly asked to remove something.
- Use the same code style as the existing files.`;

  try {
    let rawText = '';

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
          max_tokens: 8192,
          stream: true,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(180000),
      });
      if (!r.ok) {
        send({ type: 'error', message: `Anthropic API error: ${await readErrorMessage(r, 'Update failed')}` });
        return res.end();
      }
      for await (const chunk of r.body) {
        const lines = Buffer.from(chunk).toString().split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.type === 'content_block_delta' && d.delta?.text) {
              const txt = d.delta.text;
              rawText += txt;
              send({ type: 'progress', text: txt });
            }
          } catch { /* skip */ }
        }
      }

    } else if (provider === 'openai' || provider === 'groq' || provider === 'openrouter' || provider === 'deepseek') {
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
        signal: AbortSignal.timeout(180000),
      });
      if (!r.ok) {
        send({ type: 'error', message: `${provider} API error: ${await readErrorMessage(r, 'Update failed')}` });
        return res.end();
      }
      for await (const chunk of r.body) {
        const lines = Buffer.from(chunk).toString().split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
          try {
            const d = JSON.parse(line.slice(6));
            const txt = d.choices?.[0]?.delta?.content;
            if (txt) {
              rawText += txt;
              send({ type: 'progress', text: txt });
            }
          } catch { /* skip */ }
        }
      }

    } else if (provider === 'gemini') {
      const executeGeminiUpdateStream = async (targetModel) => {
        let textResult = '';
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:streamGenerateContent?key=${keys.gemini}&alt=sse`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }]
            }),
            signal: AbortSignal.timeout(180000)
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
              if (txt) {
                textResult += txt;
                send({ type: 'progress', text: txt });
              }
            } catch { /* skip */ }
          }
        }
        return textResult;
      };

      try {
        rawText = await executeGeminiUpdateStream(model);
      } catch (err) {
        if (err.message.includes('high demand') || err.message.includes('overloaded') || err.message.includes('429') || err.message.includes('503') || err.message.includes('400')) {
          notify(`⚠️ ${model} overloaded (${err.message}). Self-healing: retrying with stable gemini-1.5-flash...`);
          rawText = await executeGeminiUpdateStream('gemini-1.5-flash');
        } else {
          throw err;
        }
      }

    } else if (provider === 'ollama') {
      const r = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: true
        }),
        signal: AbortSignal.timeout(180000)
      });
      if (!r.ok) {
        send({ type: 'error', message: 'Ollama local update request failed' });
        return res.end();
      }
      for await (const chunk of r.body) {
        const lines = Buffer.from(chunk).toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const d = JSON.parse(line);
            if (d.message?.content) {
              const txt = d.message.content;
              rawText += txt;
              send({ type: 'progress', text: txt });
            }
          } catch { /* skip */ }
        }
      }
    } else {
      send({ type: 'error', message: `Unknown provider for update: ${provider}` });
      return res.end();
    }

    notify('\n🧩 Code generated successfully! Validating and applying file patches...');

    function extractJsonArray(text) {
      let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

      // Try finding markdown json blocks
      const mdMatch = cleaned.match(/```json\s*(\[\s*\{[\s\S]*\}\s*\])\s*```/);
      if (mdMatch) {
        try {
          const parsed = JSON.parse(mdMatch[1]);
          if (Array.isArray(parsed)) return parsed;
        } catch { /* skip */ }
      }

      const firstIdx = cleaned.indexOf('[');
      const lastIdx = cleaned.lastIndexOf(']');
      if (firstIdx !== -1 && lastIdx !== -1 && lastIdx >= firstIdx) {
        const maybeJson = cleaned.slice(firstIdx, lastIdx + 1);
        try {
          const parsed = JSON.parse(maybeJson);
          if (Array.isArray(parsed)) return parsed;
        } catch { /* skip */ }
      }
      cleaned = cleaned.replace(/```json|```/gi, '').trim();
      return JSON.parse(cleaned);
    }

    let patches;
    try {
      patches = extractJsonArray(rawText);
    } catch {
      send({ type: 'error', message: 'Could not parse JSON array of file patches from AI response.\nResponse text was:\n' + rawText });
      return res.end();
    }

    if (!Array.isArray(patches)) {
      send({ type: 'error', message: 'AI response parsed successfully but was not a JSON array' });
      return res.end();
    }

    const applied = [];
    for (const patch of patches) {
      const target = safeResolve(appDir, patch.path);
      if (!target || typeof patch.content !== 'string') {
        send({ type: 'error', message: `Unsafe or invalid patch path: ${patch?.path}` });
        return res.end();
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, patch.content, 'utf8');
      applied.push(patch.path);
    }

    send({
      type: 'success',
      applied,
      backupDir,
      message: `Successfully applied ${applied.length} file update(s)! Reload the page to see your evolved application.`
    });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
});

// -- Serve index for all other routes -----------------------------------------
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n[OK]  AI Chat running at ? http://localhost:${PORT}\n`);
  // Try to open browser automatically
  if (!process.env.NO_OPEN_BROWSER) {
    const url = `http://localhost:${PORT}`;
    const cmd = process.platform === 'win32' ? `start ${url}` :
                 process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
    exec(cmd, () => {});
  }
});
