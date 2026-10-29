import { motion, type HTMLMotionProps } from 'motion/react';
import { forwardRef, memo, useState, type ReactNode } from 'react';
import { AlertCircle, Music2, RefreshCw } from 'lucide-react';
import { SOURCE_META } from '../../providers/registry';
import type { SourceId } from '../../providers/types';
import { cn, haptic, hashHue } from '../../lib/util';

export const spring = { type: 'spring', stiffness: 420, damping: 32, mass: 0.8 } as const;
export const softSpring = { type: 'spring', stiffness: 260, damping: 30 } as const;

// ───────────── Pressable: every tappable thing gets the same physical feel ─────────────
type PressableProps = HTMLMotionProps<'button'> & { label?: string; hapticFeedback?: boolean };

export const Pressable = forwardRef<HTMLButtonElement, PressableProps>(function Pressable(
  { className, label, hapticFeedback = true, onClick, type = 'button', ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      whileTap={{ scale: 0.92 }}
      transition={spring}
      onClick={(e) => {
        if (hapticFeedback) haptic();
        onClick?.(e);
      }}
      className={cn('cursor-pointer select-none disabled:cursor-not-allowed disabled:opacity-40', className)}
      {...rest}
    />
  );
});

export function IconButton({
  label,
  className,
  size = 'md',
  active,
  ...rest
}: PressableProps & { label: string; size?: 'sm' | 'md' | 'lg'; active?: boolean }) {
  const s = size === 'sm' ? 'size-8' : size === 'lg' ? 'size-12' : 'size-10';
  return (
    <Pressable
      label={label}
      aria-pressed={active}
      className={cn(
        s,
        'grid place-items-center rounded-full transition-colors hover:bg-surface-hover',
        active ? 'text-dyn' : 'text-fg-2 hover:text-fg',
        className,
      )}
      {...rest}
    />
  );
}

export function Button({
  variant = 'primary',
  className,
  children,
  ...rest
}: PressableProps & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return (
    <Pressable
      className={cn(
        'inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold transition-colors',
        variant === 'primary' && 'bg-fg text-bg hover:opacity-90',
        variant === 'secondary' && 'glass text-fg hover:bg-surface-hover',
        variant === 'ghost' && 'text-fg-2 hover:bg-surface-hover hover:text-fg',
        variant === 'danger' && 'bg-red-500 text-white hover:bg-red-600',
        className,
      )}
      {...rest}
    >
      {children}
    </Pressable>
  );
}

export function Glass({ className, strong, ...rest }: HTMLMotionProps<'div'> & { strong?: boolean }) {
  return <motion.div className={cn('glass', strong && 'glass-strong', className)} {...rest} />;
}

// ───────────── Artwork: lazy, fades in, never shows a broken image ─────────────
export const Artwork = memo(function Artwork({
  src,
  alt,
  seed,
  className,
  rounded = 'rounded-xl',
  eager,
}: {
  src?: string;
  alt: string;
  seed: string;
  className?: string;
  rounded?: string;
  eager?: boolean;
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>(src ? 'loading' : 'error');
  const hue = hashHue(seed);
  return (
    <div
      className={cn('relative overflow-hidden bg-surface', rounded, className)}
      style={
        state !== 'ok'
          ? { background: `linear-gradient(135deg, hsl(${hue} 55% 38%), hsl(${(hue + 50) % 360} 60% 18%))` }
          : undefined
      }
    >
      {state === 'error' && (
        <Music2 aria-hidden className="absolute top-1/2 left-1/2 size-1/3 -translate-x-1/2 -translate-y-1/2 text-white/45" />
      )}
      {src && state !== 'error' && (
        <img
          src={src}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
          className={cn('size-full object-cover transition-opacity duration-500', state === 'ok' ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </div>
  );
});

export function SourceBadge({ source, preview, className }: { source: SourceId; preview?: boolean; className?: string }) {
  const m = SOURCE_META[source];
  return (
    <span
      title={`Источник: ${m.label}`}
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full px-1.5 text-[10px] font-bold tracking-wide uppercase',
        className,
      )}
      style={{ background: `${m.color}22`, color: m.color }}
    >
      <span className="size-1.5 rounded-full" style={{ background: m.color }} />
      {preview ? '30s' : m.short}
    </span>
  );
}

export const Skeleton = ({ className }: { className?: string }) => <div aria-hidden className={cn('skeleton rounded-lg', className)} />;

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4 px-4 md:px-8">
      <div className="min-w-0">
        <h2 className="truncate text-[22px] font-bold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-0.5 truncate text-sm text-fg-2">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  text,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto flex max-w-sm flex-col items-center px-6 py-14 text-center', className)}>
      {icon && <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-surface text-fg-2">{icon}</div>}
      <h3 className="text-lg font-semibold">{title}</h3>
      {text && <p className="mt-1.5 text-sm text-fg-2">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn('mx-4 flex items-center gap-3 rounded-2xl bg-red-500/10 px-4 py-3 text-sm md:mx-8', className)} role="alert">
      <AlertCircle className="size-5 shrink-0 text-red-400" />
      <span className="flex-1 text-fg-2">{message}</span>
      {onRetry && (
        <Pressable onClick={onRetry} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium hover:bg-surface-hover">
          <RefreshCw className="size-4" /> Повторить
        </Pressable>
      )}
    </div>
  );
}

export function Chip({ active, className, ...rest }: PressableProps & { active?: boolean }) {
  return (
    <Pressable
      aria-pressed={active}
      className={cn(
        'h-8 shrink-0 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors',
        active ? 'bg-fg text-bg' : 'bg-surface text-fg-2 hover:bg-surface-hover hover:text-fg',
        className,
      )}
      {...rest}
    />
  );
}

/** Animated equalizer bars shown on the playing row. CSS-only, cheap. */
export function PlayingBars({ paused }: { paused?: boolean }) {
  return (
    <span className="flex h-3.5 items-end gap-[2px]" aria-label={paused ? 'На паузе' : 'Играет'}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full bg-dyn"
          animate={paused ? { height: 4 } : { height: [4, 14, 6, 11, 4] }}
          transition={paused ? { duration: 0.2 } : { duration: 0.9 + i * 0.15, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </span>
  );
}
