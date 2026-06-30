# Module: backend/services/probe.js

## Responsibility
Model testing infrastructure: extract JSON from AI responses, run self-chat probes through the local API.

## Public API
- `extractFirstJson(text): object` — Extract first JSON object or array from text, stripping markdown fences
- `runSelfChatProbe(port, provider, model, prompt, systemPrompt): string` — Call /api/chat locally to test a model

## Invariants
- `runSelfChatProbe` uses AbortSignal.timeout(45000) — 45 seconds max
- `extractFirstJson` must handle both `{}` and `[]` JSON, wrapped in markdown or not
- Probe failures must propagate as thrown errors

## Dependencies
- `backend/utils` (readErrorMessage)
