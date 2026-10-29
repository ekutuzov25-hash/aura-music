import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SourceId } from '../providers/types';

export type ThemePref = 'dark' | 'light' | 'system';
export type MotionPref = 'full' | 'reduced' | 'system';

export interface Profile {
  displayName: string;
  username: string;
  bio: string;
  avatar?: string;
  isPrivate: boolean;
  showHistory: boolean;
}

interface SettingsState {
  theme: ThemePref;
  motion: MotionPref;
  /** Disables backdrop blur & big shadows for weak GPUs. */
  liteGlass: boolean;
  haptics: boolean;
  dynamicColor: boolean;
  visualizer: boolean;
  enabledSources: SourceId[];
  searchHistory: string[];
  profile: Profile;
  set<K extends keyof Omit<SettingsState, 'set' | 'pushSearch' | 'setProfile'>>(k: K, v: SettingsState[K]): void;
  pushSearch(q: string): void;
  setProfile(p: Partial<Profile>): void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      motion: 'system',
      liteGlass: false,
      haptics: true,
      dynamicColor: false,
      visualizer: true,
      enabledSources: ['soundcloud', 'audius', 'itunes', 'local'],
      searchHistory: [],
      profile: { displayName: 'Слушатель', username: '', bio: '', isPrivate: true, showHistory: true },
      set: (k, v) => set({ [k]: v } as Partial<SettingsState>),
      pushSearch(q) {
        q = q.trim();
        if (q.length < 2) return;
        set({ searchHistory: [q, ...get().searchHistory.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 20) });
      },
      setProfile: (p) => set({ profile: { ...get().profile, ...p } }),
    }),
    {
      name: 'aura-settings',
      version: 2,
      // v2: new black-and-white look — cover colours become opt-in
      migrate: (state, version) => {
        const s = state as { dynamicColor?: boolean };
        if (version < 2) s.dynamicColor = false;
        return s as never;
      },
    },
  ),
);
