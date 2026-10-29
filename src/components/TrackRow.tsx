import { memo } from 'react';
import { create } from 'zustand';
import { useNavigate } from 'react-router-dom';
import {
  Disc3, ExternalLink, Heart, Link2, ListEnd, ListPlus, ListStart, MoreHorizontal, Play, Radio, Trash2, UserRound,
} from 'lucide-react';
import { startTrackAura } from '../recommend/aura';
import { soundcloudSearchUrl } from '../providers/scWidget';
import { warmTrack } from '../providers/registry';
import type { Track } from '../providers/types';
import { player } from '../player/controller';
import { usePlayerState, type PlayContext } from '../player/store';
import { useLibrary } from '../store/library';
import { toast, useUI } from '../store/ui';
import { cn, formatTime } from '../lib/util';
import { Artwork, IconButton, PlayingBars, SourceBadge } from './ui/primitives';
import { Menu, type MenuItem } from './ui/overlays';

export const artistPath = (id: string) => `/artist/${encodeURIComponent(id)}`;
export const collectionPath = (id: string) => `/collection/${encodeURIComponent(id)}`;

export const TRACK_DRAG_TYPE = 'application/x-aura-tracks';

// ───────────── one shared track menu for the whole app ─────────────
// Every row/card used to mount its own (hidden) menu; with hundreds of cards
// that's a lot of idle components and store subscriptions. Now opening a menu
// just writes to this tiny store and <TrackMenuHost/> renders it once.
interface MenuState {
  anchor: { x: number; y: number };
  track: Track;
  extra?: MenuItem[];
}
const useTrackMenuStore = create<{ menu: MenuState | null }>(() => ({ menu: null }));

function openTrackMenu(e: React.MouseEvent, track: Track, extra?: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const anchor = e.type === 'contextmenu' ? { x: e.clientX, y: e.clientY } : { x: r.right - 256, y: r.bottom + 6 };
  useTrackMenuStore.setState({ menu: { anchor, track, extra } });
}

/** Shared track actions — used by rows, cards and the full player. */
export function useTrackMenu() {
  return { open: openTrackMenu, element: null };
}

export function TrackMenuHost() {
  const navigate = useNavigate();
  const state = useTrackMenuStore((s) => s.menu);
  const liked = useLibrary((s) => (state ? s.likes.some((l) => l.item.id === state.track.id) : false));
  const close = () => useTrackMenuStore.setState({ menu: null });

  const t = state?.track;
  const items: MenuItem[] = t
    ? [
        { label: 'Играть далее', icon: <ListStart />, onSelect: () => player.playNext([t]), disabled: t.playability === 'external' || t.playability === 'unavailable' },
        { label: 'Добавить в очередь', icon: <ListEnd />, onSelect: () => player.addToQueue([t]), disabled: t.playability === 'external' || t.playability === 'unavailable' },
        { label: 'Аура трека', icon: <Radio />, onSelect: () => void startTrackAura(t), disabled: t.playability === 'unavailable' },
        { label: 'Добавить в плейлист', icon: <ListPlus />, onSelect: () => useUI.getState().openAddToPlaylist([t]) },
        {
          label: liked ? 'Убрать из «Любимых»' : 'Добавить в «Любимые»',
          icon: <Heart className={cn(liked && 'fill-current text-dyn')} />,
          onSelect: () => toast(useLibrary.getState().toggleLike(t) ? 'Добавлено в «Любимые»' : 'Удалено из «Любимых»'),
        },
        { label: 'К исполнителю', icon: <UserRound />, onSelect: () => navigate(artistPath(t.artistId!)), hidden: !t.artistId },
        { label: 'К альбому', icon: <Disc3 />, onSelect: () => navigate(collectionPath(t.albumId!)), hidden: !t.albumId },
        {
          label: 'Полная версия на SoundCloud',
          icon: <ExternalLink />,
          hidden: t.playability !== 'preview',
          onSelect: () => window.open(soundcloudSearchUrl(`${t.artist} ${t.title}`), '_blank', 'noopener'),
        },
        { label: 'Открыть в источнике', icon: <ExternalLink />, onSelect: () => window.open(t.permalink, '_blank', 'noopener'), hidden: !t.permalink },
        {
          label: 'Скопировать ссылку',
          icon: <Link2 />,
          hidden: !t.permalink,
          onSelect: () => navigator.clipboard?.writeText(t.permalink!).then(() => toast('Ссылка скопирована')),
        },
        ...(state?.extra ?? []),
      ]
    : [];

  return (
    <Menu
      anchor={state?.anchor ?? null}
      onClose={close}
      items={items}
      header={
        t && (
          <div className="flex items-center gap-3">
            <Artwork src={t.artwork} alt="" seed={t.id} className="size-10 shrink-0" rounded="rounded-lg" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{t.title}</div>
              <div className="truncate text-xs text-fg-2">{t.artist}</div>
            </div>
          </div>
        )
      }
    />
  );
}

