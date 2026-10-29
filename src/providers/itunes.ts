/**
 * Apple iTunes Search API — public, keyless, CORS-enabled. Covers mainstream
 * catalog metadata and Apple-licensed 30-second previews. Full tracks are NOT
 * available here; every result is clearly marked "preview" and links to Apple.
 * Docs: https://performance-partners.apple.com/search-api
 */
import { getJSON, qs } from '../lib/http';
import type { Artist, Collection, MusicProvider, SearchResults, Track } from './types';

interface ISong {
  wrapperType: string; kind?: string; trackId?: number; artistId?: number; collectionId?: number;
  trackName?: string; artistName: string; collectionName?: string; artworkUrl100?: string; previewUrl?: string;
  trackTimeMillis?: number; primaryGenreName?: string; trackViewUrl?: string; collectionViewUrl?: string;
  artistLinkUrl?: string; artistViewUrl?: string; releaseDate?: string; trackCount?: number;
}

const art = (u?: string, size = 600) => u?.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`);
const search = (params: Record<string, string | number>, signal?: AbortSignal) =>
  getJSON<{ results: ISong[] }>(`https://itunes.apple.com/search?${qs(params)}`, { signal, persistTtl: 6 * 60 * 60_000 }).then((r) => r.results);
const lookup = (params: Record<string, string | number>) =>
  getJSON<{ results: ISong[] }>(`https://itunes.apple.com/lookup?${qs(params)}`, { persistTtl: 6 * 60 * 60_000 }).then((r) => r.results);

const mapTrack = (s: ISong): Track => ({
  id: `itunes:${s.trackId}`,
  source: 'itunes',
  sourceId: String(s.trackId),
  title: s.trackName ?? '',
  artist: s.artistName,
  artistId: s.artistId ? `itunes:${s.artistId}` : undefined,
  album: s.collectionName,
  albumId: s.collectionId ? `itunes:${s.collectionId}` : undefined,
  artwork: art(s.artworkUrl100, 200),
  artworkLarge: art(s.artworkUrl100, 480),
  artworkXL: art(s.artworkUrl100, 1000),
  // The playable part is the preview; keep full length for display in the card.
  duration: s.previewUrl ? 30 : Math.round((s.trackTimeMillis ?? 0) / 1000),
  genre: s.primaryGenreName,
  permalink: s.trackViewUrl,
  playability: s.previewUrl ? 'preview' : 'external',
  releaseDate: s.releaseDate,
});

const mapAlbum = (s: ISong): Collection => ({
  id: `itunes:${s.collectionId}`,
  source: 'itunes',
  sourceId: String(s.collectionId),
  kind: 'album',
  title: s.collectionName ?? '',
  owner: s.artistName,
  ownerId: s.artistId ? `itunes:${s.artistId}` : undefined,
  artwork: art(s.artworkUrl100, 600),
  trackCount: s.trackCount,
  permalink: s.collectionViewUrl,
  releaseDate: s.releaseDate,
});

// Preview URLs aren't stored on the Track, so remember them per id.
const previews = new Map<string, string>();
const remember = (list: ISong[]) => list.forEach((s) => s.previewUrl && s.trackId && previews.set(String(s.trackId), s.previewUrl));

export const itunes: MusicProvider = {
  id: 'itunes',
  name: 'Apple Previews',
  description: 'Мейнстрим-каталог Apple: метаданные и лицензированные 30-секундные превью.',
  async status() {
    return { ready: true };
  },
  async search(query, signal): Promise<SearchResults> {
    const [songs, albums, artists] = await Promise.all([
      search({ term: query, media: 'music', entity: 'song', limit: 25 }, signal),
      search({ term: query, media: 'music', entity: 'album', limit: 10 }, signal).catch(() => []),
      search({ term: query, media: 'music', entity: 'musicArtist', limit: 5 }, signal).catch(() => []),
    ]);
    remember(songs);
    return {
      tracks: songs.filter((s) => s.wrapperType === 'track').map(mapTrack),
      collections: albums.filter((a) => a.collectionId).map(mapAlbum),
      artists: artists.map(
        (a): Artist => ({
          id: `itunes:${a.artistId}`, source: 'itunes', sourceId: String(a.artistId), name: a.artistName,
          permalink: a.artistLinkUrl ?? a.artistViewUrl,
        }),
      ),
    };
  },
  async resolveStream(track) {
    let url = previews.get(track.sourceId);
    if (!url) {
      const [s] = await lookup({ id: track.sourceId });
      url = s?.previewUrl;
    }
    if (!url) throw new Error('Превью недоступно');
    return { kind: 'audio', url, preview: true, corsSafe: true };
  },
  async getArtist(id) {
    const [a] = await lookup({ id });
    return { id: `itunes:${id}`, source: 'itunes', sourceId: id, name: a?.artistName ?? '', permalink: a?.artistLinkUrl };
  },
  async getArtistTracks(id) {
    const r = await lookup({ id, entity: 'song', limit: 50 });
    remember(r);
    return r.filter((s) => s.wrapperType === 'track').map(mapTrack);
  },
  async getArtistCollections(id) {
    const r = await lookup({ id, entity: 'album', limit: 30 });
    return r.filter((s) => s.wrapperType === 'collection').map(mapAlbum);
  },
  async getCollection(id) {
    const r = await lookup({ id, entity: 'song' });
    remember(r);
    const meta = r.find((s) => s.wrapperType === 'collection');
    if (!meta) throw new Error('Альбом не найден');
    return { ...mapAlbum(meta), tracks: r.filter((s) => s.wrapperType === 'track').map(mapTrack) };
  },
};
