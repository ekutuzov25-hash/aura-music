/**
 * SoundCloud API proxy.
 *
 * SoundCloud requires a registered app (client_id + client_secret). The secret
 * must never reach the browser, so all API calls go through this server.
 *
 * Auth: OAuth 2.1 Client Credentials → access token valid ~1h. SoundCloud
 * rate-limits token issuance, so the token is cached in memory and only
 * refreshed when it expires or a request returns 401.
 */

const TOKEN_URL = 'https://secure.soundcloud.com/oauth/token';
const API = 'https://api.soundcloud.com';

const clientId = () => process.env.SOUNDCLOUD_CLIENT_ID?.trim() ?? '';
const clientSecret = () => process.env.SOUNDCLOUD_CLIENT_SECRET?.trim() ?? '';

export const isSoundCloudConfigured = () => Boolean(clientId() && clientSecret());

let token: { value: string; expiresAt: number } | null = null;
let tokenPromise: Promise<string> | null = null;

async function fetchToken(): Promise<string> {
  const basic = Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json; charset=utf-8',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    throw new HttpError(res.status === 429 ? 429 : 502, `SoundCloud auth failed (${res.status})`);
  }
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  token = { value: json.access_token, expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000 };
  return token.value;
}

async function getToken(force = false): Promise<string> {
  if (!force && token && token.expiresAt > Date.now()) return token.value;
  // Coalesce concurrent refreshes into one request.
  tokenPromise ??= fetchToken().finally(() => (tokenPromise = null));
  return tokenPromise;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Small in-memory response cache to stay well inside SoundCloud's quotas.
const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_TTL = 5 * 60 * 1000;

async function scFetch(path: string, opts: { cache?: boolean; redirect?: 'follow' | 'manual' } = {}) {
  const useCache = opts.cache !== false;
  const hit = useCache ? cache.get(path) : undefined;
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;

  const run = async (t: string) =>
    fetch(`${API}${path}`, {
      headers: { Authorization: `OAuth ${t}`, Accept: 'application/json; charset=utf-8' },
      redirect: opts.redirect ?? 'follow',
    });

  let res = await run(await getToken());
  if (res.status === 401) res = await run(await getToken(true));
  if (res.status === 429) throw new HttpError(429, 'SoundCloud rate limit reached. Try again later.');
  if (res.status === 404) throw new HttpError(404, 'Not found on SoundCloud');
  if (!res.ok) throw new HttpError(502, `SoundCloud error ${res.status}`);

  const data = await res.json();
  if (useCache) {
    cache.set(path, { at: Date.now(), data });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
  }
  return data;
}

const enc = encodeURIComponent;
const clampLimit = (v: string | null) => String(Math.min(50, Math.max(1, Number(v) || 20)));

/** Routes under /api/sc/* — a whitelist, not an open proxy. */
export async function handleSoundCloud(pathname: string, params: URLSearchParams): Promise<unknown> {
  if (!isSoundCloudConfigured()) {
    throw new HttpError(503, 'SoundCloud is not configured on the server');
  }
  const parts = pathname.replace(/^\/api\/sc\/?/, '').split('/').filter(Boolean);
  const limit = clampLimit(params.get('limit'));

  // /api/sc/search?q=&type=tracks|users|playlists
  if (parts[0] === 'search') {
    const q = params.get('q')?.trim();
    if (!q) throw new HttpError(400, 'Missing q');
    const type = params.get('type') ?? 'tracks';
    if (!['tracks', 'users', 'playlists'].includes(type)) throw new HttpError(400, 'Bad type');
    const extra = type === 'playlists' ? '&show_tracks=false' : '';
    return scFetch(`/${type}?q=${enc(q)}&limit=${limit}&linked_partitioning=true${extra}`);
  }

  // /api/sc/resolve?url=
  if (parts[0] === 'resolve') {
    const url = params.get('url') ?? '';
    if (!/^https:\/\/(on\.|m\.)?soundcloud\.com\//.test(url)) throw new HttpError(400, 'Not a SoundCloud URL');
    return scFetch(`/resolve?url=${enc(url)}`);
  }

  const id = parts[1] ? enc(decodeURIComponent(parts[1])) : '';
  if (!id) throw new HttpError(400, 'Missing id');

  if (parts[0] === 'tracks' && parts.length === 2) return scFetch(`/tracks/${id}`);
  if (parts[0] === 'tracks' && parts[2] === 'related') return scFetch(`/tracks/${id}/related?limit=${limit}`);
  if (parts[0] === 'tracks' && parts[2] === 'stream') return resolveStream(id);
  if (parts[0] === 'users' && parts.length === 2) return scFetch(`/users/${id}`);
  if (parts[0] === 'users' && parts[2] === 'tracks') return scFetch(`/users/${id}/tracks?limit=${limit}&linked_partitioning=true`);
  if (parts[0] === 'users' && parts[2] === 'playlists')
    return scFetch(`/users/${id}/playlists?limit=${limit}&show_tracks=false&linked_partitioning=true`);
  if (parts[0] === 'playlists' && parts.length === 2) return scFetch(`/playlists/${id}?show_tracks=true`);

  throw new HttpError(404, 'Unknown SoundCloud route');
}

/**
 * /tracks/{id}/streams returns stream URLs that themselves need the OAuth
 * header. We follow that redirect server-side and only hand the browser the
 * resulting short-lived signed CDN URL — never the token.
 */
async function resolveStream(id: string) {
  const streams = (await scFetch(`/tracks/${id}/streams`, { cache: false })) as Record<string, string | undefined>;
  const candidates: Array<[string, boolean, boolean]> = [
    ['http_mp3_128_url', false, false],
    ['hls_aac_160_url', true, false],
    ['hls_mp3_128_url', true, false],
    ['preview_mp3_128_url', false, true],
  ];
  for (const [key, hls, preview] of candidates) {
    const apiUrl = streams[key];
    if (!apiUrl) continue;
    const t = await getToken();
    const res = await fetch(apiUrl, { headers: { Authorization: `OAuth ${t}` }, redirect: 'manual' });
    const location = res.headers.get('location');
    if (location) return { url: location, hls, preview };
    if (res.ok) {
      // Some endpoints answer with JSON { url } instead of a redirect.
      const body = (await res.json().catch(() => null)) as { url?: string } | null;
      if (body?.url) return { url: body.url, hls, preview };
    }
  }
  throw new HttpError(403, 'This track is not available for streaming via the API');
}
