const { Router } = require('express');
const { loadConfig, saveConfig, ALLOWED_PROVIDERS } = require('../config');
const { readErrorMessage, joinUrl, enrichModel, prettyModelName, defaultOllamaBaseUrl } = require('../utils');

const router = Router();

// Helper to query provider APIs during Test
async function fetchCatalogForEndpoint({ provider, baseUrl, apiKey, category }) {
  const models = [];
  const cleanBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  const cleanKey = String(apiKey || '').trim();

  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': cleanKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(await readErrorMessage(r, 'Anthropic models request failed'));
    const data = await r.json();
    (data.data || [])
      .filter(m => !/embedding|image|audio/i.test(`${m.id} ${m.display_name}`))
      .slice(0, 50)
      .forEach(m => models.push({
        id: m.id,
        name: m.display_name || prettyModelName(m.id),
        provider: 'anthropic',
        icon: '◖',
        source: 'anthropic-models-api'
      }));
  } else if (provider === 'gemini') {
    const discovered = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ key: cleanKey, pageSize: '1000' });
      if (pageToken) params.set('pageToken', pageToken);
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?${params}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error(await readErrorMessage(r, 'Gemini models request failed'));
      const data = await r.json();
      (data.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .filter(m => !/embedding|tts|image|veo|lyria|live|aqa/i.test(`${m.name} ${m.displayName}`))
        .forEach(m => {
          const id = (m.name || m.baseModelId || '').replace(/^models\//, '');
          if (!id || discovered.some(x => x.id === id)) return;
          discovered.push({
            id,
            name: m.displayName || prettyModelName(id),
            provider: 'gemini',
            icon: '◇'
          });
        });
      pageToken = data.nextPageToken || '';
    } while (pageToken);
    models.push(...discovered.slice(0, 40));
  } else if (provider === 'ollama') {
    const targetUrl = joinUrl(cleanBase || defaultOllamaBaseUrl(), '/api/tags');
    const r = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(await readErrorMessage(r, 'Ollama request failed'));
    const data = await r.json();
    (data.models || []).forEach(m => models.push({
      id: m.name, name: m.name, provider: 'ollama', icon: '◌', local: true
    }));
  } else {
    // OpenAI compatible (OpenRouter, Groq, OpenAI, DeepSeek, Kimi, Mistral, Together, Fireworks, xAI, Custom)
    const targetUrl = joinUrl(cleanBase, '/models');
    const r = await fetch(targetUrl, {
      headers: { Authorization: `Bearer ${cleanKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(await readErrorMessage(r, `${provider} models request failed`));
    const data = await r.json();
    const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
    list
      .filter(m => !/embedding|moderation|tts|whisper|transcribe/i.test(`${m.id || m.name}`))
      .slice(0, 250)
      .forEach(m => {
        const id = m.id || m.name;
        models.push({
          id,
          name: m.name || id,
          provider: provider,
          icon: '◆',
          pricing: m.pricing || null,
          context_length: m.context_length || null
        });
      });
  }

  // Filter category if needed
  let finalModels = models.map(m => enrichModel(m));
  if (category && category !== 'All' && category !== 'all') {
    finalModels = finalModels.filter(m => {
      if (category.toLowerCase() === 'vision') return m.capabilities?.imageInput;
      if (category.toLowerCase() === 'llm') return !m.capabilities?.imageOutput;
      return true;
    });
  }

  return finalModels;
}

// POST /api/endpoints/test
router.post('/test', async (req, res) => {
  const { provider, baseUrl, apiKey, category } = req.body || {};
  if (!provider) return res.status(400).json({ error: 'provider required' });
  if (provider !== 'ollama' && !apiKey) return res.status(400).json({ error: 'API key required' });

  try {
    const models = await fetchCatalogForEndpoint({ provider, baseUrl, apiKey, category });
    res.json({
      ok: true,
      status: 'Online',
      count: models.length,
      preview: models.slice(0, 15).map(m => m.id),
      models
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      status: 'Offline',
      error: err.message
    });
  }
});

// GET /api/endpoints
router.get('/', (req, res) => {
  const cfg = loadConfig();
  const list = (cfg.endpoints || []).map(ep => ({
    id: ep.id,
    providerType: ep.providerType || ep.id,
    label: ep.label,
    icon: ep.icon || '◆',
    baseUrl: ep.baseUrl,
    category: ep.category || 'LLM',
    enabled: ep.enabled !== false,
    keySet: !!ep.apiKey,
    keyMasked: ep.apiKey ? '••••' + ep.apiKey.slice(-4) : '',
    totalModels: (ep.models || []).length,
    enabledModels: (ep.models || []).filter(m => !(ep.disabledModels || []).includes(m.id)).length,
    disabledModels: ep.disabledModels || [],
    models: ep.models || []
  }));
  res.json(list);
});

// POST /api/endpoints
router.post('/', (req, res) => {
  const { id, providerType, label, icon, baseUrl, apiKey, category, models } = req.body || {};
  if (!id || !label) return res.status(400).json({ error: 'id and label required' });

  const cfg = loadConfig();
  cfg.endpoints = cfg.endpoints || [];
  const existingIndex = cfg.endpoints.findIndex(e => e.id === id);
  const endpointModels = Array.isArray(models) ? models : [];
  const endpointModelIds = new Set(endpointModels.map(m => m && m.id).filter(Boolean));
  const requestedDisabled = Array.isArray(req.body?.disabledModels) ? req.body.disabledModels : [];
  const disabledModels = requestedDisabled.filter(id => endpointModelIds.has(id));

  const endpointData = {
    id,
    providerType: providerType || id,
    label,
    icon: icon || '◆',
    baseUrl: String(baseUrl || '').trim(),
    apiKey: String(apiKey || '').trim(),
    category: category || 'All',
    models: endpointModels,
    enabled: true,
    // A fresh Add should make discovered models visible immediately. Do not
    // preserve stale disabledModels from an older endpoint with the same id.
    disabledModels,
    updatedAt: Date.now()
  };

  if (existingIndex !== -1) {
    cfg.endpoints[existingIndex] = { ...cfg.endpoints[existingIndex], ...endpointData };
  } else {
    endpointData.addedAt = Date.now();
    cfg.endpoints.push(endpointData);
  }

  // A re-added endpoint should not stay hidden because of old global model
  // toggles. Keep unrelated disabled models intact.
  const endpointKeys = new Set(endpointModels.map(m => `${id}::${m.id}`));
  cfg.disabledModelKeys = (cfg.disabledModelKeys || []).filter(k => !endpointKeys.has(k));

  // Backwards compatibility for legacy routes/tests
  cfg.keys = cfg.keys || {};
  if (ALLOWED_PROVIDERS.has(id)) {
    cfg.keys[id] = endpointData.apiKey;
  }

  saveConfig(cfg);
  res.json({ ok: true });
});

// PUT /api/endpoints/:id/toggle
router.put('/:id/toggle', (req, res) => {
  const { id } = req.params;
  const cfg = loadConfig();
  const ep = (cfg.endpoints || []).find(e => e.id === id);
  if (!ep) return res.status(404).json({ error: 'endpoint not found' });
  ep.enabled = ep.enabled === false ? true : false;
  saveConfig(cfg);
  res.json({ ok: true, enabled: ep.enabled });
});

// PUT /api/endpoints/:id/models
router.put('/:id/models', (req, res) => {
  const { id } = req.params;
  const { disabledModels } = req.body || {};
  if (!Array.isArray(disabledModels)) return res.status(400).json({ error: 'disabledModels array required' });
  const cfg = loadConfig();
  const ep = (cfg.endpoints || []).find(e => e.id === id);
  if (!ep) return res.status(404).json({ error: 'endpoint not found' });
  ep.disabledModels = disabledModels;
  saveConfig(cfg);
  res.json({ ok: true });
});

// DELETE /api/endpoints/:id
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const cfg = loadConfig();
  cfg.endpoints = (cfg.endpoints || []).filter(e => e.id !== id);
  if (cfg.keys && cfg.keys[id]) delete cfg.keys[id];
  saveConfig(cfg);
  res.json({ ok: true });
});

module.exports = router;
