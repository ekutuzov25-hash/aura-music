import { useEffect } from 'react';
import { useSettings } from '../store/settings';

/**
 * AURA cursor: a dot that sits exactly on the pointer + a thin ring that
 * follows with inertia. The ring never covers a control: over buttons it
 * wraps the button's outline ("snaps" around it), over other clickable areas
 * it just grows a little, over text fields the native I-beam returns, and a
 * click sends a soft wave. Style ported from the «Дом у воды» site.
 *
 * Performance: pointermove only stores coordinates; one requestAnimationFrame
 * loop moves two composited layers and goes to sleep when nothing moves.
 * Element lookups (closest) happen on pointerover — only when the target
 * changes, not on every pixel. Mouse/trackpad only; touch screens skip it.
 */
const HOVER = 'a,button,[role="button"],[role="tab"],[role="radio"],[role="menuitem"],[role="slider"],[role="row"],label,select,summary';
const SNAP = 'button,a,[role="button"],[role="tab"],[role="radio"],[role="menuitem"]';
const TEXT = 'input:not([type="range"]):not([type="checkbox"]):not([type="radio"]),textarea,[contenteditable="true"]';

function start() {
  const root = document.documentElement;
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mk = (cls: string) => {
    const o = document.createElement('div');
    o.className = cls;
    o.setAttribute('aria-hidden', 'true');
    o.appendChild(document.createElement('i'));
    document.body.appendChild(o);
    return o;
  };
  const dot = mk('cur-d');
  const ring = mk('cur-r');
  const wave = mk('cur-p');
  const ri = ring.firstChild as HTMLElement;

  let tx = 0, ty = 0, rx = 0, ry = 0, svx = 0, svy = 0;
  let raf = 0, last = 0, shown = false;
  let snapEl: Element | null = null, snapW = 0, snapH = 0;

  const frame = (now: number) => {
    raf = 0;
    const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
    last = now;
    const k = REDUCE ? 1 : 1 - Math.exp(-dt * (snapEl ? 10 : 13)); // frame-rate independent smoothing
    let gx = tx, gy = ty;
    if (snapEl) {
      // ring floats to the button's centre and leans slightly towards the pointer
      const r = snapEl.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      gx = cx + (tx - cx) * 0.15;
      gy = cy + (ty - cy) * 0.15;
      const w = Math.round(r.width + 10), h = Math.round(r.height + 10);
      if (w !== snapW || h !== snapH) {
        snapW = w;
        snapH = h;
        ring.style.setProperty('--rw', `${w}px`);
        ring.style.setProperty('--rh', `${h}px`);
      }
    }
    const dx = gx - rx, dy = gy - ry;
    rx += dx * k;
    ry += dy * k;
    const settled = Math.abs(gx - rx) < 0.1 && Math.abs(gy - ry) < 0.1;
    if (settled) {
      rx = gx;
      ry = gy;
    }
    // the free ring stretches in the direction of travel
    if (!snapEl && !REDUCE) {
      svx += (dx - svx) * 0.25;
      svy += (dy - svy) * 0.25;
      const s = Math.min(0.35, Math.hypot(svx, svy) / 170);
      ri.style.transform = s > 0.015 ? `rotate(${Math.atan2(svy, svx).toFixed(3)}rad) scale(${(1 + s).toFixed(3)},${(1 - s * 0.4).toFixed(3)})` : '';
    } else if (ri.style.transform) {
      ri.style.transform = '';
      svx = svy = 0;
    }
    dot.style.transform = `translate3d(${tx}px,${ty}px,0)`;
    ring.style.transform = `translate3d(${rx}px,${ry}px,0)`;
    if (!settled || snapEl || Math.hypot(svx, svy) > 0.3) raf = requestAnimationFrame(frame);
    else last = 0; // sleep until the mouse moves again
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };
  const show = (on: boolean) => {
    if (shown === on) return;
    shown = on;
    root.classList.toggle('cur-on', on);
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    tx = e.clientX;
    ty = e.clientY;
    if (!shown) {
      rx = tx;
      ry = ty;
      show(true);
    }
    kick();
  };

  let offTimer = 0;
  const retarget = (t: EventTarget | null) => {
    const el = t as Element | null;
    if (!el?.closest) return;
    root.classList.toggle('cur-off', el.tagName === 'IFRAME'); // native cursor inside the SoundCloud player
    const text = !!el.closest(TEXT);
    let sn = text ? null : el.closest(SNAP);
    // only small controls get wrapped; big rows/cards just get the hover ring
    if (sn) {
      const r = sn.getBoundingClientRect();
      if (r.width > 340 || r.height > 72) sn = null;
    }
    const hv = !text && !sn && !!el.closest(HOVER);
    const apply = () => {
      offTimer = 0;
      root.classList.toggle('cur-text', text);
      root.classList.toggle('cur-hover', hv);
      if (sn !== snapEl) {
        snapEl = sn;
        snapW = snapH = 0;
        root.classList.toggle('cur-snap', !!sn);
        if (sn) {
          const br = parseFloat(getComputedStyle(sn).borderTopLeftRadius) || 0;
          ring.style.setProperty('--rr', br > 40 ? '999px' : `${br + 5}px`);
        } else {
          ring.style.removeProperty('--rw');
          ring.style.removeProperty('--rh');
          ring.style.removeProperty('--rr');
        }
        kick();
      }
    };
    // turning ON is instant; turning OFF waits a moment so the ring doesn't
    // flicker while the pointer crosses the gap between neighbouring buttons
    if (sn || hv || text) {
      clearTimeout(offTimer);
      apply();
    } else if (!offTimer) offTimer = window.setTimeout(apply, 120);
  };
  const onOver = (e: PointerEvent) => e.pointerType === 'mouse' && retarget(e.target);

  // scrolling moves content under a still mouse
  let sraf = 0;
  const onScroll = () => {
    if (!shown || sraf) return;
    sraf = requestAnimationFrame(() => {
      sraf = 0;
      retarget(document.elementFromPoint(tx, ty));
    });
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    root.classList.add('cur-down');
    if (!REDUCE) {
      wave.style.transform = `translate3d(${e.clientX}px,${e.clientY}px,0)`;
      (wave.firstChild as HTMLElement).animate(
        [
          { transform: 'scale(.25)', opacity: 0.6 },
          { transform: 'scale(2.2)', opacity: 0 },
        ],
        { duration: 550, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    }
  };
  const onUp = () => root.classList.remove('cur-down');
  const onLeave = () => show(false);
  const onEnter = () => (tx || ty) && show(true);
  const onBlur = () => {
    onUp();
    show(false);
  };

  root.classList.add('has-cur');
  addEventListener('pointermove', onMove, { passive: true });
  addEventListener('pointerover', onOver, { passive: true });
  addEventListener('scroll', onScroll, { passive: true, capture: true });
  addEventListener('pointerdown', onDown, { passive: true });
  addEventListener('pointerup', onUp, { passive: true });
  addEventListener('pointercancel', onUp, { passive: true });
  addEventListener('blur', onBlur);
  root.addEventListener('mouseleave', onLeave);
  root.addEventListener('mouseenter', onEnter);

  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(offTimer);
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerover', onOver);
    removeEventListener('scroll', onScroll, { capture: true });
    removeEventListener('pointerdown', onDown);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onUp);
    removeEventListener('blur', onBlur);
    root.removeEventListener('mouseleave', onLeave);
    root.removeEventListener('mouseenter', onEnter);
    [dot, ring, wave].forEach((n) => n.remove());
    root.classList.remove('has-cur', 'cur-on', 'cur-off', 'cur-hover', 'cur-snap', 'cur-text', 'cur-down');
  };
}

export function CustomCursor() {
  const enabled = useSettings((s) => s.customCursor);
  useEffect(() => {
    if (!enabled || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    return start();
  }, [enabled]);
  return null;
}
