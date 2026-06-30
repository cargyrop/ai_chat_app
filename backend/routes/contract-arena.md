# Module: backend/routes/arena.js

## Responsibility
Expose Arena leaderboard cache/sync endpoints.

## Routes
- `GET /api/arena` — Return cached Arena data, refreshing if stale. Query `?force=1` forces refresh.
- `POST /api/arena/sync` — Force a live refresh of the configured Arena leaderboards.

## Invariants
- Never requires an API key; data source is public leaderboard snapshots.
- If no live data or cache is available, returns an error instead of fake scores.
- Route delegates all fetch/cache logic to `backend/services/arenaSync.js`.

## Dependencies
- `backend/services/arenaSync`
