/**
 * Internet Archive — netlabel releases and public-domain recordings.
 * Keyless, CORS-enabled (search, metadata and the MP3 files themselves).
 *
 * Only items that state a licence are used (Creative Commons netlabels,
 * public domain), and items the Archive marks as access-restricted are
 * skipped — in testing those answer 401 instead of audio.
 * Docs: https://archive.org/developers/
 */
import { getJSON, qs } from '../lib/http';
import type { Collection, MusicProvider, SearchResults, Track } from './types';

const SCOPE = '(collection:netlabels OR collection:audio_music OR collection:opensource_audio) AND mediatype:audio AND licenseurl:*';

interface IADoc { identifier: string; title?: string; creator?: string | string[]; licenseurl?: string; date?: string; downloads?: number }
interface IAFile { name: string; format?: string; source?: string; original?: string; title?: string; artist?: string; creator?: string; length?: string; track?: string }
interface IAMeta {
  metadata?: { identifier: string; title?: string; creator?: string | string[]; licenseurl?: string; date?: string; description?: string; 'access-restricted-item'?: string };
  files?: IAFile[];
  is_dark?: boolean;
}

const one = (x?: string | string[]) => (Array.isArray(x) ? x[0] : x) ?? '';
const art = (id: string) => `https://archive.org/services/img/${encodeURIComponent(id)}`;
const details = (id: string) => `https://archive.org/details/${encodeURIComponent(id)}`;
const fileUrl = (id: string, name: string) => `https://archive.org/download/${encodeURIComponent(id)}/${name.split('/').map(encodeURIComponent).join('/')}`;
const seconds = (len?: string) => {
  if (!len) return 0;
  if (/^\d+(\.\d+)?$/.test(len)) return Math.round(Number(len));
  return len.split(':').reduce((acc, p) => acc * 60 + Number(p || 0), 0);
};
const licenseLabel = (u?: string) =>
  !u ? undefined : /publicdomain/.test(u) ? 'Общественное достояние' : /creativecommons\.org\/licenses\/([\w-]+)/.exec(u)?.[1]?.toUpperCase().replace(/^/, 'CC ');

const search = (q: string, rows: number, signal?: AbortSignal) =>
  getJSON<{ response: { docs: IADoc[] } }>(
    `https://archive.org/advancedsearch.php?${qs({ q: `(${q}) AND ${SCOPE}`, rows, output: 'json' })}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl&fl[]=date&fl[]=downloads&sort[]=downloads+desc`,
    { signal, persistTtl: 60 * 60_000 },
  ).then((r) => r.response.docs);

const mapDoc = (d: IADoc): Collection => ({
  id: `archive:${d.identifier}`,
  source: 'archive',
  sourceId: d.identifier,
  kind: 'album',
  title: d.title ?? d.identifier,
  owner: one(d.creator) || 'Internet Archive',
  artwork: art(d.identifier),
  permalink: details(d.identifier),
  releaseDate: d.date,
});

async function itemTracks(id: string): Promise<{ meta: IAMeta['metadata']; tracks: Track[] }> {
  const m = await getJSON<IAMeta>(`https://archive.org/metadata/${encodeURIComponent(id)}`, { persistTtl: 6 * 60 * 60_000 });
  const md = m.metadata;
  if (!md || m.is_dark || md['access-restricted-item'] === 'true') return { meta: md, tracks: [] };
  // One MP3 per recording: prefer the MP3 derivative, fall back to an MP3 original.
  const mp3 = (m.files ?? []).filter((f) => /mp3/i.test(f.format ?? '') || f.name.toLowerCase().endsWith('.mp3'));
  const byOriginal = new Map<string, IAFile>();
  for (const f of mp3) {
    const k = f.source === 'derivative' && f.original ? f.original : f.name;
    if (!byOriginal.has(k) || f.source === 'derivative') byOriginal.set(k, f);
  }
  const files = [...byOriginal.values()].sort((a, b) => (Number(a.track) || 0) - (Number(b.track) || 0) || a.name.localeCompare(b.name));
  const license = licenseLabel(md.licenseurl);
  const tracks = files.map(
    (f): Track => ({
      id: `archive:${id}/${f.name}`,
      source: 'archive',
      sourceId: `${id}/${f.name}`,
      title: f.title || f.name.replace(/^.*\//, '').replace(/\.mp3$/i, '').replace(/[_]+/g, ' '),
      artist: f.artist || f.creator || one(md.creator) || 'Internet Archive',
      album: md.title,
      albumId: `archive:${id}`,
      artwork: art(id),
      artworkLarge: art(id),
      duration: seconds(f.length),
      permalink: details(id),
      playability: 'full',
      releaseDate: md.date,
      license,
    }),
  );
  return { meta: md, tracks };
}

export const archive: MusicProvider = {
  id: 'archive',
  name: 'Internet Archive',
  description: 'Нетлейблы под Creative Commons и записи в общественном достоянии. Полные треки, без ключей.',
  async status() {
    return { ready: true };
  },
  async search(query, signal): Promise<SearchResults> {
    const docs = await search(query, 16, signal);
    // first few releases are opened so their tracks appear in results too
    const opened = await Promise.all(docs.slice(0, 4).map((d) => itemTracks(d.identifier).then((r) => r.tracks.slice(0, 4)).catch(() => [])));
    return { tracks: opened.flat(), artists: [], collections: docs.map(mapDoc) };
  },
  async resolveStream(track) {
    const slash = track.sourceId.indexOf('/');
    return { kind: 'audio', url: fileUrl(track.sourceId.slice(0, slash), track.sourceId.slice(slash + 1)), corsSafe: true };
  },
  async getCollection(id) {
    const { meta, tracks } = await itemTracks(id);
    if (!meta) throw new Error('Релиз не найден');
    return { ...mapDoc({ identifier: id, title: meta.title, creator: meta.creator, date: meta.date }), description: meta.description?.replace(/<[^>]+>/g, ' ').slice(0, 400), trackCount: tracks.length, tracks };
  },
};
