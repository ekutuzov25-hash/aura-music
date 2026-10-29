/** Artist, remote collection (album / playlist / set) and Daily Mix pages. */
import { motion } from 'motion/react';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { BadgeCheck, Bookmark, BookmarkCheck, ExternalLink, Pause, Play, UserCheck, UserPlus } from 'lucide-react';
import { getProvider, SOURCE_META, splitId } from '../providers/registry';
import type { Track } from '../providers/types';
import { player } from '../player/controller';
import { usePlayerState } from '../player/store';
import { useLibrary } from '../store/library';
import { toast } from '../store/ui';
import { buildTaste, dailyMixes } from '../recommend/engine';
import { useIsPremium } from '../billing/premium';
import { useUI } from '../store/ui';
import { useAsync } from '../lib/useAsync';
import { formatCount } from '../lib/util';
import { CollectionCard, Shelf } from '../components/cards';
import { CollectionHeader } from '../components/CollectionHeader';
import { TrackList } from '../components/TrackRow';
import { Artwork, Button, EmptyState, ErrorState, SectionHeader, Skeleton, SourceBadge, softSpring } from '../components/ui/primitives';

function PageSkeleton() {
  return (
    <div className="px-4 pt-10 md:px-8" aria-label="Загрузка">
      <div className="flex flex-col items-center gap-6 md:flex-row md:items-end">
        <Skeleton className="aspect-square w-[min(64vw,240px)] rounded-[24px]" />
        <div className="w-full flex-1 space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>
      <div className="mt-10 space-y-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
    </div>
  );
}

