# Module: backend/routes/index.js

## Responsibility
Mount all Express routes and register the SPA catch-all fallback.

## Public API
- `mountRoutes(app): void` — Mounts all route modules under their paths.
- `renderIndexWithAssetVersion(app): string` — Internal helper that injects a startup asset version query into CSS/JS URLs before serving `frontend/index.html`.

## Invariants
- All API routes are mounted before the catch-all `app.get('*')`.
- Static files are served by Express static middleware in `server.js`, not here.
- The catch-all must serve HTML with versioned JS/CSS URLs (`?v=<assetVersion>`) so browsers cannot keep using old cached modules after an app update.
- Asset version is taken from `app.locals.assetVersion`.

## Dependencies
All route modules: keys, customProviders, health, models, chat, manifest, files, endpoints, probes, evolve. Also `fs`/`path` for the versioned HTML fallback.
