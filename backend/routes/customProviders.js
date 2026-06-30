const { Router } = require('express');
const { loadConfig, saveConfig, clearModelProbesForProvider } = require('../config');
const { sanitizeCustomProviderInput, publicCustomProvider, getCustomProvider } = require('../utils');
const { CUSTOM_PROVIDER_PRESETS } = require('../providers/presets');

const router = Router();

router.get('/', (req, res) => {
  const cfg = loadConfig();
  res.json((cfg.customProviders || []).map(publicCustomProvider));
});

router.post('/', (req, res) => {
  try {
    const cfg = loadConfig();
    cfg.customProviders = Array.isArray(cfg.customProviders) ? cfg.customProviders : [];
    const incomingId = String(req.body?.id || '').trim();
    const existing = incomingId ? cfg.customProviders.find(p => p.id === incomingId) : null;
    const provider = sanitizeCustomProviderInput(req.body, existing);
    const idx = cfg.customProviders.findIndex(p => p.id === provider.id);
    if (idx >= 0) cfg.customProviders[idx] = provider;
    else cfg.customProviders.push(provider);
    clearModelProbesForProvider(cfg, `custom:${provider.id}`);
    saveConfig(cfg);
    res.json({ ok: true, provider: publicCustomProvider(provider) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const cfg = loadConfig();
  cfg.customProviders = (cfg.customProviders || []).filter(p => p.id !== req.params.id);
  clearModelProbesForProvider(cfg, `custom:${req.params.id}`);
  saveConfig(cfg);
  res.json({ ok: true });
});

module.exports = router;
