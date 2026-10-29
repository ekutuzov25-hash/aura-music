import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Clock, ExternalLink, Info, Search as SearchIcon, SearchX, X } from 'lucide-react';
import { openSoundCloudLink } from '../providers/scLinks';
import { scLinkKind, soundcloudSearchUrl } from '../providers/scWidget';
import { audius } from '../providers/audius';
import { searchAll, SOURCE_META, type SourceResult } from '../providers/registry';
import { isSoundCloudUrl, trackFromSoundCloudUrl } from '../providers/soundcloud';
import type { SourceId, Track } from '../providers/types';
import { isRemix, isSet } from '../store/library';
import { useSettings } from '../store/settings';
import { GENRES, normalizeGenre } from '../recommend/engine';
import { useAsync } from '../lib/useAsync';
import { cn, hashHue } from '../lib/util';
import { ArtistCard, CollectionCard, Shelf } from '../components/cards';
import { TrackList } from '../components/TrackRow';
import { Chip, EmptyState, ErrorState, IconButton, SectionHeader, Skeleton, softSpring } from '../components/ui/primitives';

const TYPES = [
  ['all', 'Всё'],
  ['tracks', 'Треки'],
  ['artists', 'Исполнители'],
  ['albums', 'Альбомы'],
  ['playlists', 'Плейлисты'],
  ['remixes', 'Ремиксы'],
  ['sets', 'DJ-сеты'],
] as const;
type TypeKey = (typeof TYPES)[number][0];

const SOURCES: Array<SourceId | 'all'> = ['all', 'soundcloud', 'audius', 'mixcloud', 'archive', 'itunes', 'local'];

