import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './app/global.css';
import { App } from './app/App';
import { reloadForNewVersion } from './app/ErrorBoundary';

// Кусок кода новой версии не загрузился (сайт обновили, пока вкладка была открыта) — перезагрузка.
window.addEventListener('vite:preloadError', (e) => {
  if (reloadForNewVersion((e as Event & { payload?: unknown }).payload ?? 'Unable to preload'))
    e.preventDefault();
});
window.addEventListener('unhandledrejection', (e) => {
  if (reloadForNewVersion(e.reason)) e.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
