# Module: models.js

## Responsibility
Model discovery, selection, Model Center rendering, model enable/disable state, probing/pinging, Ollama status check, and Evolve model selection.

## Public API
- `loadModels(showToast): Promise<void>` — Fetch `/api/models`, load probes, populate chat/evolve selects, render Model Center and endpoint cards.
- `populateModelSelect(preferredVal): void` — Fill `#model-select` with selectable models.
- `populateEvolveModelSelect(): void` — Fill Evolve model select with update-capable models unless "Show all" is checked.
- `onModelChange(): void` — Save selected chat model to state/localStorage.
- `providerLabel(p): string` — Return provider display name, including added endpoint labels.
- `capabilityBadges(m): string[]` — Generate text capability badges for a model.
- `modelOptionText(m): string` — Generate option text for model selects.
- `isModelSelectable(m): boolean` — Check model is enabled and usable.
- `modelKey(provider, id): string` — Return `provider::id` key.
- `modelProbeFor(m): object|null` — Get live/cached probe result.
- `setModelCenterFilter(filter): void` — Compatibility no-op that forces `all` and re-renders.
- `providerCollapseKey`, `isProviderTableCollapsed`, `setProviderTableCollapsed`, `applyProviderTableCollapsedState` — Persist and apply user-controlled provider table expansion state.
- `modelMatchesCenterFilter(m): boolean` — Compatibility helper; always returns true because Model Center filters were removed.
- `renderModelCenter(): void` — Render grouped provider tables for all discovered models.
- `toggleProviderTable(prov): void` — User expand/collapse handler.
- `toggleEntireProvider(provider, enable): Promise<void>` — Enable/disable all models in provider group.
- `toggleModelEnabled(provider, id, isChecked): Promise<void>` — Enable/disable one model.
- `bulkToggleFiltered(enable): Promise<void>` — Compatibility name; now enables/disables all models.
- `pingModel(m, btn, reactCell): Promise<void>` — Lightweight ping probe.
- `probeModel(m, btn): Promise<void>` — Full benchmark probe.
- `loadModelProbes(): Promise<void>` — Load cached probe results.
- `getEvolveModel(): object|null` — Get current Evolve model selection.
- `checkOllama(): Promise<void>` — Update Ollama status if legacy status elements exist.
- `currentModelObject(): object|null`, `yesNoBadge(label, value): string`.

## DOM Targets
- `#model-select`, `#model-count` — Chat model selector/status.
- `#model-center-list` — Model Center provider tables.
- `#catalog-counts-hint` — Model count/status text.
- `#evolve-model-select`, `#show-all-evolve-models` — Evolve selector.
- Optional legacy Ollama status elements: `#ollama-dot`, `#ollama-status-text`.

## Invariants
- Model Center displays every discovered model; no search/category/tabs hide models.
- Model Center ELO columns show only proven Arena matches; unmatched chat/code cells display a dash, not heuristic estimates.
- Provider expansion/collapse is controlled only by the user and persists across Model Center re-renders.
- Enabling/disabling a model must not expand all provider tables.
- Disabled/error models remain visible in Model Center but are not selectable.
- Local Ollama and added endpoint models are trusted as selectable immediately; probes can still add metadata.
- `modelProbeFor` checks both live `m.probe` and cached `modelProbes`.

## Dependencies
- state.js (`models`, `modelProbes`, `modelCenterFilter`, `providerTableCollapsed`, `currentModel`)
- core.js (`escHtml`, `apiErrorMessage`)
- toast.js
- panels.js (`openModelInfoModal`)
- settings.js (`renderAddedEndpoints`, called after model loads)

## Used By
app.js bootstrap, settings.js, chat_send.js, evolve_send.js, panels.js.
