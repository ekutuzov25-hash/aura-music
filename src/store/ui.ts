import { create } from 'zustand';
import type { Track } from '../providers/types';

export interface Toast {
  id: number;
  message: string;
  tone?: 'default' | 'error' | 'success';
  action?: { label: string; run: () => void };
}

interface UIState {
  nowPlayingOpen: boolean;
  queueOpen: boolean;
  shortcutsOpen: boolean;
  /** Tracks waiting for the "add to playlist" sheet. */
  addToPlaylist: Track[] | null;
  /** reason shown in the Premium sheet, null when closed */
  paywall: string | null;
  toasts: Toast[];
  setNowPlaying(open: boolean): void;
  setQueue(open: boolean): void;
  setShortcuts(open: boolean): void;
  openAddToPlaylist(tracks: Track[] | null): void;
  openPaywall(reason: string | null): void;
  toast(message: string, opts?: Omit<Toast, 'id' | 'message'>): void;
  dismiss(id: number): void;
}

let seq = 0;

export const useUI = create<UIState>((set, get) => ({
  nowPlayingOpen: false,
  queueOpen: false,
  shortcutsOpen: false,
  addToPlaylist: null,
  paywall: null,
  toasts: [],
  setNowPlaying: (nowPlayingOpen) => set({ nowPlayingOpen }),
  setQueue: (queueOpen) => set({ queueOpen }),
  setShortcuts: (shortcutsOpen) => set({ shortcutsOpen }),
  openAddToPlaylist: (addToPlaylist) => set({ addToPlaylist }),
  openPaywall: (paywall) => set({ paywall }),
  toast(message, opts = {}) {
    const id = ++seq;
    set({ toasts: [...get().toasts.slice(-2), { id, message, ...opts }] });
    setTimeout(() => get().dismiss(id), opts.action ? 6000 : 3200);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (m: string, o?: Omit<Toast, 'id' | 'message'>) => useUI.getState().toast(m, o);
