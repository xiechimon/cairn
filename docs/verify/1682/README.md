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

The browser command used a temporary Playwright configuration with one worker,
the repository's `apps/web/e2e` test directory and `demo-mode.spec.ts`. It had
no shared webServer and used the existing helper's random ports and isolated
build directories. Production bundle folding is checked by the original
production case. These checks do not establish a public deployment.

The direct HTTPS probe of `https://demo.cairn.xmon.me/app` on 2026-10-28 failed
locally with `SSL_ERROR_SYSCALL`; it did not establish live-site availability.
Public hosting and domain acceptance remain unverified.

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
