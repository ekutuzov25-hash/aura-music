import { audius } from './audius';
import { itunes } from './itunes';
import { local } from './local';
import { soundcloud } from './soundcloud';
import type { MusicProvider, SearchResults, SourceId } from './types';
import { emptyResults, ProviderError } from './types';

/** Order matters: it's the order of results and of source chips in the UI. */
export const providers: MusicProvider[] = [soundcloud, audius, itunes, local];

export const getProvider = (id: SourceId): MusicProvider => {
  const p = providers.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown source ${id}`);
  return p;
};

export const SOURCE_META: Record<SourceId, { label: string; short: string; color: string }> = {
  soundcloud: { label: 'SoundCloud', short: 'SC', color: '#ff5500' },
  audius: { label: 'Audius', short: 'AU', color: '#cc0fe0' },
  itunes: { label: 'Apple · превью', short: '30s', color: '#fa2d48' },
  local: { label: 'Мои файлы', short: 'FILE', color: '#34c759' },
};

export interface SourceResult {
  source: SourceId;
  results: SearchResults;
  error?: { message: string; code: ProviderError['code'] };
}

/** Search all sources in parallel; one failing source never breaks the others. */
export async function searchAll(query: string, sources: SourceId[], signal?: AbortSignal): Promise<SourceResult[]> {
  return Promise.all(
    providers
      .filter((p) => sources.includes(p.id))
      .map(async (p): Promise<SourceResult> => {
        try {
          return { source: p.id, results: await p.search(query, signal) };
        } catch (e) {
          if (signal?.aborted) throw e;
          const err = e instanceof ProviderError ? e : new ProviderError(String((e as Error)?.message ?? e));
          return { source: p.id, results: emptyResults(), error: { message: err.message, code: err.code } };
        }
      }),
  );
}

/** Start resolving a track's stream when the user is about to play it (hover / touch). */
export function warmTrack(t: { source: SourceId; playability: string } & Parameters<NonNullable<MusicProvider['prefetch']>>[0]) {
  if (t.playability === 'full' || t.playability === 'preview') void getProvider(t.source).prefetch?.(t);
}

/** Splits a "source:id" global id. Source ids may themselves contain colons (URNs). */
export function splitId(id: string): { source: SourceId; sourceId: string } {
  const i = id.indexOf(':');
  return { source: id.slice(0, i) as SourceId, sourceId: id.slice(i + 1) };
}
