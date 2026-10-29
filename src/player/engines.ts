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
  load(url: string, opts: { autoplay: boolean; hls?: boolean; startAt?: number }): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(sec: number): void;
  setVolume(v: number): void;
  stop(): void;
}

// ─────────────────────────── HTML5 audio ───────────────────────────

export class HtmlAudioEngine implements Engine {
  readonly el: HTMLAudioElement;
  private hls: Hls | null = null;
  private ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;

  constructor(private ev: EngineEvents) {
    const el = (this.el = new Audio());
    // All bundled sources serve audio with CORS headers, which keeps the
    // analyser (visualizer) able to read samples.
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.addEventListener('timeupdate', () => ev.time(el.currentTime, this.duration()));
    el.addEventListener('durationchange', () => ev.time(el.currentTime, this.duration()));
    el.addEventListener('playing', () => ev.playing());
    el.addEventListener('pause', () => ev.paused());
    el.addEventListener('ended', () => ev.ended());
    el.addEventListener('waiting', () => ev.waiting());
    el.addEventListener('error', () => {
      if (!el.src || el.src === location.href) return;
      const code = el.error?.code;
      ev.error(
        code === MediaError.MEDIA_ERR_NETWORK
          ? 'Сетевая ошибка при загрузке аудио'
          : code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
            ? 'Трек недоступен или формат не поддерживается'
            : 'Не удалось воспроизвести трек',
      );
    });
  }

  private duration() {
    const d = this.el.duration;
    return Number.isFinite(d) ? d : 0;
  }

  async load(url: string, { autoplay, hls, startAt }: { autoplay: boolean; hls?: boolean; startAt?: number }) {
    this.hls?.destroy();
    this.hls = null;
    const el = this.el;
    if (hls && !el.canPlayType('application/vnd.apple.mpegurl')) {
      const { default: HlsCtor } = await import('hls.js');
      const h = new HlsCtor({ maxBufferLength: 30 });
      h.on(HlsCtor.Events.ERROR, (_e, data) => data.fatal && this.ev.error('Ошибка потока HLS'));
      h.loadSource(url);
      h.attachMedia(el);
      this.hls = h;
    } else {
      el.src = url;
    }
    if (startAt) {
      const apply = () => {
        el.currentTime = startAt;
        el.removeEventListener('loadedmetadata', apply);
      };
      el.addEventListener('loadedmetadata', apply);
    }
    if (autoplay) await this.play();
  }

  async play() {
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
    this.el.pause();
  }
  seek(sec: number) {
    if (Number.isFinite(sec)) this.el.currentTime = Math.max(0, sec);
  }
  setVolume(v: number) {
    this.el.volume = Math.min(1, Math.max(0, v));
  }
  stop() {
    this.el.pause();
    this.hls?.destroy();
    this.hls = null;
    this.el.removeAttribute('src');
    this.el.load();
  }

  /**
   * Routes the element through Web Audio once. Called lazily the first time
   * the visualizer is shown, because once connected the element can only be
   * heard through the AudioContext.
   */
  ensureAnalyser(): AnalyserNode | null {
    if (this.analyser) return this.analyser;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      const src = this.ctx.createMediaElementSource(this.el);
      const an = this.ctx.createAnalyser();
      an.fftSize = 256;
      an.smoothingTimeConstant = 0.8;
      src.connect(an);
      an.connect(this.ctx.destination);
      this.analyser = an;
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
  `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=${autoplay}&visual=false&show_artwork=false&buying=false&sharing=false&download=false&show_comments=false&single_active=true`;

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
        const timer = setTimeout(() => reject(new Error('SoundCloud не ответил — трек мог быть удалён или закрыт')), 15000);
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
          w.bind(E.ERROR, () => this.ev.error('SoundCloud не может воспроизвести этот трек'));
          w.bind(E.PLAY_PROGRESS, (e) => {
            if (!e) return;
            if (!this.duration && e.relativePosition > 0) this.duration = e.currentPosition / e.relativePosition / 1000;
            this.ev.time(e.currentPosition / 1000, this.duration);
          });
        } else {
          this.widget!.load(url, { auto_play: autoplay, visual: false, show_artwork: false, callback: onReady });
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
