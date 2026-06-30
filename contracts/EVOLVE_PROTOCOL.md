# Evolve Protocol — How AI Edits This Codebase

## Overview

The Evolve system lets an AI (via the "Evolve App" panel) read, plan, and rewrite the app's own code under explicit human approval. This document describes the protocol for safe, predictable AI-driven code changes.

## Phase 1: Investigation (AI Sees Architecture Only)

When the user asks for a feature in the Evolve panel, the AI receives:
1. `contracts/ARCHITECTURE.md` — high-level module map and data flow
2. `backend/manifest.json` + `frontend/manifest.json` — machine-readable module list
3. The `contract.md` of any module the user explicitly mentions

The AI does **NOT** receive full source code at this stage. It uses the manifest to understand which modules exist and what they do.

## Phase 2: Planning (AI Proposes Module Changes)

The AI responds with a plan embedded in a JSON code block tagged `plan`:

```json
[
  { "path": "frontend/modules/models.js", "action": "edit", "description": "Add favoriteIds Set to state; add toggleFavorite(modelId) and isFavorite(modelId) helpers." },
  { "path": "frontend/modules/settings.js", "action": "edit", "description": "Add 'Favorites' section to Model Center with unfavorite buttons." }
]
```

Plan rules:
- Each item must specify `path` (relative to app root), `action` (`create`, `edit`, or `delete`), and `description`.
- Maximum 25 items per plan.
- The AI should prefer editing existing modules over creating new ones, unless the feature is genuinely independent (then a new module is cleaner).

## Phase 3: Approval (Human Review)

The frontend renders an inline "Approve & Execute" button in the chat message containing the plan. The human clicks it. **No text-based approval works.** Typing "yes", "proceed", "do it" does NOT execute the plan.

## Phase 4: Execution (Server Applies Changes)

The frontend sends the plan to `POST /api/evolve/execute` with:
- `provider` and `model` (which AI model to use for code generation)
- `plan` array

The server (`backend/services/evolveEngine.js`) executes:
1. **Backup**: Creates timestamped backup at `../Blackline_AI-backup-<timestamp>/`
2. **Read files**: Fetches the full source of each file in the plan via `readFileTree()`
3. **For each edit item**:
   - Sends a prompt to the AI: "Edit this specific file using search/replace JSON"
   - AI responds with JSON: `{ "path": "...", "action": "edit", "changes": [{ "search": "exact text", "replace": "new text" }] }`
   - Server applies `applySearchReplacePatch()` — validates exact match, no duplicates, no ambiguity
   - If search/replace fails, falls back to full rewrite: `{ "content": "complete new file" }`
4. **For each create item**:
   - Sends a prompt to the AI with full codebase context (all files)
   - AI returns complete file content
   - Server writes the file
5. **For each delete item**:
   - Server deletes the file directly (no AI involved)
6. **Stream progress**: SSE chunks sent back to frontend showing each file being processed

## Phase 5: Verification (Human + Tests)

After execution:
- The frontend shows a success/partial/failure message with the backup path.
- The user reloads the page to see changes.
- If `server.js` changed, the user must restart the Node process.
- **Future**: `npm test` will run automatically after evolve. If tests fail, the update is flagged as partial.

## Search/Replace Patch Rules (For AI Code Generation)

When generating an edit patch, the AI must follow these rules:

1. **Exact match**: The `search` string must match the current file exactly, including whitespace.
2. **Unique match**: The `search` string must appear exactly once in the file. If it appears multiple times, include more surrounding context to make it unique.
3. **Minimal change**: Prefer small, targeted edits over large rewrites. Only use full rewrite if search/replace is genuinely impractical.
4. **Preserve invariants**: Never remove path safety checks, never remove backup logic, never change API key masking.
5. **No markdown fences**: The patch JSON must be raw JSON, not wrapped in ```json fences.

Example of a good patch:
```json
{
  "path": "frontend/modules/models.js",
  "action": "edit",
  "changes": [
    {
      "search": "function populateModelSelect(preferredVal) {\n  const sel = document.getElementById('model-select');\n  if (!sel) return;",
      "replace": "function populateModelSelect(preferredVal) {\n  const sel = document.getElementById('model-select');\n  if (!sel) return;\n  // Favorites first\n  const favIds = getFavoriteModelIds();\n  const favModels = models.filter(m => favIds.has(modelKey(m.provider, m.id)));\n  const otherModels = models.filter(m => !favIds.has(modelKey(m.provider, m.id)));\n  const sorted = [...favModels, ...otherModels];"
    }
  ]
}
```

## Prompt Templates Used by Evolve Engine

### Edit Prompt Template
```
You are executing ONE approved BLACKLINE AI edit action.

TARGET FILE: {filePath}
ACTION: edit
DESCRIPTION: {description}

CURRENT TARGET FILE CONTENT:
=== FILE: {filePath} ===
{existingContent}

OUTPUT RULES:
- Respond ONLY with a valid JSON object. No markdown, no explanation.
- Prefer targeted edits. Use this format:
  { "path": "...", "action": "edit", "changes": [{ "search": "exact unique current text", "replace": "replacement text" }] }
- Each search string must match the current file exactly and must be unique. Include enough surrounding context.
- Do NOT rewrite the whole file unless a targeted patch is genuinely impractical.
- If a full rewrite is genuinely necessary, use: { "path": "...", "action": "edit", "content": "complete final file content" }
- Preserve all unrelated behavior.
```

### Create Prompt Template
```
You are executing ONE approved BLACKLINE AI file creation action.

TARGET FILE: {filePath}
ACTION: create
DESCRIPTION: {description}

CODEBASE CONTEXT:
{allFilesDump}

OUTPUT RULES:
- Output ONLY the complete final content for TARGET FILE.
- Do not output the file path marker.
- Do not wrap the content in markdown fences unless those fences are literally part of the file content.
- Do not explain what you changed.
- For Markdown documentation files, write useful complete Markdown content.
```

## Failure Handling

- **Backup failure**: Entire operation aborts. No files written.
- **Patch parse failure**: That file is skipped. Other files may still be applied.
- **Search not found**: That file is skipped. The error is streamed to the user.
- **Multiple matches**: That file is skipped. The error tells the AI to include more context.
- **Timeout**: After 15 minutes, the operation aborts. Partial changes may be in place.

## Future: Smart File Loading (Phase 5 of Roadmap)

Currently, the Evolve engine reads ALL files in the repo for context when creating new files. In Phase 5, this will be optimized:
- The AI only receives the files it is editing.
- Dependency contracts are fetched instead of full source code.
- Estimated context reduction: 60-70% for typical feature edits.
