/**
 * SoundCloud — priority source.
 *
 * Two modes, chosen automatically:
 *
 * 1. API mode (server has SOUNDCLOUD_CLIENT_ID/SECRET): full search, artist
 *    pages, sets, and streaming via short-lived signed URLs our server resolves.
 *
 * 2. Link mode (no keys): SoundCloud's public oEmbed endpoint gives title,
 *    author and artwork for any public URL, and playback goes through the
 *    official Widget (embedded player) — the sanctioned way to play SoundCloud
 *    without API credentials. Search is not possible in this mode.
 */
import { getJSON, qs } from '../lib/http';
import type { Artist, Collection, MusicProvider, Playability, SearchResults, Track } from './types';
import { ProviderError } from './types';
import { artistFromUrl, collectionFromUrl, listFromWidget, normalizeScUrl, podcastStreamFor } from './scWidget';

const isUrlId = (id: string) => id.startsWith('url:');
const urlOf = (id: string) => id.slice(4);

interface SCUser {
  id: number; urn?: string; username: string; full_name?: string; avatar_url?: string; description?: string;
  followers_count?: number; track_count?: number; permalink_url?: string; verified?: boolean;
}
interface SCTrack {
  id: number; urn?: string; title: string; duration: number; genre?: string; tag_list?: string;
  artwork_url?: string | null; user: SCUser; permalink_url: string; created_at?: string; release_date?: string;
  playback_count?: number; favoritings_count?: number; streamable?: boolean; access?: 'playable' | 'preview' | 'blocked';
}
interface SCPlaylist {
  id: number; urn?: string; title: string; description?: string; artwork_url?: string | null; user: SCUser;
  track_count?: number; permalink_url: string; playlist_type?: string; set_type?: string; tracks?: SCTrack[];
  release_date?: string; created_at?: string;
}
type Paged<T> = { collection: T[] } | T[];
const items = <T,>(p: Paged<T>) => (Array.isArray(p) ? p : p.collection ?? []);

let apiReady: Promise<boolean> | null = null;
export function soundcloudApiReady(): Promise<boolean> {
  apiReady ??= getJSON<{ soundcloud: boolean }>('/api/health', { ttl: 60_000 })
    .then((r) => r.soundcloud)
    .catch(() => false);
  return apiReady;
}

const big = (url?: string | null) => (url ? url.replace('-large.', '-t500x500.') : undefined);
const mid = (url?: string | null) => (url ? url.replace('-large.', '-t300x300.') : undefined);
// Keys are strings so URNs ("soundcloud:tracks:123") and numeric ids both work.
const key = (x: { id: number; urn?: string }) => String(x.urn ?? x.id);

function mapTrack(t: SCTrack): Track {
  const access: Playability =
    t.access === 'blocked' ? 'external' : t.access === 'preview' ? 'preview' : t.streamable === false ? 'external' : 'full';
  return {
    id: `soundcloud:${key(t)}`,
    source: 'soundcloud',
    sourceId: key(t),
    title: t.title,
    artist: t.user?.username ?? 'Unknown',
    artistId: t.user ? `soundcloud:${key(t.user)}` : undefined,
    artwork: t.artwork_url ?? t.user?.avatar_url ?? undefined,
    artworkLarge: mid(t.artwork_url ?? t.user?.avatar_url),
    artworkXL: big(t.artwork_url ?? t.user?.avatar_url),
    duration: Math.round((t.duration ?? 0) / 1000),
    genre: t.genre || undefined,
    tags: t.tag_list ? t.tag_list.match(/"[^"]+"|\S+/g)?.map((x) => x.replace(/"/g, '')) : undefined,
    permalink: t.permalink_url,
    playability: access,
    releaseDate: t.release_date ?? t.created_at,
    plays: t.playback_count,
    likes: t.favoritings_count,
  };
}

const mapArtist = (u: SCUser): Artist => ({
  id: `soundcloud:${key(u)}`,
  source: 'soundcloud',
  sourceId: key(u),
  name: u.username,
  handle: u.full_name || undefined,
  avatar: big(u.avatar_url),
  bio: u.description,
  followers: u.followers_count,
  trackCount: u.track_count,
  verified: u.verified,
  permalink: u.permalink_url,
});

const mapCollection = (p: SCPlaylist): Collection => ({
  id: `soundcloud:${key(p)}`,
  source: 'soundcloud',
  sourceId: key(p),
  kind: p.set_type === 'album' || p.playlist_type === 'album' ? 'album' : 'playlist',
  title: p.title,
  owner: p.user?.username ?? '',
  ownerId: p.user ? `soundcloud:${key(p.user)}` : undefined,
  artwork: big(p.artwork_url),
  description: p.description,
  trackCount: p.track_count,
  permalink: p.permalink_url,
  releaseDate: p.release_date ?? p.created_at,
  tracks: p.tracks?.map(mapTrack),
});

const sc = <T,>(path: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal) =>
  getJSON<T>(`/api/sc/${path}${Object.keys(params).length ? `?${qs(params)}` : ''}`, { signal });

const enc = encodeURIComponent;

export const isSoundCloudUrl = (s: string) => /^https?:\/\/(on\.|m\.|www\.)?soundcloud\.com\/\S+/i.test(s.trim());

