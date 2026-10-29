/**
 * AURA HTTP server, shared by the web deployment (server/index.ts) and the
 * desktop app (electron/main.ts).
 * - /api/health   → which integrations are configured (no secrets)
 * - /api/sc/*     → SoundCloud proxy (keeps client_secret on the server)
 * - distDir set   → also serves the built frontend (SPA fallback)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { handleSoundCloud, HttpError, isSoundCloudConfigured } from './soundcloud.ts';
import { billingConfig, confirmOrder, createCheckout, getSubscription, handleWebhook, userFromToken } from './billing.ts';

export interface ServerOptions {
  /** Folder with the Vite build; omit in development (Vite serves the UI). */
  distDir?: string;
  /** If set, requests with any other Host header are rejected (DNS-rebinding guard for the desktop app). */
  allowedHosts?: string[];
}

// Naive per-IP rate limit so a single client can't burn the SoundCloud quota.
const hits = new Map<string, { n: number; reset: number }>();
function rateLimited(ip: string) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) {
    hits.set(ip, { n: 1, reset: now + 60_000 });
    return false;
  }
  return ++h.n > 120;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, 'Body too large');
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

/** Public origin for payment return links: PUBLIC_URL if set, else the request's own host. */
function originOf(req: IncomingMessage) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? 'http';
  return `${proto}://${req.headers.host}`;
}

/** /api/billing/* — see server/billing.ts */
async function handleBilling(req: IncomingMessage, res: ServerResponse, path: string) {
  // The desktop app may call a deployed billing server: allow listed origins only.
  const origin = req.headers.origin;
  const allowed = (process.env.BILLING_CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  if (path === 'config' && req.method === 'GET') return json(res, 200, billingConfig());
  if (path === 'subscription' && req.method === 'GET') {
    if (!billingConfig().accounts) return json(res, 200, { subscription: null });
    const user = await userFromToken(req.headers.authorization);
    return json(res, 200, { subscription: await getSubscription(user.id) });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const body = (await readJson(req)) as Record<string, unknown>;
  if (path === 'checkout') return json(res, 200, await createCheckout(req.headers.authorization, String(body.plan ?? ''), originOf(req)));
  if (path === 'confirm') return json(res, 200, await confirmOrder(String(body.orderId ?? '')));
  if (path === 'webhook') return json(res, 200, await handleWebhook(body));
  return json(res, 404, { error: 'Not found' });
}

async function serveStatic(dist: string, req: IncomingMessage, res: ServerResponse) {
  const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  let file = normalize(join(dist, urlPath));
  if (!file.startsWith(dist)) return json(res, 403, { error: 'Forbidden' });
  try {
    if (!(await stat(file)).isFile()) throw new Error();
  } catch {
    file = join(dist, 'index.html'); // SPA fallback
  }
  const data = await readFile(file);
  const immutable = file.includes(join(dist, 'assets'));
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(data);
}

export function createAuraServer({ distDir, allowedHosts }: ServerOptions = {}) {
  return createServer(async (req, res) => {
    if (allowedHosts && !allowedHosts.includes(req.headers.host ?? '')) return json(res, 403, { error: 'Forbidden host' });
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/api/health') {
        return json(res, 200, { ok: true, soundcloud: isSoundCloudConfigured() });
      }
      if (url.pathname.startsWith('/api/sc')) {
        if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
        const ip = req.socket.remoteAddress ?? 'unknown';
        if (rateLimited(ip)) return json(res, 429, { error: 'Too many requests' });
        return json(res, 200, await handleSoundCloud(url.pathname, url.searchParams));
      }
      if (url.pathname.startsWith('/api/billing/')) {
        const ip = req.socket.remoteAddress ?? 'unknown';
        if (rateLimited(ip)) return json(res, 429, { error: 'Too many requests' });
        return await handleBilling(req, res, url.pathname.slice('/api/billing/'.length));
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
      if (distDir) return serveStatic(distDir, req, res);
      return json(res, 404, { error: 'In development the frontend is served by Vite on :5173' });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500 && status !== 503) console.error('[api]', err);
      return json(res, status, { error: err instanceof Error ? err.message : 'Server error' });
    }
  });
}

export { isSoundCloudConfigured };
