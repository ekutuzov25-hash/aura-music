import { motion } from 'motion/react';
import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Crown, Heart, Home, Library, Plus, Search, Settings, UserRound } from 'lucide-react';
import { useIsPremium } from '../billing/premium';
import type { Track } from '../providers/types';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { toast } from '../store/ui';
import { cn, haptic, plural } from '../lib/util';
import { Artwork, IconButton, softSpring } from './ui/primitives';
import { TRACK_DRAG_TYPE } from './TrackRow';

const TABS = [
  { to: '/', label: 'Главная', icon: Home },
  { to: '/search', label: 'Поиск', icon: Search },
  { to: '/library', label: 'Библиотека', icon: Library },
  { to: '/profile', label: 'Профиль', icon: UserRound },
];

const isActive = (pathname: string, to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to));

/** Floating Liquid Glass tab bar (mobile). The active pill glides between tabs. */
export function TabBar() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Основная навигация" className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[calc(8px+var(--safe-b))] md:hidden">
      <div className="glass mx-auto flex h-[60px] max-w-md items-center justify-around rounded-[28px] px-1.5">
        {TABS.map(({ to, label, icon: Icon }) => {
          const active = isActive(pathname, to);
          return (
            <NavLink
              key={to}
              to={to}
              onClick={() => haptic(6)}
              className={cn('relative flex h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-[22px] text-[10.5px] font-semibold', active ? 'text-fg' : 'text-fg-3')}
              aria-current={active ? 'page' : undefined}
            >
              {active && <motion.span layoutId="tab-pill" transition={softSpring} className="absolute inset-0 rounded-[22px] bg-surface-hover" />}
              <Icon className="relative size-[22px]" strokeWidth={active ? 2.4 : 2} />
              <span className="relative">{label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

/** Desktop sidebar: navigation + playlists that accept dropped tracks. */
export function Sidebar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const playlists = useLibrary((s) => s.playlists);
  const likes = useLibrary((s) => s.likes.length);
  const profile = useSettings((s) => s.profile);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const premium = useIsPremium();

  const onDrop = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    setDropTarget(null);
    try {
      const tracks = JSON.parse(e.dataTransfer.getData(TRACK_DRAG_TYPE)) as Track[];
      const added = useLibrary.getState().addToPlaylist(id, tracks);
      const name = useLibrary.getState().playlists.find((p) => p.id === id)?.name;
      haptic([6, 30, 6]);
      toast(added ? `Добавлено в «${name}»` : 'Этот трек уже в плейлисте');
    } catch {
      /* not a track */
    }
  };

  return (
    <aside className="fixed top-[calc(12px+var(--safe-t))] bottom-[100px] left-3 z-30 hidden w-[248px] flex-col md:flex" aria-label="Боковая панель">
      <div className="glass flex h-full flex-col overflow-hidden rounded-[26px]">
        <Link to="/" className="flex items-center gap-2.5 px-5 pt-5 pb-4">
          <img src="/icon.svg" alt="" className="size-6" />
          <span className="text-[15px] font-semibold tracking-[0.32em]">AURA</span>
        </Link>
        <nav className="space-y-0.5 px-3" aria-label="Основная навигация">
          {[...TABS, { to: '/premium', label: premium ? 'Premium ✓' : 'Premium', icon: Crown }, { to: '/settings', label: 'Настройки', icon: Settings }].map(({ to, label, icon: Icon }) => {
            const active = isActive(pathname, to);
            return (
              <NavLink
                key={to}
                to={to}
                aria-current={active ? 'page' : undefined}
                className={cn('relative flex h-11 items-center gap-3 rounded-2xl px-3 text-[15px] font-semibold transition-colors', active ? 'text-fg' : 'text-fg-2 hover:text-fg')}
              >
                {active && <motion.span layoutId="side-pill" transition={softSpring} className="absolute inset-0 rounded-2xl bg-surface-hover" />}
                <Icon className="relative size-5" />
                <span className="relative">{label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-5 flex items-center justify-between px-5 pb-2">
          <span className="text-xs font-bold tracking-wider text-fg-3 uppercase">Плейлисты</span>
          <IconButton
            label="Создать плейлист"
            size="sm"
            onClick={() => {
              const p = useLibrary.getState().createPlaylist();
              if (p) navigate(`/playlist/${p.id}`);
            }}
          >
            <Plus className="size-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
          <NavLink
            to="/library?tab=liked"
            className="flex items-center gap-3 rounded-xl p-1.5 hover:bg-surface-hover"
          >
            <div className="grid size-10 place-items-center rounded-lg bg-gradient-to-br from-zinc-100 to-zinc-500">
              <Heart className="size-4 fill-black text-black" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">Любимые треки</div>
              <div className="text-xs text-fg-3">
                {likes} {plural(likes, 'трек', 'трека', 'треков')}
              </div>
            </div>
          </NavLink>
          {playlists.map((p) => (
            <NavLink
              key={p.id}
              to={`/playlist/${p.id}`}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(TRACK_DRAG_TYPE)) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                  setDropTarget(p.id);
                }
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => onDrop(e, p.id)}
              className={({ isActive: a }) =>
                cn(
                  'flex items-center gap-3 rounded-xl p-1.5 transition-all hover:bg-surface-hover',
                  a && 'bg-surface',
                  dropTarget === p.id && 'scale-[1.03] bg-surface-hover ring-2 ring-dyn',
                )
              }
            >
              <Artwork src={p.cover ?? p.items[0]?.track.artwork} alt="" seed={p.id} className="size-10 shrink-0" rounded="rounded-lg" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{p.name}</div>
                <div className="text-xs text-fg-3">
                  {p.items.length} {plural(p.items.length, 'трек', 'трека', 'треков')}
                </div>
              </div>
            </NavLink>
          ))}
        </div>
        <Link to="/profile" className="flex items-center gap-3 border-t border-line px-4 py-3 hover:bg-surface-hover">
          <Artwork src={profile.avatar} alt="" seed={profile.displayName} className="size-8" rounded="rounded-full" />
          <span className="truncate text-sm font-semibold">{profile.displayName}</span>
        </Link>
      </div>
    </aside>
  );
}
