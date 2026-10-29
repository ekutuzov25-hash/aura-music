/**
 * The user's own audio files. Files are stored in IndexedDB on this device
 * (never uploaded), metadata lives in the library store.
 */
import { del, get, set } from 'idb-keyval';
import { useLibrary } from '../store/library';
import type { MusicProvider, Track } from './types';

const blobKey = (id: string) => `aura-file:${id}`;
const urls = new Map<string, string>();

function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    a.preload = 'metadata';
    a.src = url;
    a.onloadedmetadata = () => {
      resolve(Number.isFinite(a.duration) ? Math.round(a.duration) : 0);
      URL.revokeObjectURL(url);
    };
    a.onerror = () => {
      resolve(0);
      URL.revokeObjectURL(url);
    };
  });
}

export async function importLocalFiles(files: FileList | File[]): Promise<Track[]> {
  const added: Track[] = [];
  for (const file of Array.from(files)) {
    if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(file.name)) continue;
    const sourceId = crypto.randomUUID();
    const base = file.name.replace(/\.[^.]+$/, '');
    // "Artist - Title.mp3" is the most common naming convention.
    const [artist, title] = base.includes(' - ') ? base.split(/ - (.+)/) : ['Мои файлы', base];
    await set(blobKey(sourceId), file);
    added.push({
      id: `local:${sourceId}`,
      source: 'local',
      sourceId,
      title: title.trim(),
      artist: artist.trim(),
      duration: await readDuration(file),
      playability: 'full',
      releaseDate: new Date().toISOString(),
    });
  }
  useLibrary.getState().addLocalTracks(added);
  return added;
}

export async function removeLocalFile(track: Track) {
  await del(blobKey(track.sourceId));
  const u = urls.get(track.sourceId);
  if (u) URL.revokeObjectURL(u);
  urls.delete(track.sourceId);
  useLibrary.getState().removeLocalTrack(track.id);
}

export const local: MusicProvider = {
  id: 'local',
  name: 'Мои файлы',
  description: 'Ваши аудиофайлы. Хранятся только на этом устройстве.',
  async status() {
    return { ready: true };
  },
  async search(query) {
    const q = query.toLowerCase();
    const tracks = useLibrary
      .getState()
      .localTracks.filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(q));
    return { tracks, artists: [], collections: [] };
  },
  async resolveStream(track) {
    let url = urls.get(track.sourceId);
    if (!url) {
      const blob = await get<Blob>(blobKey(track.sourceId));
      if (!blob) throw new Error('Файл больше не найден на этом устройстве');
      url = URL.createObjectURL(blob);
      urls.set(track.sourceId, url);
    }
    return { kind: 'audio', url, corsSafe: true };
  },
};
