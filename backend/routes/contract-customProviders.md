# Module: backend/routes/customProviders.js

## Responsibility
Express routes for custom OpenAI-compatible provider management.

## Routes
- `GET /api/custom-providers` — List all custom providers (API keys masked)
- `POST /api/custom-providers` — Add/update custom provider. Validates ID, label, base URL, key.
- `DELETE /api/custom-providers/:id` — Remove custom provider.

## Invariants
- Provider ID must be 2-40 chars, alphanumeric + hyphens + underscores
- Base URL must start with `http://` or `https://`
- API key is required and non-empty
- On change, model probes for `custom:<id>` are cleared

## Dependencies
- `backend/config` (loadConfig, saveConfig, clearModelProbesForProvider)
- `backend/utils` (sanitizeCustomProviderInput, publicCustomProvider, getCustomProvider)
- `backend/providers/presets` (CUSTOM_PROVIDER_PRESETS for the separate /api/custom-provider-presets endpoint)
