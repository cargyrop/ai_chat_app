# Module: backend/services/modelDiscovery.js

## Responsibility
Build the model catalog shown in Chat, Evolve, Role Matrix, and Model Center. It combines user-added endpoints, configured native provider keys, custom providers, and local Ollama models, then applies enrichment metadata (capabilities, pricing, evolve readiness), live/cached Arena ELOs, and cached probe results.

## Public API
- `discoverModels(cfg): Promise<Array<Model>>` — Returns enriched model list.
- `GEMINI_FALLBACK_MODELS: Array` — Static fallback when Gemini API fails.
- `isUpdateCapable(provider, id, name): boolean` — Internal heuristic for whether a model can handle Evolve tasks.

## Invariants
- Added endpoints in `cfg.endpoints` are included first and respect endpoint/model enabled state.
- Adding one endpoint must not hide models from other configured provider keys.
- If an added endpoint uses a native provider id (for example `openrouter`), native discovery for that same provider is skipped to avoid duplicate rows and to respect endpoint disabled-model state.
- Provider fetches use bounded timeouts; Ollama uses a 5-second timeout.
- OpenRouter is capped at 150 models.
- Gemini fallback is used if the Gemini API fails.
- All models go through `enrichModel()` before returning.
- Arena scores from `arenaSync` are merged when a leaderboard match exists: Chat/Text, Search, Vision, Document, and Code/WebDev.
- Probe results from config are merged into model objects.

## Dependencies
- `backend/utils` (prettyModelName, readErrorMessage, joinUrl, enrichModel, modelProbeKey, getCustomProvider)
- `backend/config` (config shape consumed from caller)
