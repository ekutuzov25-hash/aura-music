/**
 * Keyless SoundCloud catalogue via the official embedded player.
 *
 * Loading a profile or playlist URL into a (hidden) SoundCloud Widget and
 * calling getSounds() returns the same public track list the embed shows —
 * titles, artwork, durations, permalinks — and every track then plays in full
 * through the official widget. No API key, no scraping.
 *
 * Limits we respect: the widget can't search and can't list a user's likes
 * (a /likes URL falls back to the profile's own tracks), so those cases are
 * reported honestly instead of guessed.
 */
import { getJSON, qs } from '../lib/http';
import type { Artist, Collection, Track } from './types';
import { ProviderError } from './types';

interface WSound {
  id: number;
  title?: string;
  duration?: number;
  artwork_url?: string | null;
  permalink_url?: string;
  genre?: string;
  tag_list?: string;
  policy?: 'ALLOW' | 'MONETIZE' | 'SNIP' | 'BLOCK';
  playback_count?: number;
  likes_count?: number;
  created_at?: string;
  user?: { id?: number; username?: string; avatar_url?: string; permalink_url?: string };
}
interface WidgetApi {
  bind(ev: string, cb: () => void): void;
  getSounds(cb: (s: WSound[]) => void): void;
}
interface SCGlobal {
  Widget: ((el: HTMLIFrameElement) => WidgetApi) & { Events: Record<string, string> };
}

let api: Promise<SCGlobal> | null = null;
function loadApi(): Promise<SCGlobal> {
  api ??= new Promise((resolve, reject) => {
    const w = window as unknown as { SC?: SCGlobal };
    if (w.SC) return resolve(w.SC);
    const s = document.createElement('script');
    s.src = 'https://w.soundcloud.com/player/api.js';
    s.onload = () => (w.SC ? resolve(w.SC) : reject(new Error('SoundCloud недоступен')));
    s.onerror = () => {
      api = null;
      reject(new ProviderError('Не удалось связаться с SoundCloud', 'network'));
    };
    document.head.appendChild(s);
  });
  return api;
}

const big = (u?: string | null) => (u ? u.replace('-large.', '-t500x500.') : undefined);
const mid = (u?: string | null) => (u ? u.replace('-large.', '-t300x300.') : undefined);

