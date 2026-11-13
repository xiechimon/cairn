import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { applyLocaleLang, readStoredLocale } from './i18n/locale.js';
import { trackPointerFocus } from './pointer-focus.js';
import { safeLocalStorage, safeSessionStorage } from './safe-storage.js';
import { reloadOnStaleBuild } from './stale-build-reload.js';
import { followSystemTheme, paintTheme, readStoredTheme } from './theme.js';
import './styles/fonts.css';
import './styles/motion.css';
import './styles/app.css';

const bootStorage = safeLocalStorage();
paintTheme(readStoredTheme(bootStorage));
followSystemTheme(bootStorage);
applyLocaleLang(readStoredLocale(bootStorage));
trackPointerFocus();
reloadOnStaleBuild({
  target: window,
  storage: safeSessionStorage(),
  reload: () => window.location.reload(),
  now: Date.now,
});

const container = document.getElementById('root');
if (container == null) {
  throw new Error('#root missing in index.html');
}

flushSync(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.getElementById('boot')?.remove();
  });
});
