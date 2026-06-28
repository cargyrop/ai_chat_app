# Module: evolve_tree.js

## Responsibility
File tree viewer in the Evolve panel, draggable resizer, file preview.

## Public API
- `initEvolveResizer(): void` — Set up draggable resizer between left and right evolve panels. Restore saved width from localStorage.
- `loadFileTree(): Promise<void>` — Fetch /api/files, render tree
- `fileTreeLabel(fullPath): string` — Get display name from path
- `renderFileTreeNodes(nodes, container, level): void` — Recursively render tree nodes
- `showFileViewer(path, content): void` — Show file content in viewer panel

## DOM Targets
- `#evolve-file-tree` — File tree container
- `#evolve-file-viewer` — File preview panel (shown when a file is clicked)
- `#evolve-file-viewer-title` — File preview title
- `#evolve-resizer` — Draggable divider
- `.evolve-layout`, `.evolve-left`, `.evolve-right` — Resizer targets

## Invariants
- Resizer width is saved to localStorage as `evolveLeftWidthPct` (35-78%)
- File tree is sorted: directories first, then files alphabetically
- Directories are collapsible (click to toggle)
- Files show line count badge
- Clicking a file fetches content and shows in viewer
- Tree is refreshed on load and via Refresh button

## Dependencies
- state.js
- core.js (`escHtml`)
- toast.js

## Used By
app.js bootstrap, evolve_send.js
