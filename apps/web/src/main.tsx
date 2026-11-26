import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { App, router } from './App.js';
import { liveTextStore } from './api/live-text.js';
import { liveThinkingStore } from './api/live-thinking.js';
import { taskOutbox } from './board/task-outbox.js';
import { chiefOutbox } from './chief/outbox.js';
import {
  followDesktopNavigation,
  markDesktopShell,
  showPendingRollbackNotice,
  syncDesktopFullScreen,
} from './desktop-shell.js';
import { applyLocaleLang, readStoredLocale } from './i18n/locale.js';
import { trackPointerFocus } from './pointer-focus.js';
import { safeLocalStorage, safeSessionStorage } from './safe-storage.js';
import { entryScriptOf, reloadOnNewDeploy, reloadOnStaleBuild } from './stale-build-reload.js';
import { followSystemTheme, paintTheme, readStoredTheme } from './theme.js';
import './styles/fonts.css';
import './styles/motion.css';
import './styles/app.css';

function isEditableElement(target: EventTarget | null): target is HTMLElement {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function editableHasContent(field: HTMLElement): boolean {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    return field.value !== '';
  }
  return field.isContentEditable && field.innerText.trim() !== '';
}

function isPersistedOrSearchField(field: HTMLElement): boolean {
  if (field instanceof HTMLInputElement && (field.type === 'file' || field.type === 'search')) {
    return true;
  }
  if (
    field.closest(
      '[data-testid="chief-composer-block"], [data-testid="search-panel"], [data-testid="settings-search"]',
    ) !== null
  ) {
    return true;
  }
  return (
    field instanceof HTMLTextAreaElement && field.closest('[data-testid="side-chat"]') !== null
  );
}

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

const prepareReload = () => {
  window.dispatchEvent(new Event('cairn:prepare-reload'));
};

let composing = false;
document.addEventListener('compositionstart', () => {
  composing = true;
});
document.addEventListener('compositionend', () => {
  composing = false;
});
document.addEventListener('compositioncancel', () => {
  composing = false;
});

const dirtyFields = new Set<HTMLElement>();
document.addEventListener('input', (event) => {
  const { target } = event;
  if (!isEditableElement(target) || isPersistedOrSearchField(target)) return;
  if (editableHasContent(target)) dirtyFields.add(target);
  else dirtyFields.delete(target);
});
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof Node)) return;
  for (const field of dirtyFields) {
    if (form.contains(field)) dirtyFields.delete(field);
  }
});

reloadOnStaleBuild({
  target: window,
  storage: safeSessionStorage(),
  reload: () => window.location.reload(),
  prepareReload,
  now: Date.now,
});
const currentEntry = entryScriptOf(document.documentElement.outerHTML);
if (currentEntry !== null) {
  let lastRouteKey = `${router.state.location.pathname}${router.state.location.search}`;
  reloadOnNewDeploy({
    target: document,
    windowTarget: window,
    activityTarget: document,
    currentEntry,
    latestEntry: async () => {
      const response = await fetch('/', { cache: 'no-store' });
      return response.ok ? entryScriptOf(await response.text()) : null;
    },
    visible: () => document.visibilityState === 'visible',
    busy: () => {
      if (
        chiefOutbox.entries().some((entry) => entry.state === 'sending') ||
        taskOutbox
          .entries()
          .some((entry) => entry.state === 'sending' || entry.state === 'failed') ||
        composing ||
        document.querySelector('[role="dialog"], [role="alertdialog"]') !== null ||
        liveTextStore.hasActive() ||
        liveThinkingStore.hasActive() ||
        document.querySelector('[data-testid="chief-composer-stop"]') !== null
      ) {
        return true;
      }
      const field = document.activeElement;
      if (isEditableElement(field) && editableHasContent(field)) return true;
      for (const dirty of dirtyFields) {
        if (!dirty.isConnected || !editableHasContent(dirty)) {
          dirtyFields.delete(dirty);
          continue;
        }
        return true;
      }
      return false;
    },
    reload: () => window.location.reload(),
    prepareReload,
    storage: safeSessionStorage(),
    now: Date.now,
    every: (run) => {
      const id = window.setInterval(run, 60_000);
      return () => window.clearInterval(id);
    },
    subscribeNavigation: (onNavigate) =>
      router.subscribe((state) => {
        const nextKey = `${state.location.pathname}${state.location.search}`;
        if (state.navigation.state === 'idle' && nextKey !== lastRouteKey) {
          lastRouteKey = nextKey;
          onNavigate();
        }
      }),
    shouldSkipNavigationReload: () => window.location.pathname === '/app/machines/authorize',
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
