/**
 * Playback engines. Each one wraps a real audio backend and reports its true
 * state (time, duration, buffering, end, errors) — nothing is simulated.
 *
 * - HtmlAudioEngine: <audio> element (+ hls.js when the browser lacks native
 *   HLS). Optional Web Audio analyser for the visualizer.
 * - SoundCloudWidgetEngine: SoundCloud's official embedded player, controlled
 *   via its Widget API. Used for SoundCloud links when no API keys are set.
 */
import type Hls from 'hls.js';

export interface EngineEvents {
  time(current: number, duration: number): void;
  playing(): void;
  paused(): void;
  ended(): void;
  waiting(): void;
  error(message: string): void;
}

export interface Engine {
  load(url: string, opts: { autoplay: boolean; hls?: boolean; startAt?: number; fallbacks?: string[]; key?: string }): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(sec: number): void;
  setVolume(v: number): void;
  stop(): void;
}

// ─────────────────────────── HTML5 audio ───────────────────────────

export class HtmlAudioEngine implements Engine {
  /**
   * Two elements: `el` plays, `standby` quietly buffers the next track. When
   * the next track starts we swap them, so playback begins almost instantly.
   */
  el: HTMLAudioElement;
  private standby: HTMLAudioElement;
  /** which track the standby element holds (track id, not URL — URLs change as redirects resolve) */
  private standbyKey = '';
  private hls: Hls | null = null;
  private ctx: AudioContext | null = null;
  /** alternative URLs for the current track, tried silently before reporting an error */
  private fallbacks: string[] = [];
  private wantPlay = false;
  private volume = 1;
  private loadToken = 0;
  analyser: AnalyserNode | null = null;

  constructor(private ev: EngineEvents) {
    this.el = this.create();
    this.standby = this.create();
  }

  private create() {
    const el = new Audio();
    // All bundled sources serve audio with CORS headers, which keeps the
    // analyser (visualizer) able to read samples.
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    // Every listener ignores the standby element.
    const on = (type: string, fn: () => void) => el.addEventListener(type, () => el === this.el && fn());
    on('timeupdate', () => this.ev.time(el.currentTime, this.duration()));
    on('durationchange', () => this.ev.time(el.currentTime, this.duration()));
    on('playing', () => this.ev.playing());
    on('pause', () => this.ev.paused());
    on('ended', () => this.ev.ended());
    on('waiting', () => this.ev.waiting());
    on('error', () => {
      if (!el.src || el.src === location.href) return;
      const next = this.fallbacks.shift();
      if (next && !this.hls) {
        el.src = next;
        if (this.wantPlay) void this.play().catch(() => {});
        return;
      }
      const code = el.error?.code;
      this.ev.error(
        code === MediaError.MEDIA_ERR_NETWORK
          ? 'Сетевая ошибка при загрузке аудио'
          : code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
            ? 'Трек недоступен или формат не поддерживается'
            : 'Не удалось воспроизвести трек',
      );
    });
    if (this.ctx && this.analyser) this.connect(el);
    return el;
  }

  private duration() {
    const d = this.el.duration;
    return Number.isFinite(d) ? d : 0;
  }

  /** Start buffering a track that will probably play next. */
  preload(url: string, key: string) {
    if (!url || key === this.standbyKey) return;
    this.standbyKey = key;
    this.standby.src = url;
    this.standby.load();
  }

  async load(url: string, { autoplay, hls, startAt, fallbacks, key }: { autoplay: boolean; hls?: boolean; startAt?: number; fallbacks?: string[]; key?: string }) {
    const token = ++this.loadToken;
    this.hls?.destroy();
    this.hls = null;
    this.fallbacks = [...(fallbacks ?? [])];
    this.wantPlay = autoplay;

    if (!hls && key && key === this.standbyKey && this.standby.error == null) {
      // Next track is already buffering: swap the elements.
      const old = this.el;
      this.el = this.standby;
      this.standby = old;
      old.pause();
      old.removeAttribute('src');
      old.load();
      this.standbyKey = '';
      this.el.volume = this.volume;
      this.el.currentTime = 0;
    } else if (hls && !this.el.canPlayType('application/vnd.apple.mpegurl')) {
      const { default: HlsCtor } = await import('hls.js');
      if (token !== this.loadToken) return;
      const h = new HlsCtor({ maxBufferLength: 30 });
      h.on(HlsCtor.Events.ERROR, (_e, data) => data.fatal && this.ev.error('Ошибка потока HLS'));
      h.loadSource(url);
      h.attachMedia(this.el);
      this.hls = h;
    } else {
      this.el.src = url;
    }

    const el = this.el;
    if (startAt) {
      const apply = () => token === this.loadToken && (el.currentTime = startAt);
      if (el.readyState >= 1) apply();
      else el.addEventListener('loadedmetadata', apply, { once: true });
    }
    if (autoplay) await this.play();
  }

