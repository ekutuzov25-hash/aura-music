import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { Heart, ListMusic, Maximize2, SkipForward } from 'lucide-react';
import { player } from '../../player/controller';
import { useCurrentTrack, usePlayerState, useProgress } from '../../player/store';
import { useLibrary } from '../../store/library';
import { useUI } from '../../store/ui';
import { cn } from '../../lib/util';
import { Artwork, IconButton, SourceBadge, softSpring } from '../ui/primitives';
import { artistPath } from '../TrackRow';
import { PlayPauseButton, Scrubber, TransportControls, VolumeControl } from './controls';

function ThinProgress() {
  const time = useProgress((s) => s.time);
  const duration = useProgress((s) => s.duration);
  return (
    <div className="absolute inset-x-4 bottom-0 h-[2px] overflow-hidden rounded-full bg-line">
      <div className="h-full bg-fg/80" style={{ width: `${duration ? (time / duration) * 100 : 0}%` }} />
    </div>
  );
}

/**
 * Mobile: a floating glass capsule above the tab bar; swipe up or tap to
 * expand. Desktop: a persistent full-width control bar.
 */
export function MiniPlayer() {
  const t = useCurrentTrack();
  const open = useUI((s) => s.nowPlayingOpen);
  const setOpen = useUI((s) => s.setNowPlaying);
  const queueOpen = useUI((s) => s.queueOpen);
  const setQueue = useUI((s) => s.setQueue);
  const liked = useLibrary((s) => (t ? s.likes.some((l) => l.item.id === t.id) : false));
  const isPreview = usePlayerState((s) => s.isPreview);
  if (!t) return null;

  const like = (e: React.MouseEvent) => {
    e.stopPropagation();
    useLibrary.getState().toggleLike(t);
  };

  return (
    <>
      {/* ── Mobile ── */}
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: open ? 0 : 1 }}
        transition={softSpring}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.25, bottom: 0 }}
        onDragEnd={(_, i) => (i.offset.y < -40 || i.velocity.y < -400) && setOpen(true)}
        onClick={() => setOpen(true)}
        className="glass fixed inset-x-2 bottom-[calc(76px+var(--safe-b))] z-40 flex h-16 cursor-pointer items-center gap-3 rounded-[22px] pr-2 pl-2 md:hidden"
        role="button"
        aria-label={`Открыть плеер: ${t.title}`}
      >
        {!open && (
          <motion.div layoutId="np-artwork" transition={softSpring} className="shrink-0">
            <Artwork src={t.artwork} alt="" seed={t.id} className="size-12" rounded="rounded-[14px]" eager />
          </motion.div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{t.title}</div>
          <div className="flex items-center gap-1.5 truncate text-[13px] text-fg-2">
            <SourceBadge source={t.source} preview={isPreview} />
            <span className="truncate">{t.artist}</span>
          </div>
        </div>
        <IconButton label={liked ? 'Убрать из «Любимых»' : 'Нравится'} active={liked} onClick={like}>
          <Heart className={cn('size-5', liked && 'fill-current')} />
        </IconButton>
        <PlayPauseButton size="md" className="bg-transparent text-fg shadow-none" />
        <IconButton label="Следующий" onClick={(e) => (e.stopPropagation(), void player.next())} className="text-fg">
          <SkipForward className="size-5 fill-current" />
        </IconButton>
        <ThinProgress />
      </motion.div>

      {/* ── Desktop ── */}
      <motion.div
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        transition={softSpring}
        className="glass fixed inset-x-3 bottom-3 z-40 hidden h-[84px] grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] items-center gap-6 rounded-[24px] px-3 md:grid"
      >
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={() => setOpen(true)} className="group relative shrink-0" aria-label="Открыть полноэкранный плеер">
            {!open && (
              <motion.div layoutId="np-artwork-desktop" transition={softSpring}>
                <Artwork src={t.artwork} alt="" seed={t.id} className="size-[60px]" rounded="rounded-[14px]" eager />
              </motion.div>
            )}
            <span className="absolute inset-0 grid place-items-center rounded-[14px] bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              <Maximize2 className="size-5 text-white" />
            </span>
          </button>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">{t.title}</div>
            <div className="flex items-center gap-1.5 text-[13px] text-fg-2">
              <SourceBadge source={t.source} preview={isPreview} />
              {t.artistId ? (
                <Link to={artistPath(t.artistId)} className="truncate hover:text-fg hover:underline">
                  {t.artist}
                </Link>
              ) : (
                <span className="truncate">{t.artist}</span>
              )}
            </div>
          </div>
          <IconButton label={liked ? 'Убрать из «Любимых»' : 'Нравится'} active={liked} onClick={like} size="sm">
            <Heart className={cn('size-[18px]', liked && 'fill-current')} />
          </IconButton>
        </div>
        <div className="flex flex-col items-center">
          <div className="w-full max-w-[300px]">
            <TransportControls />
          </div>
          <Scrubber compact className="mt-1 max-w-[560px]" />
        </div>
        <div className="flex items-center justify-end gap-2">
          <IconButton label="Очередь (Q)" active={queueOpen} onClick={() => setQueue(!queueOpen)} size="sm">
            <ListMusic className="size-[18px]" />
          </IconButton>
          <VolumeControl className="w-36" />
          <IconButton label="Полноэкранный плеер (F)" onClick={() => setOpen(true)} size="sm">
            <Maximize2 className="size-[18px]" />
          </IconButton>
        </div>
      </motion.div>
    </>
  );
}
