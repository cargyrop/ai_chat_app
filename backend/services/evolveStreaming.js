/* ARKEL — evolve streaming (split from evolveEngine.js, Phase 1B)
   Provider-specific model streaming for execution. */

const { readErrorMessage, joinUrl, getCustomProvider, ollamaBaseUrl } = require('../utils');
const { loadConfig } = require('../config');
const { EVOLVE_EXECUTION_TIMEOUT_MS } = require('./evolvePatching');

async function streamModelText(port, provider, model, prompt, onText, cfg, sendEvent) {
  const keys = cfg.keys || {};
  const customProvider = getCustomProvider(cfg, provider);
  const addedEndpoint = (cfg.endpoints || []).find(e => e.id === provider && e.enabled !== false);
  const endpointType = addedEndpoint?.providerType || addedEndpoint?.id || provider;
  let textResult = '';
  const push = (txt) => {
    if (!txt) return;
    textResult += txt;
    onText(txt);
  };

  if (provider === 'anthropic' || (addedEndpoint && endpointType === 'anthropic')) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': addedEndpoint ? addedEndpoint.apiKey : keys.anthropic,
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

  if (provider === 'openai' || provider === 'groq' || provider === 'openrouter' || provider === 'deepseek' || customProvider || (addedEndpoint && !['anthropic', 'gemini', 'ollama'].includes(endpointType))) {
    const endpoints = {
      openai: 'https://api.openai.com/v1/chat/completions',
      groq: 'https://api.groq.com/openai/v1/chat/completions',
      openrouter: 'https://openrouter.ai/api/v1/chat/completions',
      deepseek: 'https://api.deepseek.com/v1/chat/completions',
    };
    const endpoint = addedEndpoint
      ? joinUrl(addedEndpoint.baseUrl, addedEndpoint.chatPath || '/chat/completions')
      : customProvider ? joinUrl(customProvider.baseUrl, customProvider.chatPath || '/chat/completions') : endpoints[provider];
    const authKey = addedEndpoint ? addedEndpoint.apiKey : customProvider ? customProvider.apiKey : keys[provider];
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authKey}`,
        'Content-Type': 'application/json',
        ...(provider === 'openrouter' || endpointType === 'openrouter' ? { 'HTTP-Referer': 'http://localhost:3737', 'X-Title': 'BLACKLINE AI' } : {}),
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

  if (provider === 'gemini' || (addedEndpoint && endpointType === 'gemini')) {
    const callGemini = async (targetModel) => {
      let geminiText = '';
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:streamGenerateContent?key=${addedEndpoint ? addedEndpoint.apiKey : keys.gemini}&alt=sse`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
          signal: AbortSignal.timeout(EVOLVE_EXECUTION_TIMEOUT_MS)
        }
      );
      if (!r.ok) {
        const msg = await readErrorMessage(r, 'Gemini API error');
        throw new Error(msg);
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
        if (sendEvent) sendEvent({ type: 'info', message: `${model} overloaded. Retrying with gemini-1.5-flash...` });
        await callGemini('gemini-1.5-flash');
      } else {
        throw err;
      }
    }
    return textResult;
  }

  if (provider === 'ollama') {
    const r = await fetch(joinUrl(ollamaBaseUrl(cfg, provider), '/api/chat'), {
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

module.exports = { streamModelText };
