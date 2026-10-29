import { AudioLines, FileAudio, ListMusic, Sparkles } from 'lucide-react';
import { FREE_PLAYLIST_LIMIT } from './plans';

/** What Premium unlocks. Listening itself stays free: we never sell access to third-party music. */
export const PREMIUM_FEATURES = [
  { icon: ListMusic, title: 'Безлимитные плейлисты', text: `В бесплатной версии — до ${FREE_PLAYLIST_LIMIT}` },
  { icon: Sparkles, title: 'Daily Mix', text: 'Новые персональные миксы каждый день' },
  { icon: AudioLines, title: 'Визуализатор', text: 'Спектр звука в реальном времени в плеере' },
  { icon: FileAudio, title: 'Своя музыка', text: 'Загрузка и прослушивание своих аудиофайлов' },
];

