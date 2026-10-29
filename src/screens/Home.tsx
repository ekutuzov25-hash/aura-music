import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Link2, Search, Sparkles } from 'lucide-react';
import { audius } from '../providers/audius';
import { isSoundCloudUrl, soundcloudApiReady } from '../providers/soundcloud';
import { openSoundCloudLink } from '../providers/scLinks';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { toast } from '../store/ui';
import { buildTaste, dailyMixes, madeForYou, newReleases, rotation } from '../recommend/engine';
import { useAsync } from '../lib/useAsync';
import { useIsPremium } from '../billing/premium';
import { useUI } from '../store/ui';
import { greeting } from '../lib/util';
import { ArtistCard, CollectionCard, Shelf, ShelfSkeleton, TrackCard } from '../components/cards';
import { Artwork, Button, ErrorState, IconButton, Pressable, SectionHeader, softSpring } from '../components/ui/primitives';
import { Onboarding } from './Onboarding';
import { AuraHero } from '../components/AuraHero';

// Stable objects so memoised cards don't re-render on every Home update.
const CTX = {
  recent: { label: 'Недавно прослушанное', path: '/library?tab=recent' },
  forYou: { label: 'Для вас' },
  rotation: { label: 'Ваша ротация' },
  trending: { label: 'В тренде · Audius' },
  underground: { label: 'Андеграунд' },
  newReleases: { label: 'Новые релизы' },
};
const loadTrending = () => audius.trending!({ time: 'week' });
const loadUnderground = () => audius.underground!();

function TrackShelf({ title, subtitle, loader, deps, context }: { title: string; subtitle?: string; loader: () => Promise<import('../providers/types').Track[]>; deps: unknown[]; context: { label: string } }) {
  const { data, error, loading, reload } = useAsync(loader, deps);
  if (!loading && !error && !data?.length) return null;
  return (
    <section className="mt-9">
      <SectionHeader title={title} subtitle={subtitle} />
      {error ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <ShelfSkeleton /> : (
        <Shelf>{data!.map((t, i) => <TrackCard key={t.id} track={t} list={data!} index={i} context={context} />)}</Shelf>
      )}
    </section>
  );
}

