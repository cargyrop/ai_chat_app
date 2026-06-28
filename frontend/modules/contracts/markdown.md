# Module: markdown.js

## Responsibility
Initialize and use the markdown renderer (marked.js + highlight.js). Convert raw markdown text to HTML with syntax-highlighted code blocks.

## Public API
- `initMarkdown(): void` — Configure marked renderer with custom code block handler
- `formatMd(text): string` — Convert markdown string to HTML. Falls back to basic HTML escaping if marked is unavailable.

## Invariants
- `initMarkdown` sets `mdReady = true` when complete
- `formatMd` checks `mdReady` before using marked
- Code blocks are wrapped in: `<div class="code-block"><div class="code-header"><span>{lang}</span><button class="copy-code-btn" onclick="copyCode(this, event)">COPY</button></div><pre><code class="hljs language-{lang}">{highlighted}</code></pre></div>`
- Syntax highlighting uses `hljs.highlight()` if language is registered, otherwise `hljs.highlightAuto()`
- Fallback: plain HTML with `<br>` line breaks if marked.js fails

## Dependencies
- state.js (`mdReady`)
- core.js (`escHtml`)
- External: `window.marked`, `window.hljs` (loaded in index.html from vendor/)

## Used By
chat_render.js, evolve_messages.js
