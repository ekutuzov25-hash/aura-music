/**
 * Audius — an open music platform for independent artists. Its public API
 * needs no key, sends CORS headers, and artists publish their tracks for free
 * streaming, which makes it the legal "works out of the box" catalog:
 * underground, remixes, DJ mixes, bedroom producers.
 * Docs: https://docs.audius.org/developers/api
 */
import { getJSON, qs } from '../lib/http';
import type { Artist, Collection, MusicProvider, SearchResults, Track } from './types';

const HOST = 'https://api.audius.co';
const APP = 'AURA';

type Sizes = Record<string, string> | null | undefined;
interface AUser {
  id: string; name: string; handle: string; bio?: string; follower_count?: number; track_count?: number;
  is_verified?: boolean; profile_picture?: Sizes; cover_photo?: Sizes;
}
interface ATrack {
  id: string; title: string; duration: number; genre?: string; tags?: string | null; mood?: string;
  artwork?: Sizes; user: AUser; permalink?: string; release_date?: string; created_at?: string;
  play_count?: number; favorite_count?: number; bpm?: number | null; is_streamable?: boolean; is_delete?: boolean;
  is_stream_gated?: boolean; access?: { stream?: boolean };
  stream?: { url?: string; mirrors?: string[] } | null;
}
interface APlaylist {
  id: string; playlist_name: string; description?: string; is_album: boolean; artwork?: Sizes;
  user: AUser; track_count?: number; permalink?: string; release_date?: string; tracks?: ATrack[];
}

const api = <T,>(path: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal) =>
  getJSON<{ data: T }>(`${HOST}/v1/${path}?${qs({ ...params, app_name: APP })}`, { signal }).then((r) => r.data);

// ───────────── fast streaming ─────────────
// /v1/tracks/{id}/stream goes API → content node → storage (~3 s of redirects).
// Track metadata already carries a signed content-node URL (~1.2 s), and once
// resolved, the final storage URL starts in ~0.7 s. We remember both and
// resolve upcoming tracks ahead of time. Signed URLs are kept in memory only.
const STREAM_TTL = 20 * 60_000;
const metaStream = new Map<string, { urls: string[]; at: number }>();
const finalStream = new Map<string, { url: string; at: number }>();
const preconnected = new Set<string>();

function rememberStream(t: ATrack) {
  const u = t.stream?.url;
  if (!u) return;
  // mirrors are other nodes holding the same file: same path, different host
  const path = u.replace(/^https?:\/\/[^/]+/, '');
  const mirrors = (t.stream?.mirrors ?? []).map((m) => m.replace(/\/$/, '') + path);
  metaStream.set(t.id, { urls: [u, ...mirrors], at: Date.now() });
}

function preconnect(url: string) {
  try {
    const origin = new URL(url).origin;
    if (preconnected.has(origin)) return;
    preconnected.add(origin);
    const l = document.createElement('link');
    l.rel = 'preconnect';
    l.href = origin;
    l.crossOrigin = 'anonymous';
    document.head.appendChild(l);
  } catch {
    /* bad url */
  }
}

const apiStreamUrl = (id: string) => `${HOST}/v1/tracks/${id}/stream?${qs({ app_name: APP })}`;

function candidates(id: string): string[] {
  const fresh = <T extends { at: number }>(x?: T) => (x && Date.now() - x.at < STREAM_TTL ? x : undefined);
  const fin = fresh(finalStream.get(id))?.url;
  const meta = fresh(metaStream.get(id))?.urls ?? [];
  return [...new Set([fin, ...meta.slice(0, 2), apiStreamUrl(id)].filter((u): u is string => !!u))];
}

