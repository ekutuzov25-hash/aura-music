/**
 * «Аура» — endless personal streams.
 *
 *  • Моя аура: an infinite queue built from your taste profile (likes, plays,
 *    playlists, chosen genres/artists) and tuned by «Характер» and «Настроение».
 *  • Аура трека: an infinite queue of tracks similar to one seed track
 *    (same genre/mood/tempo, the source's related tracks, the same scene).
 *
 * The stream learns during listening: a like boosts the artist and genre, a
 * skip in the first 30 s lowers them a little, «Не нравится» lowers them a
 * lot and hides that track forever. All rules are plain arithmetic here —
 * no hidden ML — so it's easy to tune.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { audius } from '../providers/audius';
import { getProvider } from '../providers/registry';
import { soundcloud, soundcloudApiReady } from '../providers/soundcloud';
import type { Track } from '../providers/types';
import { player } from '../player/controller';
import { usePlayerState, useProgress, type PlayContext } from '../player/store';
import { useLibrary } from '../store/library';
import { toast } from '../store/ui';
import { buildTaste, normalizeGenre } from './engine';
import { shuffleArray } from '../lib/util';

export type Character = 'favorite' | 'discover' | 'popular';
export type Mood = 'any' | 'energetic' | 'calm' | 'sad';

export const CHARACTERS: Array<[Character, string, string]> = [
  ['favorite', 'Любимое', 'Больше ваших артистов'],
  ['discover', 'Незнакомое', 'Новые имена и андеграунд'],
  ['popular', 'Популярное', 'То, что сейчас в тренде'],
];
export const MOODS: Array<[Mood, string]> = [
  ['any', 'Любое'],
  ['energetic', 'Бодрое'],
  ['calm', 'Спокойное'],
  ['sad', 'Грустное'],
];

const MOOD_TAGS: Record<Exclude<Mood, 'any'>, string[]> = {
  energetic: ['Energizing', 'Upbeat', 'Excited', 'Fiery', 'Aggressive', 'Rowdy', 'Empowering', 'Defiant', 'Stirring'],
  calm: ['Peaceful', 'Easygoing', 'Tender', 'Cool', 'Sophisticated', 'Romantic', 'Sensual'],
  sad: ['Melancholy', 'Sentimental', 'Yearning', 'Brooding', 'Serious'],
};

interface AuraPrefs {
  character: Character;
  mood: Mood;
  /** learned adjustments, keyed by artist name / genre */
  artistAdj: Record<string, number>;
  genreAdj: Record<string, number>;
  disliked: string[];
  set(p: Partial<Pick<AuraPrefs, 'character' | 'mood'>>): void;
  adjust(t: Track, artist: number, genre: number): void;
  dislike(id: string): void;
  reset(): void;
}

export const useAura = create<AuraPrefs>()(
  persist(
    (set, get) => ({
      character: 'favorite',
      mood: 'any',
      artistAdj: {},
      genreAdj: {},
      disliked: [],
      set: (p) => set(p),
      adjust(t, a, g) {
        const genre = normalizeGenre(t.genre);
        const clamp = (v: number) => Math.max(-6, Math.min(6, v));
        set({
          artistAdj: { ...get().artistAdj, [t.artist]: clamp((get().artistAdj[t.artist] ?? 0) + a) },
          genreAdj: genre ? { ...get().genreAdj, [genre]: clamp((get().genreAdj[genre] ?? 0) + g) } : get().genreAdj,
        });
      },
      dislike: (id) => set({ disliked: [...get().disliked.filter((x) => x !== id), id].slice(-500) }),
      reset: () => set({ artistAdj: {}, genreAdj: {}, disliked: [] }),
    }),
    { name: 'aura-stream', version: 1 },
  ),
);

// ─────────────────────────── scoring helpers ───────────────────────────
const playable = (t: Track) => t.playability === 'full' || t.playability === 'preview';

function matchesMood(t: Track, mood: Mood) {
  if (mood === 'any') return true;
  if (t.mood) return MOOD_TAGS[mood].includes(t.mood);
  // no mood tag: fall back to tempo when the source provides it
  if (t.bpm) return mood === 'energetic' ? t.bpm >= 118 : t.bpm <= 105;
  return false;
}

/** Weighted random pick — higher weight, higher chance, but never deterministic. */
function pickWeighted<T>(items: Array<[T, number]>, n: number): T[] {
  const pool = items.filter(([, w]) => w > 0).map(([v, w]) => ({ v, w }));
  const out: T[] = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    const i = pool.findIndex((x) => (r -= x.w) <= 0);
    out.push(pool.splice(i < 0 ? 0 : i, 1)[0].v);
  }
  return out;
}

