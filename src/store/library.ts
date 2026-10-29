/**
 * The user's library: playlists, likes, saved artists/albums/sets, history.
 * Persisted to localStorage immediately; when signed in with Supabase the
 * sync module mirrors it to the database (see auth/sync.ts).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Artist, Collection, Track } from '../providers/types';
import { FREE_PLAYLIST_LIMIT } from '../billing/plans';
import { isPremiumNow } from '../billing/premium';
import { useUI } from './ui';
import { batchedStorage } from '../lib/storage';
import { uuid } from '../lib/util';

export interface PlaylistItem {
  track: Track;
  addedAt: number;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  /** small data: URL (resized on upload) */
  cover?: string;
  isPublic: boolean;
  items: PlaylistItem[];
  createdAt: number;
  updatedAt: number;
}

export interface HistoryEntry {
  track: Track;
  playedAt: number;
}

interface Saved<T> {
  item: T;
  addedAt: number;
}

export interface LibraryState {
  playlists: Playlist[];
  deletedPlaylistIds: string[];
  likes: Saved<Track>[];
  artists: Saved<Artist>[];
  collections: Saved<Collection>[];
  history: HistoryEntry[];
  /** trackId → number of plays that lasted > 30 s */
  playCounts: Record<string, number>;
  localTracks: Track[];
  preferences: { genres: string[]; artists: string[]; onboarded: boolean };
  updatedAt: number;

  /** null when the free-plan limit is reached (the Premium sheet is shown instead) */
  createPlaylist(p?: Partial<Pick<Playlist, 'name' | 'description' | 'cover' | 'isPublic'>>, tracks?: Track[]): Playlist | null;
  updatePlaylist(id: string, patch: Partial<Pick<Playlist, 'name' | 'description' | 'cover' | 'isPublic'>>): void;
  deletePlaylist(id: string): void;
  duplicatePlaylist(id: string): Playlist | null;
  addToPlaylist(id: string, tracks: Track[]): number;
  removeFromPlaylist(id: string, index: number): void;
  reorderPlaylist(id: string, items: PlaylistItem[]): void;

  toggleLike(track: Track): boolean;
  isLiked(id: string): boolean;
  toggleArtist(a: Artist): boolean;
  toggleCollection(c: Collection): boolean;

  recordPlay(track: Track): void;
  countPlay(track: Track): void;
  clearHistory(): void;

  addLocalTracks(t: Track[]): void;
  removeLocalTrack(id: string): void;

  setPreferences(p: Partial<LibraryState['preferences']>): void;
  replaceAll(data: Partial<LibraryState>): void;
}

const MAX_HISTORY = 300;
const now = () => Date.now();

