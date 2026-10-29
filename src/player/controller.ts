/**
 * The player controller: the only place that talks to the engines.
 * UI calls `player.*`; state flows back through the stores.
 */
import { getProvider } from '../providers/registry';
import type { Track } from '../providers/types';
import { useLibrary } from '../store/library';
import { toast } from '../store/ui';
import { shuffleArray } from '../lib/util';
import { findFullVersion } from '../providers/alternatives';
import { SOURCE_META } from '../providers/registry';
import { useSettings } from '../store/settings';
import { HtmlAudioEngine, MixcloudWidgetEngine, SoundCloudWidgetEngine, type Engine, type EngineEvents } from './engines';
import { usePlayerState as S, useProgress as P, type PlayContext } from './store';

let loadSeq = 0;
let countedFor: string | null = null;
let consecutiveErrors = 0;
let engine: Engine;

const events = (owner: () => Engine): EngineEvents => ({
  time(time, duration) {
    if (engine !== owner()) return;
    P.setState({ time, duration: duration || P.getState().duration, buffering: false });
    const t = current();
    // count a "play" for Your Rotation after 30 s of real listening
    if (t && countedFor !== t.id && time > 30) {
      countedFor = t.id;
      useLibrary.getState().countPlay(t);
    }
    updatePositionState();
  },
  playing() {
    if (engine !== owner()) return;
    consecutiveErrors = 0;
    prefetchUpcoming();
    S.setState({ status: 'playing', error: undefined });
    P.setState({ buffering: false });
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing';
  },
  paused() {
    if (engine !== owner()) return;
    if (S.getState().status === 'loading') return;
    S.setState({ status: 'paused' });
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
  },
  waiting() {
    if (engine === owner()) P.setState({ buffering: true });
  },
  ended() {
    if (engine !== owner()) return;
    if (S.getState().repeat === 'one') {
      engine.seek(0);
      void engine.play();
    } else {
      void player.next(true);
    }
  },
  error(message) {
    if (engine !== owner()) return;
    void recover(message);
  },
});

const audio: HtmlAudioEngine = new HtmlAudioEngine(events((): Engine => audio));
const widget: SoundCloudWidgetEngine = new SoundCloudWidgetEngine(events((): Engine => widget));
const mixcloudEngine: MixcloudWidgetEngine = new MixcloudWidgetEngine(events((): Engine => mixcloudEngine));
engine = audio;

/** Get the next two tracks ready while this one plays, so skipping is near-instant. */
function prefetchUpcoming() {
  const { queue, index, repeat } = S.getState();
  const upcoming = queue.slice(index + 1, index + 3).filter((t) => t.playability === 'full' || t.playability === 'preview');
  upcoming.forEach((t, i) =>
    Promise.resolve(getProvider(t.source).prefetch?.(t))
      .then(async () => {
        // buffer the very next track in the standby element
        if (i !== 0 || repeat === 'one') return;
        const s = await getProvider(t.source).resolveStream(t);
        if (s.kind === 'audio' && !s.hls && S.getState().queue[S.getState().index + 1]?.id === t.id) audio.preload(s.url, t.id);
      })
      .catch(() => {}),
  );
}

const current = (): Track | undefined => {
  const s = S.getState();
  return s.queue[s.index];
};

/** Put `alt` in place of the current track (queue and un-shuffled order). */
function swapCurrent(alt: Track, orig: Track) {
  const s = S.getState();
  const swap = (list: Track[]) => list.map((x) => (x.id === orig.id ? alt : x));
  S.setState({ queue: swap(s.queue), baseQueue: swap(s.baseQueue) });
}

/**
 * A track failed at runtime (e.g. SoundCloud refused it). Before skipping,
 * look for the same song in full on Audius and play that instead.
 */
async function recover(message: string) {
  const t = current();
  const seq = loadSeq;
  if (t && useSettings.getState().autoFullVersion && t.source !== 'audius' && t.source !== 'local') {
    S.setState({ status: 'loading' });
    const alt = await findFullVersion(t);
    if (seq !== loadSeq) return;
    if (alt) {
      swapCurrent(alt, t);
      toast(`«${t.title}» закрыт в ${SOURCE_META[t.source].label} — играет полная версия от артиста на Audius`);
      await loadCurrent(true);
      return;
    }
  }
  handleError(message);
}

function handleError(message: string) {
  const t = current();
  S.setState({ status: 'error', error: message });
  P.setState({ buffering: false });
  consecutiveErrors++;
  const { queue, index } = S.getState();
  const openOriginal = t?.permalink ? { label: 'Открыть', run: () => window.open(t.permalink, '_blank', 'noopener') } : undefined;
  if (consecutiveErrors < 4 && index < queue.length - 1) {
    toast(`${t?.title ?? 'Трек'}: ${message}. Переходим к следующему`, { tone: 'error', action: openOriginal });
    setTimeout(() => {
      if (S.getState().status === 'error') void player.next(true);
    }, 1500);
  } else {
    toast(message, { tone: 'error', action: openOriginal });
  }
}