function PasteLink() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSoundCloudUrl(url)) return toast('Вставьте ссылку SoundCloud: на трек, артиста или плейлист', { tone: 'error' });
    setBusy(true);
    try {
      await openSoundCloudLink(url, navigate);
      setUrl('');
    } catch (err) {
      toast((err as Error).message || 'Не удалось открыть ссылку', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="mt-4 flex gap-2">
      <label htmlFor="sc-link" className="sr-only">Ссылка SoundCloud</label>
      <div className="relative min-w-0 flex-1">
        <Link2 className="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-fg-3" />
        <input id="sc-link" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" placeholder="soundcloud.com/артист или /sets/плейлист" className="h-11 w-full rounded-full bg-surface pr-4 pl-10 text-[15px] placeholder:text-fg-3" />
      </div>
      <Button type="submit" disabled={busy || !url}>{busy ? 'Открываем…' : 'Открыть'}</Button>
    </form>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const profile = useSettings((s) => s.profile);
  const history = useLibrary((s) => s.history);
  const likes = useLibrary((s) => s.likes);
  const playlists = useLibrary((s) => s.playlists);
  const playCounts = useLibrary((s) => s.playCounts);
  const artists = useLibrary((s) => s.artists);
  const preferences = useLibrary((s) => s.preferences);
  const [onboarding, setOnboarding] = useState(false);
  const premium = useIsPremium();
  const scArtists = artists.filter((a) => a.item.source === 'soundcloud').map((a) => a.item);

  const taste = useMemo(() => buildTaste({ likes, history, playCounts, playlists, artists, preferences }), [likes.length, history.length, playlists.length, artists.length, preferences]); // eslint-disable-line react-hooks/exhaustive-deps
  const tasteKey = taste.genres.slice(0, 3).map((g) => g[0]).join() + '|' + taste.artists.slice(0, 2).map((a) => a[0]).join();
  const recent = useMemo(() => history.slice(0, 20).map((h) => h.track), [history]);
  const rot = useMemo(() => rotation({ history, likes, playCounts }), [history, likes, playCounts]);

  const recs = useAsync(() => (taste.hasData ? madeForYou(taste, { likes, history }) : Promise.resolve([])), [tasteKey]);
  const recTracks = useMemo(() => recs.data?.map((x) => x.track) ?? [], [recs.data]);
  const mixes = useAsync(() => (premium && taste.hasData ? dailyMixes(taste, { likes, history }) : Promise.resolve([])), [tasteKey, premium]);
  const trendingPl = useAsync(() => audius.trendingCollections!(), []);
  const scApi = useAsync(() => soundcloudApiReady(), []);

  return (
    <div className="page-pad pt-[calc(12px+var(--safe-t))]">
      {/* ── Top bar ── */}
      <header className="flex items-center gap-3 px-4 pt-3 md:px-8 md:pt-6">
        <Link to="/profile" aria-label="Профиль" className="shrink-0">
          <Artwork src={profile.avatar} alt="" seed={profile.displayName} className="size-10" rounded="rounded-full" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-fg-2">{greeting()},</div>
          <h1 className="truncate text-2xl font-semibold tracking-tight">{profile.displayName}</h1>
        </div>
        <IconButton label="Поиск" onClick={() => navigate('/search')} className="glass text-fg">
          <Search className="size-5" />
        </IconButton>
      </header>

      <AuraHero />

      {/* ── Onboarding when we know nothing about the listener ── */}
      {!taste.hasData && (
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={softSpring} className="glass mx-4 mt-6 overflow-hidden rounded-[28px] p-6 md:mx-8 md:p-8">
          <Sparkles className="size-7 text-dyn" />
          <h2 className="mt-3 text-2xl font-bold tracking-tight">Настроим AURA под вас</h2>
          <p className="mt-1.5 max-w-lg text-[15px] text-fg-2">Выберите любимые жанры и исполнителей — рекомендации и Daily Mix будут строиться на них. Без этого мы не выдаём случайные треки за «персональные».</p>
          <Button className="mt-5" onClick={() => setOnboarding(true)}>Выбрать жанры</Button>
        </motion.section>
      )}

      {recent.length > 0 && (
        <section className="mt-8">
          <SectionHeader title="Недавно прослушанное" action={<Link to="/library?tab=recent" className="text-sm font-semibold text-fg-2 hover:text-fg">Все</Link>} />
          <Shelf>{recent.map((t, i) => <TrackCard key={t.id} track={t} list={recent} index={i} context={CTX.recent} />)}</Shelf>
        </section>
      )}

      {taste.hasData && (
        <section className="mt-9">
          <SectionHeader title="Для вас" subtitle={`На основе: ${taste.genres.slice(0, 3).map((g) => g[0]).concat(taste.artists.slice(0, 2).map((a) => a[0])).join(', ')}`} action={<button onClick={() => setOnboarding(true)} className="text-sm font-semibold text-fg-2 hover:text-fg">Настроить</button>} />
          {recs.error ? <ErrorState message={recs.error} onRetry={recs.reload} /> : recs.loading && !recs.data ? <ShelfSkeleton /> : recs.data!.length ? (
            <Shelf>{recs.data!.map((r, i) => <TrackCard key={r.track.id} track={r.track} subtitle={r.reason} list={recTracks} index={i} context={CTX.forYou} />)}</Shelf>
          ) : <p className="px-4 text-sm text-fg-2 md:px-8">Пока не нашли новых треков по вашим предпочтениям.</p>}
        </section>
      )}

      {rot.length > 0 && (
        <section className="mt-9">
          <SectionHeader title="Ваша ротация" subtitle="Чаще всего слушаете" />
          <Shelf>{rot.map((t, i) => <TrackCard key={t.id} track={t} list={rot} index={i} context={CTX.rotation} subtitle={`${playCounts[t.id]} прослушиваний`} />)}</Shelf>
        </section>
      )}

      {taste.hasData && !premium && (
        <section className="mt-9">
          <SectionHeader title="Daily Mix" subtitle="Premium" />
          <button onClick={() => useUI.getState().openPaywall('Daily Mix — ежедневные персональные миксы из ваших любимых жанров. Доступно в Premium.')} className="mx-4 flex w-[calc(100%-2rem)] items-center gap-4 rounded-[24px] bg-[linear-gradient(120deg,rgb(var(--dyn)/0.35),transparent_70%),var(--surface)] p-5 text-left md:mx-8 md:w-[calc(100%-4rem)]">
            <Sparkles className="size-8 shrink-0 text-dyn" />
            <span>
              <span className="block font-semibold">Ваши Daily Mix готовы к сборке</span>
              <span className="block text-sm text-fg-2">Каждый день — новые миксы по жанрам {taste.genres.slice(0, 2).map((g) => g[0]).join(' и ')}. Откройте с Premium.</span>
            </span>
          </button>
        </section>
      )}

      {premium && taste.hasData && (mixes.loading || !!mixes.data?.length) && (
        <section className="mt-9">
          <SectionHeader title="Daily Mix" subtitle="Обновляются каждый день" />
          {mixes.loading && !mixes.data ? <ShelfSkeleton /> : (
            <Shelf>
              {mixes.data!.map((m, i) => (
                <motion.div key={m.id} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ ...softSpring, delay: i * 0.05 }} className="w-[148px] shrink-0 snap-start md:w-[176px]">
                  <Link to={`/mix/${encodeURIComponent(m.genre)}`} className="block">
                    <div className="relative aspect-square overflow-hidden rounded-2xl">
                      <div className="grid size-full grid-cols-2 grid-rows-2">
                        {m.tracks.slice(0, 4).map((t) => <Artwork key={t.id} src={t.artwork} alt="" seed={t.id} rounded="" className="size-full" />)}
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
                      <div className="absolute bottom-3 left-3 text-lg leading-tight font-semibold text-white">{m.title}</div>
                    </div>
                    <div className="mt-2.5 truncate text-[13px] text-fg-2">{m.reason}</div>
                  </Link>
                </motion.div>
              ))}
            </Shelf>
          )}
        </section>
      )}

      {/* ── SoundCloud ── */}
      <section className="glass mx-4 mt-9 rounded-[28px] p-5 md:mx-8 md:p-7">
        <div className="flex items-center gap-2 text-sm font-bold text-fg-2"><span className="size-2 rounded-full bg-[#ff5500]" /> SoundCloud</div>
        <h2 className="mt-1.5 text-lg font-semibold tracking-tight">Любой артист или плейлист SoundCloud — целиком</h2>
        <p className="mt-1 max-w-2xl text-sm text-fg-2">
          {scApi.data
            ? 'Ищите треки, сеты и ремиксы SoundCloud во вкладке «Поиск» или вставьте ссылку.'
            : 'Вставьте ссылку на профиль артиста, плейлист или трек — AURA покажет все публичные треки и сыграет их полностью через официальный плеер SoundCloud. Подпишитесь на артиста, и он появится здесь.'}
        </p>
        <PasteLink />
        {scArtists.length > 0 && (
          <div className="no-scrollbar -mx-1 mt-5 flex gap-4 overflow-x-auto px-1">
            {scArtists.map((a, i) => <ArtistCard key={a.id} a={a} index={i} />)}
          </div>
        )}
      </section>

      <TrackShelf title="В тренде" subtitle="Audius · топ недели" loader={loadTrending} deps={[]} context={CTX.trending} />
      <TrackShelf title="Андеграунд-открытия" subtitle="Набирающие популярность независимые артисты" loader={loadUnderground} deps={[]} context={CTX.underground} />
      <TrackShelf title="Новые релизы" subtitle="Вышли за последние недели и уже в тренде" loader={newReleases} deps={[]} context={CTX.newReleases} />

      {(trendingPl.loading || !!trendingPl.data?.length) && (
        <section className="mt-9">
          <SectionHeader title="Популярные плейлисты" subtitle="Audius" />
          {trendingPl.loading && !trendingPl.data ? <ShelfSkeleton /> : trendingPl.error ? <ErrorState message={trendingPl.error} onRetry={trendingPl.reload} /> : (
            <Shelf>{trendingPl.data!.map((c, i) => <CollectionCard key={c.id} c={c} index={i} />)}</Shelf>
          )}
        </section>
      )}

      <section className="mt-9">
        <SectionHeader title="Ваши плейлисты" action={<Link to="/library" className="text-sm font-semibold text-fg-2 hover:text-fg">Библиотека</Link>} />
        <Shelf>
          <Pressable onClick={() => { const p = useLibrary.getState().createPlaylist(); if (p) navigate(`/playlist/${p.id}`); }} className="grid aspect-square w-[148px] shrink-0 snap-start place-items-center rounded-2xl border-2 border-dashed border-line text-sm font-semibold text-fg-2 hover:border-fg-3 hover:text-fg md:w-[176px]">
            + Новый плейлист
          </Pressable>
          {playlists.map((p, i) => (
            <CollectionCard key={p.id} index={i} to={`/playlist/${p.id}`} c={{ id: p.id, title: p.name, owner: profile.displayName, artwork: p.cover ?? p.items[0]?.track.artworkLarge, source: 'local', kind: 'playlist', trackCount: p.items.length }} />
          ))}
        </Shelf>
      </section>

      <Onboarding open={onboarding} onClose={() => setOnboarding(false)} />
    </div>
  );
}
