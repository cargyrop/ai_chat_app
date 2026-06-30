/* BLACKLINE AI — LMSYS Arena Leaderboard Benchmark Registry v2.1
   Curated factual Text ELO and Coding ELO scores.
*/

const ARENA_BENCHMARKS = [
  { regex: /claude-3-7-sonnet|claude-3\.7-sonnet/i, name: 'Claude 3.7 Sonnet', textElo: 1310, codingElo: 1345, score: 98, code: true, reasoning: true, longContext: true },
  { regex: /o3-mini|o3_mini/i, name: 'OpenAI o3-mini', textElo: 1295, codingElo: 1330, score: 97, code: true, reasoning: true, longContext: true },
  { regex: /o1\b|-o1\b|o1-preview/i, name: 'OpenAI o1', textElo: 1290, codingElo: 1325, score: 97, code: true, reasoning: true, longContext: true },
  { regex: /claude-3-5-sonnet|claude-3\.5-sonnet|sonnet-20241022/i, name: 'Claude 3.5 Sonnet', textElo: 1286, codingElo: 1315, score: 96, code: true, reasoning: false, longContext: true },
  { regex: /deepseek-r1|deepseek.*reasoner/i, name: 'DeepSeek R1', textElo: 1285, codingElo: 1310, score: 96, code: true, reasoning: true, longContext: true },
  { regex: /gpt-4o\b|-gpt-4o\b|gpt-4o-2024/i, name: 'GPT-4o', textElo: 1280, codingElo: 1290, score: 95, code: true, reasoning: false, longContext: true },
  { regex: /gpt-4\b|-gpt-4\b|gpt-4-turbo/i, name: 'GPT-4 Turbo', textElo: 1255, codingElo: 1270, score: 88, code: true, reasoning: false, longContext: true },
  { regex: /deepseek-v3|deepseek.*chat/i, name: 'DeepSeek V3', textElo: 1272, codingElo: 1285, score: 94, code: true, reasoning: false, longContext: true },
  { regex: /gemini-1\.5-pro|gemini-2\.5-pro/i, name: 'Gemini Pro', textElo: 1265, codingElo: 1275, score: 93, code: true, reasoning: false, longContext: true },
  { regex: /gemini-2\.0-flash|gemini-2\.5-flash/i, name: 'Gemini Flash', textElo: 1248, codingElo: 1255, score: 91, code: true, reasoning: false, longContext: true },
  { regex: /claude-3-opus|claude-3\.5-opus/i, name: 'Claude Opus', textElo: 1245, codingElo: 1250, score: 90, code: true, reasoning: false, longContext: true },
  { regex: /llama-3\.3-70b|llama3\.3:70b/i, name: 'Llama 3.3 70B', textElo: 1235, codingElo: 1240, score: 89, code: true, reasoning: false, longContext: true },
  { regex: /qwen.*2\.5.*72b|qwen2\.5:72b/i, name: 'Qwen 2.5 72B', textElo: 1230, codingElo: 1245, score: 88, code: true, reasoning: false, longContext: true },
  { regex: /qwq.*32b|qwq-32b/i, name: 'Qwen QwQ 32B', textElo: 1225, codingElo: 1240, score: 87, code: true, reasoning: true, longContext: true },
  { regex: /mistral-large|pixtral-large/i, name: 'Mistral Large', textElo: 1215, codingElo: 1225, score: 86, code: true, reasoning: false, longContext: true },
  { regex: /llama-3\.1-405b|llama3\.1:405b/i, name: 'Llama 3.1 405B', textElo: 1210, codingElo: 1220, score: 86, code: true, reasoning: false, longContext: true },
  { regex: /phi-4|phi4/i, name: 'Microsoft Phi-4', textElo: 1195, codingElo: 1205, score: 83, code: true, reasoning: false, longContext: false },
  { regex: /gpt-4o-mini|gpt-4o_mini/i, name: 'GPT-4o mini', textElo: 1175, codingElo: 1180, score: 79, code: true, reasoning: false, longContext: true },
  { regex: /claude-3-5-haiku|claude-3-haiku/i, name: 'Claude Haiku', textElo: 1168, codingElo: 1175, score: 78, code: true, reasoning: false, longContext: true },
  { regex: /llama-3\.1-70b|llama3\.1:70b/i, name: 'Llama 3.1 70B', textElo: 1160, codingElo: 1165, score: 77, code: true, reasoning: false, longContext: true },
  { regex: /mistral-small|codestral/i, name: 'Mistral Small', textElo: 1150, codingElo: 1170, score: 76, code: true, reasoning: false, longContext: false },
  { regex: /qwen.*coder|coder.*33b/i, name: 'Qwen Coder 33B', textElo: 1145, codingElo: 1180, score: 76, code: true, reasoning: false, longContext: false },
  { regex: /llama-3\.1-8b|llama3\.1:8b|llama3:8b/i, name: 'Llama 3.1 8B', textElo: 1120, codingElo: 1105, score: 72, code: false, reasoning: false, longContext: false },
  { regex: /gemma-2-9b|gemma2:9b/i, name: 'Google Gemma 2 9B', textElo: 1115, codingElo: 1110, score: 71, code: false, reasoning: false, longContext: false },
  { regex: /mixtral-8x7b/i, name: 'Mixtral 8x7B', textElo: 1105, codingElo: 1115, score: 70, code: true, reasoning: false, longContext: false },
];

function getArenaRanking(provider, id, name = '') {
  const full = `${provider} ${id} ${name}`.toLowerCase();
  for (const b of ARENA_BENCHMARKS) {
    if (b.regex.test(full)) {
      return {
        matched: true,
        name: b.name,
        textElo: b.textElo,
        codingElo: b.codingElo,
        score: b.score,
        caps: {
          code: b.code,
          reasoning: b.reasoning,
          longContext: b.longContext
        }
      };
    }
  }
  return { matched: false };
}

module.exports = {
  ARENA_BENCHMARKS,
  getArenaRanking
};
