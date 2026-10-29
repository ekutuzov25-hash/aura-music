import { Reorder, useDragControls } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Copy, Globe, GripVertical, ImagePlus, Lock, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { searchAll } from '../providers/registry';
import type { Track } from '../providers/types';
import { useLibrary, type PlaylistItem } from '../store/library';
import { useSettings } from '../store/settings';
import { toast } from '../store/ui';
import { authConfigured } from '../auth/auth';
import { resizeImage } from '../lib/util';
import { CollectionHeader } from '../components/CollectionHeader';
import { TrackRow, useTrackMenu } from '../components/TrackRow';
import { Artwork, Button, EmptyState, IconButton, Skeleton, SourceBadge } from '../components/ui/primitives';
import { ConfirmDialog, Menu, Sheet } from '../components/ui/overlays';

type Sort = 'custom' | 'title' | 'artist' | 'added';

function DraggableRow({ item, index, list, onMenu, onRemove, context }: { item: PlaylistItem; index: number; list: Track[]; onMenu: ReturnType<typeof useTrackMenu>['open']; onRemove: () => void; context: { label: string; path: string } }) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={item} dragListener={false} dragControls={controls} className="relative flex items-center" whileDrag={{ scale: 1.02, zIndex: 10, boxShadow: '0 16px 40px rgba(0,0,0,.4)', borderRadius: 14 }} layout="position">
      <button aria-label={`Перетащить «${item.track.title}»`} onPointerDown={(e) => controls.start(e)} className="grid h-12 w-7 shrink-0 cursor-grab touch-none place-items-center text-fg-3 hover:text-fg active:cursor-grabbing">
        <GripVertical className="size-4" />
      </button>
      <TrackRow track={item.track} index={index} list={list} onMenu={onMenu} onRemove={onRemove} context={context} className="flex-1 bg-bg/0" />
    </Reorder.Item>
  );
}

