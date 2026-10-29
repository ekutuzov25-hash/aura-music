import { useEffect, useRef, useState } from 'react';
import { player } from '../../player/controller';
import { usePlayerState } from '../../player/store';
import { useSettings } from '../../store/settings';
import { useReducedMotion } from 'motion/react';
import { useIsPremium } from '../../billing/premium';

/**
 * Real-time spectrum from the Web Audio AnalyserNode — it moves only when
 * audio is actually playing. Not available for the SoundCloud widget (the
 * audio lives inside SoundCloud's iframe), in which case nothing is drawn.
 */
export function Visualizer({ className }: { className?: string }) {
  const enabled = useSettings((s) => s.visualizer);
  const mode = usePlayerState((s) => s.mode);
  const playing = usePlayerState((s) => s.status === 'playing');
  const reduce = useReducedMotion();
  const premium = useIsPremium();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ok, setOk] = useState(true);

  const active = premium && enabled && mode === 'audio' && !reduce;

  useEffect(() => {
    if (!active) return;
    const an = player.audioEngine.ensureAnalyser();
    if (!an) return setOk(false);
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    const data = new Uint8Array(an.frequencyBinCount);
    let raf = 0;
    let level = 0;
    let frame = 0;
    let dyn = '139,92,246';

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== w * dpr) {
        c.width = w * dpr;
        c.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      an.getByteFrequencyData(data);
      // the accent colour changes per track; re-read it about once a second
      if (frame++ % 60 === 0) dyn = getComputedStyle(document.documentElement).getPropertyValue('--dyn').trim().split(/\s+/).join(',');
      const bars = Math.min(56, Math.floor(w / 7));
      const gap = 3;
      const bw = (w - gap * (bars - 1)) / bars;
      // log-ish mapping so bass doesn't dominate
      const used = Math.floor(data.length * 0.72);
      let sum = 0;
      for (let i = 0; i < bars; i++) {
        const idx = Math.floor(Math.pow(i / bars, 1.6) * used);
        const v = data[idx] / 255;
        sum += v;
        const bh = Math.max(2, v * h * 0.95);
        const x = i * (bw + gap);
        ctx.fillStyle = `rgba(${dyn}, ${0.35 + v * 0.65})`;
        ctx.beginPath();
        ctx.roundRect(x, (h - bh) / 2, bw, bh, bw / 2);
        ctx.fill();
      }
      level = level * 0.85 + (sum / bars) * 0.15;
      c.style.setProperty('--level', level.toFixed(3));
    };
    if (playing) draw();
    else ctx.clearRect(0, 0, c.width, c.height);
    return () => cancelAnimationFrame(raf);
  }, [active, playing]);

  if (!active || !ok) return null;
  return <canvas ref={canvas} className={className} aria-hidden />;
}
