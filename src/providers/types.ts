/**
 * The common contract every music source implements. Screens and the player
 * only talk to this interface, so adding a new source (Jamendo, Bandcamp,
 * a self-hosted library…) means writing one new provider file.
 */

export type SourceId = 'audius' | 'soundcloud' | 'itunes' | 'local';

/**
 * full        — whole track streams legally through the source
 * preview     — only a short preview is licensed for playback (e.g. 30 s)
 * external    — not streamable here; open on the original platform
 * unavailable — removed / blocked; we keep metadata so playlists don't break
 */
export type Playability = 'full' | 'preview' | 'external' | 'unavailable';

export interface Track {
  /** Globally unique: `${source}:${sourceId}` */
  id: string;
  source: SourceId;
  sourceId: string;
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  artwork?: string;
  artworkLarge?: string;
  /** seconds */
  duration: number;
  genre?: string;
  tags?: string[];
  permalink?: string;
  playability: Playability;
  releaseDate?: string;
  plays?: number;
  likes?: number;
  /** source-provided mood tag, e.g. "Energizing" (Audius) */
  mood?: string;
  bpm?: number;
}

export interface Artist {
  id: string;
  source: SourceId;
  sourceId: string;
  name: string;
  handle?: string;
  avatar?: string;
  cover?: string;
  bio?: string;
  followers?: number;
  trackCount?: number;
  verified?: boolean;
  permalink?: string;
}

export interface Collection {
  id: string;
  source: SourceId;
  sourceId: string;
  kind: 'playlist' | 'album';
  title: string;
  owner: string;
  ownerId?: string;
  artwork?: string;
  description?: string;
  trackCount?: number;
  tracks?: Track[];
  permalink?: string;
  releaseDate?: string;
}

export interface SearchResults {
  tracks: Track[];
  artists: Artist[];
  collections: Collection[];
}

export type StreamInfo =
  | { kind: 'audio'; url: string; hls?: boolean; preview?: boolean; corsSafe: boolean }
  | { kind: 'sc-widget'; url: string };

export interface ProviderStatus {
  ready: boolean;
  /** Human readable reason when not ready (e.g. missing API key). */
  message?: string;
}

export interface MusicProvider {
  id: SourceId;
  name: string;
  /** Short note shown in the UI about what this source can and can't do. */
  description: string;
  status(): Promise<ProviderStatus>;
  search(query: string, signal?: AbortSignal): Promise<SearchResults>;
  resolveStream(track: Track): Promise<StreamInfo>;

  trending?(opts?: { genre?: string; time?: 'week' | 'month' | 'allTime' }): Promise<Track[]>;
  underground?(): Promise<Track[]>;
  trendingCollections?(): Promise<Collection[]>;
  getArtist?(sourceId: string): Promise<Artist>;
  getArtistTracks?(sourceId: string): Promise<Track[]>;
  getArtistCollections?(sourceId: string): Promise<Collection[]>;
  getCollection?(sourceId: string): Promise<Collection>;
  getTrack?(sourceId: string): Promise<Track>;
  related?(track: Track): Promise<Track[]>;
}

export const emptyResults = (): SearchResults => ({ tracks: [], artists: [], collections: [] });

export class ProviderError extends Error {
  constructor(
    message: string,
    public code: 'network' | 'rate-limit' | 'not-configured' | 'not-found' | 'unavailable' | 'unknown' = 'unknown',
  ) {
    super(message);
  }
}
