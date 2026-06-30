# Module: backend/services/fileTree.js

## Responsibility
Read the app directory into JSON trees for the manifest and evolve APIs. Filters blocked directories.

## Public API
- `readFileMap(dir, base): Array<{path, lines}>` — Flat list of all files with line counts
- `readFileTree(dir, base): Array<{path, type, content?, lines, children?}>` — Nested tree with full file content

## Invariants
- Blocked entries: `node_modules`, `.git`, `data`, `.arena`, `.cache`, `package-lock.json`, `dist`, `build`, `coverage`
- Directories always listed before files in each level
- `readFileTree` includes full file content (used by evolve engine)
- `readFileMap` only includes line counts (used by manifest endpoint)

## Dependencies
- `backend/utils` (toPosixPath, joinRelPath, listVisibleEntries)
