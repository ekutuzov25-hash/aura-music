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
  customCursor: boolean;
  /** replace previews / blocked tracks with a full legal version from Audius when one exists */
  autoFullVersion: boolean;
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
      customCursor: true,
      autoFullVersion: true,
      enabledSources: ['soundcloud', 'audius', 'mixcloud', 'archive', 'itunes', 'local'],
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
      version: 5,
      // v2: new black-and-white look — cover colours become opt-in
      migrate: (state, version) => {
        const s = state as { dynamicColor?: boolean };
        if (version < 2) s.dynamicColor = false;
        if (version < 3) (s as { customCursor?: boolean }).customCursor = true;
        if (version < 4) (s as { autoFullVersion?: boolean }).autoFullVersion = true;
        // v5: new sources are switched on for existing users too
        if (version < 5) {
          const e = (s as { enabledSources?: string[] }).enabledSources ?? [];
          (s as { enabledSources?: string[] }).enabledSources = [...new Set([...e, 'mixcloud', 'archive'])];
        }
        return s as never;
      },
    },
  ),
);
