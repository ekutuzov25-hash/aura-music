/** What to do with a pasted SoundCloud link: play a track, open an artist or a playlist. */
import type { NavigateFunction } from 'react-router-dom';
import { player } from '../player/controller';
import { toast } from '../store/ui';
import { normalizeScUrl, scLinkKind } from './scWidget';
import { trackFromSoundCloudUrl } from './soundcloud';

const enc = encodeURIComponent;

export async function openSoundCloudLink(raw: string, navigate: NavigateFunction): Promise<void> {
  const url = normalizeScUrl(raw);
  switch (scLinkKind(url)) {
    case 'profile':
      return navigate(`/artist/${enc(`soundcloud:url:${url.split('/').slice(0, 4).join('/')}`)}`);
    case 'playlist':
      return navigate(`/collection/${enc(`soundcloud:url:${url}`)}`);
    case 'likes':
      toast('Лайки SoundCloud встроенный плеер не отдаёт. Вставьте ссылку на ваш плейлист или профиль артиста.', { tone: 'error' });
      return;
    case 'other':
      toast('Эту ссылку SoundCloud открыть нельзя. Подходят ссылки на трек, артиста или плейлист.', { tone: 'error' });
      return;
    default: {
      const t = await trackFromSoundCloudUrl(url);
      await player.playTracks([t], 0, { label: 'SoundCloud' });
    }
  }
}
