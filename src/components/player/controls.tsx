import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react';
import { player } from '../../player/controller';
import { usePlayerState, useProgress } from '../../player/store';
import { cn, formatTime } from '../../lib/util';
import { IconButton, Pressable, spring } from '../ui/primitives';

/** Timeline with real position/duration from the engine. Pointer + keyboard. */
export function Scrubber({ compact, className }: { compact?: boolean; className?: string }) {
  const time = useProgress((s) => s.time);
  const duration = useProgress((s) => s.duration);
  const buffering = useProgress((s) => s.buffering);
  const [drag, setDrag] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const shown = drag ?? time;
  const pct = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0;

  const fromEvent = (e: React.PointerEvent | PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * duration;
  };

  const onDown = (e: React.PointerEvent) => {
    if (!duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(fromEvent(e));
  };
  const onMove = (e: React.PointerEvent) => drag !== null && setDrag(fromEvent(e));
  const onUp = (e: React.PointerEvent) => {
    if (drag === null) return;
    player.seek(fromEvent(e));
    setDrag(null);
  };

  return (
    <div className={cn('w-full', className)}>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label="Позиция воспроизведения"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={`${formatTime(shown)} из ${formatTime(duration)}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') player.seekBy(5);
          else if (e.key === 'ArrowLeft') player.seekBy(-5);
          else return;
          e.preventDefault();
        }}
        className={cn('group relative flex cursor-pointer touch-none items-center', compact ? 'h-3' : 'h-6')}
      >
        <div className={cn('relative w-full overflow-hidden rounded-full bg-line transition-[height]', drag !== null ? 'h-2' : 'h-1 group-hover:h-1.5')}>
          <div className="absolute inset-y-0 left-0 rounded-full bg-fg" style={{ width: `${pct}%` }} />
          {buffering && <div className="skeleton absolute inset-0 opacity-60" />}
        </div>
        <div
          className={cn('absolute size-3.5 -translate-x-1/2 rounded-full bg-fg shadow-md transition-transform', drag !== null ? 'scale-125' : 'scale-0 group-hover:scale-100 group-focus-visible:scale-100')}
          style={{ left: `${pct}%` }}
        />
      </div>
      {!compact && (
        <div className="mt-1 flex justify-between text-[12px] font-medium text-fg-2 tabular-nums">
          <span>{formatTime(shown)}</span>
          <span>{duration ? `−${formatTime(Math.max(0, duration - shown))}` : '--:--'}</span>
        </div>
      )}
    </div>
  );
}

export function PlayPauseButton({ size = 'lg', className }: { size?: 'md' | 'lg' | 'xl'; className?: string }) {
  const status = usePlayerState((s) => s.status);
  const hasTrack = usePlayerState((s) => s.index >= 0);
  const playing = status === 'playing' || status === 'loading';
  const dims = size === 'xl' ? 'size-[72px]' : size === 'lg' ? 'size-12' : 'size-10';
  const icon = size === 'xl' ? 'size-8' : size === 'lg' ? 'size-6' : 'size-5';
  return (
    <Pressable
      label={playing ? 'Пауза' : 'Играть'}
      disabled={!hasTrack}
      onClick={(e) => {
        e.stopPropagation();
        player.toggle();
      }}
      className={cn('relative grid place-items-center rounded-full bg-fg text-bg shadow-lg', dims, className)}
    >
      <motion.span key={playing ? 'pause' : 'play'} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring}>
        {playing ? <Pause className={cn(icon, 'fill-current')} /> : <Play className={cn(icon, 'ml-0.5 fill-current')} />}
      </motion.span>
      {status === 'loading' && (
        <span className="absolute inset-[-3px] animate-spin rounded-full border-2 border-transparent border-t-dyn" aria-hidden />
      )}
    </Pressable>
  );
}

export function TransportControls({ big }: { big?: boolean }) {
  const shuffle = usePlayerState((s) => s.shuffle);
  const repeat = usePlayerState((s) => s.repeat);
  const hasTrack = usePlayerState((s) => s.index >= 0);
  const ic = big ? 'size-7' : 'size-5';
  return (
    <div className={cn('flex items-center justify-between', big ? 'gap-2' : 'gap-1')}>
      <IconButton label={shuffle ? 'Выключить перемешивание' : 'Перемешать'} active={shuffle} onClick={() => player.toggleShuffle()} size={big ? 'lg' : 'md'}>
        <Shuffle className={big ? 'size-5' : 'size-4'} />
      </IconButton>
      <IconButton label="Предыдущий" disabled={!hasTrack} onClick={() => void player.prev()} size={big ? 'lg' : 'md'} className="text-fg">
        <SkipBack className={cn(ic, 'fill-current')} />
      </IconButton>
      <PlayPauseButton size={big ? 'xl' : 'md'} />
      <IconButton label="Следующий" disabled={!hasTrack} onClick={() => void player.next()} size={big ? 'lg' : 'md'} className="text-fg">
        <SkipForward className={cn(ic, 'fill-current')} />
      </IconButton>
      <IconButton
        label={repeat === 'off' ? 'Повтор очереди' : repeat === 'all' ? 'Повтор трека' : 'Выключить повтор'}
        active={repeat !== 'off'}
        onClick={() => player.cycleRepeat()}
        size={big ? 'lg' : 'md'}
      >
        {repeat === 'one' ? <Repeat1 className={big ? 'size-5' : 'size-4'} /> : <Repeat className={big ? 'size-5' : 'size-4'} />}
      </IconButton>
    </div>
  );
}

/** iOS ignores element.volume (hardware buttons only) — detect and hide the slider there. */
const volumeSupported = (() => {
  try {
    const a = new Audio();
    a.volume = 0.5;
    return a.volume === 0.5;
  } catch {
    return false;
  }
})();

export function VolumeControl({ className }: { className?: string }) {
  const volume = usePlayerState((s) => s.volume);
  const muted = usePlayerState((s) => s.muted);
  if (!volumeSupported) return null;
  const v = muted ? 0 : volume;
  const Icon = v === 0 ? VolumeX : v < 0.5 ? Volume1 : Volume2;
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <IconButton label={muted ? 'Включить звук' : 'Выключить звук'} size="sm" onClick={() => player.toggleMute()}>
        <Icon className="size-[18px]" />
      </IconButton>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={v}
        aria-label="Громкость"
        onChange={(e) => player.setVolume(Number(e.target.value))}
        className="range w-full min-w-16"
        style={{ '--val': `${v * 100}%` } as React.CSSProperties}
      />
    </div>
  );
}

/** Keeps the slider in sync even when changed by hotkeys. */
export function useIsPlaying() {
  const status = usePlayerState((s) => s.status);
  return status === 'playing' || status === 'loading';
}

export function useElapsedTitle() {
  const t = usePlayerState((s) => s.queue[s.index]);
  const playing = useIsPlaying();
  useEffect(() => {
    document.title = t && playing ? `${t.title} · ${t.artist} — AURA` : 'AURA';
  }, [t, playing]);
}
