# Module: backend/routes/evolve.js

## Responsibility
Express route: POST /api/evolve/execute. Delegates entirely to evolveEngine.executePlan().

## Routes
- `POST /api/evolve/execute` — SSE streaming of plan execution progress.

## Invariants
- No additional logic here. Thin route wrapper.

## Dependencies
- `backend/services/evolveEngine` (executePlan)
