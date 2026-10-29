/**
 * Mixcloud — the largest home of DJ mixes, radio shows and live sets.
 * Its public API (api.mixcloud.com) needs no key and sends CORS headers;
 * playback goes through Mixcloud's official embedded player (Widget API),
 * which handles the music licensing. Docs: https://www.mixcloud.com/developers/
 */
import { getJSON, qs } from '../lib/http';
import type { Artist, MusicProvider, SearchResults, Track } from './types';

const API = 'https://api.mixcloud.com';

interface MPics { [size: string]: string | undefined }
interface MUser { key: string; url: string; name: string; username: string; pictures?: MPics; follower_count?: number; cloudcast_count?: number; biog?: string }
interface MCast {
  key: string; url: string; name: string; tags?: Array<{ name: string }>; created_time?: string; play_count?: number;
  favorite_count?: number; audio_length?: number; pictures?: MPics; user: MUser;
}

const api = <T,>(path: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal) =>
  getJSON<T>(`${API}${path}${Object.keys(params).length ? `?${qs(params)}` : ''}`, { signal, persistTtl: 30 * 60_000 });

const pic = (p: MPics | undefined, ...sizes: string[]) => sizes.map((s) => p?.[s]).find(Boolean);

export const mapCast = (c: MCast): Track => ({
  id: `mixcloud:${c.key}`,
  source: 'mixcloud',
  sourceId: c.key,
  title: c.name,
  artist: c.user?.name ?? c.user?.username ?? 'Mixcloud',
  artistId: c.user ? `mixcloud:${c.user.key}` : undefined,
  artwork: pic(c.pictures, 'medium', 'thumbnail', 'small'),
  artworkLarge: pic(c.pictures, '320wx320h', 'large', 'medium'),
  artworkXL: pic(c.pictures, '1024wx1024h', '768wx768h', 'extra_large', '640wx640h'),
  duration: c.audio_length ?? 0,
  genre: c.tags?.[0]?.name,
  tags: c.tags?.map((t) => t.name),
  permalink: c.url,
  playability: 'full',
  releaseDate: c.created_time,
  plays: c.play_count,
  likes: c.favorite_count,
});

const mapUser = (u: MUser): Artist => ({
  id: `mixcloud:${u.key}`,
  source: 'mixcloud',
  sourceId: u.key,
  name: u.name || u.username,
  handle: u.username,
  avatar: pic(u.pictures, '320wx320h', 'large', 'medium'),
  bio: u.biog,
  followers: u.follower_count,
  trackCount: u.cloudcast_count,
  permalink: u.url,
});

/** "Drum & Bass" → "drum-and-bass", "Hip-Hop/Rap" → "hip-hop" (Mixcloud tag slugs). */
const tagSlug = (g: string) =>
  g.toLowerCase().split('/')[0].replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const mixcloud: MusicProvider = {
  id: 'mixcloud',
  name: 'Mixcloud',
  description: 'DJ-сеты, миксы и радиошоу. Поиск через открытый API, воспроизведение через официальный плеер Mixcloud.',
  async status() {
    return { ready: true };
  },
  async search(query, signal): Promise<SearchResults> {
    const [casts, users] = await Promise.all([
      api<{ data: MCast[] }>('/search/', { q: query, type: 'cloudcast', limit: 20 }, signal),
      api<{ data: MUser[] }>('/search/', { q: query, type: 'user', limit: 8 }, signal).catch(() => ({ data: [] })),
    ]);
    return { tracks: casts.data.map(mapCast), artists: users.data.map(mapUser), collections: [] };
  },
  async resolveStream(track) {
    return { kind: 'mixcloud-widget', url: track.sourceId };
  },
  async trending(opts = {}) {
    const tag = opts.genre ? tagSlug(opts.genre) : 'electronic';
    return (await api<{ data: MCast[] }>(`/discover/${tag}/popular/`, { limit: 20 })).data.map(mapCast);
  },
  async getArtist(key) {
    return mapUser(await api<MUser>(key));
  },
  async getArtistTracks(key) {
    return (await api<{ data: MCast[] }>(`${key}cloudcasts/`, { limit: 50 })).data.map(mapCast);
  },
  async getTrack(key) {
    return mapCast(await api<MCast>(key));
  },
  async related(track) {
    return track.genre ? (await this.trending!({ genre: track.genre })).filter((t) => t.id !== track.id) : [];
  },
};
