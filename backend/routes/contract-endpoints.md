# Module: backend/routes/endpoints.js

## Responsibility
Endpoint-based provider onboarding and management. Tests provider model catalog access, saves endpoint instances, toggles endpoint/model state, and deletes endpoints.

## Routes
- `POST /api/endpoints/test` — Test a provider/baseUrl/key and return discovered models.
- `GET /api/endpoints` — Return saved endpoint instances with masked key metadata and model counts.
- `POST /api/endpoints` — Save one endpoint instance. Remote endpoints can have unique ids with `providerType` so multiple keys/base URLs for the same provider can coexist.
- `PUT /api/endpoints/:id/toggle` — Enable/disable an endpoint.
- `PUT /api/endpoints/:id/models` — Replace the endpoint disabled model list.
- `DELETE /api/endpoints/:id` — Delete an endpoint and remove associated models from discovery.

## Invariants
- API keys are stored only in `data/config.json`; GET returns masked key metadata only.
- Freshly added endpoint models are enabled by default unless `disabledModels` is explicitly supplied.
- Re-adding a provider with a different unique id must not replace existing endpoint models.
- Existing stale `disabledModelKeys` for newly added endpoint models are cleared on add so they appear immediately.
- Provider type (`providerType`) is preserved for native/special handling while endpoint id remains unique for UI grouping.

## Dependencies
- `backend/config`
- `backend/utils` (`readErrorMessage`, `joinUrl`, `enrichModel`, `prettyModelName`)
