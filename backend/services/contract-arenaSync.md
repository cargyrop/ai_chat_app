# Module: backend/services/arenaSync.js

## Responsibility
Fetch, cache, normalize, and match Arena AI leaderboard ELOs for model metadata.

## Public API
- `fetchArenaLeaderboards(): Promise<ArenaCache>` — Fetch latest leaderboards and write `data/arena-cache.json`.
- `getArenaCache({ force, refreshIfStale }): Promise<ArenaCache|null>` — Return cached data or refresh if stale.
- `matchArenaScores(provider, id, name, cache): object` — Match a provider model to Arena entries.
- `applyArenaScores(model, cache): Model` — Merge matched ELO data into an enriched model.
- `normalizeModelName(value): string` — Canonicalize provider/Arena model names.

## Leaderboards Fetched
- Chat: `text`, `search`, `vision`, `document`
- Code: `code` (shown in UI as WebDev)

## Invariants
- Cache path is `data/arena-cache.json`.
- Cache TTL is 24 hours.
- If live refresh fails but cache exists, return the cache with `refreshError`.
- Heuristic ELOs must not be represented as live Arena matches.
- Model Center shows only Chat and Code/WebDev ELOs; Model Info can show all matched ELOs.

## Dependencies
- Node `fs`, `path`
- Global `fetch`, `AbortSignal.timeout`
