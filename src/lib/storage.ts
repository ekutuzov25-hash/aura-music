import type { PersistStorage, StorageValue } from 'zustand/middleware';

/**
 * localStorage with batched, idle-time writes. zustand's persist serialises
 * the whole store on every change; for the queue (hundreds of tracks) or the
 * library that is a synchronous JSON.stringify + disk write on each
 * pause/skip/like, which shows up as micro-freezes. Here the latest value is
 * kept in memory and serialised once, when the browser is idle — and always
 * flushed before the page is hidden or closed.
 */
const pending = new Map<string, StorageValue<unknown>>();
let scheduled = false;

function flush() {
  scheduled = false;
  for (const [k, v] of pending) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* quota / private mode: keep running without persistence */
    }
  }
  pending.clear();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(flush, { timeout: 1500 });
  else setTimeout(flush, 500);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
}

export function batchedStorage<S>(): PersistStorage<S> {
  return {
    getItem: (name) => {
      if (pending.has(name)) return pending.get(name) as StorageValue<S>;
      try {
        const raw = localStorage.getItem(name);
        return raw ? (JSON.parse(raw) as StorageValue<S>) : null;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      pending.set(name, value as StorageValue<unknown>);
      schedule();
    },
    removeItem: (name) => {
      pending.delete(name);
      localStorage.removeItem(name);
    },
  };
}
