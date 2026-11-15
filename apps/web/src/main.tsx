import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { applyLocaleLang, readStoredLocale } from './i18n/locale.js';
import { trackPointerFocus } from './pointer-focus.js';
import { safeLocalStorage, safeSessionStorage } from './safe-storage.js';
import { entryScriptOf, reloadOnNewDeploy, reloadOnStaleBuild } from './stale-build-reload.js';
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
const currentEntry = entryScriptOf(document.documentElement.outerHTML);
if (currentEntry !== null) {
  reloadOnNewDeploy({
    target: document,
    currentEntry,
    latestEntry: async () => {
      const response = await fetch('/', { cache: 'no-store' });
      return response.ok ? entryScriptOf(await response.text()) : null;
    },
    visible: () => document.visibilityState === 'visible',
    busy: () => {
      const field = document.activeElement;
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        return field.value !== '';
      }
      return (
        field instanceof HTMLElement && field.isContentEditable && field.innerText.trim() !== ''
      );
    },
    reload: () => window.location.reload(),
    storage: safeSessionStorage(),
    now: Date.now,
    every: (run) => window.setInterval(run, 60_000),
  });
}

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
