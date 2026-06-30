# Module: panels.js

## Responsibility
Panel visibility switching, modal open/close, system prompt save/cancel, and Model Info modal rendering.

## Public API
- `showPanel(name): void` — Show panel by name (`chat`, `settings`, `roles`, `evolve`). Hides others, updates nav active states.
- `openSystemModal(): void` — Show system prompt modal, pre-fill from state.
- `closeModal(): void` — Hide system prompt modal.
- `closeModalOutside(e): void` — Close modal if click was on overlay.
- `openModelInfoModal(): void` — Show model info modal with capabilities, Arena ELOs, pricing, and metadata notes for the current model.
- `closeModelInfoModal(): void` — Hide model info modal.
- `closeModelInfoOutside(e): void` — Close model info modal if click was on overlay.
- `saveSystemPrompt(): void` — Save system prompt from textarea to state/localStorage.

## DOM Targets
- `#chat-panel`, `#settings-panel`, `#roles-panel`, `#evolve-panel` — Panels to show/hide.
- `.nav-btn` — Navigation buttons.
- `#modal-overlay`, `#system-modal` — System prompt modal.
- `#model-info-overlay`, `#model-info-modal`, `#model-info-content` — Model info modal.
- `#system-prompt-input` — System prompt textarea.

## Invariants
- Exactly one panel is visible at a time.
- Model Info does not show Evolve suitability or full live probe benchmark sections; Role Matrix and Arena ELOs are the intended decision surfaces.
- If the latest probe was a ping, Model Info shows the last ping status/error.
- Yellow info note explains that Arena ELOs are cached public leaderboard snapshots and that capabilities/pricing may be provider metadata or estimates.
- Modal overlays are `display:none` when closed.
- System prompt is saved to `localStorage` as `systemPrompt`.

## Dependencies
- state.js (`systemPrompt`, `currentModel`, `models`)
- models.js (`currentModelObject`, `capabilityBadges`, `providerLabel`)
- core.js (`escHtml`)

## Used By
app.js bootstrap, chat_actions.js, models.js
