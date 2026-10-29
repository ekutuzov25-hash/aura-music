import { motion } from 'motion/react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Disc3, FileAudio, Heart, History, ListMusic, Plus, Radio, Search, Trash2, Upload, UserRound } from 'lucide-react';
import type { Track } from '../providers/types';
import { importLocalFiles, removeLocalFile } from '../providers/local';
import { isSet, useLibrary } from '../store/library';
import { toast } from '../store/ui';
import { plural } from '../lib/util';
import { isPremiumNow } from '../billing/premium';
import { useUI } from '../store/ui';
import { ArtistCard, CollectionCard } from '../components/cards';
import { CollectionHeader } from '../components/CollectionHeader';
import { TrackList, TrackRow, useTrackMenu } from '../components/TrackRow';
import { Button, Chip, EmptyState, softSpring } from '../components/ui/primitives';
import { ConfirmDialog } from '../components/ui/overlays';

const TABS = [
  ['playlists', 'Плейлисты', ListMusic],
  ['liked', 'Любимые', Heart],
  ['albums', 'Альбомы', Disc3],
  ['artists', 'Исполнители', UserRound],
  ['recent', 'Недавние', History],
  ['sets', 'Сеты', Radio],
  ['files', 'Мои файлы', FileAudio],
] as const;
type Tab = (typeof TABS)[number][0];
type Sort = 'recent' | 'title' | 'artist';

const sortTracks = (items: Array<{ t: Track; at: number }>, sort: Sort) =>
  [...items].sort((a, b) =>
    sort === 'title' ? a.t.title.localeCompare(b.t.title) : sort === 'artist' ? a.t.artist.localeCompare(b.t.artist) : b.at - a.at,
  );

