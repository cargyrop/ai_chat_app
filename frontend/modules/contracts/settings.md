# Module: settings.js

## Responsibility
Endpoint/API-key onboarding UI for the Model Hub panel. It lets users test a local or remote provider endpoint and save the discovered model list. Endpoint management after adding happens in Model Center provider blocks.

## Public API
- `onEndpointProviderChange(): void` — Update the default endpoint URL when provider dropdown changes.
- `testEndpoint(): Promise<void>` — POST to `/api/endpoints/test`, store the successful result in `lastTestedEndpoint`, enable Add.
- `testLocalEndpoint(): Promise<void>` — Test local Ollama, save it as an endpoint, reload models.
- `addEndpoint(): Promise<void>` — Persist the last tested endpoint through `/api/endpoints`, force Model Center to ALL, reload models.
- `renderAddedEndpoints(): Promise<void>` — Compatibility helper; endpoint cards are no longer rendered in Add Models.
- `renderDrawerGrid(ep, filterQuery): void` — Compatibility helper for old endpoint drawer UI.
- `filterDrawerModels(id, q): void` — Compatibility helper for old drawer filter UI.
- `toggleEndpointModels(id): void` — Compatibility helper for old drawer UI.
- `toggleEndpointStatus(id): Promise<void>` — Enable/disable an entire endpoint through backend state.
- `deleteEndpoint(id): Promise<void>` — Remove an endpoint; used by Model Center provider DELETE action.
- `setAllEndpointModels(id, enable): Promise<void>` — Bulk enable/disable models for one endpoint.
- `toggleSingleEndpointModel(id, modelId, isChecked): Promise<void>` — Enable/disable one endpoint model.
- Compatibility/bootstrap helpers: `buildKeysList`, `loadCustomProviderPresets`, `applyCustomProviderPreset`, `buildCustomProvidersList`, `saveKey`, `deleteKey`, `saveCustomProvider`, `deleteCustomProvider`.

## DOM Targets
- `#endpoint-provider` — Provider preset selector.
- `#endpoint-url` — Endpoint base URL.
- `#endpoint-key` — Provider API key input.
- `#endpoint-test-btn`, `#endpoint-add-btn` — Test/Add controls.
- `#endpoint-status-line` — Test status and discovered model count.
- `#model-center-list` — Model Center refresh target through `loadModels()`.

## Invariants
- Add stays disabled until a test succeeds.
- Each added remote endpoint receives a unique endpoint id, so adding the same provider with a different key preserves previously added models.
- Testing uses category `All`; no UI filter should hide provider models before saving.
- API keys are sent only to local backend endpoints; backend stores them in `data/config.json`.
- After adding an endpoint, all discovered endpoint models are enabled and visible immediately.
- Added endpoints are deleted from Model Center, not from the Add Models section.
- Errors show toast and do not silently fail.

## Dependencies
- state.js (`modelCenterFilter`, `customProviderPresets`)
- models.js (`loadModels`, `renderModelCenter` indirectly through `loadModels`)
- core.js (`escHtml`)
- toast.js

## Used By
app.js bootstrap, Model Hub panel inline handlers, Model Center delete action.
