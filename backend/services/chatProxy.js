const { readErrorMessage, explainProviderError, sanitizeMessages, joinUrl, getCustomProvider, ollamaBaseUrlCandidates } = require('../utils');

async function streamChat(req, res, cfg) {
  const keys = cfg.keys || {};
  const { provider, model } = req.body || {};
  const messages = sanitizeMessages(req.body?.messages);
  const explicitSystemPrompt = typeof req.body?.systemPrompt === 'string' ? req.body.systemPrompt : '';
  const systemMessages = (messages || [])
    .filter(m => m.role === 'system')
    .map(m => m.content)
    .join('\n\n');
  const safeSystemPrompt = [explicitSystemPrompt, systemMessages]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 200000);
  const finalMessages = messages || [];

  const customProvider = getCustomProvider(cfg, provider);
  const addedEndpoint = (cfg.endpoints || []).find(e => e.id === provider && e.enabled !== false);
  const endpointType = addedEndpoint?.providerType || addedEndpoint?.id || provider;
  const knownProvider = ['anthropic', 'openai', 'gemini', 'groq', 'openrouter', 'ollama', 'deepseek'].includes(provider);
  if (!knownProvider && !customProvider && !addedEndpoint) {
    return res.status(400).json({ error: 'unknown provider' });
  }
  if (!model || typeof model !== 'string') return res.status(400).json({ error: 'model required' });
  if (!messages) return res.status(400).json({ error: 'messages must be an array' });
  if (provider !== 'ollama' && !customProvider && !addedEndpoint && !keys[provider]) return res.status(400).json({ error: `${provider} API key is not configured` });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  let promptTokens = 0;
  let completionTokens = 0;
  let assistantAnswer = '';
  let usageReported = false;
  let usageEstimated = false;

  const reportUsageAndFinish = () => {
    if (usageReported) return;
    usageReported = true;
    if (promptTokens === 0) {
      const promptText = safeSystemPrompt + ' ' + messages.map(m => m.content).join(' ');
      promptTokens = Math.max(1, Math.round(promptText.length / 4));
      usageEstimated = true;
    }
    if (completionTokens === 0) {
      completionTokens = Math.max(1, Math.round(assistantAnswer.length / 4));
      usageEstimated = true;
    }
    send({
      type: 'usage',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimated: usageEstimated
      }
    });
    send({ done: true });
  };

  try {
    if (provider === 'anthropic' || (addedEndpoint && endpointType === 'anthropic')) {
      const antKey = addedEndpoint ? addedEndpoint.apiKey : keys.anthropic;
      const body = {
        model,
        max_tokens: req.body.enableThinking ? 8192 : 4096,
        temperature: req.body.temperature ?? 0.7,
        top_p: req.body.top_p ?? 1.0,
        stream: true,
        messages: finalMessages.filter(m => m.role !== 'system'),
      };
      if (req.body.enableThinking && /sonnet-4|3-7-sonnet/.test(model)) {
        body.thinking = { type: 'enabled', budget_tokens: 2000 };
      }
      if (safeSystemPrompt) body.system = safeSystemPrompt;

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': antKey,
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

    } else if (provider === 'openai' || provider === 'groq' || provider === 'openrouter' || provider === 'deepseek' || customProvider || (addedEndpoint && endpointType !== 'gemini' && endpointType !== 'ollama' && endpointType !== 'anthropic')) {
      const endpoints = {
        openai: 'https://api.openai.com/v1/chat/completions',
        groq: 'https://api.groq.com/openai/v1/chat/completions',
        openrouter: 'https://openrouter.ai/api/v1/chat/completions',
        deepseek: 'https://api.deepseek.com/v1/chat/completions',
      };
      const endpoint = addedEndpoint ? joinUrl(addedEndpoint.baseUrl, '/chat/completions') : customProvider ? joinUrl(customProvider.baseUrl, customProvider.chatPath || '/chat/completions') : endpoints[provider];
      const authKey = addedEndpoint ? addedEndpoint.apiKey : customProvider ? customProvider.apiKey : keys[provider];
      const msgs = safeSystemPrompt
        ? [{ role: 'system', content: safeSystemPrompt }, ...messages.filter(m => m.role !== 'system')]
        : messages.filter(m => m.role !== 'system');

      const r = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authKey}`,
          'Content-Type': 'application/json',
          ...(provider === 'openrouter' || endpointType === 'openrouter' ? { 'HTTP-Referer': 'http://localhost:3737', 'X-Title': 'BLACKLINE AI' } : {}),
        },
        body: JSON.stringify({
          model,
          messages: msgs,
          stream: true,
          ...(customProvider ? {} : { stream_options: { include_usage: true } })
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

    } else if (provider === 'gemini' || (addedEndpoint && endpointType === 'gemini')) {
      const gemKey = addedEndpoint ? addedEndpoint.apiKey : keys.gemini;
      const chatMessages = messages.filter(m => m.role !== 'system');
      const msgs = chatMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      const body = { contents: msgs };
      if (safeSystemPrompt) body.systemInstruction = { parts: [{ text: safeSystemPrompt }] };

      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?key=${gemKey}&alt=sse`,
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
          } catch { /* skip */ }
        }
      }
      reportUsageAndFinish();

    } else if (provider === 'ollama') {
      const chatMessages = messages.filter(m => m.role !== 'system');
      const msgs = safeSystemPrompt
        ? [{ role: 'system', content: safeSystemPrompt }, ...chatMessages]
        : chatMessages;
      const bases = ollamaBaseUrlCandidates(cfg, provider);
      let mode = 'chat';
      let r = null;
      let usedBase = bases[0];
      const errors = [];
      for (const base of bases) {
        usedBase = base;
        try {
          mode = 'chat';
          r = await fetch(joinUrl(base, '/api/chat'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: msgs, stream: true }),
            signal: AbortSignal.timeout(120000),
          });
          if (r.ok) break;
          errors.push(`${base}/api/chat: ${await readErrorMessage(r, 'Ollama /api/chat request failed')}`);
          const prompt = msgs.map(m => `${m.role === 'assistant' ? 'Assistant' : m.role === 'system' ? 'System' : 'User'}: ${m.content}`).join('\n\n') + '\n\nAssistant:';
          mode = 'generate';
          r = await fetch(joinUrl(base, '/api/generate'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt, stream: true }),
            signal: AbortSignal.timeout(120000),
          });
          if (r.ok) break;
          errors.push(`${base}/api/generate: ${await readErrorMessage(r, 'Ollama /api/generate request failed')}`);
        } catch (err) {
          errors.push(`${base}: ${err.message}`);
          r = null;
        }
      }
      if (!r || !r.ok) {
        send({ error: `Ollama request failed. Tried: ${errors.join(' | ') || bases.join(', ')}` });
        return res.end();
      }
      for await (const chunk of r.body) {
        const lines = Buffer.from(chunk).toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const d = JSON.parse(line);
            if (d.prompt_eval_count) promptTokens = d.prompt_eval_count;
            if (d.eval_count) completionTokens = d.eval_count;
            const txt = mode === 'chat' ? d.message?.content : d.response;
            if (txt) {
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
}

module.exports = {
  streamChat,
};