export default function LibraryScreen() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'playlists';
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const navigate = useNavigate();
  const lib = useLibrary();
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [removeFile, setRemoveFile] = useState<Track | null>(null);
  const menu = useTrackMenu();
  const newPlaylist = () => {
    const p = useLibrary.getState().createPlaylist();
    if (p) navigate(`/playlist/${p.id}`);
  };

  const f = filter.trim().toLowerCase();
  const match = (s: string) => !f || s.toLowerCase().includes(f);

  const liked = useMemo(
    () => sortTracks(lib.likes.map((l) => ({ t: l.item, at: l.addedAt })), sort).filter((x) => match(`${x.t.title} ${x.t.artist}`)).map((x) => x.t),
    [lib.likes, sort, f], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const sets = useMemo(() => {
    const all = [...lib.likes.map((l) => ({ t: l.item, at: l.addedAt })), ...lib.history.map((h) => ({ t: h.track, at: h.playedAt }))].filter((x) => isSet(x.t));
    const seen = new Set<string>();
    return sortTracks(all.filter((x) => !seen.has(x.t.id) && seen.add(x.t.id)), sort).filter((x) => match(`${x.t.title} ${x.t.artist}`)).map((x) => x.t);
  }, [lib.likes, lib.history, sort, f]); // eslint-disable-line react-hooks/exhaustive-deps
  const recent = lib.history.filter((h) => match(`${h.track.title} ${h.track.artist}`)).map((h) => h.track);
  const files = sortTracks(lib.localTracks.map((t) => ({ t, at: Date.parse(t.releaseDate ?? '') || 0 })), sort).filter((x) => match(`${x.t.title} ${x.t.artist}`)).map((x) => x.t);
  const playlists = [...lib.playlists]
    .filter((p) => match(p.name))
    .sort((a, b) => (sort === 'title' ? a.name.localeCompare(b.name) : b.updatedAt - a.updatedAt));
  const albums = lib.collections.filter((c) => c.item.kind === 'album' && match(`${c.item.title} ${c.item.owner}`));
  const savedPlaylists = lib.collections.filter((c) => c.item.kind === 'playlist' && match(`${c.item.title} ${c.item.owner}`));
  const artists = [...lib.artists]
    .filter((a) => match(a.item.name))
    .sort((a, b) => (sort === 'title' || sort === 'artist' ? a.item.name.localeCompare(b.item.name) : b.addedAt - a.addedAt));

  const grid = 'grid grid-cols-2 gap-x-4 gap-y-6 px-4 sm:grid-cols-3 md:px-8 lg:grid-cols-4 xl:grid-cols-5 [&>*]:w-auto';

  return (
    <div className="page-pad pt-[calc(12px+var(--safe-t))]">
      <header className="flex items-center justify-between px-4 pt-3 md:px-8 md:pt-6">
        <h1 className="text-3xl font-extrabold tracking-tight">Библиотека</h1>
        <Button variant="secondary" className="h-10 px-4" onClick={newPlaylist}>
          <Plus className="size-4" /> Плейлист
        </Button>
      </header>

      <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto px-4 md:px-8" role="tablist">
        {TABS.map(([k, label, Icon]) => (
          <Chip key={k} role="tab" aria-selected={tab === k} active={tab === k} onClick={() => setParams({ tab: k }, { replace: true })}>
            <Icon className="mr-1.5 inline size-3.5" />
            {label}
          </Chip>
        ))}
      </div>

      <div className="mt-3 flex gap-2 px-4 md:px-8">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" />
          <label htmlFor="lib-filter" className="sr-only">Поиск по библиотеке</label>
          <input id="lib-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Найти в библиотеке" className="h-10 w-full rounded-full bg-surface pr-4 pl-9 text-sm outline-none placeholder:text-fg-3 focus:ring-2 focus:ring-dyn" />
        </div>
        <label htmlFor="lib-sort" className="sr-only">Сортировка</label>
        <select id="lib-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-10 rounded-full bg-surface px-3 text-sm font-medium text-fg-2 outline-none">
          <option value="recent">Недавние</option>
          <option value="title">По названию</option>
          <option value="artist">По исполнителю</option>
        </select>
      </div>

      <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={softSpring} className="mt-5">
        {tab === 'playlists' && (
          <>
            {!playlists.length && !savedPlaylists.length ? (
              <EmptyState icon={<ListMusic />} title={f ? 'Ничего не найдено' : 'Создайте первый плейлист'} text="Собирайте треки из SoundCloud, Audius, Apple и своих файлов в одном месте." action={!f && <Button onClick={newPlaylist}><Plus className="size-4" />Создать плейлист</Button>} />
            ) : (
              <div className={grid}>
                {playlists.map((p, i) => (
                  <CollectionCard key={p.id} index={i} to={`/playlist/${p.id}`} c={{ id: p.id, title: p.name, owner: `${p.items.length} ${plural(p.items.length, 'трек', 'трека', 'треков')}`, artwork: p.cover ?? p.items[0]?.track.artworkLarge, source: 'local', kind: 'playlist' }} />
                ))}
                {savedPlaylists.map((c, i) => <CollectionCard key={c.item.id} index={i} c={c.item} />)}
              </div>
            )}
          </>
        )}

        {tab === 'liked' &&
          (lib.likes.length ? (
            <>
              <CollectionHeader kind="Коллекция" title="Любимые треки" seed="liked" tracks={liked} context={{ label: 'Любимые треки', path: '/library?tab=liked' }} artworkNode={<div className="grid aspect-square w-full place-items-center rounded-[24px] bg-gradient-to-br from-zinc-100 via-zinc-400 to-zinc-800 shadow-2xl"><Heart className="size-1/3 fill-black/80 text-black/80" /></div>} />
              <TrackList tracks={liked} context={{ label: 'Любимые треки', path: '/library?tab=liked' }} className="mt-6 px-2 md:px-6" />
            </>
          ) : (
            <EmptyState icon={<Heart />} title="Здесь будут любимые треки" text="Нажмите ♥ у любого трека или клавишу L во время прослушивания." />
          ))}

        {tab === 'albums' &&
          (albums.length ? (
            <div className={grid}>{albums.map((c, i) => <CollectionCard key={c.item.id} c={c.item} index={i} />)}</div>
          ) : (
            <EmptyState icon={<Disc3 />} title="Нет сохранённых альбомов" text="Откройте альбом и нажмите «Сохранить»." />
          ))}

        {tab === 'artists' &&
          (artists.length ? (
            <div className={grid}>{artists.map((a, i) => <ArtistCard key={a.item.id} a={a.item} index={i} />)}</div>
          ) : (
            <EmptyState icon={<UserRound />} title="Нет любимых исполнителей" text="Подпишитесь на исполнителя на его странице — он появится здесь и будет учитываться в рекомендациях." />
          ))}

        {tab === 'recent' &&
          (recent.length ? (
            <>
              <div className="flex justify-end px-4 md:px-8">
                <Button variant="ghost" className="h-9 text-sm" onClick={() => setConfirmClear(true)}><Trash2 className="size-4" />Очистить историю</Button>
              </div>
              <TrackList tracks={recent} context={{ label: 'Недавно прослушанное', path: '/library?tab=recent' }} className="px-2 md:px-6" />
            </>
          ) : (
            <EmptyState icon={<History />} title="История пуста" text="Здесь появятся треки, которые вы слушали." />
          ))}

        {tab === 'sets' &&
          (sets.length ? (
            <TrackList tracks={sets} context={{ label: 'Сеты', path: '/library?tab=sets' }} className="px-2 md:px-6" />
          ) : (
            <EmptyState icon={<Radio />} title="Нет сохранённых сетов" text="DJ-сеты и миксы (от 20 минут или с пометкой mix/set), которые вы лайкнули или слушали, собираются здесь автоматически." />
          ))}

        {tab === 'files' && (
          <>
            <div className="mx-4 flex flex-col items-start gap-3 rounded-[24px] bg-surface p-5 md:mx-8 md:flex-row md:items-center">
              <div className="flex-1">
                <div className="font-semibold">Ваши аудиофайлы</div>
                <p className="mt-0.5 text-sm text-fg-2">MP3, M4A, WAV, FLAC, OGG. Файлы хранятся только на этом устройстве и никуда не загружаются.</p>
              </div>
              <input ref={fileInput} type="file" accept="audio/*,.mp3,.m4a,.flac,.wav,.ogg,.opus" multiple hidden onChange={async (e) => {
                if (!e.target.files?.length) return;
                const added = await importLocalFiles(e.target.files);
                toast(added.length ? `Добавлено файлов: ${added.length}` : 'Не найдено аудиофайлов', { tone: added.length ? 'success' : 'error' });
                e.target.value = '';
              }} />
              <Button onClick={() => (isPremiumNow() ? fileInput.current?.click() : useUI.getState().openPaywall('Загрузка своих аудиофайлов доступна в Premium.'))}><Upload className="size-4" />Добавить файлы</Button>
            </div>
            <div className="mt-4 px-2 md:px-6">
              {files.map((t, i) => (
                <TrackRow key={t.id} track={t} index={i} list={files} context={{ label: 'Мои файлы', path: '/library?tab=files' }} onMenu={(e, tr) => menu.open(e, tr, [{ label: 'Удалить файл с устройства', icon: <Trash2 />, danger: true, onSelect: () => setRemoveFile(tr) }])} />
              ))}
            </div>
          </>
        )}
      </motion.div>

      {menu.element}
      <ConfirmDialog open={confirmClear} onClose={() => setConfirmClear(false)} title="Очистить историю?" text={`Будет удалено ${lib.history.length} ${plural(lib.history.length, 'запись', 'записи', 'записей')} и счётчики прослушиваний. Рекомендации начнут строиться заново.`} confirmLabel="Очистить историю" onConfirm={() => { lib.clearHistory(); toast('История очищена'); }} />
      <ConfirmDialog open={!!removeFile} onClose={() => setRemoveFile(null)} title="Удалить файл?" text={`«${removeFile?.title}» будет удалён с этого устройства. В плейлистах он останется с пометкой «недоступен».`} confirmLabel="Удалить файл" onConfirm={() => removeFile && removeLocalFile(removeFile).then(() => toast('Файл удалён'))} />
    </div>
  );
}
