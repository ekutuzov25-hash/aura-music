/**
 * Legal fallback for tracks that can't be played in full here: a SoundCloud
 * track that's Go+-only, embed-disabled or region-locked, or a 30-second
 * Apple preview. We look for the same recording on sources that stream full
 * tracks (Audius; for DJ sets also Mixcloud) and only accept a confident
 * match: same title, uploaded by the artist themselves, similar length, not
 * a remix/cover/live version. The original's title, artist, artwork and link
 * are kept so the user still sees what they picked.
 */
import { audius } from './audius';
import { mixcloud } from './mixcloud';
import type { Track } from './types';

const isLong = (t: Track) => t.duration >= 20 * 60 || /\b(mix|set|live|podcast|radio ?show|b2b)\b/i.test(t.title);

const cache = new Map<string, Track | null>();

/** Lowercase, drop brackets / feat. / prod. parts and punctuation. Works for Cyrillic too. */
export function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(feat|ft|prod|при уч)\.?\b.*$/u, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// different versions of a song: never accept one in place of the original (and vice versa)
const VERSION = /\b(remix|rmx|edit|bootleg|flip|vip|mashup|cover|tribute|karaoke|instrumental|acapella|a cappella|acoustic|piano|guitar|drum|bateria|live|rework|version|sped|slowed|nightcore|8d|reverb|ремикс|кавер|минус)\b/i;

function score(orig: Track, cand: Track): number {
  if (cand.playability !== 'full' || cand.id === orig.id) return 0;
  const ot = norm(orig.title), oa = norm(orig.artist);
  const ct = norm(cand.title), ca = norm(cand.artist);
  if (!ot || !ct) return 0;
  const firstArtist = oa.split(' ').slice(0, 3).join(' ');
  // titles must match exactly, or be an upload named "Artist - Title"
  const titleOk = ct === ot || ct === `${oa} ${ot}` || ct === `${firstArtist} ${ot}`;
  if (!titleOk) return 0;
  // Only the artist's own upload counts: the uploader must share a name with
  // the performer. Re-uploads of someone else's song by third parties are not
  // a legal "full version", so they're never picked.
  const words = (x: string) => new Set(x.split(' ').filter((w) => w.length >= 3));
  const performer = words(oa);
  const uploaderIsArtist = ca === oa || [...words(ca)].some((w) => performer.has(w));
  if (!uploaderIsArtist) return 0;
  // a remix / cover / live take is not the same recording
  if (VERSION.test(cand.title) !== VERSION.test(orig.title)) return 0;
  // length must match when we know the real length (previews only know 30 s)
  if (orig.playability !== 'preview' && orig.duration > 40 && cand.duration > 0 && Math.abs(orig.duration - cand.duration) > 8) return 0;
  return (ct === ot ? 3 : 1) + (ca === oa ? 2 : 1) + Math.min(1, Math.log10((cand.plays ?? 0) + 1) / 6);
}

/** Full-length legal alternative for `t`, or null. Cached per track. */
export async function findFullVersion(t: Track, timeoutMs = 4000): Promise<Track | null> {
  if (t.source === 'audius' || t.source === 'local') return null;
  if (cache.has(t.id)) return cache.get(t.id)!;
  const q = `${t.artist} ${t.title}`;
  const search = Promise.all([
    audius.search(q).then((r) => r.tracks).catch(() => [] as Track[]),
    isLong(t) && t.source !== 'mixcloud' ? mixcloud.search(q).then((r) => r.tracks).catch(() => [] as Track[]) : Promise.resolve([] as Track[]),
  ]).then((lists) => lists.flat());
  const timeout = new Promise<null>((res) => setTimeout(() => res(null), timeoutMs));
  const list = await Promise.race([search, timeout]);
  if (!list) return null; // slow network: don't remember "not found", try again next time
  let best: Track | null = null;
  let bestScore = 0;
  for (const c of list) {
    const s = score(t, c);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  const result = best ? keepOriginal(best, t) : null;
  cache.set(t.id, result);
  return result;
}

/** Plays `alt`, but shows the original's labels, artwork and link. */
function keepOriginal(alt: Track, orig: Track): Track {
  return {
    ...alt,
    title: orig.title,
    artist: orig.artist,
    artwork: orig.artwork ?? alt.artwork,
    artworkLarge: orig.artworkLarge ?? alt.artworkLarge,
    artworkXL: orig.artworkXL ?? orig.artworkLarge ?? alt.artworkXL,
    album: orig.album ?? alt.album,
    origin: { source: orig.source, permalink: orig.permalink, title: orig.title, artist: orig.artist },
  };
}
