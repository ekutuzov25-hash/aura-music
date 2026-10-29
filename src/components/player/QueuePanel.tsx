import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react';
import { useRef } from 'react';
import { GripVertical, ListX, X } from 'lucide-react';
import type { Track } from '../../providers/types';
import { player } from '../../player/controller';
import { usePlayerState } from '../../player/store';
import { useUI } from '../../store/ui';
import { Artwork, EmptyState, IconButton, PlayingBars, SourceBadge, softSpring } from '../ui/primitives';
import { useFocusTrap } from '../ui/overlays';

function UpcomingRow({ t, absIndex }: { t: Track; absIndex: number }) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={t}
      dragListener={false}
      dragControls={controls}
      className="group flex items-center gap-3 rounded-xl px-1.5 py-1.5 hover:bg-surface-hover"
      whileDrag={{ scale: 1.02, boxShadow: '0 12px 30px rgba(0,0,0,.35)' }}
      layout="position"
    >
      <button
        aria-label="Перетащить"
        onPointerDown={(e) => controls.start(e)}
        className="cursor-grab touch-none text-fg-3 hover:text-fg active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <button onClick={() => void player.jumpTo(absIndex)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Artwork src={t.artwork} alt="" seed={t.id} className="size-10 shrink-0" rounded="rounded-lg" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{t.title}</div>
          <div className="flex items-center gap-1.5 text-xs text-fg-2">
            <SourceBadge source={t.source} preview={t.playability === 'preview'} />
            <span className="truncate">{t.artist}</span>
          </div>
        </div>
      </button>
      <IconButton label="Убрать из очереди" size="sm" onClick={() => player.removeFromQueue(absIndex)} className="opacity-60 group-hover:opacity-100">
        <X className="size-4" />
      </IconButton>
    </Reorder.Item>
  );
}

export function QueuePanel() {
  const open = useUI((s) => s.queueOpen);
  const setOpen = useUI((s) => s.setQueue);
  const queue = usePlayerState((s) => s.queue);
  const index = usePlayerState((s) => s.index);
  const context = usePlayerState((s) => s.context);
  const paused = usePlayerState((s) => s.status !== 'playing');
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref, () => setOpen(false));
  const current = queue[index];
  const upcoming = queue.slice(index + 1);
  const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-[70] bg-black/30 md:bg-transparent" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
          <motion.aside
            ref={ref}
            role="dialog"
            aria-label="Очередь воспроизведения"
            className="glass glass-strong fixed z-[71] flex flex-col overflow-hidden max-md:inset-x-0 max-md:bottom-0 max-md:h-[86dvh] max-md:rounded-t-[28px] md:top-3 md:right-3 md:bottom-[100px] md:w-[400px] md:rounded-[26px]"
            initial={mobile ? { y: '100%' } : { x: 420, opacity: 0.6 }}
            animate={mobile ? { y: 0 } : { x: 0, opacity: 1 }}
            exit={mobile ? { y: '100%' } : { x: 420, opacity: 0.6 }}
            transition={softSpring}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2 className="text-xl font-bold">Очередь</h2>
              <div className="flex items-center gap-1">
                {upcoming.length > 0 && (
                  <IconButton label="Очистить очередь" size="sm" onClick={() => player.clearUpcoming()}>
                    <ListX className="size-[18px]" />
                  </IconButton>
                )}
                <IconButton label="Закрыть" size="sm" onClick={() => setOpen(false)}>
                  <X className="size-5" />
                </IconButton>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(16px+var(--safe-b))]">
              {!current ? (
                <EmptyState title="Очередь пуста" text="Включите трек или добавьте его через меню «⋯ → Добавить в очередь»." />
              ) : (
                <>
                  <div className="px-2 pb-2 text-xs font-semibold tracking-wider text-fg-3 uppercase">Сейчас играет</div>
                  <div className="flex items-center gap-3 rounded-2xl bg-surface p-2">
                    <Artwork src={current.artwork} alt="" seed={current.id} className="size-12 shrink-0" rounded="rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-dyn">{current.title}</div>
                      <div className="truncate text-sm text-fg-2">{current.artist}</div>
                    </div>
                    <PlayingBars paused={paused} />
                  </div>
                  <div className="mt-5 px-2 pb-2 text-xs font-semibold tracking-wider text-fg-3 uppercase">
                    Далее {context?.label ? `· ${context.label}` : ''} · {upcoming.length}
                  </div>
                  {upcoming.length === 0 ? (
                    <p className="px-2 text-sm text-fg-2">После этого трека воспроизведение остановится.</p>
                  ) : (
                    <Reorder.Group axis="y" values={upcoming} onReorder={(v) => player.reorderUpcoming(v)} className="space-y-0.5">
                      {upcoming.map((t, i) => (
                        <UpcomingRow key={t.id} t={t} absIndex={index + 1 + i} />
                      ))}
                    </Reorder.Group>
                  )}
                </>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
