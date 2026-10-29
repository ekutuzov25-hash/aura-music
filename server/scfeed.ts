/**
 * SoundCloud podcast feeds — the official RSS that creators enable for
 * podcast apps (feeds.soundcloud.com). Many DJs publish their sets there with
 * full MP3 enclosures. The feed itself doesn't allow browser CORS, so the
 * server reads and parses it; the MP3s are then streamed by the browser
 * directly (they do send CORS headers).
 */
import { HttpError } from './soundcloud.ts';

export interface FeedItem {
  title: string;
  link: string;
  mp3: string;
  duration: number;
  published?: string;
  image?: string;
}

const cache = new Map<string, { at: number; data: { author: string; image?: string; items: FeedItem[] } }>();

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : undefined;
};
const attr = (xml: string, name: string, a: string) => xml.match(new RegExp(`<${name}[^>]*\\b${a}="([^"]+)"`))?.[1];
const toSeconds = (d?: string) => (!d ? 0 : d.split(':').reduce((acc, p) => acc * 60 + Number(p || 0), 0));

export async function soundcloudFeed(userId: string) {
  if (!/^\d{1,12}$/.test(userId)) throw new HttpError(400, 'Bad user id');
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.data;
  const res = await fetch(`https://feeds.soundcloud.com/users/soundcloud:users:${userId}/sounds.rss`, {
    headers: { 'User-Agent': 'AURA/0.1 (podcast reader)' },
  });
  // no podcast enabled for this account
  if (res.status === 404 || res.status === 403) return { author: '', items: [] };
  if (!res.ok) throw new HttpError(502, `SoundCloud feed ${res.status}`);
  const xml = await res.text();
  const channel = xml.split('<item>')[0];
  const author = tag(channel, 'itunes:author') ?? tag(channel, 'title') ?? '';
  const image = attr(channel, 'itunes:image', 'href');
  const items: FeedItem[] = [];
  for (const raw of xml.split('<item>').slice(1)) {
    const mp3 = attr(raw, 'enclosure', 'url');
    const link = tag(raw, 'link');
    if (!mp3 || !link || !/^https:\/\/feeds\.soundcloud\.com\/stream\//.test(mp3)) continue;
    items.push({
      title: tag(raw, 'title') ?? '',
      link,
      mp3,
      duration: toSeconds(tag(raw, 'itunes:duration')),
      published: tag(raw, 'pubDate'),
      image: attr(raw, 'itunes:image', 'href') ?? image,
    });
  }
  const data = { author, image, items };
  cache.set(userId, { at: Date.now(), data });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return data;
}
