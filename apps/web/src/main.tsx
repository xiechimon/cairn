import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { toast } from 'sonner';
import { App, router } from './App.js';
import { taskOutbox } from './board/task-outbox.js';
import { chiefOutbox } from './chief/outbox.js';
import {
  followDesktopNavigation,
  markDesktopShell,
  showPendingRollbackNotice,
  syncDesktopFullScreen,
} from './desktop-shell.js';
import { EN } from './i18n/en.js';
import { applyLocaleLang, readStoredLocale } from './i18n/locale.js';
import { translate } from './i18n/translate.js';
import { trackPointerFocus } from './pointer-focus.js';
import { safeLocalStorage, safeSessionStorage } from './safe-storage.js';
import { entryScriptOf, reloadOnNewDeploy, reloadOnStaleBuild } from './stale-build-reload.js';
import { followSystemTheme, paintTheme, readStoredTheme } from './theme.js';
import './styles/fonts.css';
import './styles/motion.css';
import './styles/app.css';

const bootStorage = safeLocalStorage();
paintTheme(readStoredTheme(bootStorage));
if (markDesktopShell(document.documentElement, navigator.userAgent, window.location.pathname)) {
  syncDesktopFullScreen(document.documentElement);
}
followDesktopNavigation((path) => void router.navigate(path));
followSystemTheme(bootStorage);
applyLocaleLang(readStoredLocale(bootStorage));
void showPendingRollbackNotice();
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
      if (
        chiefOutbox.entries().some((entry) => entry.state === 'sending') ||
        taskOutbox.entries().some((entry) => entry.state === 'sending')
      )
        return true;
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
    offerReload: () => {
      const locale = readStoredLocale(bootStorage);
      toast(translate(locale, EN, '有新版本'), {
        id: 'new-deploy',
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: translate(locale, EN, '点此刷新'),
          onClick: () => window.location.reload(),
        },
      });
    },
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
    const boot = document.getElementById('boot');
    if (boot === null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      boot.remove();
      return;
    }
    boot.style.pointerEvents = 'none';
    boot.style.opacity = '0';
    window.setTimeout(() => boot.remove(), 240);
  });
});
