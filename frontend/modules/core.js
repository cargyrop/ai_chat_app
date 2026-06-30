/* BLACKLINE AI — core module (Phase 2) */

function loadStoredJson(key, fallback) {
  try { const parsed = JSON.parse(localStorage.getItem(key) || 'null'); return parsed ?? fallback; }
  catch (e) { console.warn('[storage] Failed to parse', key, e.message); localStorage.removeItem(key); return fallback; }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

function flashCopied(btn) {
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = '✓ Copied';
  btn.classList.add('copied');
  setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1800);
}

async function copyTextToClipboard(text, btn) {
  try { await navigator.clipboard.writeText(text || ''); if (btn) flashCopied(btn); }
  catch { toast('Copy failed', 'err'); }
}

async function apiErrorMessage(response, fallback) {
  try { const data = await response.json(); return data.error || data.message || fallback; }
  catch { try { return await response.text() || fallback; } catch { return fallback; } }
}
