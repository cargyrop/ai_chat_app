const { ALLOWED_PROVIDERS, modelProbeKey } = require('../config');
const { prettyModelName, readErrorMessage, joinUrl, enrichModel, getCustomProvider, ollamaBaseUrl } = require('../utils');
const { getArenaCache, applyArenaScores } = require('./arenaSync');

const GEMINI_FALLBACK_MODELS = [
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash-Lite' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
];

function isUpdateCapable(provider, id, name = '') {
  const full = `${id} ${name}`.toLowerCase();
  if (provider === 'gemini' || provider === 'anthropic' || provider === 'deepseek') return true;
  if (provider === 'openai') return /gpt-4|o1|o3|gpt-5/i.test(full);
  if (provider === 'groq') return /70b|deepseek|3\.3|mixtral/i.test(full);
  if (provider === 'openrouter') return /sonnet|opus|gpt-4|o1|o3|gemini|70b|405b|deepseek|coder/i.test(full);
  if (provider === 'ollama') return /70b|deepseek|qwen|coder|llama3|phi4|mistral/i.test(full);
  return false;
}

async function discoverModels(cfg) {
  const keys = cfg.keys || {};
  const models = [];
  const probes = cfg.modelProbes || {};
  const arenaCache = await getArenaCache({ refreshIfStale: true });
  const endpointProviderIds = new Set();

  if (cfg.endpoints && cfg.endpoints.length > 0) {
    for (const ep of cfg.endpoints) {
      const endpointType = ep.providerType || ep.id;
      if (endpointType) endpointProviderIds.add(endpointType);
      if (ep.enabled === false) continue;
      for (const m of (ep.models || [])) {
        if ((ep.disabledModels || []).includes(m.id)) continue;
        models.push({
          ...m,
          provider: ep.id,
          providerType: endpointType,
          providerName: ep.label,
          baseUrl: ep.baseUrl,
          icon: ep.icon || '◆',
          source: 'added-endpoint'
        });
      }
    }
  }

  // Anthropic
  if (keys.anthropic && !endpointProviderIds.has('anthropic')) {
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
  if (keys.openai && !endpointProviderIds.has('openai')) {
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
        { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', icon: '◎' },
        { id: 'gpt-4o-mini', name: 'GPT-4o mini', provider: 'openai', icon: '◎' },
        { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai', icon: '◎' },
        { id: 'o3-mini', name: 'o3-mini', provider: 'openai', icon: '◎' }
      );
    }
  }

  // Google Gemini
  if (keys.gemini && !endpointProviderIds.has('gemini')) {
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
  if (keys.groq && !endpointProviderIds.has('groq')) {
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
        { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', provider: 'groq', icon: '⚡' },
        { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 70B', provider: 'groq', icon: '⚡' },
        { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', provider: 'groq', icon: '⚡' },
        { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', provider: 'groq', icon: '⚡' }
      );
    }
  }

  // OpenRouter
  if (keys.openrouter && !endpointProviderIds.has('openrouter')) {
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
        { id: 'openai/gpt-4o', provider: 'openrouter', name: 'GPT-4o (via OpenRouter)', icon: '⬡' },
        { id: 'anthropic/claude-3.5-sonnet', provider: 'openrouter', name: 'Claude 3.5 Sonnet (OR)', icon: '⬡' },
        { id: 'google/gemini-2.0-flash-001', provider: 'openrouter', name: 'Gemini 2.0 Flash (OR)', icon: '⬡' },
        { id: 'meta-llama/llama-3.3-70b-instruct', provider: 'openrouter', name: 'Llama 3.3 70B (OR)', icon: '⬡' },
        { id: 'deepseek/deepseek-chat', provider: 'openrouter', name: 'DeepSeek Chat (OR)', icon: '⬡' },
      );
    }
  }

  // DeepSeek
  if (keys.deepseek && !endpointProviderIds.has('deepseek')) {
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
        { id: 'deepseek-chat', name: 'DeepSeek V3 (Chat)', provider: 'deepseek', icon: '▽' },
        { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Reasoner)', provider: 'deepseek', icon: '▽' }
      );
    }
  }

  // Custom OpenAI-compatible providers
  for (const cp of (cfg.customProviders || []).filter(p => p && p.enabled !== false && p.apiKey && p.baseUrl && !endpointProviderIds.has(`custom:${p.id}`))) {
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
  if (!models.some(m => m.provider === 'ollama')) {
    try {
      const r = await fetch(joinUrl(ollamaBaseUrl(cfg), '/api/tags'), { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const data = await r.json();
        (data.models || []).forEach(m =>
          models.push({ id: m.name, name: m.name, provider: 'ollama', icon: '◌', local: true })
        );
      }
    } catch { /* Ollama not running */ }
  }

  // Apply metadata
  for (let i = 0; i < models.length; i++) {
    const enriched = enrichModel(models[i], { _source: models[i].source || 'provider-api-or-fallback' });
    const mKey = `${enriched.provider}::${enriched.id}`;
    const isDisabled = (cfg.disabledModelKeys || []).includes(mKey);
    if (isDisabled) {
      enriched.enabled = false;
      enriched.disabled = true;
    } else {
      enriched.enabled = true;
      enriched.disabled = false;
    }
    Object.assign(enriched, applyArenaScores(enriched, arenaCache));
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
    enriched.updateCapable = enriched.updateCapable || isUpdateCapable(enriched.provider, enriched.id, enriched.name) || !enriched.capabilities?.imageOutput;
    if (enriched.evolve) enriched.evolve.capable = enriched.updateCapable;
    models[i] = enriched;
  }

  return models;
}

module.exports = {
  discoverModels,
  GEMINI_FALLBACK_MODELS,
};