const resolving = new Map<string, Promise<void>>();
async function resolveFinal(id: string) {
  if (finalStream.has(id) && Date.now() - finalStream.get(id)!.at < STREAM_TTL) return;
  if (resolving.has(id)) return resolving.get(id);
  const job = (async () => {
    const start = candidates(id)[0];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      // A 1-byte range request follows every redirect and leaves the connection warm.
      const res = await fetch(start, { headers: { Range: 'bytes=0-0' }, signal: ctrl.signal, cache: 'no-store' });
      if (res.ok && res.url) {
        finalStream.set(id, { url: res.url, at: Date.now() });
        preconnect(res.url);
      }
      void res.body?.cancel();
    } catch {
      /* best effort: playback falls back to the other URLs */
    } finally {
      clearTimeout(timer);
      resolving.delete(id);
    }
  })();
  resolving.set(id, job);
  return job;
}

// Content nodes are community-run and some are often overloaded. Each image
// comes with mirror hosts holding the same file; remember them so <Artwork>
// can silently switch to a mirror when a node fails.
const imageMirrors = new Map<string, string[]>();
function rememberMirrors(s: Sizes) {
  const mirrors = (s as { mirrors?: string[] } | null | undefined)?.mirrors;
  if (!s || !mirrors?.length) return;
  for (const [k, v] of Object.entries(s)) {
    if (k === 'mirrors' || typeof v !== 'string') continue;
    const path = v.replace(/^https?:\/\/[^/]+/, '');
    imageMirrors.set(v, mirrors.map((m) => m.replace(/\/$/, '') + path));
  }
}
/** Alternative URLs for an Audius image (empty for other sources). */
export function audiusImageFallbacks(url: string): string[] {
  const known = imageMirrors.get(url);
  if (known) return known;
  // Saved tracks from an earlier session: try hosts that served mirrors this session.
  const m = url.match(/^https?:\/\/([^/]+)(\/content\/.+)$/);
  if (!m) return [];
  const hosts = new Map<string, number>();
  for (const list of imageMirrors.values()) for (const u of list) {
    const h = u.match(/^https?:\/\/([^/]+)/)?.[1];
    if (h && h !== m[1]) hosts.set(h, (hosts.get(h) ?? 0) + 1);
  }
  return [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => `https://${h}${m[2]}`);
}

const pic = (s: Sizes, size: string) => {
  rememberMirrors(s);
  return s ? s[size] ?? Object.values(s).find((v) => typeof v === 'string') : undefined;
};
const web = (path?: string) => (path ? `https://audius.co${path}` : undefined);

export function mapTrack(t: ATrack): Track {
  rememberStream(t);
  const gated = t.is_stream_gated || t.access?.stream === false;
  return {
    id: `audius:${t.id}`,
    source: 'audius',
    sourceId: t.id,
    title: t.title,
    artist: t.user?.name ?? 'Unknown',
    artistId: t.user ? `audius:${t.user.id}` : undefined,
    artwork: pic(t.artwork, '150x150'),
    artworkLarge: pic(t.artwork, '480x480') ?? pic(t.artwork, '1000x1000'),
    artworkXL: pic(t.artwork, '1000x1000') ?? pic(t.artwork, '480x480'),
    duration: t.duration ?? 0,
    genre: t.genre || undefined,
    tags: t.tags ? t.tags.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
    permalink: web(t.permalink),
    playability: t.is_delete ? 'unavailable' : gated || t.is_streamable === false ? 'external' : 'full',
    releaseDate: t.release_date ?? t.created_at,
    plays: t.play_count,
    likes: t.favorite_count,
    mood: t.mood || undefined,
    bpm: t.bpm ? Math.round(t.bpm) : undefined,
  };
}

const mapArtist = (u: AUser): Artist => ({
  id: `audius:${u.id}`,
  source: 'audius',
  sourceId: u.id,
  name: u.name,
  handle: u.handle,
  avatar: pic(u.profile_picture, '480x480'),
  cover: pic(u.cover_photo, '2000x') ?? pic(u.cover_photo, '640x'),
  bio: u.bio,
  followers: u.follower_count,
  trackCount: u.track_count,
  verified: u.is_verified,
  permalink: `https://audius.co/${u.handle}`,
});

