const { readErrorMessage } = require('../utils');

function extractFirstJson(text) {
  const cleaned = String(text || '').replace(/```(?:json|plan)?\s*([\s\S]*?)```/i, '$1').trim();
  const firstObj = cleaned.indexOf('{');
  const lastObj = cleaned.lastIndexOf('}');
  const firstArr = cleaned.indexOf('[');
  const lastArr = cleaned.lastIndexOf(']');
  if (firstArr !== -1 && lastArr > firstArr && (firstObj === -1 || firstArr < firstObj)) return JSON.parse(cleaned.slice(firstArr, lastArr + 1));
  if (firstObj !== -1 && lastObj > firstObj) return JSON.parse(cleaned.slice(firstObj, lastObj + 1));
  return JSON.parse(cleaned);
}

async function runSelfChatProbe(port, provider, model, prompt, systemPrompt = '') {
  const r = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, model, messages: [{ role: 'user', content: prompt }], systemPrompt, enableThinking: false }),
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw new Error(await readErrorMessage(r, 'Probe request failed'));
  let answer = '';
  for await (const chunk of r.body) {
    const lines = Buffer.from(chunk).toString().split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const d = JSON.parse(line.slice(6));
      if (d.error) throw new Error(d.error);
      if (d.text) answer += d.text;
    }
  }
  return answer.trim();
}

module.exports = {
  extractFirstJson,
  runSelfChatProbe,
};