  async play() {
    this.wantPlay = true;
    await this.ctx?.resume().catch(() => {});
    try {
      await this.el.play();
    } catch (e) {
      // AbortError = a newer load() interrupted this play() — not a real error.
      if ((e as DOMException).name === 'AbortError') return;
      if ((e as DOMException).name === 'NotAllowedError') {
        this.ev.paused();
        return;
      }
      throw e;
    }
  }
  pause() {
    this.wantPlay = false;
    this.el.pause();
  }
  seek(sec: number) {
    if (Number.isFinite(sec)) this.el.currentTime = Math.max(0, sec);
  }
  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    this.el.volume = this.volume;
    this.standby.volume = this.volume;
  }
  stop() {
    this.loadToken++;
    this.wantPlay = false;
    this.el.pause();
    this.hls?.destroy();
    this.hls = null;
    this.el.removeAttribute('src');
    this.el.load();
  }

  private sources = new WeakSet<HTMLAudioElement>();
  private connect(el: HTMLAudioElement) {
    if (!this.ctx || !this.analyser || this.sources.has(el)) return;
    this.ctx.createMediaElementSource(el).connect(this.analyser);
    this.sources.add(el);
  }

  /**
   * Routes both elements through Web Audio once. Called lazily the first time
   * the visualizer is shown, because once connected an element can only be
   * heard through the AudioContext.
   */
  ensureAnalyser(): AnalyserNode | null {
    if (this.analyser) return this.analyser;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      const an = this.ctx.createAnalyser();
      an.fftSize = 256;
      an.smoothingTimeConstant = 0.8;
      an.connect(this.ctx.destination);
      this.analyser = an;
      this.connect(this.el);
      this.connect(this.standby);
      if (!this.el.paused) this.ctx.resume().catch(() => {});
      return an;
    } catch {
      return null;
    }
  }
}

// ─────────────────────── SoundCloud Widget API ───────────────────────

interface SCWidget {
  bind(ev: string, cb: (e?: { currentPosition: number; relativePosition: number }) => void): void;
  load(url: string, opts: Record<string, unknown>): void;
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  setVolume(v: number): void;
  getDuration(cb: (ms: number) => void): void;
}
interface SCGlobal {
  Widget: ((el: HTMLIFrameElement) => SCWidget) & { Events: Record<string, string> };
}

let apiPromise: Promise<SCGlobal> | null = null;
function loadWidgetApi(): Promise<SCGlobal> {
  apiPromise ??= new Promise((resolve, reject) => {
    const w = window as unknown as { SC?: SCGlobal };
    if (w.SC) return resolve(w.SC);
    const s = document.createElement('script');
    s.src = 'https://w.soundcloud.com/player/api.js';
    s.async = true;
    s.onload = () => (w.SC ? resolve(w.SC) : reject(new Error('SoundCloud widget failed to load')));
    s.onerror = () => {
      apiPromise = null;
      reject(new Error('Не удалось загрузить плеер SoundCloud'));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

const widgetSrc = (url: string, autoplay: boolean) =>
  `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=${autoplay}&visual=false&show_artwork=false&buying=false&sharing=false&download=false&show_comments=false&single_active=true&color=%23d4d4d8`;

export class SoundCloudWidgetEngine implements Engine {
  private iframe: HTMLIFrameElement | null = null;
  private widget: SCWidget | null = null;
  private duration = 0;
  private volume = 1;
  private loadToken = 0;
  private active = false;

  constructor(private ev: EngineEvents) {}

  async load(url: string, { autoplay, startAt }: { autoplay: boolean; startAt?: number }) {
    const token = ++this.loadToken;
    const SC = await loadWidgetApi();
    if (token !== this.loadToken) return;
    this.duration = 0;

    const ready = () =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('SoundCloud не отдал трек — он удалён, приватный или закрыт для встраивания')), 15000);
        const onReady = () => {
          clearTimeout(timer);
          this.widget!.getDuration((ms) => {
            this.duration = ms / 1000;
            this.ev.time(0, this.duration);
          });
          this.widget!.setVolume(this.volume * 100);
          if (startAt) this.widget!.seekTo(startAt * 1000);
          if (autoplay) this.widget!.play();
          resolve();
        };
        if (!this.iframe) {
          const f = (this.iframe = document.createElement('iframe'));
          f.allow = 'autoplay; encrypted-media';
          f.title = 'SoundCloud player';
          // The official player stays in the DOM and is shown with attribution
          // inside the Now Playing screen (see .sc-dock in index.css).
          f.className = this.active ? 'sc-dock active' : 'sc-dock';
          f.src = widgetSrc(url, autoplay);
          document.body.appendChild(f);
          const w = (this.widget = SC.Widget(f));
          const E = SC.Widget.Events;
          w.bind(E.READY, onReady);
          w.bind(E.PLAY, () => this.ev.playing());
          w.bind(E.PAUSE, () => this.ev.paused());
          w.bind(E.FINISH, () => this.ev.ended());
          w.bind(E.ERROR, () => this.ev.error('SoundCloud не разрешает играть этот трек вне своего сайта (Go+, запрет автора или ограничение по стране)'));
          w.bind(E.PLAY_PROGRESS, (e) => {
            if (!e) return;
            if (!this.duration && e.relativePosition > 0) this.duration = e.currentPosition / e.relativePosition / 1000;
            this.ev.time(e.currentPosition / 1000, this.duration);
          });
        } else {
          this.widget!.load(url, { auto_play: autoplay, visual: false, show_artwork: false, color: '#d4d4d8', callback: onReady });
        }
      });
    await ready();
  }

  async play() {
    this.widget?.play();
  }
  pause() {
    this.widget?.pause();
  }
  seek(sec: number) {
    this.widget?.seekTo(Math.max(0, sec) * 1000);
  }
  setVolume(v: number) {
    this.volume = v;
    this.widget?.setVolume(Math.round(v * 100));
  }
  stop() {
    this.loadToken++;
    this.widget?.pause();
  }
  setActive(active: boolean) {
    this.active = active;
    this.iframe?.classList.toggle('active', active);
  }
}

