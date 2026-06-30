const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const ARENA_CACHE_FILE = path.join(DATA_DIR, 'arena-cache.json');
const ARENA_API_BASE = 'https://api.wulong.dev/arena-ai-leaderboards/v1';
const ARENA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const LEADERBOARD_DEFS = [
  { name: 'text', key: 'text', label: 'Text' },
  { name: 'search', key: 'search', label: 'Search' },
  { name: 'vision', key: 'vision', label: 'Vision' },
  { name: 'document', key: 'document', label: 'Document' },
  { name: 'code', key: 'code', label: 'WebDev' },
];

function normalizeModelName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^models\//, '')
    .replace(/^[a-z0-9_.-]+\//, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(via|by|from)\b.*$/g, ' ')
    .replace(/\b(preview|latest|experimental|exp|instruct|chat|thinking|fast|lite)\b/g, ' ')
    .replace(/\b\d{4}[-/]\d{2}[-/]\d{2}\b/g, ' ')
    .replace(/\b\d{8}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

function candidateNames(provider, id, name = '') {
  const out = new Set();
  const push = (v) => {
    const raw = String(v || '').trim();
    if (!raw) return;
    out.add(raw);
    out.add(raw.replace(/^models\//, ''));
    out.add(raw.replace(/^[^/]+\//, ''));
    out.add(raw.replace(/\s*\([^)]*\)\s*/g, ' '));
    out.add(raw.replace(/:free$/i, ''));
  };
  push(id);
  push(name);
  push(`${provider}/${id}`);
  return [...out].map(normalizeModelName).filter(Boolean);
}

function hasAnyLeaderboard(cache) {
  return !!cache?.leaderboards && Object.values(cache.leaderboards).some(lb => Array.isArray(lb?.models) && lb.models.length > 0);
}

function readArenaCache() {
  try {
    if (!fs.existsSync(ARENA_CACHE_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(ARENA_CACHE_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !hasAnyLeaderboard(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeArenaCache(cache) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ARENA_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

function isFresh(cache, ttlMs = ARENA_CACHE_TTL_MS) {
  const ts = Date.parse(cache?.fetchedAt || cache?.fetched_at || '');
  return Number.isFinite(ts) && Date.now() - ts < ttlMs;
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Arena request failed (${res.status}) for ${url}`);
  return res.json();
}

async function fetchArenaLeaderboards() {
  const leaderboards = {};
  const errors = [];

  for (const def of LEADERBOARD_DEFS) {
    try {
      const data = await fetchJson(`${ARENA_API_BASE}/leaderboard?name=${encodeURIComponent(def.name)}`);
      leaderboards[def.key] = {
        name: def.name,
        label: def.label,
        sourceUrl: data.meta?.source_url || `https://arena.ai/leaderboard/${def.name}`,
        fetchedAt: data.meta?.fetched_at || new Date().toISOString(),
        modelCount: data.meta?.model_count || (data.models || []).length,
        models: (data.models || []).map(m => ({
          rank: m.rank,
          model: m.model,
          vendor: m.vendor,
          license: m.license,
          score: m.score,
          ci: m.ci,
          votes: m.votes,
          normalized: normalizeModelName(m.model),
        }))
      };
    } catch (err) {
      errors.push({ leaderboard: def.name, error: err.message });
    }
  }

  if (!Object.keys(leaderboards).length) {
    throw new Error(`Could not fetch any Arena leaderboards: ${errors.map(e => `${e.leaderboard}: ${e.error}`).join('; ')}`);
  }

  const cache = {
    version: 1,
    source: 'arena-ai-leaderboards',
    sourceApi: ARENA_API_BASE,
    fetchedAt: new Date().toISOString(),
    leaderboards,
    errors,
  };
  writeArenaCache(cache);
  return cache;
}

async function getArenaCache({ force = false, refreshIfStale = true } = {}) {
  const cached = readArenaCache();
  if (!force && cached && (!refreshIfStale || isFresh(cached))) return cached;
  try {
    return await fetchArenaLeaderboards();
  } catch (err) {
    if (cached) return { ...cached, refreshError: err.message };
    return null;
  }
}

function findInLeaderboard(leaderboard, candidates) {
  if (!leaderboard?.models?.length || !candidates.length) return null;
  const byName = new Map(leaderboard.models.map(m => [m.normalized, m]));
  for (const candidate of candidates) {
    if (byName.has(candidate)) return byName.get(candidate);
  }

  // Conservative fallback for provider names with suffixes like "-preview".
  for (const candidate of candidates) {
    if (candidate.length < 6) continue;
    const match = leaderboard.models.find(m =>
      m.normalized === candidate ||
      (m.normalized.length >= 6 && (m.normalized.includes(candidate) || candidate.includes(m.normalized)))
    );
    if (match) return match;
  }
  return null;
}

function matchArenaScores(provider, id, name = '', cache = null) {
  if (!cache?.leaderboards) return { matched: false };
  const candidates = candidateNames(provider, id, name);
  const leaderboards = {};

  for (const def of LEADERBOARD_DEFS) {
    const lb = cache.leaderboards[def.key];
    const match = findInLeaderboard(lb, candidates);
    if (!match) continue;
    leaderboards[def.key] = {
      label: def.label,
      score: match.score,
      rank: match.rank,
      ci: match.ci,
      votes: match.votes,
      model: match.model,
      vendor: match.vendor,
      sourceUrl: lb.sourceUrl,
      fetchedAt: lb.fetchedAt || cache.fetchedAt,
    };
  }

  const chatScores = ['text', 'search', 'vision', 'document']
    .map(key => leaderboards[key]?.score)
    .filter(score => Number.isFinite(score));
  const chatElo = leaderboards.text?.score ?? (chatScores.length ? Math.round(chatScores.reduce((a, b) => a + b, 0) / chatScores.length) : null);
  const codeElo = leaderboards.code?.score ?? null;

  return {
    matched: Object.keys(leaderboards).length > 0,
    source: cache.source,
    sourceApi: cache.sourceApi,
    fetchedAt: cache.fetchedAt,
    leaderboards,
    chatElo,
    codeElo,
  };
}

function applyArenaScores(model, cache) {
  const scores = matchArenaScores(model.provider, model.id, model.name, cache);
  if (!scores.matched) return model;

  const arena = {
    ...(model.arena || {}),
    matched: true,
    source: scores.source,
    sourceApi: scores.sourceApi,
    fetchedAt: scores.fetchedAt,
    leaderboards: scores.leaderboards,
    chatElo: scores.chatElo ?? model.arena?.chatElo ?? model.arena?.textElo,
    codeElo: scores.codeElo ?? model.arena?.codeElo ?? model.arena?.codingElo,
    textElo: scores.chatElo ?? model.arena?.textElo,
    codingElo: scores.codeElo ?? model.arena?.codingElo,
  };

  const codeScore = Number.isFinite(arena.codeElo) ? arena.codeElo : arena.codingElo;
  const chatScore = Number.isFinite(arena.chatElo) ? arena.chatElo : arena.textElo;
  const evolveScore = Math.max(model.evolve?.score || 0, Math.min(100, Math.round(((codeScore || chatScore || 1000) - 1000) / 6)));

  return {
    ...model,
    arena,
    evolve: model.evolve ? {
      ...model.evolve,
      score: evolveScore,
      tier: evolveScore >= 80 ? 'recommended' : evolveScore >= 65 ? 'good' : evolveScore >= 55 ? 'experimental' : 'not-recommended',
      reasons: [
        `Arena Chat ELO ${arena.chatElo ?? 'n/a'}`,
        `Arena WebDev ELO ${arena.codeElo ?? 'n/a'}`,
        ...(model.evolve.reasons || []).filter(r => !/^LMSYS ELO|^Arena /i.test(r)),
      ]
    } : model.evolve,
    updateCapable: model.updateCapable || evolveScore >= 55,
  };
}

module.exports = {
  ARENA_CACHE_FILE,
  ARENA_API_BASE,
  LEADERBOARD_DEFS,
  normalizeModelName,
  candidateNames,
  readArenaCache,
  writeArenaCache,
  fetchArenaLeaderboards,
  getArenaCache,
  matchArenaScores,
  applyArenaScores,
};
