# Module: model_roles.js

## Responsibility
Role Matrix UI and model-role assignment logic. Roles let BLACKLINE use different enabled models for planning, execution, review, repair, and tiny edit tasks.

## Public API
- `autoAssignModelRoles(force): void` — Assign recommended enabled models based on proven Arena Chat/Text and Code/WebDev ELO thresholds.
- `renderModelRoles(): void` — Render Role Matrix cards and selects.
- `clearModelRoles(): void` — Clear all assignments.
- `setModelRole(roleId, value): void` — Persist one role assignment.
- `getAssignedRoleModel(roleId): Model|null` — Return enabled assigned model for a role.
- `requireModelRole(roleId, workflowName): {provider,id}|null` — Enforce role requirement and route user to Role Matrix if missing.
- `assignPlannerFromEvolveSelect(): void` — Compatibility handler for the Evolve planner dropdown.

## Roles
- `planner` — used now; required for Evolve planning chat.
- `executor` — used now; required for approved Evolve execution.
- `reviewer` — reserved for future diff review loops.
- `repair` — reserved for future automatic repair loops.
- `micro` — reserved for future tiny deterministic edits.

## DOM Targets
- `#role-matrix-list` — Role cards.
- `#evolve-model-select` — Planner role quick selector in Evolve panel.

## Invariants
- Only enabled/selectable models appear in role dropdowns.
- The same model can be assigned to multiple roles.
- Auto assignment leaves a role empty if no enabled model has proven Arena ELOs meeting that role's minimum thresholds.
- Workflows that require a missing role must not run; they must inform the user and open Role Matrix.
- Assignments persist in localStorage under `modelRoles`.

## Dependencies
- state.js (`models`, `modelRoles`)
- models.js (`isModelSelectable`, `providerLabel`, `arenaEloValue`, `populateEvolveModelSelect`)
- panels.js (`showPanel`)
- toast.js

## Used By
app.js bootstrap, models.js after model loading, evolve_send.js role enforcement.
