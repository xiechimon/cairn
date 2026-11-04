# 1682 verification: read-only public demo build

This directory holds the evidence for the demo build introduced by #1682
(`vite build --mode demo`): a fixture-driven, backend-free snapshot of the
web app for `demo.cairn.xmon.me`.

## Files

| File | What it shows |
| --- | --- |
| `board-light-1440.png` / `board-dark-1440.png` | Demo board, desktop 1440px, light / dark |
| `board-light-390.png` / `board-dark-390.png` | Demo board, phone 390px, light / dark |
| `detail-light-1440.png` / `detail-dark-1440.png` | Versioned plan doc + AI review reject-and-fix thread |
| `demo-tour.webm` | Playwright video: board → plan doc versions → review reject chain → chief dispatch → machine roster |

The e2e spec `apps/web/e2e/demo-mode.spec.ts` pins the behaviour end to end:
plain `/app` opens the demo set with no `?scenario=`, the banner is present
and bilingual, writes are swallowed with the demo toast (no network, no state
change), no `/api` or `/git` traffic, and the production bundle carries none
of the demo content.

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

The repository side is complete: `apps/web/vercel.json` carries the build
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
`main` touched `apps/web/` or `packages/shared/` (same pattern as the site
project, #1674), keeping the project inside the Hobby plan's daily build
quota. Do not enable auto-deploy for all branches; the demo is a
production-only artifact.
