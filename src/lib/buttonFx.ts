/**
 * Ripple from the exact click point on every `.fx` control (buttons, chips,
 * icon buttons) — the «РеФорма» effect. One delegated listener for the
 * whole app; the ripple element removes itself when its animation ends.
 */
export function installButtonFx() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  addEventListener(
    'pointerdown',
    (e) => {
      const el = (e.target as Element | null)?.closest?.('.fx') as HTMLElement | null;
      if (!el || (el as HTMLButtonElement).disabled) return;
      const r = el.getBoundingClientRect();
      const size = Math.max(r.width, r.height);
      const s = document.createElement('span');
      s.className = 'fx-ripple';
      s.style.width = s.style.height = `${size}px`;
      s.style.left = `${e.clientX - r.left - size / 2}px`;
      s.style.top = `${e.clientY - r.top - size / 2}px`;
      el.appendChild(s);
      s.addEventListener('animationend', () => s.remove(), { once: true });
      setTimeout(() => s.remove(), 1000); // also when animations are paused (background tab)
    },
    { passive: true },
  );
}
