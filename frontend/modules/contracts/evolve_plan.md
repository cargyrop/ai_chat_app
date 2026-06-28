# Module: evolve_plan.js

## Responsibility
Parse plan JSON blocks from AI responses, render inline approve/reject buttons, manage plan state, handle retry of failed items.

## Public API
- `planStateKey(plan): string` — Generate unique key from plan JSON string
- `saveEvolvePlanStates(): void` — Save plan states to localStorage
- `setPlanState(planKey, status, note): void` — Set plan state and save
- `setPlanCardStatus(planId, status, note): void` — Update UI status of a plan card
- `rejectPlan(planId): void` — Mark plan as rejected in UI and state
- `renderInvestigationPrompt(failedPayload, appliedPayload): string` — Generate retry prompt for failed items
- `requestFailedPlanRetry(encodedFailed, encodedApplied): void` — Trigger retry of failed plan items
- `renderPlanInChat(plan): void` — Render a plan as a card in the evolve chat with approve/reject buttons

## DOM Targets
- `#evolve-messages` — Plan cards are appended here as message children
- `.plan-card` — Plan card containers (created dynamically)
- `.plan-approve-btn`, `.plan-reject-btn` — Action buttons inside plan cards
- `.plan-status` — Status text inside plan cards

## Invariants
- Plan state is keyed by stable JSON string of the plan array
- Approved plans are marked with status and timestamp
- Rejected plans are marked with status and timestamp
- Retry prompts include both failed and successfully applied items for context
- Plan cards are rendered as HTML inside the chat message flow
- `window._evolvePlans` is used to store plan data by ID for approve/reject handlers

## Dependencies
- state.js (`evolvePlanStates`)
- core.js (`escHtml`)
- toast.js

## Used By
evolve_send.js
