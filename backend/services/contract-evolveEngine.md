# Module: backend/services/evolveEngine.js

## Responsibility
Execute approved Evolve plans: create backups, load only relevant target files, ask the selected model for per-file patches/content, apply search/replace patches or full rewrites, stream progress via SSE, and run tests after writes.

## Public API
- `executePlan(port, req, res): Promise<void>` — Main SSE entry. Validates provider/model/plan, creates backup, processes each item, streams results.
- `streamModelText(port, provider, model, prompt, onText, cfg, sendEvent): Promise<string>` — Stream AI code generation through native providers, custom providers, Ollama, or added OpenAI-compatible endpoints.
- `runTests(): Promise<{passed, stdout, stderr}>` — Run `npm test` after successful writes.
- `applySearchReplacePatch(original, changes, filePath): string` — Apply validated search/replace patches.
- `extractJsonObject(text): object` — Parse JSON from AI response (strip think tags, markdown fences).
- `stripGeneratedFileContent(text, filePath): string` — Clean AI-generated file content (remove fences, path markers).
- `cleanupOldBackups(parentDir, appName, currentBackupDir): number` — Prune old backups, keep 5.
- `MAX_BACKUPS_TO_KEEP: 5`, `MAX_PLAN_ITEMS: 25`, `EVOLVE_EXECUTION_TIMEOUT_MS: 900000`.

## Invariants
- Backup MUST be created before ANY write. If backup fails, operation aborts.
- `safeResolve` is used for every file path. Unsafe paths are skipped with an error.
- Maximum 25 plan items. Exceeding returns 400 before any work.
- Smart loading reads all file paths/line counts plus full content only for files in the approved plan.
- Existing-file edits prefer JSON search/replace patches; each search must match exactly once.
- If patch JSON parse fails, the executor asks the model for one JSON-only repair attempt before failing the file.
- If a valid patch does not apply, the executor asks the model for one corrected patch before failing the file.
- If model returns empty content, that file is skipped.
- Tests run after applied writes; failures are reported to the UI with backup path.
- Added endpoints with ids not covered by native providers are treated as OpenAI-compatible `/chat/completions` providers.
- Gemini overload: retry with `gemini-1.5-flash` automatically.

## Dependencies
- `backend/utils` (safeResolve, readErrorMessage, joinUrl, getCustomProvider)
- `backend/config` (loadConfig)
- `backend/services/fileTree` (readFileMap, readFilesByPaths)
