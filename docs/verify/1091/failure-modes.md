# #1091 failure-mode inventory — boot/first-paint reads with Storage unavailable

Enumerated before writing the fix (repo rule: list every way the block can
fail, then make the list pass). Environment shapes that make the
`window.localStorage` **accessor itself** throw `SecurityError`:

- E1 sandboxed iframe without `allow-same-origin` (opaque origin) — the shape
  found in the wild (BuilderIO visual-edit canvas, 2026-10-09, `main @ 5d9d91d6`).
- E2 third-party embed / Safari ITP blocking site data.
- E3 browser-level "block third-party cookies / site data" settings.
- E4 legacy Safari private mode: reads work, `setItem` throws.

Key mechanic: the throw happens **while evaluating the `localStorage`
identifier at the call site**, before any callee body runs — a try/catch
*inside* a reader function cannot guard its own call sites (this is why
`new-task-dialog.tsx` readers, although already wrapped, still crash the
boot: the argument evaluation throws first). The guard must live at the
acquisition point.

## Failures on `/app` first paint (pre-fix)

| # | Site | Path | Result |
|---|------|------|--------|
| F1 | `main.tsx:11` `applyTheme(readStoredTheme(localStorage))` | module top level | module aborts, `createRoot().render()` never runs → `#root` empty, white screen |
| F2 | `main.tsx:13` `readStoredLocale(localStorage)` | module top level | same as F1 |
| F3 | `theme.ts:27` `applyTheme(theme, storage = localStorage)` | default parameter, evaluated at call time | throws even when the read side is guarded; `setItem` at `:43` also throws under E4 |
| F4 | `i18n/provider.tsx:25` `useState(() => readStoredLocale(localStorage))` | first render, `I18nProvider` wraps every route | render throw, no error boundary in repo → React unmounts the whole tree → white screen |
| F5 | `board/app-sidebar.tsx:76` `useState(() => readCollapsed(localStorage))` | first render of the shell sidebar (every route) | white screen |
| F6 | `board/sidebar.tsx:337` `useState(() => readGroupCollapsed(localStorage))` | first render of `BoardSidebar` | white screen |
| F7 | `overlay/new-task-dialog.tsx:285/295` `readRemembered*(localStorage)` in `useState` initializers | `NewTaskSurfaceRoot` renders `NewTaskDialog` retained-mount, so the initializers run at first paint of `/app` (board-page passes `apiRef`) | white screen |

## Failures after first paint / on other routes (same class)

| # | Site | Trigger |
|---|------|---------|
| F8 | `board/sidebar.tsx:300` `readStoredTheme(localStorage)` (UserMenu popover content) | opening the user menu → render throw → tree unmount |
| F9 | `routes/todo-detail-page.tsx:1135` same UserMenu pattern | detail route, menu open |
| F10 | `pages/project-page.tsx:450` `readStoredLayout(localStorage)` `useState` initializer | first paint of `/app/project/:id` → white screen on that route |
| F11 | `routes/team-page.tsx:96` same | first paint of `/app/team` |
| F12 | `routes/account-page.tsx:124` `readNotifyPref(localStorage)` | first paint of `/app/account` |
| F13 | write handlers: `app-sidebar.tsx:80`, `sidebar.tsx:341`, `project-page.tsx:453`, `team-page.tsx:99`, `provider.tsx:27` `persistLocale(next, localStorage)`, `account-page.tsx:225`, `new-task-dialog.tsx:442/496/776/943/972` | any interaction that persists (collapse toggle, layout switch, locale switch, notify toggle, remembered project/machine) → handler throws; under E4 the write throws while reads work |
| F14 | `api/sse.ts:124-125` `readNotifyPref(localStorage)` / `readStoredLocale(localStorage)` | desktop-notification firing path |

## Already safe (no change; semantics copied from these)

- `api/auth.ts` `readStoredToken` / `writeToken` — try/catch around the global
  reference itself; read failure → `null`, write failure → silently dropped.
- `chief/use-chief-surface.ts` `readStoredChiefOpen` + the persistence effect.
- `pages/dir-browser.tsx` `readLastDir` / `writeLastDir` (`window.localStorage`
  inside try).
- `pwa/register.tsx` — CacheStorage in try/catch, SW registration best-effort.

## Post-fix invariants

- I1 `/app` renders inside a sandboxed iframe without `allow-same-origin`:
  `#root` non-empty, `body.innerText` length > 0, no `SecurityError`.
- I2 degraded theme = the existing no-stored-value path (#129): follows the
  system scheme (dark in the e2e config), and `applyTheme`'s persist write is
  silently dropped instead of throwing.
- I3 degraded locale = `DEFAULT_LOCALE` (`zh`), `<html lang="zh-CN">`.
- I4 normal browsers: zero regression — theme/locale/collapse/layout/notify
  persistence keeps working (existing e2e: theme-toggle, sidebar-nav,
  collapse-family, shell-consistency, newtask-project-persist,
  newtask-machine-persist, account-controls).
- I5 dead-environment writes never throw; they are dropped (session-only
  behavior), matching `auth.ts writeToken` semantics.
