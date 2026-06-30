/* BLACKLINE AI — toast module (Phase 2) */

function toast(msg, type) {
  const el = document.getElementById('toast');
  if (!el) return;
  toastQueue.push({ msg, type: type || 'ok' });
  if (!isToastShowing) showNextToast(el);
}

function showNextToast(el) {
  if (!toastQueue.length) { isToastShowing = false; return; }
  isToastShowing = true;
  const { msg, type } = toastQueue.shift();
  el.textContent = msg;
  el.className = `show ${type || 'ok'}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = '';
    setTimeout(() => showNextToast(el), 130);
  }, 2700);
}
