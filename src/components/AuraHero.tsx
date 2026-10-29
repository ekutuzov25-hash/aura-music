import { motion, useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play, RotateCcw, ThumbsDown } from 'lucide-react';
import { player } from '../player/controller';
import { usePlayerState } from '../player/store';
import { useLibrary } from '../store/library';
import { CHARACTERS, dislikeCurrent, MOODS, refreshAura, startMyAura, useAura, useAuraLoading } from '../recommend/aura';
import { cn } from '../lib/util';
import { Chip, IconButton, Pressable, spring } from './ui/primitives';

/**
 * The living "aura": soft blobs in the cover's accent colour that drift
 * slowly and breathe faster while the stream is playing. Pure CSS/motion
 * transforms on GPU layers; static when reduced motion is on.
 */
export function AuraOrb({ active, size = 220, className }: { active: boolean; size?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // animate only while visible on screen and the window is in the foreground
  const inView = useInView(ref, { margin: '100px' });
  const [hidden, setHidden] = useState(document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  const reduce = useReducedMotion() || !inView || hidden;
  const blobs = [
    { c: 'rgb(var(--dyn))', x: -0.18, y: -0.12, s: 0.78, d: 14 },
    { c: 'rgb(255 255 255)', x: 0.2, y: -0.06, s: 0.62, d: 17 },
    { c: 'rgb(161 161 170)', x: -0.04, y: 0.2, s: 0.66, d: 19 },
    { c: 'rgb(228 228 231)', x: 0.08, y: 0.02, s: 0.5, d: 11 },
  ];
  return (
    <div ref={ref} className={cn('relative shrink-0', className)} style={{ width: size, height: size }} aria-hidden>
      {blobs.map((b, i) => (
        <motion.span
          key={i}
          className="absolute top-1/2 left-1/2 rounded-full mix-blend-screen blur-2xl will-change-transform [.lite_&]:blur-xl"
          style={{ width: size * b.s, height: size * b.s, background: b.c, opacity: 0.75, marginLeft: (-size * b.s) / 2, marginTop: (-size * b.s) / 2 }}
          animate={
            reduce
              ? { x: b.x * size, y: b.y * size }
              : {
                  x: [b.x * size, -b.y * size, b.x * size * 0.4, b.x * size],
                  y: [b.y * size, b.x * size, -b.y * size * 0.6, b.y * size],
                  scale: active ? [1, 1.18, 0.95, 1] : [1, 1.06, 1],
                }
          }
          transition={reduce ? { duration: 0 } : { duration: active ? b.d / 2.2 : b.d, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
      <motion.span
        className="absolute inset-[22%] rounded-full bg-white/80 blur-xl mix-blend-overlay will-change-transform"
        animate={reduce ? { scale: 1, opacity: 0.5 } : { scale: active ? [1, 1.15, 1] : [1, 1.04, 1], opacity: active ? [0.5, 0.8, 0.5] : 0.4 }}
        transition={reduce ? { duration: 0.3 } : { duration: active ? 1.6 : 4, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

/** «Моя аура» block on the Home screen. */
export function AuraHero() {
  const ctx = usePlayerState((s) => s.context);
  const status = usePlayerState((s) => s.status);
  const loading = useAuraLoading((s) => s.loading);
  const { character, mood, set } = useAura();
  const hasTaste = useLibrary((s) => s.likes.length + s.history.length + s.preferences.genres.length > 0);
  const onMyAura = ctx?.aura?.kind === 'my';
  const playing = onMyAura && (status === 'playing' || status === 'loading');

  const toggle = () => {
    if (onMyAura) player.toggle();
    else void startMyAura();
  };
  const change = (p: Parameters<typeof set>[0]) => {
    set(p);
    if (onMyAura) void refreshAura();
  };

  return (
    <section className="glass relative mx-4 mt-6 overflow-hidden rounded-[32px] md:mx-8">
      <div className="flex flex-col items-center gap-2 px-5 pt-6 pb-5 md:flex-row md:gap-8 md:px-8 md:py-7">
        <Pressable onClick={toggle} hapticFeedback className="relative grid place-items-center" label={playing ? 'Пауза' : 'Включить Мою ауру'}>
          <AuraOrb active={playing} size={200} />
          <motion.span
            key={playing ? 'p' : 's'}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={spring}
            className="absolute grid size-16 place-items-center rounded-full bg-black/35 text-white backdrop-blur-md"
          >
            {loading ? <Loader2 className="size-7 animate-spin" /> : playing ? <Pause className="size-7 fill-current" /> : <Play className="ml-1 size-7 fill-current" />}
          </motion.span>
        </Pressable>

        <div className="w-full min-w-0 flex-1 text-center md:text-left">
          <h2 className="text-3xl font-semibold tracking-tight">Моя аура</h2>
          <p className="mt-1 text-[15px] text-fg-2">
            {hasTaste
              ? 'Бесконечный поток под ваш вкус. Учится на лайках, пропусках и «Не нравится».'
              : 'Пока мы мало о вас знаем — начнём с популярного и будем подстраиваться по ходу.'}
          </p>

          <div className="mt-4 text-xs font-semibold tracking-wider text-fg-3 uppercase">Характер</div>
          <div className="no-scrollbar mt-2 -mx-1 flex gap-2 overflow-x-auto px-1 md:flex-wrap">
            {CHARACTERS.map(([id, label, hint]) => (
              <Chip key={id} active={character === id} onClick={() => change({ character: id })} title={hint}>
                {label}
              </Chip>
            ))}
          </div>
          <div className="mt-3 text-xs font-semibold tracking-wider text-fg-3 uppercase">Настроение</div>
          <div className="no-scrollbar mt-2 -mx-1 flex gap-2 overflow-x-auto px-1 md:flex-wrap">
            {MOODS.map(([id, label]) => (
              <Chip key={id} active={mood === id} onClick={() => change({ mood: id })}>
                {label}
              </Chip>
            ))}
          </div>

          {onMyAura && (
            <div className="mt-4 flex items-center justify-center gap-1 md:justify-start">
              <IconButton label="Не нравится" onClick={dislikeCurrent}>
                <ThumbsDown className="size-5" />
              </IconButton>
              <IconButton label="Обновить поток" onClick={() => void refreshAura()}>
                <RotateCcw className="size-5" />
              </IconButton>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
