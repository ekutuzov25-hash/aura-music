import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { Pause, Play, Shuffle } from 'lucide-react';
import type { Track } from '../providers/types';
import { player } from '../player/controller';
import { usePlayerState, type PlayContext } from '../player/store';
import { cn, plural, totalDuration } from '../lib/util';
import { Artwork, Button, softSpring } from './ui/primitives';

const playable = (ts: Track[]) => ts.filter((t) => t.playability === 'full' || t.playability === 'preview');

/** Big header used by playlist, album, mix and "liked" pages. */
export function CollectionHeader({
  kind,
  title,
  subtitle,
  description,
  artwork,
  artworkNode,
  seed,
  tracks,
  context,
  actions,
}: {
  kind: string;
  title: string;
  subtitle?: ReactNode;
  description?: string;
  artwork?: string;
  artworkNode?: ReactNode;
  seed: string;
  tracks: Track[];
  context: PlayContext;
  actions?: ReactNode;
}) {
  const sameContext = usePlayerState((s) => s.context?.path === context.path && s.index >= 0);
  const playing = usePlayerState((s) => s.status === 'playing' || s.status === 'loading');
  const total = tracks.reduce((s, t) => s + (t.duration || 0), 0);
  const list = playable(tracks);

  return (
    <header className="relative px-4 pt-6 md:px-8 md:pt-10">
      <div className="flex flex-col items-center gap-6 md:flex-row md:items-end">
        <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={softSpring} className="w-[min(64vw,240px)] shrink-0">
          {artworkNode ?? <Artwork src={artwork} alt="" seed={seed} className="aspect-square w-full" rounded="rounded-[24px]" eager />}
        </motion.div>
        <div className="min-w-0 flex-1 text-center md:text-left">
          <div className="text-xs font-bold tracking-[0.14em] text-fg-2 uppercase">{kind}</div>
          <h1 className="text-balance mt-1 text-3xl font-semibold tracking-tight break-words md:text-4xl">{title}</h1>
          {description && <p className="mt-2 line-clamp-2 text-[15px] text-fg-2">{description}</p>}
          <div className="mt-2 text-sm text-fg-2">
            {subtitle}
            {subtitle ? ' · ' : ''}
            {tracks.length} {plural(tracks.length, 'трек', 'трека', 'треков')}
            {total > 0 && ` · ${totalDuration(total)}`}
          </div>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2 md:justify-start">
        <Button
          disabled={!list.length}
          onClick={() => (sameContext ? player.toggle() : void player.playTracks(list, 0, context, { shuffle: false }))}
          className={cn('min-w-[132px]')}
        >
          {sameContext && playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
          {sameContext && playing ? 'Пауза' : 'Слушать'}
        </Button>
        <Button variant="secondary" disabled={!list.length} onClick={() => void player.playTracks(list, 0, context, { shuffle: true })}>
          <Shuffle className="size-4" /> Перемешать
        </Button>
        {actions}
      </div>
    </header>
  );
}
