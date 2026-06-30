# Module: backend/routes/files.js

## Responsibility
Express route: GET /api/files. Returns full file tree with content for the Evolve panel.

## Routes
- `GET /api/files` — Returns nested JSON tree with file content and line counts.

## Invariants
- Same blocked directories as manifest: node_modules, .git, data, etc.
- Returns actual file content (used by Evolve AI for context)
- 500 error if directory read fails

## Dependencies
- `backend/services/fileTree` (readFileTree)
