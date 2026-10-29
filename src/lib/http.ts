import { ProviderError } from '../providers/types';

/**
 * fetch + JSON with: in-memory TTL cache, request de-duplication,
 * a timeout, and friendly error codes. Keeps metadata cached "within reason"
 * (5 min by default, max 300 entries) — audio is never cached here.
 */
const cache = new Map<string, { at: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 300;

export async function getJSON<T>(
  url: string,
  opts: { ttl?: number; signal?: AbortSignal; timeout?: number } = {},
): Promise<T> {
  const ttl = opts.ttl ?? 5 * 60_000;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.data as T;
  if (!opts.signal && inflight.has(url)) return inflight.get(url) as Promise<T>;

  const p = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 12_000);
    opts.signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
    let res: Response;
    try {
      res = await fetch(url, { signal: ctrl.signal });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      throw new ProviderError(
        navigator.onLine ? 'Источник не ответил вовремя' : 'Нет подключения к интернету',
        'network',
      );
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429) throw new ProviderError('Слишком много запросов — попробуйте через минуту', 'rate-limit');
    if (res.status === 404) throw new ProviderError('Не найдено', 'not-found');
    if (res.status === 503) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ProviderError(body.error ?? 'Источник не настроен', 'not-configured');
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ProviderError(body.error ?? `Ошибка источника (${res.status})`, res.status === 403 ? 'unavailable' : 'unknown');
    }
    const data = (await res.json()) as T;
    cache.set(url, { at: Date.now(), data });
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    return data;
  })();

  if (!opts.signal) {
    inflight.set(url, p);
    p.finally(() => inflight.delete(url)).catch(() => {});
  }
  return p;
}

export const qs = (params: Record<string, string | number | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
