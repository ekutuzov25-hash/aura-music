/**
 * AURA desktop app (macOS & Windows) built with Electron.
 *
 * The main process starts the same server the web version uses on a fixed
 * local port (127.0.0.1 only) and opens it in a window. A fixed port keeps
 * the page origin stable, so playlists and settings saved in the window's
 * storage survive restarts. SoundCloud secrets, if any, are read from a .env
 * file in the user's data folder and never reach the page.
 */
import { app, BrowserWindow, Menu, nativeTheme, shell } from 'electron';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createAuraServer } from '../server/app.ts';

const PREFERRED_PORT = 47831;
const isMac = process.platform === 'darwin';
let win: BrowserWindow | null = null;
let quitting = false;
let origin = '';

if (!app.requestSingleInstanceLock()) app.quit();

function loadSecrets() {
  const file = join(app.getPath('userData'), '.env');
  if (existsSync(file)) {
    try {
      process.loadEnvFile(file);
    } catch (e) {
      console.error('Failed to read', file, e);
    }
  }
}

async function startServer(): Promise<string> {
  const distDir = join(__dirname, '..', 'dist');
  for (let port = PREFERRED_PORT; port < PREFERRED_PORT + 10; port++) {
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const server = createAuraServer({ distDir, allowedHosts: hosts });
    const ok = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (ok) return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  throw new Error('No free local port for AURA');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    title: 'AURA',
    backgroundColor: '#07070a',
    show: false,
    autoHideMenuBar: true,
    // macOS: content under the title bar, traffic lights over the glass sidebar.
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 22, y: 22 } } : {}),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // keep audio progress/visualizer smooth in the background
    },
  });

  win.once('ready-to-show', () => win?.show());
  void win.loadURL(origin);

  // Links to SoundCloud, Audius, Apple etc. open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });

  // macOS convention: closing the window keeps the app (and the music) running.
  win.on('close', (e) => {
    if (isMac && !quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.on('closed', () => (win = null));
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    {
      label: 'Вид',
      submenu: [{ role: 'reload', label: 'Обновить' }, { role: 'togglefullscreen', label: 'Полный экран' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }],
    },
    { role: 'windowMenu' },
    {
      label: 'Справка',
      submenu: [
        { label: 'Папка настроек (.env для SoundCloud)', click: () => void shell.openPath(app.getPath('userData')) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.on('before-quit', () => (quitting = true));
app.on('activate', () => (win ? win.show() : createWindow()));
app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';
  loadSecrets();
  origin = await startServer();
  buildMenu();
  createWindow();
});
