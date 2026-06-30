const { Router } = require('express');
const { loadConfig, saveConfig } = require('../config');
const { discoverModels } = require('../services/modelDiscovery');

const router = Router();

router.get('/', async (req, res) => {
  const cfg = loadConfig();
  try {
    const models = await discoverModels(cfg);
    res.json(models);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/toggle', (req, res) => {
  const { provider, id, enabled } = req.body || {};
  if (!provider || !id) return res.status(400).json({ error: 'provider and id required' });
  const cfg = loadConfig();
  cfg.disabledModelKeys = cfg.disabledModelKeys || [];
  const key = `${provider}::${id}`;
  if (enabled === false) {
    if (!cfg.disabledModelKeys.includes(key)) cfg.disabledModelKeys.push(key);
  } else {
    cfg.disabledModelKeys = cfg.disabledModelKeys.filter(k => k !== key);
  }
  saveConfig(cfg);
  res.json({ ok: true, enabled });
});

router.put('/bulk-toggle', (req, res) => {
  const { provider, enable, modelIds } = req.body || {};
  if (!Array.isArray(modelIds)) return res.status(400).json({ error: 'modelIds array required' });
  const cfg = loadConfig();
  cfg.disabledModelKeys = cfg.disabledModelKeys || [];
  for (const item of modelIds) {
    const key = item.includes('::') ? item : `${provider}::${item}`;
    if (enable === false) {
      if (!cfg.disabledModelKeys.includes(key)) cfg.disabledModelKeys.push(key);
    } else {
      cfg.disabledModelKeys = cfg.disabledModelKeys.filter(k => k !== key);
    }
  }
  saveConfig(cfg);
  res.json({ ok: true });
});

module.exports = router;