function RowsSkeleton() {
  return (
    <div className="space-y-2 px-4 md:px-8" aria-label="Загрузка результатов">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-1.5">
          <Skeleton className="size-12 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Search() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get('q') ?? '';
  const source = (params.get('source') as SourceId | null) ?? 'all';
  const type = (params.get('type') as TypeKey | null) ?? 'all';
  const genreParam = params.get('genre') ?? '';
  const [input, setInput] = useState(q);
  const [focused, setFocused] = useState(false);
  const [genreFilter, setGenreFilter] = useState('');
  const history = useSettings((s) => s.searchHistory);
  const enabled = useSettings((s) => s.enabledSources);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };

  // Debounce typing → URL (which drives the search).
  useEffect(() => {
    const t = setTimeout(() => input.trim() !== q && update({ q: input.trim(), genre: '' }), 350);
    return () => clearTimeout(t);
  }, [input]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setInput(q), [q]);
  useEffect(() => setGenreFilter(''), [q, source]);

  const sources = (source === 'all' ? enabled : [source]) as SourceId[];
  const linkMode = isSoundCloudUrl(q);

  const [state, setState] = useState<{ loading: boolean; results: SourceResult[]; linkTrack?: Track; error?: string }>({ loading: false, results: [] });
  useEffect(() => {
    if (!q) return setState({ loading: false, results: [] });
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    (async () => {
      try {
        if (linkMode && !['track', 'short'].includes(scLinkKind(q))) {
          // artist / playlist links open their own page with every track
          setState({ loading: false, results: [] });
          await openSoundCloudLink(q, navigate);
          return;
        }
        if (linkMode) {
          const t = await trackFromSoundCloudUrl(q);
          if (!ctrl.signal.aborted) setState({ loading: false, results: [], linkTrack: t });
          return;
        }
        const results = await searchAll(q, sources, ctrl.signal);
        if (!ctrl.signal.aborted) {
          setState({ loading: false, results });
          useSettings.getState().pushSearch(q);
        }
      } catch (e) {
        if (!ctrl.signal.aborted) setState({ loading: false, results: [], error: (e as Error).message });
      }
    })();
    return () => ctrl.abort();
  }, [q, sources.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const genreBrowse = useAsync(() => (genreParam && !q ? audius.trending!({ genre: genreParam, time: 'month' }) : Promise.resolve([])), [genreParam, q]);

  const merged = useMemo(() => {
    // full-length tracks first, 30-second previews after (stable order within each group)
    const all = state.results.flatMap((r) => r.results.tracks);
    const tracks = [...all.filter((t) => t.playability !== 'preview'), ...all.filter((t) => t.playability === 'preview')];
    const artists = state.results.flatMap((r) => r.results.artists);
    const collections = state.results.flatMap((r) => r.results.collections);
    const genres = [...new Set(tracks.map((t) => normalizeGenre(t.genre)).filter(Boolean) as string[])].slice(0, 12);
    const byGenre = genreFilter ? tracks.filter((t) => normalizeGenre(t.genre) === genreFilter) : tracks;
    return {
      tracks: byGenre.filter((t) => !isSet(t)),
      remixes: byGenre.filter(isRemix),
      sets: byGenre.filter(isSet),
      artists,
      albums: collections.filter((c) => c.kind === 'album'),
      playlists: collections.filter((c) => c.kind === 'playlist'),
      genres,
    };
  }, [state.results, genreFilter]);

  const errors = state.results.filter((r) => r.error);
  const previewShare = merged.tracks.length ? merged.tracks.filter((t) => t.playability === 'preview').length / merged.tracks.length : 0;
  const total = merged.tracks.length + merged.sets.length + merged.artists.length + merged.albums.length + merged.playlists.length;
  const suggestions = input
    ? [
        ...history.filter((h) => h.toLowerCase().startsWith(input.toLowerCase()) && h !== input),
        ...GENRES.filter((g) => g.toLowerCase().includes(input.toLowerCase())).map((g) => `${g}`),
      ].slice(0, 6)
    : [];
  const ctx = { label: `Поиск: ${q}`, path: `/search?q=${encodeURIComponent(q)}` };
  const show = (k: TypeKey) => type === 'all' || type === k;

  return (
    <div className="page-pad pt-[calc(12px+var(--safe-t))]">
      <div className="sticky top-0 z-20 px-4 pt-3 pb-4 md:px-8 md:pt-6">
        <h1 className="mb-3 text-3xl font-semibold tracking-tight md:hidden">Поиск</h1>
        <div className="relative">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              update({ q: input.trim(), genre: '' });
              inputRef.current?.blur();
            }}
            className="glass flex h-12 items-center gap-2 rounded-full pr-1.5 pl-5 transition-shadow focus-within:shadow-[0_0_0_1px_rgba(255,255,255,0.25)]"
          >
            <SearchIcon className="size-5 shrink-0 text-fg-2" />
            <label htmlFor="search-input" className="sr-only">Поиск музыки</label>
            <input
              id="search-input"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              placeholder="Треки, артисты, ремиксы, сеты или ссылка SoundCloud"
              autoComplete="off"
              enterKeyHint="search"
              className="h-full min-w-0 flex-1 appearance-none border-0 bg-transparent text-[16px] outline-none ring-0 placeholder:text-fg-3"
            />
            {input && (
              <IconButton label="Очистить" size="sm" onClick={() => (setInput(''), update({ q: '' }), inputRef.current?.focus())}>
                <X className="size-4" />
              </IconButton>
            )}
          </form>
          <AnimatePresence>
            {focused && suggestions.length > 0 && (
              <motion.ul
                role="listbox"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={softSpring}
                className="glass glass-strong absolute inset-x-0 top-14 z-30 overflow-hidden rounded-2xl p-1.5"
              >
                {suggestions.map((s) => (
                  <li key={s}>
                    <button onMouseDown={(e) => e.preventDefault()} onClick={() => (setInput(s), update({ q: s }), inputRef.current?.blur())} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-hover">
                      {history.includes(s) ? <Clock className="size-4 text-fg-3" /> : <SearchIcon className="size-4 text-fg-3" />}
                      {s}
                    </button>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>

        {(q || source !== 'all') && !linkMode && (
          <div className="no-scrollbar mt-3 -mx-4 flex gap-2 overflow-x-auto px-4 md:-mx-8 md:px-8">
            {SOURCES.map((s) => (
              <Chip key={s} active={source === s} onClick={() => update({ source: s === 'all' ? '' : s })}>
                {s === 'all' ? 'Все источники' : SOURCE_META[s].label}
              </Chip>
            ))}
          </div>
        )}
        {q && !linkMode && (
          <div className="no-scrollbar mt-2 -mx-4 flex gap-2 overflow-x-auto px-4 md:-mx-8 md:px-8">
            {TYPES.map(([k, label]) => (
              <Chip key={k} active={type === k} onClick={() => update({ type: k === 'all' ? '' : k })} className="h-7 text-[12.5px]">
                {label}
              </Chip>
            ))}
            {merged.genres.length > 1 && (
              <>
                <label htmlFor="genre-filter" className="sr-only">Фильтр по жанру</label>
                <select id="genre-filter" value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)} className="h-7 shrink-0 rounded-full bg-surface px-3 text-[12.5px] font-medium text-fg-2 outline-none">
                  <option value="">Любой жанр</option>
                  {merged.genres.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Empty query: history + genres ── */}
      {!q && !genreParam && (
        <div>
          {history.length > 0 && (
            <section className="mt-2">
              <SectionHeader title="Недавние запросы" action={<button onClick={() => useSettings.setState({ searchHistory: [] })} className="text-sm font-semibold text-fg-2 hover:text-fg">Очистить</button>} />
              <div className="flex flex-wrap gap-2 px-4 md:px-8">
                {history.map((h) => (
                  <Chip key={h} onClick={() => (setInput(h), update({ q: h }))}><Clock className="mr-1.5 inline size-3.5" />{h}</Chip>
                ))}
              </div>
            </section>
          )}
          <section className="mt-8">
            <SectionHeader title="Жанры" subtitle="Популярное в жанре за месяц" />
            <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 md:px-8 lg:grid-cols-4 xl:grid-cols-6">
              {GENRES.map((g, i) => {
                const h = hashHue(g);
                return (
                  <motion.button
                    key={g}
                    onClick={() => update({ genre: g })}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...softSpring, delay: Math.min(i, 18) * 0.015 }}
                    whileTap={{ scale: 0.96 }}
                    className="relative h-20 overflow-hidden rounded-2xl p-3 text-left text-[15px] font-bold text-white"
                    style={{ background: `linear-gradient(135deg, hsl(0 0% ${30 + (h % 18)}% / 0.55), hsl(0 0% ${10 + (h % 8)}% / 0.35))` }}
                  >
                    {g}
                  </motion.button>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* ── Genre browse ── */}
      {!q && genreParam && (
        <section className="mt-2">
          <SectionHeader title={genreParam} subtitle="В тренде за месяц · Audius" action={<button onClick={() => update({ genre: '' })} className="text-sm font-semibold text-fg-2 hover:text-fg">Все жанры</button>} />
          {genreBrowse.loading ? <RowsSkeleton /> : genreBrowse.error ? <ErrorState message={genreBrowse.error} onRetry={genreBrowse.reload} /> : genreBrowse.data!.length ? (
            <TrackList tracks={genreBrowse.data!} context={{ label: genreParam, path: `/search?genre=${encodeURIComponent(genreParam)}` }} className="px-2 md:px-6" showIndex />
          ) : <EmptyState icon={<SearchX />} title="Пока пусто" text="В этом жанре сейчас нет трендовых треков." />}
        </section>
      )}

      {/* ── Results ── */}
      {q && state.loading && <RowsSkeleton />}
      {q && !state.loading && state.error && <ErrorState message={state.error} />}
      {q && !state.loading && state.linkTrack && (
        <section>
          <SectionHeader title="Трек по ссылке" subtitle="SoundCloud" />
          <TrackList tracks={[state.linkTrack]} className="px-2 md:px-6" />
        </section>
      )}

      {q && !state.loading && !linkMode && (
        <>
          {errors.map((e) => (
            <div key={e.source} className="mx-4 mb-3 flex gap-2.5 rounded-2xl bg-surface p-3 text-[13px] text-fg-2 md:mx-8">
              <Info className="mt-0.5 size-4 shrink-0" style={{ color: SOURCE_META[e.source].color }} />
              <span>
                <b className="text-fg">{SOURCE_META[e.source].label}:</b>{' '}
                {e.error!.code === 'not-configured'
                  ? 'поиск по названию требует платных ключей API. Вставьте сюда ссылку на артиста, плейлист или трек SoundCloud — AURA покажет и сыграет все треки целиком.'
                  : e.error!.message}
              </span>
            </div>
          ))}
          {previewShare > 0.5 && (
            <div className="mx-4 mb-4 rounded-[22px] bg-surface p-4 md:mx-8">
              <div className="font-semibold">Здесь в основном 30-секундные превью</div>
              <p className="mt-1 text-sm text-fg-2">
                Полные версии таких треков обычно есть на SoundCloud. Найдите там артиста или плейлист, скопируйте ссылку и вставьте её в поиск — AURA покажет все его треки целиком.
              </p>
              <a href={soundcloudSearchUrl(q)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-fg px-4 text-sm font-semibold text-bg">
                Найти «{q}» на SoundCloud <ExternalLink className="size-4" />
              </a>
            </div>
          )}
          {total === 0 && !errors.length && (
            <EmptyState icon={<SearchX />} title="Ничего не найдено" text={`По запросу «${q}» нет результатов${source !== 'all' ? ` в ${SOURCE_META[source].label}` : ''}. Попробуйте другое написание или другой источник.`} />
          )}

          {show('artists') && merged.artists.length > 0 && (
            <section className="mt-4">
              <SectionHeader title="Исполнители" />
              <Shelf>{merged.artists.map((a, i) => <ArtistCard key={a.id} a={a} index={i} />)}</Shelf>
            </section>
          )}
          {show('tracks') && merged.tracks.length > 0 && (
            <section className="mt-6">
              <SectionHeader title="Треки" subtitle={`${merged.tracks.length} результатов`} />
              <TrackList tracks={type === 'all' ? merged.tracks.slice(0, 12) : merged.tracks} context={ctx} className="px-2 md:px-6" />
              {type === 'all' && merged.tracks.length > 12 && (
                <button onClick={() => update({ type: 'tracks' })} className="mx-4 mt-2 text-sm font-semibold text-fg-2 hover:text-fg md:mx-8">Показать все треки</button>
              )}
            </section>
          )}
          {show('remixes') && merged.remixes.length > 0 && (
            <section className="mt-6">
              <SectionHeader title="Ремиксы и эдиты" />
              <TrackList tracks={type === 'all' ? merged.remixes.slice(0, 6) : merged.remixes} context={ctx} className="px-2 md:px-6" />
            </section>
          )}
          {show('sets') && merged.sets.length > 0 && (
            <section className="mt-6">
              <SectionHeader title="DJ-сеты и миксы" subtitle="Длинные треки и записи с пометкой mix / set" />
              <TrackList tracks={merged.sets} context={ctx} className="px-2 md:px-6" />
            </section>
          )}
          {show('albums') && merged.albums.length > 0 && (
            <section className="mt-6">
              <SectionHeader title="Альбомы" />
              <Shelf>{merged.albums.map((c, i) => <CollectionCard key={c.id} c={c} index={i} />)}</Shelf>
            </section>
          )}
          {show('playlists') && merged.playlists.length > 0 && (
            <section className="mt-6">
              <SectionHeader title="Плейлисты и сеты" />
              <Shelf>{merged.playlists.map((c, i) => <CollectionCard key={c.id} c={c} index={i} />)}</Shelf>
            </section>
          )}
          {type !== 'all' && total > 0 && (
            (type === 'tracks' && !merged.tracks.length) || (type === 'artists' && !merged.artists.length) || (type === 'albums' && !merged.albums.length) ||
            (type === 'playlists' && !merged.playlists.length) || (type === 'remixes' && !merged.remixes.length) || (type === 'sets' && !merged.sets.length)
          ) && <EmptyState title="В этой категории пусто" text="Попробуйте другую категорию или источник." className={cn('py-8')} />}
        </>
      )}
    </div>
  );
}
