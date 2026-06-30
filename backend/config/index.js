const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'config.json');
const ALLOWED_PROVIDERS = new Set(['anthropic', 'openai', 'gemini', 'groq', 'openrouter', 'deepseek']);

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

function modelProbeKey(provider, model) {
  return `${provider}::${model}`;
}

function clearModelProbesForProvider(cfg, providerPrefix) {
  if (!cfg.modelProbes) return;
  for (const key of Object.keys(cfg.modelProbes)) {
    if (key.startsWith(`${providerPrefix}::`)) delete cfg.modelProbes[key];
  }
}

module.exports = {
  DATA_FILE,
  ALLOWED_PROVIDERS,
  loadConfig,
  saveConfig,
  modelProbeKey,
  clearModelProbesForProvider,
};
