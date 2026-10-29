/**
 * Transparent, rule-based recommendations (no ML).
 *
 * 1. Build a taste profile: weighted genres and artists from likes (×3),
 *    real plays >30 s (×1 each, capped), playlist tracks (×2), saved artists
 *    (×4) and genres/artists picked in onboarding (×4).
 * 2. Fetch candidates from live sources for the top genres/artists.
 * 3. Drop what the user already knows, interleave, and attach the reason
 *    ("Потому что вы слушаете House") that is shown in the UI.
 */
import { audius } from '../providers/audius';
import type { Track } from '../providers/types';
import type { LibraryState } from '../store/library';
import { seeded, shuffleArray } from '../lib/util';

export const GENRES = [
  'Electronic', 'House', 'Deep House', 'Tech House', 'Techno', 'Drum & Bass', 'Dubstep', 'Trap', 'Hip-Hop/Rap',
  'Lo-Fi', 'Ambient', 'Downtempo', 'Pop', 'R&B/Soul', 'Rock', 'Alternative', 'Metal', 'Punk', 'Jazz', 'Funk',
  'Disco', 'Experimental', 'Hyperpop', 'Latin', 'Reggae', 'Dancehall', 'Trance', 'Future Bass', 'Jersey Club',
  'Classical', 'Soundtrack', 'Folk', 'Acoustic', 'World', 'Vaporwave', 'Jungle',
] as const;

const GENRE_LC = new Map(GENRES.map((g) => [g.toLowerCase(), g]));
/** Map free-form genres from any source onto the shared list when possible. */
export function normalizeGenre(g?: string): string | undefined {
  if (!g) return;
  const lc = g.toLowerCase().trim();
  if (GENRE_LC.has(lc)) return GENRE_LC.get(lc);
  if (/hip.?hop|rap/.test(lc)) return 'Hip-Hop/Rap';
  if (/r&b|rnb|soul/.test(lc)) return 'R&B/Soul';
  if (/d(rum)?\s?(&|n|and)\s?b(ass)?/.test(lc)) return 'Drum & Bass';
  if (/lo-?fi/.test(lc)) return 'Lo-Fi';
  if (/dance|edm/.test(lc)) return 'Electronic';
  for (const [k, v] of GENRE_LC) if (lc.includes(k)) return v;
  return g;
}

export interface Taste {
  genres: Array<[string, number]>;
  artists: Array<[string, number]>;
  hasData: boolean;
}

export function buildTaste(lib: Pick<LibraryState, 'likes' | 'history' | 'playCounts' | 'playlists' | 'artists' | 'preferences'>): Taste {
  const g = new Map<string, number>();
  const a = new Map<string, number>();
  const add = (t: Track, w: number) => {
    const genre = normalizeGenre(t.genre);
    if (genre) g.set(genre, (g.get(genre) ?? 0) + w);
    if (t.artist) a.set(t.artist, (a.get(t.artist) ?? 0) + w);
  };
  lib.likes.forEach((l) => add(l.item, 3));
  lib.history.forEach((h) => add(h.track, Math.min(5, lib.playCounts[h.track.id] ?? 0) + 0.5));
  lib.playlists.forEach((p) => p.items.forEach((i) => add(i.track, 2)));
  lib.artists.forEach((x) => a.set(x.item.name, (a.get(x.item.name) ?? 0) + 4));
  lib.preferences.genres.forEach((x) => g.set(x, (g.get(x) ?? 0) + 4));
  lib.preferences.artists.forEach((x) => a.set(x, (a.get(x) ?? 0) + 4));
  const sort = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1]);
  const genres = sort(g);
  const artists = sort(a);
  return { genres, artists, hasData: genres.length > 0 || artists.length > 0 };
}

export interface Rec {
  track: Track;
  reason: string;
}

const known = (lib: Pick<LibraryState, 'likes' | 'history'>) =>
  new Set([...lib.likes.map((l) => l.item.id), ...lib.history.map((h) => h.track.id)]);

/** Round-robin merge so one genre doesn't flood the list. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) lists.forEach((l) => i < l.length && out.push(l[i]));
  return out;
}

export async function madeForYou(taste: Taste, lib: Pick<LibraryState, 'likes' | 'history'>): Promise<Rec[]> {
  const skip = known(lib);
  const topGenres = taste.genres.slice(0, 3).map(([x]) => x);
  const topArtists = taste.artists.slice(0, 2).map(([x]) => x);
  const lists = await Promise.all([
    ...topGenres.map(async (genre) =>
      (await audius.trending!({ genre, time: 'month' }).catch(() => [])).map((track) => ({ track, reason: `Потому что вы слушаете ${genre}` })),
    ),
    ...topArtists.map(async (artist) =>
      (await audius.search(artist).catch(() => ({ tracks: [] as Track[] }))).tracks
        .filter((t) => t.artist.toLowerCase() !== artist.toLowerCase())
        .slice(0, 10)
        .map((track) => ({ track, reason: `Похоже на ${artist}` })),
    ),
  ]);
  const seen = new Set<string>();
  return interleave(lists).filter((r) => r.track.playability === 'full' && !skip.has(r.track.id) && !seen.has(r.track.id) && seen.add(r.track.id)).slice(0, 24);
}

export interface Mix {
  id: string;
  title: string;
  genre: string;
  reason: string;
  tracks: Track[];
}

/** Daily Mix: your tracks of a genre + fresh ones, reshuffled once per day. */
export async function dailyMixes(taste: Taste, lib: Pick<LibraryState, 'likes' | 'history'>): Promise<Mix[]> {
  const day = new Date().toISOString().slice(0, 10);
  const yours = [...lib.likes.map((l) => l.item), ...lib.history.map((h) => h.track)];
  const genres = taste.genres.slice(0, 4).map(([x]) => x);
  const mixes = await Promise.all(
    genres.map(async (genre, i): Promise<Mix | null> => {
      const fam = yours.filter((t) => normalizeGenre(t.genre) === genre && t.playability !== 'unavailable');
      const fresh = await audius.trending!({ genre, time: 'allTime' }).catch(() => []);
      const rand = seeded(`${day}:${genre}`);
      const seen = new Set<string>();
      const tracks = shuffleArray([...shuffleArray(fam, rand).slice(0, 10), ...shuffleArray(fresh, rand).slice(0, 15)], rand).filter(
        (t) => !seen.has(t.id) && seen.add(t.id),
      );
      if (tracks.length < 5) return null;
      return {
        id: `mix-${genre}`,
        title: `Daily Mix ${i + 1}`,
        genre,
        reason: `${genre} · ${fam.length ? `${Math.min(10, fam.length)} знакомых + ` : ''}новые треки`,
        tracks,
      };
    }),
  );
  return mixes.filter((m): m is Mix => !!m);
}

export function rotation(lib: Pick<LibraryState, 'history' | 'likes' | 'playCounts'>): Track[] {
  const byId = new Map<string, Track>();
  [...lib.likes.map((l) => l.item), ...lib.history.map((h) => h.track)].forEach((t) => byId.set(t.id, t));
  return Object.entries(lib.playCounts)
    .filter(([id, n]) => n >= 2 && byId.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([id]) => byId.get(id)!);
}

/** Recently released tracks among this week's trending (Audius has no dedicated "new releases" feed). */
export async function newReleases(): Promise<Track[]> {
  const list = await audius.trending!({ time: 'week' });
  const cutoff = Date.now() - 45 * 86400_000;
  return list
    .filter((t) => t.releaseDate && Date.parse(t.releaseDate) > cutoff)
    .sort((a, b) => Date.parse(b.releaseDate!) - Date.parse(a.releaseDate!));
}
