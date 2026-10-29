import { hashHue } from './util';

export type RGB = [number, number, number];
const cache = new Map<string, RGB>();

function hslToRgb(h: number, s: number, l: number): RGB {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

export const fallbackColor = (seed: string): RGB => hslToRgb(hashHue(seed), 0.55, 0.45);

/**
 * Extracts a vivid representative colour from cover art by sampling a 24×24
 * downscale and weighting pixels by saturation. Requires CORS-enabled images
 * (Audius, Apple and SoundCloud CDNs all send the header); otherwise falls back
 * to a stable colour derived from the track id.
 */
export function extractColor(url: string | undefined, seed: string): Promise<RGB> {
  if (!url) return Promise.resolve(fallbackColor(seed));
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 24;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, 24, 24);
        const d = ctx.getImageData(0, 0, 24, 24).data;
        let r = 0, g = 0, b = 0, wsum = 0;
        for (let i = 0; i < d.length; i += 4) {
          const R = d[i], G = d[i + 1], B = d[i + 2];
          const max = Math.max(R, G, B), min = Math.min(R, G, B);
          const sat = max === 0 ? 0 : (max - min) / max;
          const lum = (max + min) / 510;
          // prefer saturated mid-tones over near-black / near-white pixels
          const w = 0.05 + sat * sat * (1 - Math.abs(lum - 0.5) * 1.6);
          r += R * w; g += G * w; b += B * w; wsum += w;
        }
        let rgb: RGB = [r / wsum, g / wsum, b / wsum].map(Math.round) as RGB;
        // keep it readable as a dark-theme tint: clamp brightness
        const l = (Math.max(...rgb) + Math.min(...rgb)) / 510;
        if (l < 0.22) rgb = rgb.map((v) => Math.min(255, v + 50)) as RGB;
        if (l > 0.75) rgb = rgb.map((v) => v * 0.7) as RGB;
        cache.set(url, rgb);
        resolve(rgb);
      } catch {
        resolve(fallbackColor(seed));
      }
    };
    img.onerror = () => resolve(fallbackColor(seed));
    img.src = url;
  });
}

export const rgb = (c: RGB, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