export const normalizeScUrl = (url: string) =>
  url
    .trim()
    .replace(/^http:/, 'https:')
    .replace('://m.soundcloud.com', '://soundcloud.com')
    .replace('://www.soundcloud.com', '://soundcloud.com')
    .split(/[?#]/)[0]
    .replace(/\/$/, '');

export type ScLinkKind = 'track' | 'playlist' | 'profile' | 'likes' | 'short' | 'other';
export function scLinkKind(url: string): ScLinkKind {
  const u = normalizeScUrl(url);
  if (/^https:\/\/on\.soundcloud\.com\//.test(u)) return 'short';
  const path = u.replace(/^https:\/\/soundcloud\.com\/?/, '').split('/').filter(Boolean);
  if (!path.length) return 'other';
  if (path.length === 1) return 'profile';
  if (path[1] === 'sets' && path[2]) return 'playlist';
  if (path[1] === 'likes') return 'likes';
  if (['tracks', 'albums', 'popular-tracks', 'reposts'].includes(path[1])) return 'profile';
  if (path.length === 2) return 'track';
  // private share links: /artist/track/s-AbCdE (the secret token is part of the path)
  if (path.length === 3 && /^s-[\w-]+$/.test(path[2])) return 'track';
  return 'other';
}

export function mapWidgetSound(s: WSound): Track | null {
  if (!s.title || !s.permalink_url) return null;
  const permalink = normalizeScUrl(s.permalink_url);
  const userUrl = s.user?.permalink_url ? normalizeScUrl(s.user.permalink_url) : undefined;
  return {
    id: `soundcloud:url:${permalink}`,
    source: 'soundcloud',
    sourceId: `url:${permalink}`,
    title: s.title,
    artist: s.user?.username ?? 'SoundCloud',
    artistId: userUrl ? `soundcloud:url:${userUrl}` : undefined,
    artwork: s.artwork_url ?? s.user?.avatar_url ?? undefined,
    artworkLarge: mid(s.artwork_url ?? s.user?.avatar_url),
    artworkXL: big(s.artwork_url ?? s.user?.avatar_url),
    duration: Math.round((s.duration ?? 0) / 1000),
    genre: s.genre || undefined,
    tags: s.tag_list ? s.tag_list.match(/"[^"]+"|\S+/g)?.map((x) => x.replace(/"/g, '')) : undefined,
    permalink,
    // SNIP = only a 30 s preview is licensed (SoundCloud Go+), BLOCK = not playable in embeds
    playability: s.policy === 'BLOCK' ? 'external' : s.policy === 'SNIP' ? 'preview' : 'full',
    plays: s.playback_count,
    likes: s.likes_count,
    releaseDate: s.created_at,
  };
}

const listCache = new Map<string, { at: number; tracks: Track[] }>();

/** Public track list of a SoundCloud profile or playlist, via the official widget. */
export async function listFromWidget(url: string): Promise<Track[]> {
  const key = normalizeScUrl(url);
  const hit = listCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.tracks;
  const SC = await loadApi();

  let userId: number | undefined;
  let tracks = await new Promise<Track[]>((resolve, reject) => {
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    f.allow = 'autoplay';
    f.style.cssText = 'position:fixed;left:-9999px;top:0;width:400px;height:400px;opacity:0;pointer-events:none;border:0';
    f.src = `https://w.soundcloud.com/player/?${qs({ url: key, auto_play: 'false', visual: 'false' })}`;
    document.body.appendChild(f);
    const done = (fn: () => void) => {
      clearTimeout(timer);
      fn();
      f.remove();
    };
    const timer = setTimeout(() => done(() => reject(new ProviderError('SoundCloud не ответил — проверьте ссылку', 'network'))), 20_000);
    const w = SC.Widget(f);
    w.bind(SC.Widget.Events.READY, () => {
      // The widget fills track details progressively; poll until stable.
      let last = -1;
      let tries = 0;
      const poll = () =>
        w.getSounds((sounds) => {
          const ready = sounds.filter((s) => s.title).length;
          if ((ready === sounds.length && ready === last) || tries++ > 12) {
            userId = sounds.find((x) => x.user?.id)?.user?.id;
            return done(() => resolve(sounds.map(mapWidgetSound).filter((t): t is Track => !!t)));
          }
          last = ready;
          setTimeout(poll, 700);
        });
      setTimeout(poll, 800);
    });
  });
  // profile pages: add the artist's podcast feed (often every DJ set, as full MP3s)
  if (userId && scLinkKind(key) === 'profile') tracks = await withPodcast(userId, tracks);
  listCache.set(key, { at: Date.now(), tracks });
  return tracks;
}

interface OEmbed {
  title: string;
  author_name: string;
  author_url: string;
  thumbnail_url?: string;
  description?: string;
}
const oembed = (url: string) => getJSON<OEmbed>(`https://soundcloud.com/oembed?${qs({ format: 'json', url: normalizeScUrl(url) })}`, { persistTtl: 24 * 60 * 60_000 });

/** Artist page data for a profile URL (name and avatar from oEmbed, tracks from the widget). */
export async function artistFromUrl(url: string): Promise<Artist> {
  const u = normalizeScUrl(url);
  const o = await oembed(u);
  return {
    id: `soundcloud:url:${u}`,
    source: 'soundcloud',
    sourceId: `url:${u}`,
    name: o.author_name || o.title,
    avatar: big(o.thumbnail_url),
    bio: o.description,
    permalink: u,
  };
}

/** Playlist / album page for a /sets/ URL. */
export async function collectionFromUrl(url: string): Promise<Collection> {
  const u = normalizeScUrl(url);
  const [o, tracks] = await Promise.all([oembed(u), listFromWidget(u)]);
  const suffix = ` by ${o.author_name}`;
  const title = o.title.endsWith(suffix) ? o.title.slice(0, -suffix.length) : o.title;
  return {
    id: `soundcloud:url:${u}`,
    source: 'soundcloud',
    sourceId: `url:${u}`,
    kind: 'playlist',
    title,
    owner: o.author_name,
    ownerId: o.author_url ? `soundcloud:url:${normalizeScUrl(o.author_url)}` : undefined,
    artwork: big(o.thumbnail_url) ?? tracks[0]?.artworkLarge,
    description: o.description,
    trackCount: tracks.length,
    tracks,
    permalink: u,
  };
}

// ───────────── SoundCloud podcast feeds (via our server, see server/scfeed.ts) ─────────────
interface FeedItem { title: string; link: string; mp3: string; duration: number; published?: string; image?: string }
const podcastStreams = new Map<string, string>(); // permalink → MP3

/** Full MP3 for a SoundCloud track, if its author publishes it in their podcast feed. */
export const podcastStreamFor = (permalink?: string) => (permalink ? podcastStreams.get(normalizeScUrl(permalink)) : undefined);

async function withPodcast(userId: number, tracks: Track[]): Promise<Track[]> {
  let feed: { author: string; items: FeedItem[] };
  try {
    feed = await getJSON(`/api/sc-feed?user=${userId}`, { ttl: 15 * 60_000 });
  } catch {
    return tracks; // no server (static hosting) or feed unavailable
  }
  const known = new Set(tracks.map((t) => t.permalink));
  const extra: Track[] = [];
  for (const it of feed.items) {
    const permalink = normalizeScUrl(it.link);
    podcastStreams.set(permalink, it.mp3);
    if (known.has(permalink)) continue;
    extra.push({
      id: `soundcloud:url:${permalink}`,
      source: 'soundcloud',
      sourceId: `url:${permalink}`,
      title: it.title,
      artist: feed.author || tracks[0]?.artist || 'SoundCloud',
      artistId: tracks[0]?.artistId,
      artwork: it.image,
      artworkLarge: it.image,
      duration: it.duration,
      permalink,
      playability: 'full',
      releaseDate: it.published ? new Date(it.published).toISOString() : undefined,
    });
  }
  return [...tracks, ...extra];
}

export const soundcloudSearchUrl = (q: string) => `https://soundcloud.com/search?q=${encodeURIComponent(q)}`;
