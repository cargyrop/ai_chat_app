# Module: toast.js

## Responsibility
Toast notification system. Shows one toast at a time from a queue. 2.7s display duration.

## Public API
- `toast(msg, type): void` — Queue a toast message. Type: 'ok' (default) or 'err'
- `showNextToast(el): void` — Internal: show next queued toast on the element

## DOM Targets
- `#toast` — The toast element. Must exist in HTML.

## Invariants
- Only one toast visible at a time
- Queue is FIFO
- 2.7s display + 130ms fade-out gap
- `toast()` is safe to call even if `#toast` doesn't exist (returns silently)
- Timer is cleaned up on each new toast

## Dependencies
- state.js (`toastQueue`, `toastTimer`, `isToastShowing`)

## Used By
All modules.
