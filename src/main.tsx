import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/global.css';
import './i18n';
import { App } from './App';
import { startAuthListener } from './data/session';
import { startSyncEngine } from './lib/sync/uploadQueue';
import { loadGis, refreshStatus } from './lib/drive/gis';
import { initAnalytics } from './lib/firebase/analytics';
import { listenForInstallPrompt } from './stores/appStore';

startAuthListener();
listenForInstallPrompt();
refreshStatus();
// Preload Google Identity Services so "Connect Drive" can open its popup synchronously on tap.
if (navigator.onLine) void loadGis().catch(() => undefined);
startSyncEngine();
initAnalytics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
