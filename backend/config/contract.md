# Module: backend/config/index.js

## Responsibility
Config persistence: read and write `data/config.json`. Validate API keys on load (mask placeholders). Maintain provider whitelist.

## Public API
- `loadConfig(): object` — Returns parsed config or fallback `{keys: {}, conversations: []}`
- `saveConfig(cfg: object): void` — Atomically writes config (tmp + rename)
- `modelProbeKey(provider, model): string` — Returns `provider::model` string
- `clearModelProbesForProvider(cfg, providerPrefix): void` — Removes probe entries for a provider
- `ALLOWED_PROVIDERS: Set` — Whitelist of built-in providers
- `DATA_FILE: string` — Absolute path to config file

## Invariants
- `saveConfig` must use atomic write (tmp file + rename) to prevent corruption on crash
- `loadConfig` must never throw — always return a valid object
- Placeholder keys (`ENTER_YOUR_API_KEY`, `••••`) are stripped on load

## Dependencies
None. This is the lowest-level backend module.

## Files Touched
- `data/config.json` (read/write)
