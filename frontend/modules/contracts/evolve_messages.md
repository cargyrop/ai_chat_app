# Module: evolve_messages.js

## Responsibility
Render the Evolve App chat transcript and detect executable plans in assistant replies.

## Public API
- `parseJsonMaybe(text): any|null` — Parse JSON with a small trailing-comma tolerance.
- `extractBalancedJsonSnippet(text, startIndex): string` — Extract one balanced object/array from text.
- `parseJsonCandidateText(text): Array<{value, snippet}>` — Produce parseable JSON candidates from a reply.
- `normalizeEvolvePlanCandidate(candidate): Array|null` — Normalize supported plan shapes to `[{path, action, description}]`.
- `extractEvolvePlans(content): { plans: Array<Array>, content: string }` — Remove plan JSON from assistant text and return normalized plans. Must return one approval card for one multi-file plan.
- `addEvolveMessage(role, content): void` — Append to state/localStorage and render.
- `appendEvolveMessage(role, content): void` — Render a single Evolve message bubble.
- `appendEvolveLoading(modelName): void` — Show streaming placeholder.
- `updateEvolveLoading(text): void` — Update streaming placeholder markdown.
- `removeEvolveLoading(): void` — Remove placeholder.
- `renderEvolveMessages(): void` — Render transcript from state.
- `saveEvolveMessages(): void` — Persist transcript with max length cap.

## Supported Plan Shapes
- Fenced array: ```plan\n[{"path":"...","action":"edit"}]\n```
- Fenced JSON object: ```json\n{"plan":[...]}```
- Raw JSON array/object in assistant text.
- File aliases: `path`, `file`, `filename`, `filePath`, `file_path`.

## Invariants
- One multi-file plan renders as exactly one approval card.
- Nested objects found inside a broader valid array/object must not create duplicate approval cards.
- Assistant text remains visible, but machine-readable plan JSON is removed from the readable bubble.
- Only `renderPlanInChat(plan)` from `evolve_plan.js` creates approval/reject controls.

## Dependencies
- state.js (`evolveMessages`)
- core.js (`escHtml`, `copyTextToClipboard`)
- markdown.js (`formatMd`)
- evolve_plan.js (`renderPlanInChat`)

## Used By
app.js bootstrap, evolve_send.js.
