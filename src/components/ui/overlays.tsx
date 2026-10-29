import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/util';
import { IconButton, softSpring, spring } from './primitives';

/** Traps Tab focus inside `ref`, closes on Escape, and restores focus on close. */
export function useFocusTrap(open: boolean, ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    requestAnimationFrame(() => {
      const first = el?.querySelector<HTMLElement>('[data-autofocus], input, button, [href], [tabindex]:not([tabindex="-1"])');
      first?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key !== 'Tab' || !el) return;
      const f = Array.from(
        el.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'),
      ).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const [a, b] = [f[0], f[f.length - 1]];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        b.focus();
      } else if (!e.shiftKey && document.activeElement === b) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [open, ref]);
}

const isMobile = () => window.matchMedia('(max-width: 767px)').matches;

/**
 * Modal: centered glass dialog on desktop, a draggable bottom sheet on mobile.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref, onClose);
  const mobile = isMobile();
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center md:items-center" role="presentation">
          <motion.div
            className="absolute inset-0 bg-black/45"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              'glass glass-strong relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[28px] md:rounded-[28px]',
              wide ? 'md:max-w-2xl' : 'md:max-w-md',
              className,
            )}
            initial={mobile ? { y: '100%' } : { opacity: 0, scale: 0.94, y: 12 }}
            animate={mobile ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={mobile ? { y: '100%' } : { opacity: 0, scale: 0.96, y: 8 }}
            transition={softSpring}
            drag={mobile ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, i) => {
              if (i.offset.y > 120 || i.velocity.y > 600) onClose();
            }}
          >
            {mobile && <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-fg-3" aria-hidden />}
            <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-3 pb-2 md:pt-5">
              <h2 className="truncate text-lg font-bold">{title}</h2>
              <IconButton label="Закрыть" onClick={onClose} size="sm">
                <X className="size-5" />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(20px+var(--safe-b))]">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
}

/**
 * Context menu anchored to a point (desktop) or a bottom sheet (mobile).
 * Keyboard: arrows move, Enter selects, Esc closes.
 */
export function Menu({
  anchor,
  onClose,
  items,
  header,
}: {
  anchor: { x: number; y: number } | null;
  onClose: () => void;
  items: MenuItem[];
  header?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const visible = items.filter((i) => !i.hidden);
  const mobile = isMobile();
  useFocusTrap(!!anchor, ref, onClose);

  useLayoutEffect(() => {
    if (!anchor || mobile || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.min(anchor.x, window.innerWidth - r.width - 12),
      top: anchor.y + r.height > window.innerHeight - 12 ? Math.max(12, anchor.y - r.height) : anchor.y,
    });
  }, [anchor, mobile]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const btns = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      btns[(i + 1) % btns.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      btns[(i - 1 + btns.length) % btns.length]?.focus();
    }
  };

  return createPortal(
    <AnimatePresence>
      {anchor && (
        <div className="fixed inset-0 z-[95]" onContextMenu={(e) => (e.preventDefault(), onClose())}>
          <motion.div
            className={cn('absolute inset-0', mobile && 'bg-black/40')}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={ref}
            role="menu"
            onKeyDown={onKeyDown}
            className={cn(
              'glass glass-strong absolute overflow-hidden p-1.5',
              mobile ? 'inset-x-2 bottom-[calc(8px+var(--safe-b))] rounded-[24px]' : 'w-64 rounded-2xl',
            )}
            style={mobile ? undefined : { left: pos?.left ?? anchor.x, top: pos?.top ?? anchor.y, visibility: pos ? 'visible' : 'hidden' }}
            initial={mobile ? { y: 40, opacity: 0 } : { opacity: 0, scale: 0.92 }}
            animate={mobile ? { y: 0, opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={mobile ? { y: 40, opacity: 0 } : { opacity: 0, scale: 0.95 }}
            transition={spring}
          >
            {header && <div className="border-b border-line px-2.5 pt-1.5 pb-2.5">{header}</div>}
            {visible.map((it) => (
              <button
                key={it.label}
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  onClose();
                  it.onSelect();
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14.5px] transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none disabled:opacity-40',
                  it.danger && 'text-red-400',
                )}
              >
                <span className="grid size-5 place-items-center text-fg-2 [&>svg]:size-[18px]">{it.icon}</span>
                {it.label}
              </button>
            ))}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Confirmation dialog for destructive actions — names exactly what will be removed. */
export function ConfirmDialog({
  open,
  title,
  text,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <p className="text-[15px] text-fg-2">{text}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="h-11 rounded-full px-5 font-semibold text-fg-2 hover:bg-surface-hover" data-autofocus>
          Отмена
        </button>
        <button
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className="h-11 rounded-full bg-red-500 px-5 font-semibold text-white hover:bg-red-600"
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
