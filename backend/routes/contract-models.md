# Module: backend/routes/models.js

## Responsibility
Express route: GET /api/models. Returns enriched model list from all configured providers.

## Routes
- `GET /api/models` — Returns all discovered models with metadata, capabilities, probe status.

## Invariants
- Always returns an array (may be empty if no keys configured)
- Each model has: id, name, provider, icon, capabilities, pricing, evolve score, updateCapable flag
- Probe results are merged if available in config
- Unknown provider errors are returned as disabled entries with error messages, not thrown

## Dependencies
- `backend/config` (loadConfig)
- `backend/services/modelDiscovery` (discoverModels)
