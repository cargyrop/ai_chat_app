# Module: backend/routes/manifest.js

## Responsibility
Express route: GET /api/manifest. Returns comprehensive app metadata for the AI to understand the codebase.

## Routes
- `GET /api/manifest` — Returns {name, description, version, techStack, port, storage, files, endpoints, frontend, capabilities, hardConstraints, updateWorkflow, updatePromptGuide}

## Invariants
- Never returns source code — only metadata, line counts, endpoint list, file tree
- File list is generated dynamically from disk
- Endpoint list is static (hardcoded to match actual routes)
- If any file read fails, returns 500 with error message

## Dependencies
- `backend/utils` (listVisibleEntries, joinRelPath)
- `fs`, `path` (for reading app files)
