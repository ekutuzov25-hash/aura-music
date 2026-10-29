import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { startSync } from './auth/sync';
import { installButtonFx } from './lib/buttonFx';
import './index.css';

startSync();
installButtonFx();

// Desktop app (Electron): lets CSS leave room for the macOS window buttons.
const desktop = (window as unknown as { auraDesktop?: { platform: string } }).auraDesktop;
if (desktop) document.documentElement.dataset.desktop = desktop.platform;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
