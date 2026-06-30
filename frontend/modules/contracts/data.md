# Module: data.js

## Responsibility
Import/export data backups, load app manifest, render manifest as prompt text for AI context.

## Public API
- `exportAllData(): void` — Download all localStorage data (conversations, system prompt, model, evolve messages, plan states, layout) as JSON file. API keys intentionally excluded.
- `importAllData(e): void` — Read JSON file, restore conversations, system prompt, model, evolve messages, plan states, layout. Reload UI.
- `loadAppManifest(): Promise<void>` — Fetch /api/manifest, cache in state
- `renderManifestAsPrompt(manifest): string` — Convert manifest object to structured text for AI system prompts

## Invariants
- Export filename: `blackline_ai_backup_<timestamp>.json`
- Export includes: conversations, systemPrompt, currentModel, evolveMessages, evolvePlanStates, evolveLayout
- Export excludes: API keys (security)
- Import validates data types before restoring
- Import restores localStorage items, then re-renders UI
- Manifest is loaded once on app init and cached
- Manifest prompt text includes: tech stack, file list, endpoints, capabilities, constraints, workflow, prompt guide

## Dependencies
- state.js (`conversations`, `systemPrompt`, `currentModel`, `evolveMessages`, `evolvePlanStates`, `appManifest`, `appManifestString`)
- core.js (`escHtml`)
- toast.js
- models.js (`populateModelSelect`)
- conversations.js (`renderConvList`, `loadConversation`, `newConversation`)
- evolve_messages.js (`renderEvolveMessages`, `saveEvolveMessages`)
- evolve_tree.js (`initEvolveResizer`)
- panels.js (`saveSystemPrompt`)

## Used By
app.js bootstrap, chat_send.js, evolve_send.js