const mapCollection = (p: APlaylist): Collection => ({
  id: `audius:${p.id}`,
  source: 'audius',
  sourceId: p.id,
  kind: p.is_album ? 'album' : 'playlist',
  title: p.playlist_name,
  owner: p.user?.name ?? '',
  ownerId: p.user ? `audius:${p.user.id}` : undefined,
  artwork: pic(p.artwork, '480x480'),
  description: p.description,
  trackCount: p.track_count,
  permalink: web(p.permalink),
  releaseDate: p.release_date,
});

export const audius: MusicProvider = {
  id: 'audius',
  name: 'Audius',
  description: 'Открытая платформа независимых артистов. Полные треки, без ключей.',
  async status() {
    return { ready: true };
  },
  async search(query, signal): Promise<SearchResults> {
    const [tracks, users, playlists, albums] = await Promise.all([
      api<ATrack[]>('tracks/search', { query, limit: 30 }, signal),
      api<AUser[]>('users/search', { query, limit: 12 }, signal).catch(() => []),
      api<APlaylist[]>('playlists/search', { query, limit: 12 }, signal).catch(() => []),
      api<APlaylist[]>('playlists/search', { query, limit: 8, type: 'album' }, signal).catch(() => []),
    ]);
    const seen = new Set<string>();
    const collections = [...albums, ...playlists]
      .filter((p) => !seen.has(p.id) && seen.add(p.id))
      .map(mapCollection);
    return { tracks: tracks.map(mapTrack), artists: users.map(mapArtist), collections };
  },
  async resolveStream(track) {
    // All hops send CORS headers, so the analyser/visualizer can read the audio.
    const [url, ...fallbacks] = candidates(track.sourceId);
    if (!finalStream.has(track.sourceId)) void resolveFinal(track.sourceId); // speeds up replays
    return { kind: 'audio', url, fallbacks, corsSafe: true };
  },
  prefetch: (track) => resolveFinal(track.sourceId),
  async trending(opts = {}) {
    const data = await api<ATrack[]>('tracks/trending', { genre: opts.genre, time: opts.time ?? 'week', limit: 30 });
    return data.map(mapTrack);
  },
  async underground() {
    return (await api<ATrack[]>('tracks/trending/underground', { limit: 30 })).map(mapTrack);
  },
  async trendingCollections() {
    return (await api<APlaylist[]>('playlists/trending', { limit: 20 })).map(mapCollection);
  },
  async getArtist(id) {
    return mapArtist(await api<AUser>(`users/${id}`));
  },
  async getArtistTracks(id) {
    return (await api<ATrack[]>(`users/${id}/tracks`, { limit: 50, sort: 'plays' })).map(mapTrack);
  },
  async getArtistCollections(id) {
    const [albums, playlists] = await Promise.all([
      api<APlaylist[]>(`users/${id}/albums`, { limit: 20 }).catch(() => []),
      api<APlaylist[]>(`users/${id}/playlists`, { limit: 20 }).catch(() => []),
    ]);
    return [...albums, ...playlists].map(mapCollection);
  },
  async getCollection(id) {
    const [meta] = await api<APlaylist[]>(`playlists/${id}`);
    if (!meta) throw new Error('Not found');
    const tracks = await api<ATrack[]>(`playlists/${id}/tracks`);
    return { ...mapCollection(meta), tracks: tracks.map((t) => ({ ...mapTrack(t), album: meta.is_album ? meta.playlist_name : undefined })) };
  },
  async getTrack(id) {
    return mapTrack(await api<ATrack>(`tracks/${id}`));
  },
  async related(track) {
    // Audius has no public "related" endpoint; we use the same genre's trending
    // list (transparent, not personalized), excluding the seed track.
    if (!track.genre) return [];
    const list = await this.trending!({ genre: track.genre });
    return list.filter((t) => t.id !== track.id);
  },
};
