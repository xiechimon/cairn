import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { applyDensity, readStoredDensity } from './density.js';
import { applyLocaleLang, readStoredLocale } from './i18n/locale.js';
import { trackPointerFocus } from './pointer-focus.js';
import { safeLocalStorage } from './safe-storage.js';
import { applyTheme, readStoredTheme } from './theme.js';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/motion.css';
import './styles/app.css';

const bootStorage = safeLocalStorage();
applyTheme(readStoredTheme(bootStorage), bootStorage);
applyDensity(readStoredDensity(bootStorage), bootStorage);
applyLocaleLang(readStoredLocale(bootStorage));
trackPointerFocus();

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
