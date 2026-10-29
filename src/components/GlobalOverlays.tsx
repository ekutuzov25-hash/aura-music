import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Crown, Plus, XCircle } from 'lucide-react';
import { PLANS } from '../billing/plans';
import { PREMIUM_FEATURES } from '../billing/features';
import { SHORTCUTS } from '../player/hotkeys';
import { useLibrary } from '../store/library';
import { useUI } from '../store/ui';
import { cn, plural } from '../lib/util';
import { Artwork, Button, spring } from './ui/primitives';
import { Sheet } from './ui/overlays';

export function AddToPlaylistSheet() {
  const tracks = useUI((s) => s.addToPlaylist);
  const close = () => useUI.getState().openAddToPlaylist(null);
  const playlists = useLibrary((s) => s.playlists);
  const [name, setName] = useState('');

  const add = (id: string) => {
    if (!tracks) return;
    const n = useLibrary.getState().addToPlaylist(id, tracks);
    const pl = useLibrary.getState().playlists.find((p) => p.id === id);
    useUI.getState().toast(n ? `Добавлено в «${pl?.name}»` : 'Уже есть в этом плейлисте', { tone: n ? 'success' : 'default' });
    close();
  };

  return (
    <Sheet open={!!tracks} onClose={close} title="Добавить в плейлист">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const p = useLibrary.getState().createPlaylist({ name }, tracks ?? []);
          if (!p) return close();
          useUI.getState().toast(`Создан плейлист «${p.name}»`, { tone: 'success' });
          setName('');
          close();
        }}
      >
        <label className="sr-only" htmlFor="new-pl">
          Название нового плейлиста
        </label>
        <input
          id="new-pl"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Новый плейлист"
          className="h-11 min-w-0 flex-1 rounded-full bg-surface px-4 text-[15px] outline-none placeholder:text-fg-3 focus:ring-2 focus:ring-dyn"
        />
        <Button type="submit">
          <Plus className="size-4" /> Создать
        </Button>
      </form>
      <div className="mt-4 space-y-0.5">
        {playlists.map((p) => (
          <button key={p.id} onClick={() => add(p.id)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-surface-hover">
            <Artwork src={p.cover ?? p.items[0]?.track.artwork} alt="" seed={p.id} className="size-12 shrink-0" rounded="rounded-lg" />
            <div className="min-w-0">
              <div className="truncate font-semibold">{p.name}</div>
              <div className="text-sm text-fg-2">
                {p.items.length} {plural(p.items.length, 'трек', 'трека', 'треков')}
              </div>
            </div>
          </button>
        ))}
        {!playlists.length && <p className="py-4 text-center text-sm text-fg-2">Плейлистов пока нет — создайте первый выше.</p>}
      </div>
    </Sheet>
  );
}

/** Shown when a free user hits a Premium feature. */
export function PaywallSheet() {
  const reason = useUI((s) => s.paywall);
  const navigate = useNavigate();
  const close = () => useUI.getState().openPaywall(null);
  return (
    <Sheet open={!!reason} onClose={close} title="AURA Premium">
      <p className="text-[15px] text-fg-2">{reason}</p>
      <ul className="mt-4 space-y-3">
        {PREMIUM_FEATURES.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3">
            <Icon className="mt-0.5 size-5 shrink-0 text-dyn" />
            <span>
              <span className="block font-medium">{title}</span>
              <span className="block text-sm text-fg-2">{text}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-fg-2">от {PLANS[2].price / 12} ₽ в месяц · {PLANS.map((p) => `${p.title} — ${p.price} ₽`).join(' · ')}</p>
      <p className="mt-2 text-sm text-fg-2">
        Промокод можно купить в Telegram:{' '}
        <a href="https://t.me/dbxxl" target="_blank" rel="noopener noreferrer" className="font-semibold text-fg underline">@dbxxl</a>
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={close}>Не сейчас</Button>
        <Button onClick={() => (close(), navigate('/premium'))}><Crown className="size-4" />Ввести промокод</Button>
      </div>
    </Sheet>
  );
}

export function ShortcutsSheet() {
  const open = useUI((s) => s.shortcutsOpen);
  return (
    <Sheet open={open} onClose={() => useUI.getState().setShortcuts(false)} title="Горячие клавиши">
      <dl className="divide-y divide-line">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between py-2.5 text-[15px]">
            <dt className="text-fg-2">{v}</dt>
            <dd>
              <kbd className="rounded-md bg-surface-hover px-2 py-1 font-sans text-[13px] font-semibold">{k}</kbd>
            </dd>
          </div>
        ))}
      </dl>
    </Sheet>
  );
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[calc(10px+var(--safe-t))] z-[100] flex flex-col items-center gap-2 px-4 md:top-auto md:bottom-[108px]"
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={spring}
            className="glass glass-strong pointer-events-auto flex max-w-md items-center gap-2.5 rounded-full py-2.5 pr-3 pl-3.5 text-sm font-medium"
            role={t.tone === 'error' ? 'alert' : 'status'}
          >
            {t.tone === 'error' && <XCircle className="size-[18px] shrink-0 text-red-400" />}
            {t.tone === 'success' && <CheckCircle2 className="size-[18px] shrink-0 text-emerald-400" />}
            <span className={cn('line-clamp-2')}>{t.message}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  useUI.getState().dismiss(t.id);
                }}
                className="ml-1 rounded-full px-2 py-0.5 font-semibold text-dyn hover:bg-surface-hover"
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Offline banner — shown only while the browser reports no connection. */
export function OfflineBanner({ offline }: { offline: boolean }) {
  return (
    <AnimatePresence>
      {offline && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          className="glass fixed top-[calc(8px+var(--safe-t))] left-1/2 z-[99] -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium"
          role="status"
        >
          Нет подключения — доступны ваши файлы и сохранённые данные
        </motion.div>
      )}
    </AnimatePresence>
  );
}
