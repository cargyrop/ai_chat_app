# Module: backend/routes/health.js

## Responsibility
Health check endpoint. Minimal, no dependencies.

## Routes
- `GET /api/health` — Returns `{ok: true, version: "1.4.2", time: "..."}`

## Invariants
- No side effects. No file reads. No API calls.
- Always returns 200.

## Dependencies
None.
