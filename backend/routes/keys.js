const { Router } = require('express');
const { loadConfig, saveConfig, clearModelProbesForProvider, ALLOWED_PROVIDERS } = require('../config');
const { isAllowedProvider } = require('../utils');

const router = Router();

router.get('/', (req, res) => {
  const cfg = loadConfig();
  const safe = {};
  for (const [k, v] of Object.entries(cfg.keys || {})) {
    safe[k] = v ? '••••' + v.slice(-4) : '';
  }
  res.json(safe);
});

router.post('/', (req, res) => {
  const { provider, key } = req.body;
  if (!isAllowedProvider(provider, ALLOWED_PROVIDERS)) return res.status(400).json({ error: 'unknown provider' });
  if (!key || typeof key !== 'string' || !key.trim()) return res.status(400).json({ error: 'provider and key required' });
  const cfg = loadConfig();
  cfg.keys = cfg.keys || {};
  cfg.keys[provider] = key.trim();
  clearModelProbesForProvider(cfg, provider);
  saveConfig(cfg);
  res.json({ ok: true });
});

router.delete('/:provider', (req, res) => {
  if (!isAllowedProvider(req.params.provider, ALLOWED_PROVIDERS)) return res.status(400).json({ error: 'unknown provider' });
  const cfg = loadConfig();
  delete (cfg.keys || {})[req.params.provider];
  clearModelProbesForProvider(cfg, req.params.provider);
  saveConfig(cfg);
  res.json({ ok: true });
});

module.exports = router;