export function ArtistDetails() {
  const { id = '' } = useParams();
  const { source, sourceId } = splitId(decodeURIComponent(id));
  const provider = getProvider(source);
  const artist = useAsync(() => provider.getArtist ? provider.getArtist(sourceId) : Promise.reject(new Error('Источник не поддерживает страницы исполнителей')), [id]);
  const tracks = useAsync(() => provider.getArtistTracks?.(sourceId) ?? Promise.resolve([]), [id]);
  const colls = useAsync(() => provider.getArtistCollections?.(sourceId) ?? Promise.resolve([]), [id]);
  const following = useLibrary((s) => s.artists.some((a) => a.item.id === decodeURIComponent(id)));
  const sameContext = usePlayerState((s) => s.context?.path === `/artist/${id}`);
  const playing = usePlayerState((s) => s.status === 'playing');

  if (artist.loading && !artist.data) return <PageSkeleton />;
  if (artist.error) return <div className="pt-24"><ErrorState message={artist.error} onRetry={artist.reload} /></div>;
  const a = artist.data!;
  const list = (tracks.data ?? []).filter((t) => t.playability === 'full' || t.playability === 'preview');
  const ctx = { label: a.name, path: `/artist/${id}` };
  const albums = (colls.data ?? []).filter((c) => c.kind === 'album');
  const playlists = (colls.data ?? []).filter((c) => c.kind === 'playlist');

  return (
    <div className="page-pad">
      <div className="relative h-[42vh] min-h-[300px] overflow-hidden md:h-[46vh]">
        {a.cover ? (
          <motion.img initial={{ scale: 1.08, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.9 }} src={a.cover} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <Artwork src={a.avatar} alt="" seed={a.id} className="absolute inset-0 size-full scale-125 blur-3xl" rounded="" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/30 to-bg" />
        <div className="absolute inset-x-0 bottom-0 flex items-end gap-5 px-4 pb-6 md:px-8">
          {a.avatar && <Artwork src={a.avatar} alt="" seed={a.id} className="hidden size-36 shrink-0 shadow-2xl md:block" rounded="rounded-full" eager />}
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
              <SourceBadge source={a.source} />
              {a.verified && <span className="flex items-center gap-1"><BadgeCheck className="size-4 text-sky-400" />Подтверждённый артист</span>}
            </div>
            <h1 className="text-balance mt-1 text-4xl font-extrabold tracking-tight text-white md:text-6xl">{a.name}</h1>
            <div className="mt-1 text-sm text-white/75">
              {a.followers != null && `${formatCount(a.followers)} подписчиков`}
              {a.trackCount != null && ` · ${a.trackCount} треков`}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 md:px-8">
        <Button disabled={!list.length} onClick={() => (sameContext ? player.toggle() : void player.playTracks(list, 0, ctx, { shuffle: false }))}>
          {sameContext && playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
          {sameContext && playing ? 'Пауза' : 'Слушать'}
        </Button>
        <Button variant="secondary" onClick={() => toast(useLibrary.getState().toggleArtist(a) ? `Вы подписаны на ${a.name}` : 'Подписка отменена')}>
          {following ? <UserCheck className="size-4" /> : <UserPlus className="size-4" />}
          {following ? 'Вы подписаны' : 'Подписаться'}
        </Button>
        {a.permalink && (
          <a href={a.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-fg-2 hover:bg-surface-hover hover:text-fg">
            {SOURCE_META[a.source].label} <ExternalLink className="size-4" />
          </a>
        )}
      </div>
      {following && <p className="mt-2 px-4 text-xs text-fg-3 md:px-8">Подписка сохраняется в вашей библиотеке AURA и учитывается в рекомендациях (на платформе-источнике подписка не оформляется).</p>}

      <section className="mt-8">
        <SectionHeader title="Популярные треки" />
        {tracks.error ? <ErrorState message={tracks.error} onRetry={tracks.reload} /> : tracks.loading ? (
          <div className="space-y-2 px-4 md:px-8">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : tracks.data!.length ? (
          <TrackList tracks={tracks.data!} context={ctx} showIndex className="px-2 md:px-6" />
        ) : <p className="px-4 text-sm text-fg-2 md:px-8">У исполнителя нет доступных треков.</p>}
      </section>
      {albums.length > 0 && (
        <section className="mt-9">
          <SectionHeader title="Альбомы" />
          <Shelf>{albums.map((c, i) => <CollectionCard key={c.id} c={c} index={i} />)}</Shelf>
        </section>
      )}
      {playlists.length > 0 && (
        <section className="mt-9">
          <SectionHeader title="Плейлисты и сеты" />
          <Shelf>{playlists.map((c, i) => <CollectionCard key={c.id} c={c} index={i} />)}</Shelf>
        </section>
      )}
      {a.bio && (
        <section className="mx-4 mt-9 rounded-[24px] bg-surface p-5 md:mx-8">
          <h2 className="text-lg font-bold">Об исполнителе</h2>
          <p className="mt-2 text-[15px] whitespace-pre-line text-fg-2">{a.bio}</p>
        </section>
      )}
    </div>
  );
}

/** Album / playlist / set from a source (Audius, SoundCloud, Apple). */
export function CollectionDetails() {
  const { id = '' } = useParams();
  const gid = decodeURIComponent(id);
  const { source, sourceId } = splitId(gid);
  const provider = getProvider(source);
  const res = useAsync(() => provider.getCollection ? provider.getCollection(sourceId) : Promise.reject(new Error('Источник не поддерживает коллекции')), [gid]);
  const saved = useLibrary((s) => s.collections.some((c) => c.item.id === gid));

  if (res.loading && !res.data) return <PageSkeleton />;
  if (res.error) return <div className="pt-24"><ErrorState message={res.error} onRetry={res.reload} /></div>;
  const c = res.data!;
  const tracks = c.tracks ?? [];
  const ctx = { label: c.title, path: `/collection/${id}` };
  const year = c.releaseDate ? new Date(c.releaseDate).getFullYear() : undefined;

  return (
    <div className="page-pad">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(80%_100%_at_30%_0%,rgb(var(--dyn)/0.3),transparent)]" aria-hidden />
      <CollectionHeader
        kind={`${c.kind === 'album' ? 'Альбом' : 'Плейлист'} · ${SOURCE_META[c.source].label}`}
        title={c.title}
        description={c.description}
        subtitle={<>{c.owner}{year ? ` · ${year}` : ''}</>}
        artwork={c.artwork}
        seed={c.id}
        tracks={tracks}
        context={ctx}
        actions={
          <>
            <Button variant="secondary" onClick={() => toast(useLibrary.getState().toggleCollection(c) ? 'Сохранено в библиотеку' : 'Удалено из библиотеки')}>
              {saved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
              {saved ? 'В библиотеке' : 'Сохранить'}
            </Button>
            {c.permalink && (
              <a href={c.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-fg-2 hover:bg-surface-hover hover:text-fg">
                Оригинал <ExternalLink className="size-4" />
              </a>
            )}
          </>
        }
      />
      <div className="mt-6 px-2 md:px-6">
        {tracks.length ? <TrackList tracks={tracks} context={ctx} showIndex showArtwork={c.kind !== 'album'} /> : <EmptyState title="Нет доступных треков" text="Источник не вернул треки для этой коллекции." />}
      </div>
    </div>
  );
}

export function MixDetails() {
  const { genre = '' } = useParams();
  const g = decodeURIComponent(genre);
  const lib = useLibrary();
  const taste = useMemo(() => buildTaste(lib), [lib.likes.length, lib.history.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const premium = useIsPremium();
  const res = useAsync(() => (premium ? dailyMixes({ ...taste, genres: [[g, 1]] }, lib) : Promise.resolve([])), [g, premium]);
  if (!premium)
    return <EmptyState className="pt-32" title="Daily Mix доступен в Premium" text="Ежедневные персональные миксы по вашим жанрам." action={<Button onClick={() => useUI.getState().openPaywall('Daily Mix — ежедневные персональные миксы. Доступно в Premium.')}>Подробнее о Premium</Button>} />;
  if (res.loading && !res.data) return <PageSkeleton />;
  if (res.error) return <div className="pt-24"><ErrorState message={res.error} onRetry={res.reload} /></div>;
  const mix = res.data![0];
  if (!mix) return <EmptyState className="pt-32" title="Микс пока не собрался" text="Слушайте и лайкайте больше треков в этом жанре." />;
  const tracks: Track[] = mix.tracks;
  return (
    <div className="page-pad">
      <CollectionHeader
        kind="Daily Mix"
        title={`${g} Mix`}
        description={`Собран из ваших треков в жанре ${g} и свежих находок. Обновляется раз в день.`}
        seed={mix.id}
        tracks={tracks}
        context={{ label: `Daily Mix · ${g}`, path: `/mix/${genre}` }}
        artworkNode={
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={softSpring} className="grid aspect-square w-full grid-cols-2 grid-rows-2 overflow-hidden rounded-[24px] shadow-2xl">
            {tracks.slice(0, 4).map((t) => <Artwork key={t.id} src={t.artwork} alt="" seed={t.id} rounded="" className="size-full" />)}
          </motion.div>
        }
      />
      <TrackList tracks={tracks} context={{ label: `Daily Mix · ${g}`, path: `/mix/${genre}` }} className="mt-6 px-2 md:px-6" />
    </div>
  );
}
