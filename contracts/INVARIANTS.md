# Global Invariants

These must never be violated by any AI-generated change.

## 1. Path Safety (Critical)

`safeResolve()` in `backend/utils/index.js` must **always** block:
- `..` in any path segment
- Absolute paths (`/etc/passwd`, `C:\Windows`)
- Windows drive letters (`C:`)
- Blocked directories: `node_modules`, `.git`, `data`, `.env`, `.arena`, `.cache`, `dist`, `build`, `coverage`
- Null bytes (`\0`)

**Consequence of violation:** Arbitrary file write on the user's machine.

## 2. API Key Privacy (Critical)

- `/api/keys` GET must **never** return full API keys. Only masked format: `••••XXXX` (last 4 chars).
- Keys are stored in `data/config.json` on the server.
- Keys are sent only to their respective provider APIs (OpenAI, Anthropic, etc.). Never logged, never returned to frontend in full.

## 3. No Inline Event Handlers (Future CSP)

- HTML must not contain `onclick="..."`, `onkeydown="..."`, `oninput="..."`, etc.
- All event handlers must be attached via `addEventListener` in JS modules.
- Currently `index.html` still has inline handlers (legacy). The migration to `addEventListener` is in progress. **Do not add new inline handlers.**
- Goal: Remove `'unsafe-inline'` from `script-src` CSP.

## 4. No Inline Styles in HTML

- HTML elements must use `class` attributes only. No `style="..."` attributes.
- All styling comes from CSS files.
- Exception: dynamically set styles via JS (e.g., `el.style.width = ...` for resizer) is acceptable.

## 5. Backup Before Evolve (Critical)

`evolveEngine.executePlan()` must create a timestamped backup folder **before any write operation**.
- Backup location: `../Blackline_AI-backup-<timestamp>/`
- Only keep 5 most recent backups (prune older ones automatically)
- If backup fails, the entire evolve operation must abort — no files may be written.

## 6. No npm install from AI (Critical)

The AI cannot add new npm dependencies. If a feature needs a new package:
1. The AI must refuse and explain why.
2. The human must manually run `npm install <pkg>`.
3. Only then can the code `require()` the new package.

## 7. Rate Limiting

Global rate limiter: 90 requests per minute per IP. Must remain active on all non-static routes.
- `GET /api/health` is exempt (it's already fast and harmless).
- `/api/chat` and `/api/evolve/execute` are the heaviest routes — they are protected by the global limiter plus their own timeouts.

## 8. CORS Restrictions

CORS must remain restricted to localhost origins only:
- `http://localhost:*`
- `http://127.0.0.1:*`
- `http://[::1]:*`
- No wildcard origins, no production domains.

## 9. Evolve Plan Limits

- Maximum 25 plan items per execution.
- Maximum 15-minute timeout per evolve execution.
- If a plan fails, partial state is NOT automatically rolled back. The user is warned and must restore from the backup manually if desired.

## 10. No Arbitrary Shell Execution

- The backend must never run user-controlled shell commands.
- `child_process` usage is limited to narrow, documented local-development exceptions:
  1. `server.js` may open the local browser on startup.
  2. The Evolve verification path may run the fixed command `npm test` from the app root with a timeout.
- Do not expand the Evolve test runner into a general command runner without explicit human approval, an allowlist, cwd restrictions, timeouts, and visible logs.
- No file execution, no `eval()`, no dynamic code loading.
- Normal file operations are limited to read, write, delete, and copy for backups.

## 11. Frontend State Consistency

- `conversations` is the single source of truth for chat history. Always call `saveConversations()` after mutation.
- `evolveMessages` is the single source of truth for evolve chat. Always call `saveEvolveMessages()` after mutation.
- Never bypass `localStorage` by writing cookies or using IndexedDB.

## 12. Module Size Limits

- Backend modules: target < 400 lines, hard limit 500 lines.
- Frontend modules: target < 350 lines, hard limit 450 lines.
- If a module grows beyond these limits, it must be split into sub-modules.
- This ensures the AI can read and edit any module in a single context window.
