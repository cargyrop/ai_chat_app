# Module: backend/utils/index.js

## Responsibility
Pure helper functions: string formatting, path safety, URL joining, model intelligence scoring, custom provider parsing. No I/O, no side effects.

## Public API
- `prettyModelName(id): string` — Human-readable model name
- `readErrorMessage(response, fallback): string` — Extract error from fetch response
- `explainProviderError(provider, message): string` — Add provider-specific advice
- `isAllowedProvider(provider, allowedSet): boolean`
- `sanitizeMessages(messages): Array|null` — Filter and cap message length
- `safeResolve(base, rel): string|null` — Path safety: blocks `..`, absolute paths, blocked dirs
- `toPosixPath(value): string` — Convert backslashes to forward slashes
- `joinRelPath(base, entry): string` — Join paths with posix conversion
- `listVisibleEntries(dir, blockedEntries): Array` — Filtered, sorted directory listing
- `customProviderKey(provider): string` — Extract ID from `custom:xxx`
- `isCustomProviderId(provider): boolean`
- `getCustomProvider(cfg, provider): object|null`
- `sanitizeCustomProviderInput(input, existing): object` — Validate and normalize custom provider
- `publicCustomProvider(p): object` — Strip API key, return public-safe object
- `joinUrl(baseUrl, routePath): string`
- `modelIntelligence(provider, id, name, raw): object` — Score model capabilities (code, vision, reasoning, etc.)
- `enrichModel(m, raw): object` — Apply intelligence + probe metadata to a model object

## Invariants
- `safeResolve` must return `null` for ANY traversal attempt, blocked dir, or absolute path
- `sanitizeMessages` must cap content at 200,000 characters per message
- `modelIntelligence` score must be between 0 and 100
- No function in this module reads/writes files or makes network calls

## Dependencies
None (pure functions only, uses `fs` and `path` only for `listVisibleEntries`).