export const useLibrary = create<LibraryState>()(
  persist(
    (set, get) => {
      const touch = <T extends object>(patch: T) => set({ ...patch, updatedAt: now() } as Partial<LibraryState>);
      const mapPlaylist = (id: string, fn: (p: Playlist) => Playlist) =>
        touch({ playlists: get().playlists.map((p) => (p.id === id ? { ...fn(p), updatedAt: now() } : p)) });

      const atLimit = () => {
        if (isPremiumNow() || get().playlists.length < FREE_PLAYLIST_LIMIT) return false;
        useUI.getState().openPaywall(`В бесплатной версии — до ${FREE_PLAYLIST_LIMIT} плейлистов. С Premium их сколько угодно.`);
        return true;
      };

      return {
        playlists: [],
        deletedPlaylistIds: [],
        likes: [],
        artists: [],
        collections: [],
        history: [],
        playCounts: {},
        localTracks: [],
        preferences: { genres: [], artists: [], onboarded: false },
        updatedAt: 0,

        createPlaylist(p = {}, tracks = []) {
          if (atLimit()) return null;
          const n = get().playlists.length + 1;
          const pl: Playlist = {
            id: uuid(),
            name: p.name?.trim() || `Мой плейлист №${n}`,
            description: p.description ?? '',
            cover: p.cover,
            isPublic: p.isPublic ?? false,
            items: tracks.map((track) => ({ track, addedAt: now() })),
            createdAt: now(),
            updatedAt: now(),
          };
          touch({ playlists: [pl, ...get().playlists] });
          return pl;
        },
        updatePlaylist(id, patch) {
          mapPlaylist(id, (p) => ({ ...p, ...patch }));
        },
        deletePlaylist(id) {
          touch({
            playlists: get().playlists.filter((p) => p.id !== id),
            deletedPlaylistIds: [...get().deletedPlaylistIds, id],
          });
        },
        duplicatePlaylist(id) {
          const src = get().playlists.find((p) => p.id === id);
          if (!src || atLimit()) return null;
          const copy: Playlist = {
            ...src,
            id: uuid(),
            name: `${src.name} (копия)`,
            isPublic: false,
            createdAt: now(),
            updatedAt: now(),
          };
          touch({ playlists: [copy, ...get().playlists] });
          return copy;
        },
        addToPlaylist(id, tracks) {
          const pl = get().playlists.find((p) => p.id === id);
          if (!pl) return 0;
          const existing = new Set(pl.items.map((i) => i.track.id));
          const fresh = tracks.filter((t) => !existing.has(t.id));
          mapPlaylist(id, (p) => ({ ...p, items: [...p.items, ...fresh.map((track) => ({ track, addedAt: now() }))] }));
          return fresh.length;
        },
        removeFromPlaylist(id, index) {
          mapPlaylist(id, (p) => ({ ...p, items: p.items.filter((_, i) => i !== index) }));
        },
        reorderPlaylist(id, items) {
          mapPlaylist(id, (p) => ({ ...p, items }));
        },

        toggleLike(track) {
          const liked = get().likes.some((l) => l.item.id === track.id);
          touch({
            likes: liked ? get().likes.filter((l) => l.item.id !== track.id) : [{ item: track, addedAt: now() }, ...get().likes],
          });
          return !liked;
        },
        isLiked(id) {
          return get().likes.some((l) => l.item.id === id);
        },
        toggleArtist(a) {
          const has = get().artists.some((x) => x.item.id === a.id);
          touch({ artists: has ? get().artists.filter((x) => x.item.id !== a.id) : [{ item: a, addedAt: now() }, ...get().artists] });
          return !has;
        },
        toggleCollection(c) {
          const has = get().collections.some((x) => x.item.id === c.id);
          const slim = { ...c, tracks: undefined };
          touch({
            collections: has ? get().collections.filter((x) => x.item.id !== c.id) : [{ item: slim, addedAt: now() }, ...get().collections],
          });
          return !has;
        },

        recordPlay(track) {
          // "Recently played" shows each track once, most recent first.
          const history = [{ track, playedAt: now() }, ...get().history.filter((h) => h.track.id !== track.id)];
          touch({ history: history.slice(0, MAX_HISTORY) });
        },
        countPlay(track) {
          const c = get().playCounts;
          touch({ playCounts: { ...c, [track.id]: (c[track.id] ?? 0) + 1 } });
        },
        clearHistory() {
          touch({ history: [], playCounts: {} });
        },

        addLocalTracks(t) {
          touch({ localTracks: [...t, ...get().localTracks] });
        },
        removeLocalTrack(id) {
          touch({
            localTracks: get().localTracks.filter((t) => t.id !== id),
            // keep metadata in playlists, but mark as unavailable
            playlists: get().playlists.map((p) => ({
              ...p,
              items: p.items.map((i) => (i.track.id === id ? { ...i, track: { ...i.track, playability: 'unavailable' as const } } : i)),
            })),
          });
        },

        setPreferences(p) {
          touch({ preferences: { ...get().preferences, ...p } });
        },
        replaceAll(data) {
          set(data);
        },
      };
    },
    { name: 'aura-library', version: 1, storage: batchedStorage() },
  ),
);

/** DJ mixes / sets: long tracks, or ones tagged as a mix. */
export const isSet = (t: Track) =>
  t.duration >= 20 * 60 || /\b(dj ?set|mix(tape)?|live set|boiler room|podcast)\b/i.test(`${t.title} ${(t.tags ?? []).join(' ')}`);

export const isRemix = (t: Track) => /\b(remix|rmx|edit|bootleg|flip|vip)\b/i.test(t.title);
