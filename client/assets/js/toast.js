export function toast(message, kind = 'info', ms = 2600) {
  const box = document.getElementById('toast');
  if (!box) return;
  const el = document.createElement('div');
  el.className =
    'toast-item px-5 py-3 text-sm tracking-wide border ' +
    (kind === 'error'
      ? 'border-blood/60 text-blood'
      : kind === 'success'
        ? 'border-brass/60 text-brass-bright'
        : 'border-brass/30 text-cream') +
    ' bg-noir-900/95 shadow-card backdrop-blur';
  el.style.borderLeftWidth = '3px';
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .4s ease, transform .4s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 420);
  }, ms);
}
