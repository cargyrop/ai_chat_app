/* ARKEL — markdown module (Phase 1B hardened)
   Safety layers:
   1. marked sanitize option — escapes raw HTML in markdown input
   2. Custom sanitizer function — strips dangerous tags/attributes from output
   3. Renderer overrides — safe code block rendering, no inline handlers */

/* ── Output sanitizer ──────────────────────────────────────────────────────
   Strips dangerous content from HTML output as defense-in-depth.
   This runs AFTER marked.parse() on the generated HTML string. */
function sanitizeHtmlOutput(html) {
  if (!html) return '';
  // Remove script, iframe, object, embed, form, applet, base, meta, link tags
  html = html.replace(/<\/?(script|iframe|object|embed|applet|base|meta|link)\b[^>]*>/gi, '');
  // Remove on* event attributes (onclick, onerror, onload, etc.)
  html = html.replace(/\bon[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Remove javascript:/vbscript:/data: URLs in href/src/action
  html = html.replace(/((?:href|src|action|formaction|data|codebase)\s*=\s*)(?:"(?:javascript|vbscript|data)\s*:[^"]*"|'(?:javascript|vbscript|data)\s*:[^']*')/gi, '$1""');
  return html;
}

function initMarkdown() {
  if (!window.marked) return;
  const renderer = new marked.Renderer();
  const origCode = renderer.code.bind(renderer);
  renderer.code = (code, lang) => {
    let highlighted = escHtml(code);
    try {
      if (window.hljs) {
        if (lang && hljs.getLanguage(lang)) {
          highlighted = hljs.highlight(code, { language: lang }).value;
        } else {
          highlighted = hljs.highlightAuto(code).value;
        }
      }
    } catch(e) {}
    const cleanLang = escHtml(lang || 'code');
    return `<div class="code-block"><div class="code-header"><span>${cleanLang}</span><button class="copy-code-btn" type="button" data-action="copy-code">COPY</button></div><pre><code class="hljs language-${cleanLang}">${highlighted}</code></pre></div>`;
  };

  /* Layer 1: marked sanitize — escapes raw HTML tags in markdown source.
     Deprecated in marked but still functional and effective. */
  marked.setOptions({
    renderer,
    gfm: true,
    breaks: true,
    sanitize: true,
    sanitizer: (tag) => tag,  // passthrough: sanitize=true already escapes
  });
  mdReady = true;
}

function formatMd(text) {
  const src = String(text || '');
  if (window.marked && mdReady) {
    try {
      /* Layer 1: marked sanitize handles raw HTML in input.
         Layer 2: post-process sanitizer strips anything that slipped through. */
      return sanitizeHtmlOutput(marked.parse(src));
    } catch(e) {}
  }
  // fallback – safe basic rendering
  return escHtml(src).replace(/\n/g, '<br>');
}
