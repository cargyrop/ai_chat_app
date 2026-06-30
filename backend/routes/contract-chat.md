# Module: backend/routes/chat.js

## Responsibility
Express route: POST /api/chat. Delegates entirely to chatProxy.streamChat().

## Routes
- `POST /api/chat` — SSE streaming response.

## Invariants
- No additional logic here. Thin route wrapper.

## Dependencies
- `backend/config` (loadConfig)
- `backend/services/chatProxy` (streamChat)
