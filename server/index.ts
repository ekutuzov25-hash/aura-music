/**
 * Standalone server: `npm run dev` (API only, Vite serves the UI) and
 * `npm start` (production: UI + API on one port).
 */
import { join } from 'node:path';
import { createAuraServer, isSoundCloudConfigured } from './app.ts';

try {
  process.loadEnvFile('.env');
} catch {
  /* no .env — fine, integrations stay disabled */
}

const PROD = process.env.NODE_ENV === 'production';
// In dev the API always listens on 8787 (Vite proxies /api there); in production
// it serves everything on PORT, as hosting platforms expect.
const PORT = Number(process.env.API_PORT || (PROD && process.env.PORT) || 8787);

createAuraServer({ distDir: PROD ? join(process.cwd(), 'dist') : undefined }).listen(PORT, () => {
  console.log(`AURA API on http://localhost:${PORT}  (SoundCloud: ${isSoundCloudConfigured() ? 'configured' : 'not configured'})`);
});