function AddTracksSheet({ open, onClose, playlistId }: { open: boolean; onClose: () => void; playlistId: string }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Track[] | null>(null);
  const [loading, setLoading] = useState(false);
  const enabled = useSettings((s) => s.enabledSources);
  const items = useLibrary((s) => s.playlists.find((p) => p.id === playlistId)?.items);
  const ids = useMemo(() => new Set(items?.map((i) => i.track.id)), [items]);
  useEffect(() => {
    if (q.trim().length < 2) return setResults(null);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await searchAll(q.trim(), enabled, ctrl.signal);
        setResults(r.flatMap((x) => x.results.tracks).slice(0, 40));
      } catch {
        /* aborted */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 350);
    return () => (clearTimeout(t), ctrl.abort());
  }, [q, enabled]);
  return (
    <Sheet open={open} onClose={onClose} title="Добавить треки" wide>
      <div className="relative">
        <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg-3" />
        <label htmlFor="add-q" className="sr-only">Поиск треков</label>
        <input id="add-q" data-autofocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти трек во всех источниках" className="h-11 w-full rounded-full bg-surface pr-4 pl-10 outline-none placeholder:text-fg-3 focus:ring-2 focus:ring-dyn" />
      </div>
      <div className="mt-3 min-h-40">
        {loading && Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="my-2 h-12" />)}
        {!loading && results?.length === 0 && <p className="py-6 text-center text-sm text-fg-2">Ничего не найдено</p>}
        {!loading && results?.map((t) => (
          <div key={t.id} className="flex items-center gap-3 rounded-xl p-1.5 hover:bg-surface-hover">
            <Artwork src={t.artwork} alt="" seed={t.id} className="size-11 shrink-0" rounded="rounded-lg" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{t.title}</div>
              <div className="flex items-center gap-1.5 text-xs text-fg-2"><SourceBadge source={t.source} preview={t.playability === 'preview'} /><span className="truncate">{t.artist}</span></div>
            </div>
            <Button variant={ids.has(t.id) ? 'ghost' : 'secondary'} disabled={ids.has(t.id)} className="h-9 px-3 text-sm" onClick={() => useLibrary.getState().addToPlaylist(playlistId, [t])}>
              {ids.has(t.id) ? 'Добавлен' : <><Plus className="size-4" />Добавить</>}
            </Button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

export default function PlaylistDetails() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const pl = useLibrary((s) => s.playlists.find((p) => p.id === id));
  const owner = useSettings((s) => s.profile.displayName);
  const [sort, setSort] = useState<Sort>('custom');
  const [edit, setEdit] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const [form, setForm] = useState({ name: '', description: '', cover: undefined as string | undefined, isPublic: false });
  const coverInput = useRef<HTMLInputElement>(null);
  const menu = useTrackMenu();

  if (!pl) return <EmptyState className="pt-32" title="Плейлист не найден" text="Возможно, он был удалён." action={<Button onClick={() => navigate('/library')}>В библиотеку</Button>} />;

  const ctx = { label: pl.name, path: `/playlist/${pl.id}` };
  const sorted =
    sort === 'custom'
      ? pl.items
      : [...pl.items].sort((a, b) =>
          sort === 'title' ? a.track.title.localeCompare(b.track.title) : sort === 'artist' ? a.track.artist.localeCompare(b.track.artist) : b.addedAt - a.addedAt,
        );
  const tracks = sorted.map((i) => i.track);
  const removeAt = (item: PlaylistItem) => {
    const idx = pl.items.indexOf(item);
    useLibrary.getState().removeFromPlaylist(pl.id, idx);
    toast(`«${item.track.title}» удалён из плейлиста`, {
      action: { label: 'Вернуть', run: () => useLibrary.getState().reorderPlaylist(pl.id, [...pl.items.slice(0, idx), item, ...pl.items.slice(idx)]) },
    });
  };
  const openEdit = () => {
    setForm({ name: pl.name, description: pl.description, cover: pl.cover, isPublic: pl.isPublic });
    setEdit(true);
  };

  return (
    <div className="page-pad">
      <CollectionHeader
        kind={pl.isPublic ? 'Публичный плейлист' : 'Приватный плейлист'}
        title={pl.name}
        description={pl.description}
        subtitle={owner}
        artwork={pl.cover ?? pl.items[0]?.track.artworkLarge}
        seed={pl.id}
        tracks={tracks}
        context={ctx}
        actions={
          <>
            <Button variant="secondary" onClick={() => setAdding(true)}><Plus className="size-4" />Добавить</Button>
            <IconButton label="Редактировать" onClick={openEdit} className="glass"><Pencil className="size-[18px]" /></IconButton>
            <IconButton label="Ещё" className="glass" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMore({ x: r.left, y: r.bottom + 6 }); }}>
              <MoreHorizontal className="size-5" />
            </IconButton>
          </>
        }
      />

      {pl.items.length > 1 && (
        <div className="mt-6 flex items-center justify-end gap-2 px-4 md:px-8">
          <label htmlFor="pl-sort" className="text-sm text-fg-2">Сортировка</label>
          <select id="pl-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-9 rounded-full bg-surface px-3 text-sm font-medium outline-none">
            <option value="custom">Свой порядок</option>
            <option value="added">Дата добавления</option>
            <option value="title">Название</option>
            <option value="artist">Исполнитель</option>
          </select>
        </div>
      )}

      <div className="mt-3 px-2 md:px-6">
        {!pl.items.length ? (
          <EmptyState title="Плейлист пуст" text="Добавьте треки через поиск, меню «⋯» у любого трека, или перетащите трек на плейлист в боковой панели." action={<Button onClick={() => setAdding(true)}><Search className="size-4" />Найти треки</Button>} />
        ) : sort === 'custom' ? (
          <Reorder.Group axis="y" values={pl.items} onReorder={(items) => useLibrary.getState().reorderPlaylist(pl.id, items)}>
            {pl.items.map((item, i) => (
              <DraggableRow key={item.track.id} item={item} index={i} list={tracks} onMenu={menu.open} onRemove={() => removeAt(item)} context={ctx} />
            ))}
          </Reorder.Group>
        ) : (
          sorted.map((item, i) => <TrackRow key={item.track.id} track={item.track} index={i} list={tracks} onMenu={menu.open} onRemove={() => removeAt(item)} context={ctx} />)
        )}
      </div>

      {menu.element}
      <Menu
        anchor={more}
        onClose={() => setMore(null)}
        items={[
          { label: 'Изменить данные', icon: <Pencil />, onSelect: openEdit },
          { label: 'Создать копию', icon: <Copy />, onSelect: () => { const c = useLibrary.getState().duplicatePlaylist(pl.id); if (c) { toast(`Создана копия «${c.name}»`, { tone: 'success' }); navigate(`/playlist/${c.id}`); } } },
          { label: pl.isPublic ? 'Сделать приватным' : 'Сделать публичным', icon: pl.isPublic ? <Lock /> : <Globe />, onSelect: () => useLibrary.getState().updatePlaylist(pl.id, { isPublic: !pl.isPublic }) },
          { label: 'Удалить плейлист', icon: <Trash2 />, danger: true, onSelect: () => setConfirmDel(true) },
        ]}
      />
      <ConfirmDialog
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        title="Удалить плейлист?"
        text={`Плейлист «${pl.name}» (${pl.items.length} тр.) будет удалён без возможности восстановления. Сами треки останутся в источниках.`}
        confirmLabel="Удалить плейлист"
        onConfirm={() => { useLibrary.getState().deletePlaylist(pl.id); toast('Плейлист удалён'); navigate('/library'); }}
      />
      <AddTracksSheet open={adding} onClose={() => setAdding(false)} playlistId={pl.id} />

      <Sheet open={edit} onClose={() => setEdit(false)} title="Изменить плейлист">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim()) return;
            useLibrary.getState().updatePlaylist(pl.id, { ...form, name: form.name.trim() });
            setEdit(false);
            toast('Изменения сохранены', { tone: 'success' });
          }}
        >
          <div className="flex gap-4">
            <button type="button" onClick={() => coverInput.current?.click()} className="group relative size-28 shrink-0 overflow-hidden rounded-2xl" aria-label="Выбрать обложку">
              <Artwork src={form.cover ?? pl.items[0]?.track.artworkLarge} alt="" seed={pl.id} className="size-full" rounded="rounded-2xl" />
              <span className="absolute inset-0 grid place-items-center bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><ImagePlus className="size-6" /></span>
            </button>
            <input ref={coverInput} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setForm({ ...form, cover: await resizeImage(f, 600).catch(() => form.cover) }); }} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <label htmlFor="pl-name" className="text-xs font-semibold text-fg-2">Название</label>
              <input id="pl-name" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-11 rounded-xl bg-surface px-3 outline-none focus:ring-2 focus:ring-dyn" />
              {form.cover && <button type="button" onClick={() => setForm({ ...form, cover: undefined })} className="self-start text-xs text-fg-2 underline">Убрать обложку</button>}
            </div>
          </div>
          <label htmlFor="pl-desc" className="mt-4 block text-xs font-semibold text-fg-2">Описание</label>
          <textarea id="pl-desc" maxLength={1000} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-2 w-full resize-none rounded-xl bg-surface p-3 outline-none focus:ring-2 focus:ring-dyn" />
          <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-surface p-3">
            <span>
              <span className="block font-medium">Публичный плейлист</span>
              <span className="block text-xs text-fg-2">{authConfigured ? 'Другие пользователи смогут открыть его по ссылке' : 'Публикация работает после подключения Supabase'}</span>
            </span>
            <input type="checkbox" checked={form.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} className="size-5 accent-[rgb(var(--dyn))]" />
          </label>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEdit(false)}>Отмена</Button>
            <Button type="submit">Сохранить</Button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}