async function loadCurrent(autoplay: boolean, startAt?: number) {
  const seq = ++loadSeq;
  const t = current();
  engine.stop();
  P.setState({ time: startAt ?? 0, duration: t?.duration ?? 0, buffering: autoplay });
  if (!t) {
    S.setState({ status: 'idle' });
    return;
  }
  updateMediaSession(t);
  // 30-second previews and tracks closed on their platform: prefer a full legal version
  if (useSettings.getState().autoFullVersion && (t.playability === 'preview' || t.playability === 'external')) {
    S.setState({ status: autoplay ? 'loading' : 'paused', error: undefined });
    const alt = await findFullVersion(t, 2500);
    if (seq !== loadSeq) return;
    if (alt) {
      swapCurrent(alt, t);
      toast(`Нашли полную версию «${t.title}» от артиста на Audius`, { tone: 'success' });
      return loadCurrent(autoplay, startAt);
    }
  }
  if (t.playability === 'unavailable' || t.playability === 'external') {
    handleError(t.playability === 'external' ? 'Доступен только на сайте источника' : 'Трек больше недоступен');
    return;
  }
  S.setState({ status: autoplay ? 'loading' : 'paused', error: undefined });
  try {
    const stream = await getProvider(t.source).resolveStream(t);
    if (seq !== loadSeq) return;
    const next = stream.kind === 'sc-widget' ? widget : stream.kind === 'mixcloud-widget' ? mixcloudEngine : audio;
    if (next !== engine) engine.stop();
    engine = next;
    widget.setActive(engine === widget);
    mixcloudEngine.setActive(engine === mixcloudEngine);
    const vol = S.getState().muted ? 0 : S.getState().volume;
    engine.setVolume(vol);
    S.setState({ mode: stream.kind, isPreview: stream.kind === 'audio' && !!stream.preview });
    await engine.load(stream.url, {
      autoplay,
      hls: stream.kind === 'audio' && stream.hls,
      startAt,
      fallbacks: stream.kind === 'audio' ? stream.fallbacks : undefined,
      key: t.id,
    });
    if (seq !== loadSeq) return;
    if (autoplay) {
      useLibrary.getState().recordPlay(t);
      countedFor = null;
    }
  } catch (e) {
    if (seq !== loadSeq) return;
    void recover((e as Error).message || 'Не удалось загрузить трек');
  }
}

// ─────────── Media Session: lock screen, notification, media keys ───────────
function updateMediaSession(t: Track) {
  if (!('mediaSession' in navigator)) return;
  const art = t.artworkXL ?? t.artworkLarge ?? t.artwork;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    album: t.album ?? S.getState().context?.label ?? 'AURA',
    artwork: art ? [{ src: art, sizes: '512x512' }] : [],
  });
}
let lastPos = 0;
function updatePositionState() {
  const now = performance.now();
  if (now - lastPos < 1000 || !navigator.mediaSession?.setPositionState) return;
  lastPos = now;
  const { time, duration } = P.getState();
  if (duration > 0 && time <= duration) {
    try {
      navigator.mediaSession.setPositionState({ duration, position: time, playbackRate: 1 });
    } catch {
      /* ignore */
    }
  }
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const set = (a: MediaSessionAction, h: MediaSessionActionHandler) => {
    try {
      ms.setActionHandler(a, h);
    } catch {
      /* unsupported action */
    }
  };
  set('play', () => void player.play());
  set('pause', () => player.pause());
  set('previoustrack', () => void player.prev());
  set('nexttrack', () => void player.next());
  set('seekto', (d) => d.seekTime != null && player.seek(d.seekTime));
  set('seekbackward', () => player.seekBy(-10));
  set('seekforward', () => player.seekBy(10));
}