/** Link mode: build a track card from a public URL via oEmbed (no key needed). */
export async function trackFromSoundCloudUrl(url: string): Promise<Track> {
  url = normalizeScUrl(url);
  if (await soundcloudApiReady()) {
    const r = await sc<SCTrack & { kind?: string }>('resolve', { url });
    if (r.kind && r.kind !== 'track') throw new ProviderError('Ссылка ведёт не на трек — откройте её как плейлист', 'not-found');
    return mapTrack(r);
  }
  const o = await getJSON<{ title: string; author_name: string; author_url: string; thumbnail_url?: string }>(
    `https://soundcloud.com/oembed?${qs({ format: 'json', url })}`,
  );
  // oEmbed titles look like "Track by Artist".
  const suffix = ` by ${o.author_name}`;
  const title = o.title.endsWith(suffix) ? o.title.slice(0, -suffix.length) : o.title;
  return {
    id: `soundcloud:url:${url}`,
    source: 'soundcloud',
    sourceId: `url:${url}`,
    title,
    artist: o.author_name,
    artistId: o.author_url ? `soundcloud:url:${normalizeScUrl(o.author_url)}` : undefined,
    artwork: o.thumbnail_url,
    artworkLarge: mid(o.thumbnail_url),
    artworkXL: big(o.thumbnail_url),
    duration: 0, // learned from the widget once it loads
    permalink: url,
    playability: 'full',
  };
}

export const soundcloud: MusicProvider = {
  id: 'soundcloud',
  name: 'SoundCloud',
  description: 'Приоритетный источник. Поиск — через официальный API (нужны ключи); ссылки работают и без ключей через официальный виджет.',
  async status() {
    return (await soundcloudApiReady())
      ? { ready: true }
      : {
          ready: false,
          message: 'Поиск по названию требует платных ключей API (Artist Pro). Без ключей работают ссылки на артистов, плейлисты и треки — всё играет целиком через официальный плеер.',
        };
  },
  async search(query, signal): Promise<SearchResults> {
    if (!(await soundcloudApiReady())) {
      throw new ProviderError('SoundCloud API не настроен', 'not-configured');
    }
    const [tracks, users, playlists] = await Promise.all([
      sc<Paged<SCTrack>>('search', { q: query, type: 'tracks', limit: 30 }, signal),
      sc<Paged<SCUser>>('search', { q: query, type: 'users', limit: 10 }, signal).catch(() => []),
      sc<Paged<SCPlaylist>>('search', { q: query, type: 'playlists', limit: 12 }, signal).catch(() => []),
    ]);
    return {
      tracks: items(tracks).map(mapTrack),
      artists: items(users).map(mapArtist),
      collections: items(playlists).map(mapCollection),
    };
  },
  async resolveStream(track) {
    // the artist's own podcast feed has the full MP3: play it like any audio stream
    const mp3 = podcastStreamFor(track.permalink);
    if (mp3) return { kind: 'audio', url: mp3, corsSafe: true };
    if (track.sourceId.startsWith('url:') || !(await soundcloudApiReady())) {
      if (!track.permalink) throw new ProviderError('Нет ссылки на трек SoundCloud', 'unavailable');
      return { kind: 'sc-widget', url: track.permalink };
    }
    try {
      const s = await sc<{ url: string; hls: boolean; preview: boolean }>(`tracks/${enc(track.sourceId)}/stream`);
      return { kind: 'audio', url: s.url, hls: s.hls, preview: s.preview, corsSafe: true };
    } catch (e) {
      // Stream not available via API (e.g. quota or rights) → official widget.
      if (track.permalink) return { kind: 'sc-widget', url: track.permalink };
      throw e;
    }
  },
  // `url:` ids come from links pasted by the user and work without API keys
  // through the official widget (see scWidget.ts).
  async getArtist(id) {
    if (isUrlId(id)) return artistFromUrl(urlOf(id));
    return mapArtist(await sc<SCUser>(`users/${enc(id)}`));
  },
  async getArtistTracks(id) {
    if (isUrlId(id)) return listFromWidget(urlOf(id));
    return items(await sc<Paged<SCTrack>>(`users/${enc(id)}/tracks`, { limit: 50 })).map(mapTrack);
  },
  async getArtistCollections(id) {
    if (isUrlId(id)) return []; // the widget can't list a profile's playlists
    return items(await sc<Paged<SCPlaylist>>(`users/${enc(id)}/playlists`, { limit: 30 })).map(mapCollection);
  },
  async getCollection(id) {
    if (isUrlId(id)) return collectionFromUrl(urlOf(id));
    return mapCollection(await sc<SCPlaylist>(`playlists/${enc(id)}`));
  },
  async getTrack(id) {
    return mapTrack(await sc<SCTrack>(`tracks/${enc(id)}`));
  },
  async related(track) {
    // keyless: the rest of the same artist's public tracks
    if (track.sourceId.startsWith('url:') || !(await soundcloudApiReady())) {
      const artistUrl = track.artistId?.startsWith('soundcloud:url:') ? track.artistId.slice('soundcloud:url:'.length) : undefined;
      return artistUrl ? (await listFromWidget(artistUrl).catch(() => [])).filter((t) => t.id !== track.id) : [];
    }
    return items(await sc<Paged<SCTrack>>(`tracks/${enc(track.sourceId)}/related`, { limit: 20 })).map(mapTrack);
  },
};