// ─────────────────────── Mixcloud Widget API ───────────────────────
// https://www.mixcloud.com/developers/widget/

interface MCWidget {
  ready: Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(sec: number): Promise<boolean>;
  setVolume?(v: number): Promise<void>;
  getDuration(): Promise<number>;
  events: Record<'progress' | 'play' | 'pause' | 'ended' | 'error' | 'buffering', { on(fn: (...a: number[]) => void): void }>;
}
interface MCGlobal {
  PlayerWidget(el: HTMLIFrameElement): MCWidget;
}

let mcApi: Promise<MCGlobal> | null = null;
function loadMixcloudApi(): Promise<MCGlobal> {
  mcApi ??= new Promise((resolve, reject) => {
    const w = window as unknown as { Mixcloud?: MCGlobal };
    if (w.Mixcloud) return resolve(w.Mixcloud);
    const s = document.createElement('script');
    s.src = 'https://widget.mixcloud.com/media/js/widgetApi.js';
    s.async = true;
    s.onload = () => (w.Mixcloud ? resolve(w.Mixcloud) : reject(new Error('Mixcloud недоступен')));
    s.onerror = () => {
      mcApi = null;
      reject(new Error('Не удалось загрузить плеер Mixcloud'));
    };
    document.head.appendChild(s);
  });
  return mcApi;
}

export class MixcloudWidgetEngine implements Engine {
  private iframe: HTMLIFrameElement | null = null;
  private widget: MCWidget | null = null;
  private volume = 1;
  private token = 0;
  private active = false;
  private duration = 0;

  constructor(private ev: EngineEvents) {}

  /** `url` is the cloudcast key, e.g. "/user/show-name/". */
  async load(key: string, { autoplay, startAt }: { autoplay: boolean; startAt?: number }) {
    const token = ++this.token;
    const MC = await loadMixcloudApi();
    if (token !== this.token) return;
    // A fresh iframe per show is the most reliable way to switch shows.
    this.iframe?.remove();
    const f = (this.iframe = document.createElement('iframe'));
    f.className = this.active ? 'mc-dock active' : 'mc-dock';
    f.allow = 'autoplay; encrypted-media';
    f.title = 'Mixcloud player';
    f.src = `https://player-widget.mixcloud.com/widget/iframe/?${new URLSearchParams({
      feed: key,
      hide_cover: '1',
      mini: '1',
      hide_artwork: '1',
      autoplay: autoplay ? '1' : '0',
    })}`;
    document.body.appendChild(f);
    const w = (this.widget = MC.PlayerWidget(f));
    const ok = await Promise.race([w.ready.then(() => true), new Promise<false>((r) => setTimeout(() => r(false), 15000))]);
    if (token !== this.token) return;
    if (!ok) throw new Error('Mixcloud не ответил — шоу удалено или недоступно в вашем регионе');
    const mine = () => token === this.token;
    w.events.progress.on((pos, dur) => mine() && this.ev.time(pos, (this.duration = dur || this.duration)));
    w.events.play.on(() => mine() && this.ev.playing());
    w.events.pause.on(() => mine() && this.ev.paused());
    w.events.buffering.on(() => mine() && this.ev.waiting());
    w.events.ended.on(() => mine() && this.ev.ended());
    w.events.error.on(() => mine() && this.ev.error('Mixcloud не может воспроизвести это шоу здесь'));
    this.duration = await w.getDuration().catch(() => 0);
    this.ev.time(0, this.duration);
    await w.setVolume?.(this.volume).catch(() => {});
    if (startAt) await w.seek(startAt).catch(() => false);
    if (autoplay) await w.play().catch(() => {});
  }
  async play() {
    await this.widget?.play().catch(() => {});
  }
  pause() {
    void this.widget?.pause().catch(() => {});
  }
  seek(sec: number) {
    // Mixcloud may refuse some seeks for licensing reasons; it then just keeps playing.
    void this.widget?.seek(Math.max(0, sec)).catch(() => false);
  }
  setVolume(v: number) {
    this.volume = v;
    void this.widget?.setVolume?.(v).catch(() => {});
  }
  stop() {
    this.token++;
    void this.widget?.pause().catch(() => {});
  }
  setActive(active: boolean) {
    this.active = active;
    this.iframe?.classList.toggle('active', active);
  }
}
