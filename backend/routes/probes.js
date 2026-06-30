const { loadConfig, saveConfig, modelProbeKey } = require('../config');
const { getCustomProvider } = require('../utils');
const { runSelfChatProbe, extractFirstJson } = require('../services/probe');

async function getProbes(req, res) {
  const cfg = loadConfig();
  res.json(cfg.modelProbes || {});
}

async function postProbe(req, res) {
  const { provider, model } = req.body || {};
  if (!provider || !model) return res.status(400).json({ error: 'provider and model required' });
  const cfg = loadConfig();
  const customProvider = getCustomProvider(cfg, provider);
  const addedEndpoint = (cfg.endpoints || []).find(e => e.id === provider && e.enabled !== false && e.apiKey);
  if (provider !== 'ollama' && !customProvider && !addedEndpoint && !(cfg.keys || {})[provider]) {
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

  const port = parseInt(process.env.PORT, 10) || 3737;

  if (req.body?.tier === 'ping') {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    try {
      const out = await runSelfChatProbe(port, provider, model, 'BLACKLINE_PING');
      const ms = Date.now() - t0;
      const result = {
        provider, model, startedAt, updatedAt: new Date().toISOString(),
        score: 100, status: 'pass', pingMs: ms, type: 'ping',
        tests: { ping: { status: 'pass', ms, detail: `Reaction PONG received in ${ms}ms` } }
      };
      cfg.modelProbes = cfg.modelProbes || {};
      cfg.modelProbes[modelProbeKey(provider, model)] = result;
      saveConfig(cfg);
      return res.json(result);
    } catch (err) {
      const ms = Date.now() - t0;
      const result = {
        provider, model, startedAt, updatedAt: new Date().toISOString(),
        score: 0, status: 'fail', pingMs: ms, type: 'ping',
        tests: { ping: { status: 'fail', ms, error: err.message } }
      };
      cfg.modelProbes = cfg.modelProbes || {};
      cfg.modelProbes[modelProbeKey(provider, model)] = result;
      saveConfig(cfg);
      return res.json(result);
    }
  }

  await run('basicChat', async () => {
    const out = await runSelfChatProbe(port, provider, model, 'Reply with exactly BLACKLINE_OK and nothing else.');
    if (!/BLACKLINE_OK/i.test(out)) throw new Error(`Unexpected reply: ${out.slice(0, 120)}`);
    return 'Model completed a basic chat request.';
  });
  await run('json', async () => {
    const out = await runSelfChatProbe(port, provider, model, 'Return only valid JSON with exactly these fields: {"ok":true,"tool":"blackline"}. No markdown.');
    const parsed = extractFirstJson(out);
    if (parsed.ok !== true || parsed.tool !== 'blackline') throw new Error('JSON parsed, but expected fields were missing.');
    return 'Model returned parseable JSON.';
  });
  await run('evolvePlan', async () => {
    const out = await runSelfChatProbe(port, provider, model, 'Return exactly one fenced code block tagged plan containing a JSON array with one object: {"path":"frontend/app.js","action":"edit","description":"probe only"}. No other text.');
    const match = out.match(/```plan\s*([\s\S]*?)```/i);
    if (!match) throw new Error('No ```plan block found.');
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed) || parsed[0]?.path !== 'frontend/app.js') throw new Error('Plan JSON shape was invalid.');
    return 'Model produced a parseable Evolve plan block.';
  });
  await run('evolvePatch', async () => {
    const out = await runSelfChatProbe(port, provider, model, 'Return only valid JSON for a search/replace patch: {"path":"frontend/app.js","action":"edit","changes":[{"search":"const probe = false;","replace":"const probe = true;"}]}. No markdown.');
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
}

module.exports = { getProbes, postProbe };