const searchTracks = async (q: string) => (await audius.search(q).catch(() => ({ tracks: [] as Track[] }))).tracks;
const scSearch = async (q: string) =>
  (await soundcloudApiReady()) ? (await soundcloud.search(q).catch(() => ({ tracks: [] as Track[] }))).tracks : [];

// ─────────────────────────── candidate generation ───────────────────────────
async function candidatesMy(): Promise<{ list: Track[]; score: (t: Track) => number }> {
  const lib = useLibrary.getState();
  const prefs = useAura.getState();
  const taste = buildTaste(lib);
  const genreW = new Map(taste.genres);
  const artistW = new Map(taste.artists);
  for (const [g, v] of Object.entries(prefs.genreAdj)) genreW.set(g, (genreW.get(g) ?? 0) + v * 2);
  for (const [a, v] of Object.entries(prefs.artistAdj)) artistW.set(a, (artistW.get(a) ?? 0) + v * 2);

  const known = new Set([...lib.likes.map((l) => l.item.artist), ...lib.history.map((h) => h.track.artist)]);
  const genres = pickWeighted([...genreW.entries()], 2);
  const artists = pickWeighted([...artistW.entries()], 2);
  const time = (['week', 'month', 'allTime'] as const)[Math.floor(Math.random() * 3)];

  const jobs: Array<Promise<Track[]>> = [];
  if (!genres.length && !artists.length) {
    // cold start: we know nothing yet — say so in the UI, start from what's popular
    jobs.push(audius.trending!({ time: 'week' }));
  }
  for (const g of genres) {
    jobs.push(prefs.character === 'popular' ? audius.trending!({ genre: g, time: 'week' }) : audius.trending!({ genre: g, time }));
    jobs.push(scSearch(g));
  }
  if (prefs.character === 'favorite') {
    for (const a of artists) jobs.push(searchTracks(a), scSearch(a));
    // a few of your own liked tracks come back around
    jobs.push(Promise.resolve(shuffleArray(lib.likes.map((l) => l.item)).slice(0, 4)));
  }
  if (prefs.character === 'discover') jobs.push(audius.underground!());
  if (prefs.character === 'popular') jobs.push(audius.trending!({ time: 'week' }));

  const list = (await Promise.all(jobs.map((j) => j.catch(() => [] as Track[])))).flat();
  return {
    list,
    score: (t) => {
      const g = normalizeGenre(t.genre);
      let s = (g ? genreW.get(g) ?? 0 : 0) * 0.6 + (artistW.get(t.artist) ?? 0) * 0.8;
      if (prefs.character === 'discover') s += known.has(t.artist) ? -6 : 3;
      if (prefs.character === 'popular') s += Math.log10((t.plays ?? 0) + 1);
      return s + Math.random() * 3; // keep it fresh
    },
  };
}

async function candidatesTrack(seed: Track): Promise<{ list: Track[]; score: (t: Track) => number }> {
  const prefs = useAura.getState();
  const genre = normalizeGenre(seed.genre);
  const jobs: Array<Promise<Track[]>> = [
    getProvider(seed.source).related?.(seed) ?? Promise.resolve([]),
    searchTracks(seed.artist),
    scSearch(seed.artist),
  ];
  if (genre) jobs.push(audius.trending!({ genre, time: 'month' }), audius.trending!({ genre, time: 'allTime' }), scSearch(genre));
  const list = (await Promise.all(jobs.map((j) => j.catch(() => [] as Track[])))).flat();
  return {
    list,
    score: (t) => {
      let s = 0;
      if (genre && normalizeGenre(t.genre) === genre) s += 3;
      if (seed.mood && t.mood === seed.mood) s += 2;
      if (seed.bpm && t.bpm && Math.abs(seed.bpm - t.bpm) <= 8) s += 2;
      if (t.artist === seed.artist) s += 1;
      s += (prefs.artistAdj[t.artist] ?? 0) * 0.8 + ((genre && prefs.genreAdj[genre]) || 0) * 0.3;
      return s + Math.random() * 2;
    },
  };
}