// ─────────────────────────────── API ───────────────────────────────
export const player = {
  get audioEngine() {
    return audio;
  },

  async playTracks(tracks: Track[], start = 0, context?: PlayContext, opts: { shuffle?: boolean } = {}) {
    if (!tracks.length) return;
    const shuffle = opts.shuffle ?? S.getState().shuffle;
    let queue = tracks;
    let index = start;
    if (shuffle) {
      const first = tracks[start] ?? tracks[0];
      const rest = shuffleArray(tracks.filter((_, i) => i !== start));
      queue = opts.shuffle && start === 0 ? shuffleArray(tracks) : [first, ...rest];
      index = 0;
    }
    S.setState({ queue, baseQueue: tracks, index, context, shuffle });
    consecutiveErrors = 0;
    await loadCurrent(true);
  },

  async play() {
    const s = S.getState();
    if (s.index < 0) return;
    // After an error, or the first play after a page reload, nothing is loaded yet.
    if (s.status === 'error' || s.status === 'idle' || (engine === audio && !audio.el.src)) {
      return loadCurrent(true, P.getState().time || undefined);
    }
    S.setState({ status: 'loading' });
    try {
      await engine.play();
      const t = current();
      if (t && useLibrary.getState().history[0]?.track.id !== t.id) useLibrary.getState().recordPlay(t);
    } catch (e) {
      handleError((e as Error).message);
    }
  },
  pause() {
    engine.pause();
    S.setState({ status: 'paused' });
  },
  toggle() {
    const st = S.getState().status;
    if (st === 'playing' || st === 'loading') player.pause();
    else void player.play();
  },
  async next(auto = false) {
    const { queue, index, repeat } = S.getState();
    if (!queue.length) return;
    let i = index + 1;
    if (i >= queue.length) {
      if (repeat === 'all' || !auto) i = 0;
      else {
        player.pause();
        engine.seek(0);
        return;
      }
    }
    S.setState({ index: i });
    await loadCurrent(true);
  },
  async prev() {
    const { index, queue } = S.getState();
    // Standard behaviour: restart the track if we're more than 3 s in.
    if (P.getState().time > 3 || index <= 0) {
      engine.seek(0);
      P.setState({ time: 0 });
      if (index <= 0 && queue.length && S.getState().status !== 'playing') await player.play();
      return;
    }
    S.setState({ index: index - 1 });
    await loadCurrent(true);
  },
  seek(sec: number) {
    const d = P.getState().duration;
    const t = Math.max(0, Math.min(d || sec, sec));
    engine.seek(t);
    P.setState({ time: t });
  },
  seekBy(delta: number) {
    player.seek(P.getState().time + delta);
  },
  setVolume(v: number) {
    v = Math.min(1, Math.max(0, v));
    S.setState({ volume: v, muted: v === 0 });
    engine.setVolume(v);
  },
  toggleMute() {
    const { muted, volume } = S.getState();
    const m = !muted;
    S.setState({ muted: m, volume: !m && volume === 0 ? 0.5 : volume });
    engine.setVolume(m ? 0 : S.getState().volume);
  },
  toggleShuffle() {
    const { shuffle, queue, baseQueue, index } = S.getState();
    const cur = queue[index];
    if (!shuffle) {
      const rest = shuffleArray(queue.filter((_, i) => i !== index));
      S.setState({ shuffle: true, baseQueue: queue, queue: cur ? [cur, ...rest] : rest, index: cur ? 0 : -1 });
    } else {
      const base = baseQueue.length ? baseQueue : queue;
      // keep tracks added to the queue while shuffled
      const extra = queue.filter((t) => !base.some((b) => b.id === t.id));
      const restored = [...base, ...extra];
      S.setState({ shuffle: false, queue: restored, index: Math.max(0, restored.findIndex((t) => t.id === cur?.id)) });
    }
  },
  cycleRepeat() {
    const r = S.getState().repeat;
    S.setState({ repeat: r === 'off' ? 'all' : r === 'all' ? 'one' : 'off' });
  },
  /** Insert right after the current track. */
  playNext(tracks: Track[]) {
    const { index } = S.getState();
    // a track appears in the upcoming list only once
    const queue = S.getState().queue.filter((q, i) => i <= index || !tracks.some((t) => t.id === q.id));
    if (index < 0) return player.playTracks(tracks, 0, { label: 'Очередь' });
    const q = [...queue.slice(0, index + 1), ...tracks, ...queue.slice(index + 1)];
    S.setState({ queue: q, baseQueue: [...S.getState().baseQueue, ...tracks] });
    toast(tracks.length > 1 ? `${tracks.length} треков будут следующими` : `«${tracks[0].title}» будет следующим`);
  },
  addToQueue(tracks: Track[]) {
    const { queue, index } = S.getState();
    if (index < 0) return player.playTracks(tracks, 0, { label: 'Очередь' });
    tracks = tracks.filter((t) => !queue.slice(index + 1).some((q) => q.id === t.id));
    if (!tracks.length) return toast('Уже в очереди');
    S.setState({ queue: [...queue, ...tracks], baseQueue: [...S.getState().baseQueue, ...tracks] });
    toast(tracks.length > 1 ? `${tracks.length} треков добавлено в очередь` : `«${tracks[0].title}» в очереди`);
  },
  removeFromQueue(i: number) {
    const { queue, index } = S.getState();
    if (i === index) return;
    S.setState({ queue: queue.filter((_, k) => k !== i), index: i < index ? index - 1 : index });
  },
  reorderUpcoming(upcoming: Track[]) {
    const { queue, index } = S.getState();
    S.setState({ queue: [...queue.slice(0, index + 1), ...upcoming] });
  },
  async jumpTo(i: number) {
    S.setState({ index: i });
    await loadCurrent(true);
  },
  clearUpcoming() {
    const { queue, index } = S.getState();
    S.setState({ queue: queue.slice(0, index + 1) });
  },
};

// Apply persisted volume and show the restored track's length on boot.
audio.setVolume(S.getState().muted ? 0 : S.getState().volume);
P.setState({ duration: current()?.duration ?? 0 });
