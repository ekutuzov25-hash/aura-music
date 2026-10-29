import { motion } from 'motion/react';
import { memo, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import type { Artist, Collection, Track } from '../providers/types';
import { player } from '../player/controller';
import { warmTrack } from '../providers/registry';
import { usePlayerState, type PlayContext } from '../player/store';
import { cn, formatCount } from '../lib/util';
import { Artwork, IconButton, Pressable, Skeleton, SourceBadge, spring } from './ui/primitives';
import { artistPath, collectionPath, TRACK_DRAG_TYPE, useTrackMenu } from './TrackRow';

const cardIn = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { ...spring, delay: Math.min(i, 8) * 0.035 } }),
};

/** Horizontal, snap-scrolling shelf with arrow buttons on desktop. */
export function Shelf({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <div className={cn('group/shelf relative', className)}>
      <div ref={ref} className="no-scrollbar snap-x-mandatory flex gap-4 overflow-x-auto scroll-px-4 px-4 pb-2 md:scroll-px-8 md:px-8">
        {children}
      </div>
      <IconButton
        label="Прокрутить назад"
        onClick={() => scroll(-1)}
        className="glass absolute top-[38%] left-2 hidden -translate-y-1/2 opacity-0 transition-opacity group-hover/shelf:opacity-100 md:grid"
      >
        <ChevronLeft className="size-5" />
      </IconButton>
      <IconButton
        label="Прокрутить вперёд"
        onClick={() => scroll(1)}
        className="glass absolute top-[38%] right-2 hidden -translate-y-1/2 opacity-0 transition-opacity group-hover/shelf:opacity-100 md:grid"
      >
        <ChevronRight className="size-5" />
      </IconButton>
    </div>
  );
}

export function ShelfSkeleton({ round }: { round?: boolean }) {
  return (
    <div className="flex gap-4 overflow-hidden px-4 md:px-8" aria-label="Загрузка">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="w-[148px] shrink-0 md:w-[176px]">
          <Skeleton className={cn('aspect-square w-full', round ? 'rounded-full' : 'rounded-2xl')} />
          <Skeleton className="mt-3 h-3.5 w-4/5" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function PlayFab({ onClick, playing, label }: { onClick: (e: React.MouseEvent) => void; playing: boolean; label: string }) {
  return (
    <Pressable
      label={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(e);
      }}
      className={cn(
        'glass absolute right-2 bottom-2 grid size-11 place-items-center rounded-full text-fg transition-all duration-300',
        playing ? 'opacity-100' : 'translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:hidden',
      )}
    >
      {playing ? <Pause className="size-5 fill-current" /> : <Play className="ml-0.5 size-5 fill-current" />}
    </Pressable>
  );
}

export const TrackCard = memo(function TrackCard({
  track: t,
  list,
  index,
  context,
  subtitle,
}: {
  track: Track;
  list: Track[];
  index: number;
  context?: PlayContext;
  subtitle?: string;
}) {
  // Only the card of the playing track re-renders on play/pause.
  const isCurrent = usePlayerState((s) => s.queue[s.index]?.id === t.id);
  const playing = usePlayerState((s) => s.queue[s.index]?.id === t.id && (s.status === 'playing' || s.status === 'loading'));
  const menu = useTrackMenu();
  const play = () => {
    if (isCurrent) return player.toggle();
    const playable = list.filter((x) => x.playability === 'full' || x.playability === 'preview');
    const i = playable.findIndex((x) => x.id === t.id);
    if (i < 0) {
      if (t.permalink) window.open(t.permalink, '_blank', 'noopener');
      return;
    }
    void player.playTracks(playable, i, context);
  };
  return (
    <motion.div
      variants={cardIn}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '80px' }}
      custom={index}
      className="group w-[148px] shrink-0 snap-start md:w-[176px]"
      onContextMenu={(e) => menu.open(e, t)}
      onPointerEnter={() => warmTrack(t)}
      onPointerDown={() => warmTrack(t)}
      draggable
      onDragStart={(e) => (e as unknown as DragEvent).dataTransfer?.setData(TRACK_DRAG_TYPE, JSON.stringify([t]))}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={play}
        onKeyDown={(e) => e.key === 'Enter' && play()}
        className="block w-full cursor-pointer text-left"
        aria-label={`Играть ${t.title} — ${t.artist}`}
      >
        <div className="relative">
          <motion.div whileHover={{ scale: 1.025 }} transition={spring}>
            <Artwork src={t.artworkLarge ?? t.artwork} alt="" seed={t.id} className="aspect-square w-full shadow-lg" rounded="rounded-2xl" />
          </motion.div>
          <PlayFab onClick={play} playing={isCurrent && playing} label={isCurrent && playing ? 'Пауза' : 'Играть'} />
        </div>
        <div className={cn('mt-2.5 truncate text-[14px] font-semibold', isCurrent && 'text-dyn')}>{t.title}</div>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-fg-2">
        <SourceBadge source={t.source} preview={t.playability === 'preview'} />
        {t.artistId ? (
          <Link to={artistPath(t.artistId)} className="truncate hover:text-fg hover:underline">
            {t.artist}
          </Link>
        ) : (
          <span className="truncate">{t.artist}</span>
        )}
      </div>
      {subtitle && <div className="mt-0.5 truncate text-xs text-fg-3">{subtitle}</div>}
      {menu.element}
    </motion.div>
  );
});

export const CollectionCard = memo(function CollectionCard({ c, index, to }: { c: Pick<Collection, 'id' | 'title' | 'owner' | 'artwork' | 'source' | 'kind' | 'trackCount'>; index: number; to?: string }) {
  return (
    <motion.div variants={cardIn} initial="hidden" whileInView="show" viewport={{ once: true, margin: '80px' }} custom={index} className="group w-[148px] shrink-0 snap-start md:w-[176px]">
      <Link to={to ?? collectionPath(c.id)} className="block">
        <motion.div whileHover={{ scale: 1.025 }} transition={spring}>
          <Artwork src={c.artwork} alt="" seed={c.id} className="aspect-square w-full shadow-lg" rounded="rounded-2xl" />
        </motion.div>
        <div className="mt-2.5 truncate text-[14px] font-semibold">{c.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-fg-2">
          {c.source !== 'local' && <SourceBadge source={c.source} />}
          <span className="truncate">
            {c.kind === 'album' ? 'Альбом' : 'Плейлист'} · {c.owner}
          </span>
        </div>
      </Link>
    </motion.div>
  );
});

export const ArtistCard = memo(function ArtistCard({ a, index }: { a: Artist; index: number }) {
  return (
    <motion.div variants={cardIn} initial="hidden" whileInView="show" viewport={{ once: true, margin: '80px' }} custom={index} className="w-[130px] shrink-0 snap-start text-center md:w-[156px]">
      <Link to={artistPath(a.id)} className="block">
        <motion.div whileHover={{ scale: 1.03 }} transition={spring}>
          <Artwork src={a.avatar} alt="" seed={a.id} className="aspect-square w-full shadow-lg" rounded="rounded-full" />
        </motion.div>
        <div className="mt-2.5 flex items-center justify-center gap-1 truncate text-[14px] font-semibold">
          <span className="truncate">{a.name}</span>
          {a.verified && <BadgeCheck className="size-4 shrink-0 text-sky-400" aria-label="Подтверждён" />}
        </div>
        <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[12px] text-fg-2">
          <SourceBadge source={a.source} />
          {a.followers != null && <span>{formatCount(a.followers)}</span>}
        </div>
      </Link>
    </motion.div>
  );
});
