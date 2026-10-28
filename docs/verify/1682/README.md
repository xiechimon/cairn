# 1682 verification: read-only public demo build

This directory holds the evidence for the demo build introduced by #1682
(`vite build --mode demo`): a fixture-driven, backend-free snapshot of the
web app for `demo.cairn.xmon.me`.

## Files

| File | What it shows |
| --- | --- |
| `current-home-light-1440.png` / `current-home-dark-1440.png` | Current chat home with demo data |
| `current-board-light-1440.png` / `current-board-dark-1440.png` | Current demo board, desktop 1440px |
| `current-board-light-390.png` / `current-board-dark-390.png` | Current demo board, phone 390px |
| `current-detail-light-1440.png` / `current-detail-dark-1440.png` | Current versioned plan and AI review chain |
| `current-machine-blocked.png` | Machine evacuation shows the read-only notice |
| `current-demo-tour.webm` | Current home, board, detail, machine action and chief window |
| Files without `current-` | Historical artifacts from original PR head `e479a930` |

The e2e spec `apps/web/e2e/demo-mode.spec.ts` pins the behaviour end to end:
plain `/app` opens the demo set with no `?scenario=`, the banner is present
and bilingual, writes are swallowed with the demo toast (no network, no state
change), no `/api` or `/git` traffic, and the production bundle carries none
of the demo content.

The current main line opens the chief chat at `/app`; the visible board link
opens `/app?view=board`. The suite follows that navigation and retains the four
column checks, task counts, version picker, review chain, machine list and
read-only assertions. It also checks sending from both the home and the chief
window. No product navigation was changed to satisfy the older tests.

## Current delivery checks

Source commit: `f106a29e5b635331103ffb8a399fcff5cf24ace5`, based on main
`d3c8d5039`. The capture manifest records the full base and per-file SHA-256
hashes, all checked against that source commit after capture.

- `demo-suite-green.log`: 18 browser cases passed against compiled demo and
  production builds using the repository's existing static-server helper.
- `machine-write-red.log` and `machine-write-red-traffic.json`: two actual
  failures and the POST/DELETE requests that returned 404 before the guards.
- `dialog-write-red.log` and `oauth-write-red.log`: three missing-notice
  failures before the form and OAuth notice calls.
- `write-paths-green.log`: all five corrected paths passed, asserting no
  backend requests, no errors and unchanged demo data where applicable.
- `mobile-banner-red.log`: the menu started at y=6 over a banner ending at
  y=36. The final browser suite checks separation and the 44px touch target.
- `main-fixture-type-red.log` and `main-fixture-type-green.log`: stale
  transcript and machine fields were rejected and migrated to current types.
- `deploy-scope-red.log` and `deploy-scope-green.log`: the actual deployment
  command failed four dependency-change controls before correction. Six
  deployment cases and five translation coverage cases then passed.
- `current-capture.json`: screenshot and recording run observed no backend
  requests or console errors. The app surface is the compiled demo fixture;
  no real model provider was exercised.
- `prepush-green.log`: 27 checks passed, including 108 selected related
  tests, all 596 web unit tests, and all 1378 browser tests across 191 specs.
- `i18n-union.json`: all 1305 baseline translation-file lines have unchanged
  contents; the five demo translation lines are the only additions.

The browser command used a temporary Playwright configuration with one worker,
the repository's `apps/web/e2e` test directory and `demo-mode.spec.ts`. It had
no shared webServer and used the existing helper's random ports and isolated
build directories. Production bundle folding is checked by the original
production case. These checks do not establish a public deployment.

The direct HTTPS probe of `https://demo.cairn.xmon.me/app` on 2026-10-28 failed
locally with `SSL_ERROR_SYSCALL`; it did not establish live-site availability.
Public hosting and domain acceptance remain unverified.

The source is a delivery checkpoint. Full code review and fresh independent
review remain pending; green tests do not establish merge authorization.

## Completion fallback follow-up

Further local review found that the task menu could open the shared completion
dialog and then close it without the demo notice. `accept-dialog-red.log`
records that actual failure and a passing card-to-panel-to-detail navigation
control. The fallback now sends the notice in the shared `AcceptDialog`.
`accept-dialog-green.log` records all 20 demo cases passing after this change;
`accept-required-green.log` records lint, typecheck and spec parsing passing.
The earlier 1378-case run and capture manifest apply to source `f106a29e5`,
before this follow-up. They are not evidence of a later full-suite run.

Follow-up source `12c1a8d4c34de1e9b4efba8e2b5fcea167c4975c` passed all 483 affected browser cases and all 27 prepush checks (`followup-prepush-green.log`). The first attempt had one task-panel list color-contrast failure and 482 passes (`followup-prepush-first-failure.log`). Without a source change, all three panel accessibility cases then passed (`panel-contrast-recheck.log`), followed by the complete 483-case pass. The intermittent failure remains unexplained; no assertion, retry setting, or accessibility threshold was weakened.

## Rebuilding the demo locally

```sh
cd apps/web
pnpm exec vite build --mode demo
pnpm exec vite preview --port 4173
```

Open http://127.0.0.1:4173/app. `/api` and `/git` answer 404 there (the
`previewApiReject` plugin), which is exactly the hosting condition the demo
runs under.

## Vercel setup for ian (one-time, in the Vercel web UI)

`apps/web/vercel.json` carries the build
command, output directory, SPA rewrites and the build-skip rule. When creating
the project, fill in:

- **Import**: repo `xiechimon/cairn`, production branch `main`.
- **Framework Preset**: Vite.
- **Root Directory**: `apps/web` (this is what makes `vercel.json` apply and
  gives the `ignoreCommand` its working directory).
- **Install Command**: leave empty (Vercel auto-detects pnpm and installs the
  workspace from the repo root).
- **Build Command / Output Directory**: leave empty in the UI; they are pinned
  by `apps/web/vercel.json` (`pnpm exec vite build --mode demo`, `dist`).
- **Domain**: add `demo.cairn.xmon.me` in Project → Settings → Domains, then
  create the DNS record it suggests (CNAME to `cname.vercel-dns.com`).

Build cadence: the `ignoreCommand` skips builds unless the latest commit on
`main` touched `apps/web/`, `packages/shared/`, or the root package manifest,
lockfile or workspace catalog (same pattern as the site
project, #1674), keeping the project inside the Hobby plan's daily build
quota. Do not enable auto-deploy for all branches; the demo is a
production-only artifact.
