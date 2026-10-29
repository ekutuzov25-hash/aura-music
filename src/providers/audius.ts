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
}
interface APlaylist {
  id: string; playlist_name: string; description?: string; is_album: boolean; artwork?: Sizes;
  user: AUser; track_count?: number; permalink?: string; release_date?: string; tracks?: ATrack[];
}

const api = <T,>(path: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal) =>
  getJSON<{ data: T }>(`${HOST}/v1/${path}?${qs({ ...params, app_name: APP })}`, { signal }).then((r) => r.data);

const pic = (s: Sizes, size: string) => (s ? s[size] ?? Object.values(s).find((v) => typeof v === 'string') : undefined);
const web = (path?: string) => (path ? `https://audius.co${path}` : undefined);

export function mapTrack(t: ATrack): Track {
  const gated = t.is_stream_gated || t.access?.stream === false;
  return {
    id: `audius:${t.id}`,
    source: 'audius',
    sourceId: t.id,
    title: t.title,
    artist: t.user?.name ?? 'Unknown',
    artistId: t.user ? `audius:${t.user.id}` : undefined,
    artwork: pic(t.artwork, '150x150'),
    artworkLarge: pic(t.artwork, '1000x1000') ?? pic(t.artwork, '480x480'),
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
    // Audius redirects /stream to a signed content-node URL with CORS enabled,
    // so the analyser/visualizer can read the audio.
    return { kind: 'audio', url: `${HOST}/v1/tracks/${track.sourceId}/stream?${qs({ app_name: APP })}`, corsSafe: true };
  },
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
