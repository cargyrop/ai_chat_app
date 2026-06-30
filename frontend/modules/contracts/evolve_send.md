# Module: evolve_send.js

## Responsibility
Send Evolve messages with the assigned Planner role, stream AI responses, handle plan approval, and execute approved plans with the assigned Executor role via `POST /api/evolve/execute`.

## Public API
- `clearEvolveChat(): void` — Clear evolve messages and plan states after confirm.
- `sendEvolveMessage(): Promise<void>` — Require `planner` role, send evolve message with system prompt/manifest, stream response, render plan cards.
- `stopEvolveMessage(): void` — Abort current evolve fetch.
- `setEvolveStreamingUI(isStreaming): void` — Toggle evolve send/stop buttons.
- `onEvolveInputKey(e): void` — Keydown handler: Enter sends, Shift+Enter newline.
- `approvePlan(planId): Promise<void>` — Require `executor` role, POST plan to `/api/evolve/execute`, stream SSE progress, render results in chat.

## DOM Targets
- `#evolve-input` — Evolve message textarea.
- `#evolve-send-btn` — Evolve send button.
- `#evolve-stop-btn` — Evolve stop button.
- `#evolve-messages` — Evolve chat container.
- `#evolve-model-select` — Planner role quick selector, maintained by model_roles.js/models.js.
- `#show-all-evolve-models` — Show all planner candidates checkbox.

## Invariants
- Evolve planning must not run without an assigned Planner role.
- Approved execution must not run without an assigned Executor role.
- Evolve system prompt includes the app manifest and tells models to check `frontend/index.html` for static nav labels/headings.
- Plans are detected by `evolve_messages.js` from ```plan code blocks or compatible JSON shapes.
- Approve button requires plan to exist in `window._evolvePlans`.
- Execution streams SSE chunks: backup info, file progress, test progress, errors, completion.
- Partial execution is warned and includes failure details.
- `enableThinking` is set to false for evolve messages.

## Dependencies
- state.js (`evolveMessages`, `evolvePlanStates`, `evolveStreaming`, `evolveAbortController`, `appManifestString`)
- core.js (`autoResize`, `apiErrorMessage`)
- toast.js
- model_roles.js (`requireModelRole`)
- models.js (`providerLabel` indirectly through role UI)
- evolve_messages.js (`addEvolveMessage`, `appendEvolveLoading`, `updateEvolveLoading`, `removeEvolveLoading`)
- evolve_plan.js (`planStateKey`, `setPlanState`, `setPlanCardStatus`, `renderInvestigationPrompt`)
- evolve_tree.js (`loadFileTree`)

## Used By
app.js bootstrap, evolve_plan.js retry flow.
