/* BLACKLINE AI — markdown module (Phase 2) */

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
    return `<div class="code-block"><div class="code-header"><span>${cleanLang}</span><button class="copy-code-btn" type="button" onclick="copyCode(this, event)">COPY</button></div><pre><code class="hljs language-${cleanLang}">${highlighted}</code></pre></div>`;
  };
  marked.setOptions({ renderer, gfm: true, breaks: true });
  mdReady = true;
}

function formatMd(text) {
  const src = String(text || '');
  if (window.marked && mdReady) {
    try { return marked.parse(src); } catch(e) {}
  }
  // fallback – very basic
  return escHtml(src).replace(/\n/g, '<br>');
}
