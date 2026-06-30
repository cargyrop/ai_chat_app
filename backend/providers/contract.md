# Module: backend/providers/presets.js

## Responsibility
Static preset definitions for 9 custom OpenAI-compatible providers: Kimi, Qwen, Mistral, Together, Fireworks, xAI, LM Studio, vLLM, llama.cpp.

## Public API
- `CUSTOM_PROVIDER_PRESETS: Array<{id, label, icon, type, baseUrl, modelsPath, chatPath}>`

## Invariants
- All base URLs must be valid HTTPS/HTTP URLs
- IDs must be unique, 2-40 characters, lowercase with hyphens/underscores
- No runtime logic — pure data

## Dependencies
None.
