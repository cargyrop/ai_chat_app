# Module: backend/routes/probes.js

## Responsibility
Model probe handlers: GET `/api/model-probes` and POST `/api/models/probe`.

## Routes
- `GET /api/model-probes` — Returns cached probe results from config.
- `POST /api/models/probe` — Runs a ping probe or 4 live benchmark tests against a model: basicChat, json, evolvePlan, evolvePatch. Stores result in config.

## Invariants
- Probe requires a valid configured native key, custom provider, added endpoint, or Ollama.
- Ping probes use `tier: "ping"` and store a lightweight latency/status result.
- Benchmark tests: basicChat (`BLACKLINE_OK`), json (parseable JSON), evolvePlan (```plan block), evolvePatch (search/replace JSON).
- Results are stored with timestamp, score (0-100), status (pass/partial/fail), and per-test details.
- Timeout per test is controlled by `runSelfChatProbe` through the app's own `/api/chat` endpoint.

## Dependencies
- `backend/config` (loadConfig, saveConfig, modelProbeKey)
- `backend/utils` (getCustomProvider)
- `backend/services/probe` (runSelfChatProbe, extractFirstJson)
