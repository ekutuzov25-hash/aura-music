/**
 * Mirrors the local library & profile to Supabase while signed in.
 * Strategy: local-first. On sign-in we pull and merge (newest wins per
 * playlist, unions for likes/saved items), then push debounced changes.
 */
import { useLibrary, type LibraryState, type Playlist } from '../store/library';
import { useSettings, type Profile } from '../store/settings';
import { toast } from '../store/ui';
import { supabase, useAuth } from './auth';

interface PlaylistRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  cover: string | null;
  is_public: boolean;
  items: Playlist['items'];
  created_at: string;
  updated_at: string;
}

type LibData = Pick<LibraryState, 'likes' | 'artists' | 'collections' | 'history' | 'playCounts' | 'preferences' | 'updatedAt'>;

const toRow = (p: Playlist, owner: string): PlaylistRow => ({
  id: p.id,
  owner_id: owner,
  name: p.name,
  description: p.description,
  cover: p.cover ?? null,
  is_public: p.isPublic,
  items: p.items,
  created_at: new Date(p.createdAt).toISOString(),
  updated_at: new Date(p.updatedAt).toISOString(),
});
const fromRow = (r: PlaylistRow): Playlist => ({
  id: r.id,
  name: r.name,
  description: r.description ?? '',
  cover: r.cover ?? undefined,
  isPublic: r.is_public,
  items: r.items ?? [],
  createdAt: Date.parse(r.created_at),
  updatedAt: Date.parse(r.updated_at),
});

const unionBy = <T extends { item: { id: string }; addedAt: number }>(a: T[], b: T[]) => {
  const m = new Map<string, T>();
  [...a, ...b].forEach((x) => m.set(x.item.id, m.get(x.item.id) ?? x));
  return [...m.values()].sort((x, y) => y.addedAt - x.addedAt);
};

let pulling = false;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let lastProfileJSON = '';

async function pull(userId: string) {
  const sb = supabase!;
  pulling = true;
  try {
    const [pl, lib, prof] = await Promise.all([
      sb.from('playlists').select('*').eq('owner_id', userId),
      sb.from('user_library').select('data').eq('user_id', userId).maybeSingle(),
      sb.from('profiles').select('*').eq('id', userId).maybeSingle(),
    ]);
    if (pl.error) throw pl.error;
    const local = useLibrary.getState();
    const deleted = new Set(local.deletedPlaylistIds);

    const merged = new Map<string, Playlist>();
    for (const r of (pl.data ?? []) as PlaylistRow[]) if (!deleted.has(r.id)) merged.set(r.id, fromRow(r));
    for (const p of local.playlists) {
      const remote = merged.get(p.id);
      if (!remote || p.updatedAt >= remote.updatedAt) merged.set(p.id, p);
    }

    const remoteLib = (lib.data?.data ?? null) as LibData | null;
    const patch: Partial<LibraryState> = { playlists: [...merged.values()].sort((a, b) => b.createdAt - a.createdAt) };
    if (remoteLib) {
      patch.likes = unionBy(local.likes, remoteLib.likes ?? []);
      patch.artists = unionBy(local.artists, remoteLib.artists ?? []);
      patch.collections = unionBy(local.collections, remoteLib.collections ?? []);
      const hist = new Map<string, LibraryState['history'][number]>();
      [...local.history, ...(remoteLib.history ?? [])]
        .sort((a, b) => b.playedAt - a.playedAt)
        .forEach((h) => !hist.has(h.track.id) && hist.set(h.track.id, h));
      patch.history = [...hist.values()].slice(0, 300);
      patch.playCounts = { ...(remoteLib.playCounts ?? {}) };
      for (const [k, v] of Object.entries(local.playCounts)) patch.playCounts[k] = Math.max(v, patch.playCounts[k] ?? 0);
      patch.preferences = (remoteLib.updatedAt ?? 0) > local.updatedAt ? remoteLib.preferences : local.preferences;
    }
    useLibrary.getState().replaceAll(patch);

    if (prof.data) {
      const p = prof.data as { username: string | null; display_name: string | null; bio: string | null; avatar_url: string | null; is_private: boolean; show_history: boolean };
      useSettings.getState().setProfile({
        username: p.username ?? useSettings.getState().profile.username,
        displayName: p.display_name ?? useSettings.getState().profile.displayName,
        bio: p.bio ?? '',
        avatar: p.avatar_url ?? undefined,
        isPrivate: p.is_private,
        showHistory: p.show_history ?? true,
      });
    }
    lastProfileJSON = JSON.stringify(useSettings.getState().profile);
  } finally {
    pulling = false;
  }
  await push(userId);
}

async function push(userId: string) {
  const sb = supabase!;
  const s = useLibrary.getState();
  const rows = s.playlists.map((p) => toRow(p, userId));
  const results = await Promise.all([
    rows.length ? sb.from('playlists').upsert(rows) : Promise.resolve({ error: null }),
    s.deletedPlaylistIds.length ? sb.from('playlists').delete().in('id', s.deletedPlaylistIds) : Promise.resolve({ error: null }),
    sb.from('user_library').upsert({
      user_id: userId,
      data: {
        likes: s.likes,
        artists: s.artists,
        collections: s.collections,
        history: s.history.slice(0, 100),
        playCounts: s.playCounts,
        preferences: s.preferences,
        updatedAt: s.updatedAt,
      } satisfies LibData,
      updated_at: new Date().toISOString(),
    }),
  ]);
  const err = results.find((r) => r.error)?.error;
  if (err) throw err;
  if (s.deletedPlaylistIds.length) useLibrary.setState({ deletedPlaylistIds: [] });
}

export async function pushProfile(profile: Profile) {
  const user = useAuth.getState().user;
  if (!supabase || !user) return;
  const { error } = await supabase.from('profiles').upsert({
    id: user.id,
    username: profile.username || null,
    display_name: profile.displayName,
    bio: profile.bio,
    avatar_url: profile.avatar ?? null,
    is_private: profile.isPrivate,
    show_history: profile.showHistory,
    updated_at: new Date().toISOString(),
  });
  if (error?.code === '23505') throw new Error('Этот никнейм уже занят');
  if (error) throw new Error('Не удалось сохранить профиль на сервере');
  lastProfileJSON = JSON.stringify(profile);
}

export function startSync() {
  if (!supabase) return;
  let current: string | null = null;

  useAuth.subscribe((s) => {
    const id = s.user?.id ?? null;
    if (id === current) return;
    current = id;
    if (id) {
      pull(id)
        .then(() => toast('Библиотека синхронизирована', { tone: 'success' }))
        .catch(() => toast('Не удалось синхронизировать библиотеку — изменения сохранены локально', { tone: 'error' }));
    }
  });

  useLibrary.subscribe((s, prev) => {
    if (!current || pulling || s.updatedAt === prev.updatedAt) return;
    clearTimeout(pushTimer);
    const uid = current;
    pushTimer = setTimeout(() => push(uid).catch(() => toast('Нет связи с сервером — изменения сохранены локально', { tone: 'error' })), 1500);
  });

  useSettings.subscribe((s) => {
    if (!current || pulling) return;
    const json = JSON.stringify(s.profile);
    if (json === lastProfileJSON) return;
    lastProfileJSON = json;
    pushProfile(s.profile).catch((e: Error) => toast(e.message, { tone: 'error' }));
  });
}
