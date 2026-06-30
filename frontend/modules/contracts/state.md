# Module: state.js

## Responsibility
All global mutable state variables. This module defines the data model for the entire app. It is loaded immediately after core.js and before all other modules.

## Global Variables
- `models: Array` — Discovered model list (from `/api/models`).
- `modelProbes: Object` — Cached probe results keyed by `provider::model`.
- `modelCenterFilter: string` — Compatibility state; always defaults to `'all'` because Model Center filters were removed.
- `providerTableCollapsed: Object` — User-controlled provider table collapse state, persisted in localStorage.
- `customProviderPresets: Array` — Custom provider preset list (from `/api/custom-provider-presets`).
- `currentModel: Object|null` — Currently selected chat model.
- `conversations: Array` — All conversation objects `{id, title, messages, created}`.
- `currentConvId: string|null` — ID of active conversation.
- `convSearchFilter: string` — Current conversation sidebar filter text.
- `systemPrompt: string` — Current system prompt.
- `appManifest: Object|null` — Cached app manifest from `/api/manifest`.
- `appManifestString: string` — Manifest rendered as text for AI prompts.
- `streaming: boolean` — Whether chat is currently streaming.
- `activeAbortController: AbortController|null` — Current chat fetch controller.
- `evolveMessages: Array` — Evolve panel chat history.
- `evolvePlanStates: Object` — Plan approval states keyed by plan hash.
- `evolveStreaming: boolean` — Whether evolve is currently streaming.
- `evolveAbortController: AbortController|null` — Current evolve fetch controller.
- `renamingConvId: string|null` — ID of conversation being renamed inline.
- `PROVIDERS: Array` — Built-in provider metadata (id, label, icon, placeholder).

## Invariants
- `conversations` must always be an array (validated on load).
- `evolvePlanStates` and `providerTableCollapsed` must always be objects (not arrays).
- `currentModel` is stored in localStorage as JSON string.
- `conversations` is stored in localStorage as JSON string.
- No function should be defined here — only variable declarations and initialization.

## Dependencies
- core.js (`loadStoredJson`)

## Used By
All other frontend modules.
