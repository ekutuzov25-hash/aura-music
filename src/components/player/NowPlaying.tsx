import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ExternalLink, Heart, Info, ListMusic, MoreHorizontal, Radio, ThumbsDown } from 'lucide-react';
import { dislikeCurrent, startTrackAura } from '../../recommend/aura';
import { soundcloudSearchUrl } from '../../providers/scWidget';
import { SOURCE_META } from '../../providers/registry';
import { useCurrentTrack, usePlayerState } from '../../player/store';
import { useLibrary } from '../../store/library';
import { useUI } from '../../store/ui';
import { cn } from '../../lib/util';
import { Artwork, IconButton, SourceBadge, softSpring } from '../ui/primitives';
import { useFocusTrap } from '../ui/overlays';
import { artistPath, useTrackMenu } from '../TrackRow';
import { Scrubber, TransportControls, VolumeControl } from './controls';
import { Visualizer } from './Visualizer';

export function NowPlaying() {
  const open = useUI((s) => s.nowPlayingOpen);
  const setOpen = useUI((s) => s.setNowPlaying);
  const setQueue = useUI((s) => s.setQueue);
  const t = useCurrentTrack();
  const status = usePlayerState((s) => s.status);
  const error = usePlayerState((s) => s.error);
  const mode = usePlayerState((s) => s.mode);
  const isPreview = usePlayerState((s) => s.isPreview);
  const context = usePlayerState((s) => s.context);
  const liked = useLibrary((s) => (t ? s.likes.some((l) => l.item.id === t.id) : false));
  const navigate = useNavigate();
  const menu = useTrackMenu();
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  // Swipe-down-to-close starts only from the header/artwork so it never fights the scrubber or volume slider.
  const drag = useDragControls();
  const startDrag = (e: React.PointerEvent) => !reduce && drag.start(e);
  useFocusTrap(open, ref, () => setOpen(false));

  // lets the SoundCloud widget dock show itself (see .sc-dock)
  useEffect(() => {
    document.body.classList.toggle('np-open', open);
  }, [open]);

  useEffect(() => {
    if (!t) setOpen(false);
  }, [t, setOpen]);

  const playing = status === 'playing';
  const widget = mode === 'sc-widget';

  return (
    <AnimatePresence>
      {open && t && (
        <motion.div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label="Сейчас играет"
          className="fixed inset-0 z-[60] overflow-hidden bg-bg"
          initial={reduce ? { opacity: 0 } : { y: '100%', borderRadius: 40 }}
          animate={reduce ? { opacity: 1 } : { y: 0, borderRadius: 0 }}
          exit={reduce ? { opacity: 0 } : { y: '100%', borderRadius: 40 }}
          transition={softSpring}
          drag={reduce ? false : 'y'}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.7 }}
          dragListener={false}
          dragControls={drag}
          onDragEnd={(_, i) => (i.offset.y > 140 || i.velocity.y > 700) && setOpen(false)}
        >
          {/* Ambient background: blurred cover + accent glow */}
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            {t.artworkLarge && (
              <img src={t.artworkLarge} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-50 blur-[80px] saturate-150 [.lite_&]:hidden" />
            )}
            <div className="absolute inset-0 bg-[radial-gradient(90%_60%_at_50%_0%,rgb(var(--dyn)/0.55),transparent_70%)] transition-colors duration-1000" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-bg/40 to-bg" />
          </div>

          <div className="relative mx-auto flex h-full max-w-6xl flex-col px-6 pt-[calc(12px+var(--safe-t))] pb-[calc(16px+var(--safe-b))] md:px-10">
            <header className="flex touch-none items-center justify-between" onPointerDown={startDrag}>
              <IconButton label="Свернуть (Esc)" onClick={() => setOpen(false)} className="text-fg" data-autofocus>
                <ChevronDown className="size-7" />
              </IconButton>
              <button
                className="min-w-0 px-3 text-center"
                onClick={() => {
                  if (context?.path) {
                    setOpen(false);
                    navigate(context.path);
                  }
                }}
              >
                <div className="text-[11px] font-semibold tracking-[0.14em] text-fg-2 uppercase">Играет из</div>
                <div className="truncate text-sm font-semibold">{context?.label ?? 'Очередь'}</div>
              </button>
              <IconButton label="Ещё" onClick={(e) => menu.open(e, t)} className="text-fg">
                <MoreHorizontal className="size-6" />
              </IconButton>
            </header>

            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 py-6 md:flex-row md:gap-16">
              {/* Shared-layout artwork (morphs from the mini player); the inner layer
                  "breathes" — kept separate so scale doesn't fight the layout animation. */}
              <motion.div
                layoutId="np-artwork"
                transition={softSpring}
                onPointerDown={startDrag}
                className="aspect-square w-full max-w-[min(78vw,46vh)] shrink-0 touch-none md:max-w-[min(440px,55vh)]"
              >
                <motion.div className="size-full" animate={{ scale: playing || reduce ? 1 : 0.88 }} transition={softSpring}>
                  <Artwork
                    src={t.artworkLarge ?? t.artwork}
                    alt={`Обложка: ${t.title}`}
                    seed={t.id}
                    className="size-full shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
                    rounded="rounded-[28px]"
                    eager
                  />
                </motion.div>
              </motion.div>

              <div className="flex w-full max-w-md flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.h1
                        key={t.id}
                        initial={{ opacity: 0, x: 24 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -24 }}
                        transition={softSpring}
                        className="truncate text-2xl font-bold tracking-tight md:text-3xl"
                      >
                        {t.title}
                      </motion.h1>
                    </AnimatePresence>
                    <button
                      disabled={!t.artistId}
                      onClick={() => {
                        setOpen(false);
                        navigate(artistPath(t.artistId!));
                      }}
                      className="mt-1 max-w-full truncate text-lg text-fg-2 enabled:hover:text-fg enabled:hover:underline"
                    >
                      {t.artist}
                    </button>
                  </div>
                  <IconButton
                    label={liked ? 'Убрать из «Любимых»' : 'Нравится'}
                    active={liked}
                    onClick={() => useLibrary.getState().toggleLike(t)}
                    className={cn(!liked && 'text-fg')}
                  >
                    <motion.span key={String(liked)} initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 15 }}>
                      <Heart className={cn('size-6', liked && 'fill-current')} />
                    </motion.span>
                  </IconButton>
                </div>

                <div className="mt-5 h-12">
                  <Visualizer className="size-full" />
                </div>

                <Scrubber className="mt-2" />
                <div className="mt-3">
                  <TransportControls big />
                </div>

                <div className="mt-5 flex items-center gap-3">
                  <VolumeControl className="flex-1" />
                  {context?.aura && (
                    <IconButton label="Не нравится — пропустить и реже показывать похожее" onClick={dislikeCurrent} className="ml-auto">
                      <ThumbsDown className="size-5" />
                    </IconButton>
                  )}
                  <IconButton label="Аура трека — бесконечный поток похожих" onClick={() => void startTrackAura(t)} className={cn(!context?.aura && 'ml-auto')}>
                    <Radio className="size-5" />
                  </IconButton>
                  <IconButton label="Очередь" onClick={() => setQueue(true)}>
                    <ListMusic className="size-5" />
                  </IconButton>
                </div>

                {/* Source attribution + honest status */}
                <div className="mt-5 flex flex-wrap items-center gap-2 text-[13px] text-fg-2">
                  <SourceBadge source={t.source} preview={isPreview} />
                  <span>{SOURCE_META[t.source].label}</span>
                  {t.permalink && (
                    <a href={t.permalink} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 font-medium text-fg hover:underline">
                      Открыть оригинал <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
                {(isPreview || widget || status === 'error') && (
                  <div className="mt-3 flex gap-2 rounded-2xl bg-surface p-3 text-[13px] text-fg-2">
                    <Info className="mt-0.5 size-4 shrink-0" />
                    <span>
                      {status === 'error'
                        ? error
                        : isPreview
                          ? <>Источник разрешает только 30-секундное превью.{' '}<a className="font-semibold text-fg underline" href={soundcloudSearchUrl(`${t.artist} ${t.title}`)} target="_blank" rel="noopener noreferrer">Найти полную версию на SoundCloud</a> и вставить ссылку в поиск AURA.</>
                          : 'Воспроизводится через официальный плеер SoundCloud (ниже).'}
                    </span>
                  </div>
                )}
                {widget && <div className="h-[132px] shrink-0" aria-hidden />}
              </div>
            </div>
          </div>
          {menu.element}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
