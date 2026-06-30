# Module: backend/routes/keys.js

## Responsibility
Express routes for API key management. Keys are stored server-side in `data/config.json`.

## Routes
- `GET /api/keys` — Returns masked keys `{provider: "••••XXXX"}`
- `POST /api/keys` — Saves key. Body: `{provider, key}`. Clears model probes for that provider.
- `DELETE /api/keys/:provider` — Removes key. Clears model probes.

## Invariants
- Masked format: `••••` + last 4 characters only
- Unknown provider returns 400
- Key changes always clear model probes (old probe results are invalid)

## Dependencies
- `backend/config` (loadConfig, saveConfig, clearModelProbesForProvider, ALLOWED_PROVIDERS)
- `backend/utils` (isAllowedProvider)
