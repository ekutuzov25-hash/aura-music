import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useCurrentTrack } from './player/store';
import { useHotkeys } from './player/hotkeys';
import { useSettings } from './store/settings';
import { useUI } from './store/ui';
import { extractColor, rgb, type RGB } from './lib/color';
import { Sidebar, TabBar } from './components/Navigation';
import { MiniPlayer } from './components/player/MiniPlayer';
import { NowPlaying } from './components/player/NowPlaying';
import { QueuePanel } from './components/player/QueuePanel';
import { useElapsedTitle } from './components/player/controls';
import { TrackMenuHost } from './components/TrackRow';
import { CustomCursor } from './components/CustomCursor';
import { AddToPlaylistSheet, OfflineBanner, PaywallSheet, ShortcutsSheet, Toasts } from './components/GlobalOverlays';
import { usePremium } from './billing/premium';
import Home from './screens/Home';
// keeps Aura streams endless on every screen (refills the queue, learns from skips)
import './recommend/aura';

// Everything except Home is code-split so the first screen opens fast.
const Search = lazy(() => import('./screens/Search'));
const Library = lazy(() => import('./screens/Library'));
const Profile = lazy(() => import('./screens/Profile'));
const Settings = lazy(() => import('./screens/Settings'));
const Premium = lazy(() => import('./screens/Premium'));
const PlaylistDetails = lazy(() => import('./screens/PlaylistDetails'));
const ArtistDetails = lazy(() => import('./screens/Details').then((m) => ({ default: m.ArtistDetails })));
const CollectionDetails = lazy(() => import('./screens/Details').then((m) => ({ default: m.CollectionDetails })));
const MixDetails = lazy(() => import('./screens/Details').then((m) => ({ default: m.MixDetails })));

function QueueRoute() {
  const navigate = useNavigate();
  useEffect(() => {
    useUI.getState().setQueue(true);
    navigate('/', { replace: true });
  }, [navigate]);
  return null;
}

/** Applies theme, glass quality and the dynamic accent colour to <html>. */
function useAppearance() {
  const theme = useSettings((s) => s.theme);
  const lite = useSettings((s) => s.liteGlass);
  const dynamic = useSettings((s) => s.dynamicColor);
  const track = useCurrentTrack();
  // monochrome by default: a soft white accent unless «Цвет от обложки» is on
  const [accent, setAccent] = useState<RGB>([236, 236, 240]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const t = theme === 'system' ? (mq.matches ? 'light' : 'dark') : theme;
      document.documentElement.dataset.theme = t;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#f4f4f7' : '#07070a');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    // Weak devices (≤4 cores or data saver) default to lite glass automatically.
    const weak = (navigator.hardwareConcurrency ?? 8) <= 4 || (navigator as unknown as { connection?: { saveData?: boolean } }).connection?.saveData;
    document.documentElement.classList.toggle('lite', lite || !!weak);
  }, [lite]);

  useEffect(() => {
    let cancelled = false;
    if (!dynamic || !track) {
      setAccent([236, 236, 240]);
      return;
    }
    extractColor(track.artwork, track.id).then((c) => !cancelled && setAccent(c));
    return () => {
      cancelled = true;
    };
  }, [track?.id, dynamic]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.documentElement.style.setProperty('--dyn', accent.join(' '));
  }, [accent]);

  return accent;
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => (window.removeEventListener('online', on), window.removeEventListener('offline', off));
  }, []);
  return online;
}

export default function App() {
  const location = useLocation();
  const motionPref = useSettings((s) => s.motion);
  const hasTrack = !!useCurrentTrack();
  const accent = useAppearance();
  const online = useOnline();
  useHotkeys();
  useElapsedTitle();
  useEffect(() => {
    void usePremium.getState().refresh();
  }, []);

  // Reserve space at the bottom of pages for the floating player.
  useLayoutEffect(() => {
    const mobile = window.matchMedia('(max-width: 767px)').matches;
    document.documentElement.style.setProperty('--player-h', mobile ? (hasTrack ? '152px' : '80px') : '100px');
  }, [hasTrack]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <MotionConfig reducedMotion={motionPref === 'system' ? 'user' : motionPref === 'reduced' ? 'always' : 'never'}>
      {/* Ambient tint that follows the cover colour */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        animate={{ background: `radial-gradient(70% 55% at 70% -5%, ${rgb(accent, 0.12)}, transparent 70%)` }}
        transition={{ duration: 1.2, ease: 'easeInOut' }}
      />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:rounded-full focus:bg-fg focus:px-4 focus:py-2 focus:text-bg">
        Перейти к содержимому
      </a>
      {document.documentElement.dataset.desktop === 'darwin' && <div className="titlebar-drag" aria-hidden />}
      <Sidebar />
      <main id="main" className="relative min-h-dvh md:ml-[264px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <Suspense fallback={<div className="h-dvh" />}>
              <Routes location={location}>
                <Route path="/" element={<Home />} />
                <Route path="/search" element={<Search />} />
                <Route path="/library" element={<Library />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/premium" element={<Premium />} />
                <Route path="/queue" element={<QueueRoute />} />
                <Route path="/playlist/:id" element={<PlaylistDetails />} />
                <Route path="/artist/:id" element={<ArtistDetails />} />
                <Route path="/collection/:id" element={<CollectionDetails />} />
                <Route path="/mix/:genre" element={<MixDetails />} />
                <Route path="*" element={<Home />} />
              </Routes>
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>
      <MiniPlayer />
      <TabBar />
      <NowPlaying />
      <QueuePanel />
      <AddToPlaylistSheet />
      <ShortcutsSheet />
      <PaywallSheet />
      <TrackMenuHost />
      <CustomCursor />
      <Toasts />
      <OfflineBanner offline={!online} />
    </MotionConfig>
  );
}