interface RowProps {
  track: Track;
  index: number;
  list: Track[];
  context?: PlayContext;
  showArtwork?: boolean;
  showIndex?: boolean;
  onMenu: (e: React.MouseEvent, t: Track, extra?: MenuItem[]) => void;
  onRemove?: () => void;
  className?: string;
}

export const TrackRow = memo(function TrackRow({
  track: t,
  index,
  list,
  context,
  showArtwork = true,
  showIndex,
  onMenu,
  onRemove,
  className,
}: RowProps) {
  // Only the row of the playing track re-renders on play/pause.
  const isCurrent = usePlayerState((s) => s.queue[s.index]?.id === t.id);
  const paused = usePlayerState((s) => s.queue[s.index]?.id === t.id && s.status !== 'playing');
  const liked = useLibrary((s) => s.likes.some((l) => l.item.id === t.id));
  const blocked = t.playability === 'external' || t.playability === 'unavailable';
  const extra: MenuItem[] | undefined = onRemove ? [{ label: 'Удалить из плейлиста', icon: <Trash2 />, danger: true, onSelect: onRemove }] : undefined;

  const play = () => {
    if (isCurrent) return player.toggle();
    if (blocked) {
      if (t.permalink && t.playability === 'external') window.open(t.permalink, '_blank', 'noopener');
      else toast('Трек недоступен для воспроизведения', { tone: 'error' });
      return;
    }
    // Skip tracks that can't be played so "next" works smoothly.
    const playable = list.filter((x) => x.playability === 'full' || x.playability === 'preview');
    void player.playTracks(playable, Math.max(0, playable.findIndex((x) => x.id === t.id)), context);
  };

  return (
    <div
      role="row"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TRACK_DRAG_TYPE, JSON.stringify([t]));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={play}
      onKeyDown={(e) => {
        if (e.key === 'Enter') play();
      }}
      onContextMenu={(e) => onMenu(e, t, extra)}
      onPointerEnter={() => warmTrack(t)}
      onPointerDown={() => warmTrack(t)}
      className={cn(
        'group flex min-w-0 cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover',
        blocked && 'opacity-55',
        className,
      )}
    >
      {showIndex && (
        <div className="grid w-6 shrink-0 place-items-center text-sm text-fg-3 tabular-nums">
          {isCurrent ? <PlayingBars paused={paused} /> : <span className="group-hover:hidden">{index + 1}</span>}
          {!isCurrent && <Play className="hidden size-4 fill-current text-fg group-hover:block" />}
        </div>
      )}
      {showArtwork && (
        <div className="relative shrink-0">
          <Artwork src={t.artwork} alt="" seed={t.id} className="size-12" rounded="rounded-lg" />
          {isCurrent && !showIndex && (
            <div className="absolute inset-0 grid place-items-center rounded-lg bg-black/45">
              <PlayingBars paused={paused} />
            </div>
          )}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-[15px] font-medium', isCurrent && 'text-dyn')}>{t.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-fg-2">
          <SourceBadge source={t.source} preview={t.playability === 'preview'} />
          {t.playability === 'external' && <span className="text-[11px] text-fg-3">только в источнике</span>}
          {t.playability === 'unavailable' && <span className="text-[11px] text-red-400">недоступен</span>}
          <span className="truncate">{t.artist}</span>
        </div>
      </div>
      {t.duration > 0 && (
        <span className="hidden w-14 text-right text-[13px] text-fg-3 tabular-nums sm:block">{formatTime(t.duration)}</span>
      )}
      <IconButton
        label={liked ? 'Убрать из «Любимых»' : 'Нравится'}
        size="sm"
        active={liked}
        className={cn(!liked && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:hidden')}
        onClick={(e) => {
          e.stopPropagation();
          useLibrary.getState().toggleLike(t);
        }}
      >
        <Heart className={cn('size-[18px]', liked && 'fill-current')} />
      </IconButton>
      <IconButton label="Ещё" size="sm" onClick={(e) => onMenu(e, t, extra)}>
        <MoreHorizontal className="size-5" />
      </IconButton>
    </div>
  );
});

/** A whole list with its own menu instance. */
export function TrackList({
  tracks,
  context,
  showIndex,
  showArtwork = true,
  className,
}: {
  tracks: Track[];
  context?: PlayContext;
  showIndex?: boolean;
  showArtwork?: boolean;
  className?: string;
}) {
  const menu = useTrackMenu();
  return (
    <div role="table" className={className}>
      {tracks.map((t, i) => (
        <TrackRow
          key={`${t.id}-${i}`}
          track={t}
          index={i}
          list={tracks}
          context={context}
          showIndex={showIndex}
          showArtwork={showArtwork}
          onMenu={menu.open}
        />
      ))}
      {menu.element}
    </div>
  );
}
