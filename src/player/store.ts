/**
 * Player state. Progress (current time) lives in a separate tiny store so
 * that ticking 4×/sec only re-renders the progress bar, not the whole app.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Track } from '../providers/types';
import { batchedStorage } from '../lib/storage';

export type Repeat = 'off' | 'all' | 'one';
export type Status = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface PlayContext {
  label: string;
  path?: string;
  /** set when the queue is an endless Aura stream (see recommend/aura.ts) */
  aura?: { kind: 'my' } | { kind: 'track'; seed: Track };
}

interface PlayerState {
  queue: Track[];
  /** queue order before shuffle was enabled */
  baseQueue: Track[];
  index: number;
  status: Status;
  error?: string;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Repeat;
  mode: 'audio' | 'sc-widget';
  isPreview: boolean;
  context?: PlayContext;
}

export const usePlayerState = create<PlayerState>()(
  persist(
    (): PlayerState => ({
      queue: [],
      baseQueue: [],
      index: -1,
      status: 'idle',
      volume: 0.9,
      muted: false,
      shuffle: false,
      repeat: 'off',
      mode: 'audio',
      isPreview: false,
    }),
    {
      name: 'aura-player',
      version: 1,
      storage: batchedStorage(),
      // Restore the queue and settings, never "playing" (browsers block autoplay anyway).
      partialize: (s) => ({
        queue: s.queue.slice(0, 500),
        baseQueue: s.baseQueue.slice(0, 500),
        index: s.index,
        volume: s.volume,
        muted: s.muted,
        shuffle: s.shuffle,
        repeat: s.repeat,
        context: s.context,
      }),
    },
  ),
);

export const useProgress = create<{ time: number; duration: number; buffering: boolean }>(() => ({
  time: 0,
  duration: 0,
  buffering: false,
}));

export const useCurrentTrack = () => usePlayerState((s) => (s.index >= 0 ? s.queue[s.index] : undefined));