/** Builds the next batch: dedupe, filter, rank, keep artists varied. */
async function nextBatch(ctx: NonNullable<PlayContext['aura']>, size = 10): Promise<Track[]> {
  const prefs = useAura.getState();
  const { queue } = usePlayerState.getState();
  const recent = new Set([...queue.map((t) => t.id), ...useLibrary.getState().history.slice(0, 60).map((h) => h.track.id)]);
  const disliked = new Set(prefs.disliked);
  const { list, score } = ctx.kind === 'my' ? await candidatesMy() : await candidatesTrack(ctx.seed);

  const seen = new Set<string>();
  const pool = list.filter(
    (t) =>
      playable(t) &&
      !seen.has(t.id) &&
      seen.add(t.id) &&
      !recent.has(t.id) &&
      !disliked.has(t.id) &&
      (prefs.artistAdj[t.artist] ?? 0) > -4 &&
      (ctx.kind === 'track' ? t.id !== ctx.seed.id : true) &&
      t.duration < 20 * 60, // a radio shouldn't drop you into a 2-hour set
  );
  const moodFit = pool.filter((t) => matchesMood(t, prefs.mood));
  // if the mood filter leaves too little, relax it rather than stop the music
  const ranked = (moodFit.length >= size / 2 ? moodFit : pool).map((t) => ({ t, s: score(t) })).sort((a, b) => b.s - a.s);

  const perArtist = new Map<string, number>();
  const out: Track[] = [];
  for (const { t } of ranked) {
    const n = perArtist.get(t.artist) ?? 0;
    if (n >= (ctx.kind === 'track' ? 2 : 1)) continue;
    perArtist.set(t.artist, n + 1);
    out.push(t);
    if (out.length >= size) break;
  }
  return out;
}

// ─────────────────────────── controls ───────────────────────────
export const MY_AURA_PATH = '/';
export const isAuraContext = (c?: PlayContext) => !!c?.aura;

let loading = false;
export const useAuraLoading = create<{ loading: boolean }>(() => ({ loading: false }));

export async function startMyAura() {
  return start({ label: 'Моя аура', path: MY_AURA_PATH, aura: { kind: 'my' } });
}

export async function startTrackAura(seed: Track) {
  return start({ label: `Аура трека · ${seed.title}`, path: MY_AURA_PATH, aura: { kind: 'track', seed } });
}

async function start(context: PlayContext) {
  useAuraLoading.setState({ loading: true });
  try {
    const batch = await nextBatch(context.aura!);
    if (!batch.length) {
      toast('Не удалось собрать поток — проверьте подключение или смените настройки', { tone: 'error' });
      return;
    }
    // «Аура трека» opens with the seed itself
    const first = context.aura!.kind === 'track' && playable(context.aura!.seed) ? [context.aura!.seed] : [];
    await player.playTracks([...first, ...batch], 0, context, { shuffle: false });
  } finally {
    useAuraLoading.setState({ loading: false });
  }
}

/** Restart the current stream with new settings, keeping the playing track. */
export async function refreshAura() {
  const { context, queue, index } = usePlayerState.getState();
  if (!context?.aura) return;
  const batch = await nextBatch(context.aura);
  usePlayerState.setState({ queue: [...queue.slice(0, index + 1), ...batch], baseQueue: [...queue.slice(0, index + 1), ...batch] });
}

/** «Не нравится»: never again, the artist/genre drops, and we skip now. */
export function dislikeCurrent() {
  const { queue, index } = usePlayerState.getState();
  const t = queue[index];
  if (!t) return;
  useAura.getState().dislike(t.id);
  useAura.getState().adjust(t, -2, -0.5);
  toast('Больше не покажем этот трек, похожего станет меньше');
  void player.next();
}

// Keep the stream endless and learn from skips / likes.
let lastIndex = usePlayerState.getState().index;
let lastId = usePlayerState.getState().queue[lastIndex]?.id;
usePlayerState.subscribe((s) => {
  if (s.index === lastIndex && s.queue[s.index]?.id === lastId) return;
  const prev = lastId ? s.queue.find((t) => t.id === lastId) : undefined;
  const forward = s.index > lastIndex;
  const heard = useProgress.getState().time; // still the previous track's position at this moment
  lastIndex = s.index;
  lastId = s.queue[s.index]?.id;
  if (!s.context?.aura) return;

  // early skip = a soft "not now"
  if (prev && forward && heard > 0 && heard < 30) useAura.getState().adjust(prev, -0.5, -0.2);

  if (s.queue.length - s.index - 1 < 3 && !loading) {
    loading = true;
    const ctx = s.context.aura;
    nextBatch(ctx)
      .then((batch) => {
        const cur = usePlayerState.getState();
        if (cur.context?.aura !== ctx || !batch.length) return;
        usePlayerState.setState({ queue: [...cur.queue, ...batch], baseQueue: [...cur.baseQueue, ...batch] });
      })
      .catch(() => {})
      .finally(() => (loading = false));
  }
});

// Likes during a stream teach it, too.
useLibrary.subscribe((s, prev) => {
  if (s.likes.length <= prev.likes.length) return;
  const ctx = usePlayerState.getState().context;
  if (ctx?.aura) useAura.getState().adjust(s.likes[0].item, 1.5, 0.5);
});
