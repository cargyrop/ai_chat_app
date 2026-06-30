# Module: core.js

## Responsibility
Pure utility functions with no side effects, no DOM access, no I/O. Used by all other modules.

## Public API
- `loadStoredJson(key, fallback): any` — Safely parse from localStorage, return fallback on error
- `escHtml(s): string` — Escape HTML entities (&, <, >, ")
- `autoResize(el): void` — Resize textarea to content height, max 160px
- `flashCopied(btn): void` — Briefly show "Copied!" on a button, restore after 1.5s
- `copyTextToClipboard(text, btn): Promise<void>` — Write text to clipboard, flash button on success
- `apiErrorMessage(response, fallback): Promise<string>` — Extract error from fetch response

## Invariants
- No function writes to localStorage (except loadStoredJson which only reads)
- No function accesses DOM
- `escHtml` must escape ALL of & < > "
- `autoResize` must not exceed 160px height

## Dependencies
None.

## Used By
All modules (loaded first).
