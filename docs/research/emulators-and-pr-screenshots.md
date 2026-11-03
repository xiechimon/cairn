# Service emulators and per-PR screenshots: how cairn should adopt both

Status: research, 2026-11-03. No code or production change is proposed here beyond the PR list in section 5.

Evidence labels: **measured** means read or run in this session; **inferred** is derived from measured facts and can be re-checked; **guess** is everything else.

## 1. What Rakazo actually does

Source: Elie Steinbock's talk (youtube `xk-aLMQRYfk`, transcript) and the Rakazo repository at commit `3d0887f0` (measured).

### Emulators

- The talk names emulate.dev as the example, but says Rakazo itself does not use it ("I don't even think we use emulate.dev in Rakazo itself"). Rakazo's emulators are hand-written, AI-built fakes of Composio, Daytona and similar services that have no public emulator (measured, transcript).
- In the repo they are small in-process classes in `packages/testkit/src`: `DestinationEmulator`, `McpEmulator` (a loopback HTTP server with an `inspect()` method), `model-emulator.ts` (218 lines, an OpenAI-compatible SSE stream that validates every request and must consume every scripted step), a Cursor HTTP emulator selected by `CLOUD_AGENT_PROVIDER=emulator`, and a wallet selected by `PAYMENT_WALLET_PROVIDER=emulator` (measured).
- The pattern that matters: each emulator is a **product-level provider switch** (`X_PROVIDER=emulator`), so the same adapter code runs against a fake; the model emulator **fails the test when a scripted step is not consumed or an unexpected request arrives**; and the docs separate layers by what is real and what is a stand-in (`docs/agent-verification.md`, a table of "Real components / Stand-ins / Command").
- Rakazo has no drift check against the real APIs (measured: no canary for emulators; its `providers.canary.test.ts` and `release-watch.canary.test.ts` hit real providers, not emulators). Its only control is a "live" lane run by hand with real credentials.

### Screenshots

- Every PR runs the Playwright e2e in 2 shards (4 shards nightly); shard 1 also screenshots the marketing pages (`playwright.yml`).
- The shards upload artifacts. A separate `workflow_run` workflow, `publish-playwright-report.yml`, runs trusted default-branch code (it never checks out the PR), downloads the artifact, and publishes the screenshots plus a manifest to an S3 bucket behind a public URL (`scripts/publish-playwright-report.sh`).
- Each screenshot is hashed. The manifest of the last successful `main` run is stored at a stable key (`baselines/main/manifest.json`). Comparison is by hash: `new`, `changed`, `unchanged`, or `unavailable` when no baseline exists (`compareScreenshotsWithBaseline`).
- The PR comment is one sticky comment (marker `<!-- rakazo-playwright-screenshots -->`) that is edited in place. It embeds up to 8 "feature frames" and links the full gallery. A frame is embedded only if its source test directory matches a `*.spec.ts` file **the PR touched** and it is `new` or `changed`. The reason is in the code comment: the main baseline can trail main by hours, so shots from other merged PRs would look new (measured).
- The gallery page has filters New / Changed / All, light and dark pages, and about 350 screenshots per run. Failures only: `screenshot: 'only-on-failure'` in the Playwright config. The "full site" shots are explicit `page.screenshot` calls inside specs, not an automatic per-test capture (measured).
- Storage is S3-compatible object storage with secrets, which Rakazo can afford. Cairn is a public repo (inferred: it must not hold such secrets in workflows that run PR code).

## 2. What cairn already has

### Test doubles today (measured)

| Surface | How tests handle it today |
|---|---|
| GitHub REST | `apps/server/test/fakes/github.ts` (557 lines): `githubFake(repo, options)` returns an injected `FetchLike`, with per-test `handle` overrides, ETag/conditional helpers, a `GateAnswers` object for the merge gate, and `mergeGithubFake` for PR merges. 29 server source files take an injectable `fetchImpl`. 6 test files import the shared fake; the other github tests inline their own `fetch` stubs (measured: `grep fakes/github`). |
| GitHub GraphQL | Exactly one query: `closedByPullRequestsReferences` in `apps/server/src/lib/github.ts:1121`, `https://api.github.com/graphql`, with a `RATE_LIMITED` error branch. Faked per test. |
| GitHub from scripts | `scripts/ops/review-gate/*`, `pr-gate.js`, `await-main-health.mjs`, `pr-body-hook.mjs` call `gh` / `api.github.com`; their `*.test.mjs` stub `gh`. |
| Model APIs | The server does not call Anthropic or OpenAI directly in tests; the daemon runs Claude/Codex CLIs. A scripted `AgentBackend` with strict call/response consumption exists (`ac243f5ef`, "scripted AgentBackend"), and `apps/daemon/test/fixtures/fakes/*.fixture.ts` (`required-real`, `unconsumed`, `unexpected`, `wrong-arguments`) already implement Rakazo's "unconsumed step fails" rule. |
| Claude/Codex CLIs | `apps/daemon/test` has ~15 `claude-*.test.ts` plus `acp-agent.mjs` / `acp-exit.mjs` fake agents. A nightly Claude smoke was added in #2298 and is excluded from CI. |
| Tailscale | Only a handful of tests mention it (`token-auth`, `enroll-confirm-auth`, `startup-log`); no emulator. |
| Web e2e | `apps/web` runs against `vite build --mode fixture`: no real server, 101 distinct `?scenario=` ids, fixtures in `apps/web/src/fixtures/` (20 files). |
| Real-stack e2e | `integration/test` (e.g. `gate-e2e`, `m4a-chief-e2e`) starts the real server and daemon with fakes at the edges. |

Consequence (inferred): cairn already has a **hand-rolled, per-test** GitHub fake and the "unconsumed step" discipline. What it lacks is a **shared, stateful** one: today each test scripts the exact responses it expects, so a test passes if cairn sends the request the test author imagined, not one GitHub would accept.

### Screenshot assets today (measured)

- `apps/web/e2e/gallery-snapshots.spec.ts`: iterates every gallery specimen (`/design.html`), light and dark, `toHaveScreenshot` with `maxDiffPixelRatio: 0.001`, clock frozen at `2026-10-31`. 212 committed Linux baselines (5.6 MB) in `gallery-snapshots.spec.ts-snapshots/`. Baselines are accepted via `scripts/gallery-snapshots-accept.mjs`. It skips figures that contain an `iframe`.
- The gallery's "Screens" section (`apps/web/src/design/screens.tsx`) lists 11 product screens as iframes of `/app?scenario=…`. Because they are iframes, **the snapshot spec does not cover them** (it skips framed figures). Whole-page product screens therefore have no regression baseline today (inferred from the spec code and `screens.tsx`).
- `sidebar-visual.spec.ts`, `visual-polish.spec.ts`: geometric assertions, not pixel baselines.
- `docs/verify/<ticket>/` holds hand-captured evidence (398 directories, 183 MB). PRs embed those images; `scripts/pr-evidence-gate.py` enforces which image link forms are allowed (embedded, permalink to a commit SHA, user-attachments).
- CI: `e2e` (4 shards, full tier) or `e2e-affected` (5 shards, `scripts/e2e-affected.mjs`, selects specs from changed paths and splits by recorded spec times). On failure only, the gallery job uploads `*-actual.png` / `*-diff.png` artifacts for 7 days.
- Timing (measured, one recent `main` run, 2026-11-03 11:34): `changes` 14 s; `e2e` shards 3.2 to 4.5 min; `vitest-integration` 3 to 3.6 min; whole workflow about 4.7 min. That matches the "about 4 min median" in the brief. A new job must finish inside the existing critical path to leave the median alone.

So the gap is not "no screenshots". It is: (a) whole-page product screens have no baseline; (b) a reviewer cannot see which screens a PR changed without checking out the branch or reading a failed-job artifact; (c) agents hand-capture evidence into `docs/verify`.

## 3. Emulators: findings

### emulate.dev (vercel-labs/emulate, commit `1566b8e3`, 2026-10-29; measured)

- Apache-2.0, labelled a Vercel Labs experiment. Packages: `emulate` (CLI), `@emulators/core` (Hono-based server, in-memory store, plugin interface), one package per service. Services: Vercel, GitHub, Google, Slack, Apple, Microsoft, Okta, AWS (S3/SQS/IAM/STS/Cognito), Resend, Stripe, MongoDB Atlas, Clerk, Linear, Twilio. Only some have endpoint sections; the README lists Okta, Stripe, Atlas and Clerk as seed-config only.
- Programmatic API: `createEmulator({ service: 'github', port })` returns `url`, `reset()`, `close()`. `reset()` restores seed data. State is in memory; `port: 0` and `listen: false` are supported. Seeds are YAML or JSON.
- GitHub emulator: 240 routes. Includes pulls (with `merge_method`, `mergeable`, `auto_merge`), reviews, check runs and suites, required status checks, issues with events and timeline, compare, contents, git data, webhooks, Actions, Apps (JWT and installation tokens), search, rate-limit endpoint.
- **Not present in the GitHub emulator** (grep of `packages/@emulators/github/src`): no GraphQL endpoint; no ETag / `If-None-Match` handling; no `rules/branches` route; no combined-status route beyond a helper. The README lists gaps for other services (Slack Enterprise/Socket Mode, no SigV4 evaluation for AWS, partial Linear schema) but says nothing about GitHub gaps.
- No fidelity process is documented: no recorded-traffic contract tests against the real APIs. `tests/contracts/` holds only two custom-emulator fixtures (`custom-api`, `github-app-identity`). Drift protection is therefore ours to build.
- It is explicitly an experiment, so a pin to an exact version is a must (guess: the API will change).

### Fit against cairn's GitHub surface (inferred)

Cairn's GitHub usage that decides correctness is the merge gate and PR reconcile: PR reads with ETag caching, branch protection and `rules/branches`, `compare`, check-runs and combined status with pagination, issue timeline and events, PR merge with a `sha` pin, and one GraphQL query. 52 mentions of `etag` in `github.ts` and 6 in `github-port.ts` show the conditional-request path is core. The emulator covers the object model (PRs, checks, merge, labels) but not three things cairn's bugs live in: conditional requests, `rules/branches`, GraphQL. Using emulate directly would give a green test on exactly the paths with the least protection.

`github.ts` hardcodes `https://api.github.com` in 24 places; only the fetch is injectable. To point the server at an emulator, the base URL must become configuration, or tests must wrap `fetch` to rewrite the origin (a ~15-line `FetchLike` adapter; guess: the rewrite is the smaller change and keeps production code untouched).

### LocalStack and others (measured, one search result set)

- LocalStack ended its AWS Community edition on 2026-03-23; the replacement image needs an account token, has a non-commercial free tier, and CI credits are unlimited per LocalStack's post. Floci (MIT, no token) is reported as a drop-in. Cairn uses no AWS, so this is relevant only as a lesson: **do not build a hard dependency on a vendor's free emulator**; keep a thin seam so the emulator is replaceable. Sources: [LocalStack road ahead](https://blog.localstack.cloud/the-road-ahead-for-localstack/), [InfoQ](https://www.infoq.com/news/2026/02/localstack-aws-community).
- Other options considered, not evaluated in depth (guess): MSW (request interception, stateless by default), WireMock/Prism (spec-driven stubs, no state). None gives stateful GitHub for free.

### Recommendation

1. **Write our own GitHub emulator** as `packages/testkit-github` (or inside `apps/server/test/fakes/`), seeded from the existing `githubFake`, rather than adopt emulate directly. Reasons: GraphQL, ETag and `rules/branches` are missing there and are cairn's core paths; emulate is an experiment; one more locked dependency conflicts with the seam discipline in `CLAUDE.md`. Reuse emulate as a **reference and test oracle**: run its object-model tests (PR merge, checks) against ours.
2. Make it **stateful but thin**: repos, branches, pulls, checks, statuses, labels, issues, timeline; ETag and 304 handling; pagination with `Link`; rate-limit headers; a GraphQL handler for the one query. Everything else returns 501 with the route in the body so an unmodelled call fails loudly instead of passing.
3. Keep per-test `githubFake` for narrow unit tests. Add the emulator at two levels: a Vitest helper for server tests and `integration/` (in-process, `port: 0`), and a `GITHUB_API_BASE` (or fetch-rewrite) for the e2e that boots the real server.
4. Order: GitHub first. Second: a **model/CLI emulator** only if the scripted `AgentBackend` proves too coarse; it already enforces consumed-steps. Tailscale and Codex/Claude CLI: no emulator needed now (guess: few tests touch them and the real CLIs have their own nightly smoke).
5. Skip Slack/Stripe/Resend/Gmail: cairn does not call them (measured: a case-insensitive grep of `apps/*/src` and `packages/*/src` finds one stray `stripe` and one `resend` word and no client code). AI-written emulators for Composio/Daytona-like services apply when cairn adds integrations; not now.

### Failure modes and controls

| Failure mode | Control |
|---|---|
| Emulator drifts from GitHub; tests pass, prod fails (false confidence) | Weekly drift check, below. Unmodelled routes return 501. Each emulated route links its REST docs page in the route table. |
| Emulator accepts requests GitHub rejects (validation too loose) | Contract fixtures recorded from real GitHub for the 10 to 15 calls the gate depends on; replay asserts the emulator returns the same shape and status for the same request. |
| Tests assert the emulator's behaviour instead of cairn's | Tests assert via state (`emulator.inspect()`): what is in the PR after cairn acted, as in Rakazo's MCP emulator, not request strings. |
| State leaks between tests | `reset()` in `afterEach`; each test creates its own repo name. |
| Emulator becomes a second product to maintain | Cap scope to routes cairn calls; a test lists the routes cairn calls (from a recording) and fails if the emulator lacks one. |
| Agents "fix" a failing test by editing the emulator | Emulator and contract fixtures sit under a path that needs Codex cloud review (guess: add to a protected list only if this happens twice). |

### Weekly drift check

A scheduled workflow (`on: schedule`, weekly) that runs against the real API with a read-only token and **no secrets in PR code**:

1. For each recorded contract in `packages/testkit-github/contracts/*.json` (request, plus the response with volatile fields removed), call the real GitHub against a fixed public repository (candidates: `xiechimon/cairn` itself, read-only; or a dedicated sandbox repo; decision for ian) and diff the **shape** (keys, types, status, headers such as `etag`, `link`, `x-ratelimit-*`), not values.
2. Run the same request against the emulator and diff those shapes.
3. Any difference opens or updates one tracking issue (the `gardener-weekly.yml` pattern already does this: schedule, summary artifact, issue write permission).
4. GitHub's OpenAPI description is published at `github/rest-api-description`; the check also asserts each emulated route and its response schema exist in the current description (guess: this catches renames and removals without any token).

The drift workflow only reads public data, so it needs no secret beyond the default `GITHUB_TOKEN`. Write operations (merge, label) are never drift-tested against the real API; those are covered by the recorded contracts and the emulator state tests.

## 4. Screenshots: design

### Principles

- Reuse what exists: the fixture-mode app and its 101 scenarios, the gallery, `e2e-affected`'s spec selection, the `pr-evidence` image rules.
- **No new required check and no extra time on the critical path.** Capture runs inside existing `e2e`/`e2e-affected` shards; publishing runs after, in a separate workflow.
- Public repo: PR code must never run with secrets. Follow Rakazo's split (untrusted build, trusted publisher) but without S3.

### What to capture

1. **Product screens** (new): every route in the fixture app, in the scenarios that exercise distinct states, light and dark, desktop (1280×800) and phone (390×844). Start with the 11 in `screens.tsx`, grow to the scenarios the e2e specs already open (101 ids, to be de-duplicated by route and state). Estimated 11 screens × 2 themes × 2 viewports = 44 shots at the start; about 300 at full coverage (guess, scenario de-duplication unknown).
2. **Gallery specimens**: already covered by `gallery-snapshots` baselines (212). Reuse the same renders as the PR gallery source, no second pass.
3. **State shots from specs**: a `shot(page, name)` helper that specs call at meaningful states (as Rakazo's checkpoints). Not automatic per-test capture; automatic capture is noise.
4. Frozen clock, `reducedMotion: 'reduce'`, `animations: 'disabled'`, same Linux Chromium: copy the determinism settings from `gallery-snapshots.spec.ts` so unchanged screens hash identically.

### How to diff and what to post

- Each shot is written with its PNG hash into a `screens-manifest.json` (name, route, theme, viewport, sha256, spec path).
- On `main` pushes, the manifest of the latest successful run is stored as the baseline. Where: a `screens-baseline` artifact would expire; the practical choice is a small orphan branch `pr-screens` (manifest only, a few KB, plus the PNG blobs for changed screens).
- On PRs, compare manifests: `new` / `changed` / `unchanged`. Post a **single sticky comment** (marker, edited in place) with: counts, a list of changed and new screens, and up to 6 inline before/after pairs (before from baseline blob, after from this run). If nothing changed, the comment says so in one line, so reviewers can rely on silence.
- Rakazo restricts frames to specs the PR touched because its baseline lags. Cairn can avoid the lag: compare against `merge-base` instead of latest `main`, by looking up the manifest for the PR's merge-base SHA (fall back to latest main, then `unavailable`). (Inferred: this removes the "other merged PRs look new" false positive without needing the spec-stem filter. Verify on real PRs before dropping the filter.)
- PNGs of changed screens only are stored; unchanged ones are referenced by hash. This keeps the branch small (changed shots only; guess about 0.2 to 1 MB per PR).

### Storage

| Option | Pros | Cons |
|---|---|---|
| Actions artifacts only | Zero setup, no secrets | Not embeddable in a comment (needs login, expires in days); fails the `pr-evidence` image-link rules |
| Orphan branch in the repo (`pr-screens`) | Public, embeddable via `raw.githubusercontent.com` permalink to a commit SHA, which the pr-evidence gate already accepts; no secrets | Grows repo history unless pruned; needs a writer with `contents: write` |
| GitHub Pages | Clean URLs, gallery HTML | Needs Pages enablement; `site-deploy.yml` already uses Pages for the site (inferred: a second Pages site is not possible, a sub-path of the existing one is) |
| External S3 (Rakazo) | Scales | Secrets, cost, ian's account |

Recommendation: **orphan branch with SHA-pinned raw links**, pruning PR directories 30 days after close via the weekly gardener workflow. Embedding SHA-pinned raw links satisfies the existing image-link rule (measured: `pr-evidence-gate.py` accepts commit-SHA permalinks).

### Workflow shape

1. `e2e` / `e2e-affected` shards: after the existing run, one extra step runs the screens project (`playwright test --project=screens`, only on the shard assigned to it) and uploads `screens-<run>` with the manifest and PNGs. **Owner route** (workflow).
2. New `workflow_run` workflow `pr-screens.yml` (trusted default-branch code, like Rakazo's publisher): downloads the artifact with safe extraction (zip-slip safe; Rakazo's `extract-playwright-artifacts.py` is the pattern), compares manifests, pushes changed PNGs to `pr-screens`, edits the sticky comment. **Owner route** (workflow, `contents: write`, `pull-requests: write`).
3. `main` push: the same publisher stores the baseline manifest.

### Cost and time

- Product screens in fixture mode need no server, so each shot is a navigation plus a screenshot: about 0.5 to 1 s (guess; the measured gallery spec takes up to 240 s for 212 shots in one test, about 1 s each). 44 shots ≈ 45 s; 300 shots ≈ 5 min.
- Put the screens project on a dedicated 6th runner in parallel with the 5 `e2e-affected` shards (inferred from the current shard layout and the 3 to 4.5 min measured), so it adds a runner but not wall time while the screens project stays under about 4 min. Above that, split by viewport. If the PR does not touch `apps/web/**`, skip the job (the existing `changes` job already classifies this).
- Publisher runs after CI, off the critical path, about 1 min.
- Extra Actions minutes on a public repo: free (guess, needs confirmation for this account).

### Failure modes

- Flaky hashes (fonts, anti-aliasing, time): one render environment (CI Linux), frozen clock, `fonts.ready`, same settings as the gallery spec; comparison by pixel ratio (0.1%) rather than raw hash when raw hash flags an unchanged screen twice on `main` (decide after one week of data).
- Stale baseline: use the merge-base manifest; report `unavailable` rather than guessing.
- Baseline race (two merges to `main` at once): store manifests keyed by commit SHA, never overwrite a single "latest" key (Rakazo needed a recency-check script for this; keyed storage avoids it).
- Fork PRs: no secrets and read-only token. The publisher would see no write token; for forks, post only the artifact link. Cairn PRs are same-repo (measured: branches in `xiechimon/cairn`).
- Comment noise on every push: one sticky comment, edited, never appended.

## 5. Recommendation and PR list

Do both, in this order. Emulator first for GitHub; screenshots can ship independently, and its first step (adding baseline coverage for product screens) is useful alone.

| # | PR | Route | Scope |
|---|---|---|---|
| 1 | `testkit(emu-1)`: stateful GitHub emulator core (PRs, branches, checks, statuses, labels, ETag/304, pagination, 501 for unmodelled) + `FetchLike` origin rewrite; port `github-fake.test.ts` cases | normal | New test package; no production change |
| 2 | `testkit(emu-2)`: GraphQL handler for the closing-PR query, `rules/branches`, PR merge with `sha` pin; move `pr-merge-api`, `merge-gate-*`, `pr-reconcile` tests onto it | normal (tests only) | Touches test files, not the protected merge-gate sources |
| 3 | `testkit(emu-3)`: recorded contracts (10 to 15 gate calls) + replay test comparing emulator shape to the recording | normal | Fixtures plus one test |
| 4 | `ops(emu-4)`: weekly drift workflow + tracking issue (modelled on `gardener-weekly.yml`) | **owner** (workflow) | Read-only, `GITHUB_TOKEN` only |
| 5 | `web(shots-1)`: screens project in Playwright config: every route in the gallery "Screens" list, light/dark/phone, frozen clock, baselines committed | normal if it touches only `apps/web/e2e` and baselines | 44 shots, small |
| 6 | `ops(shots-2)`: manifest writer + compare script + sticky comment builder, unit-tested with fixtures (pure functions, no CI wiring) | **owner** if under `scripts/**`, else normal in `packages/` | Port Rakazo's `compareScreenshotsWithBaseline` and `buildScreenshotComment` logic, not their S3 code |
| 7 | `ops(shots-3)`: CI wiring: screens job on the `e2e` shards, `pr-screens.yml` publisher, `pr-screens` branch, baseline on `main` push | **owner** (workflows) | Needs `contents: write` on the orphan branch only |
| 8 | `ops(shots-4)`: prune closed-PR directories in `gardener-weekly`; add a line to `docs/pr-review.md` and `pr-cairn` skill on reading the sticky comment | **owner** if it changes `scripts/**` or the workflow | |
| 9 | `docs(verify)`: replace hand-captured `docs/verify/<ticket>` UI evidence with a link to the sticky comment where it applies | normal | Optional, after 7 |

Decisions (ian, 2026-11-03):

- The weekly drift check reads `xiechimon/cairn` itself, read-only. A sandbox repository is deferred until a write path needs drift-testing.
- Screenshot PNGs go to the orphan branch `pr-screens`, with 30-day pruning of closed-PR directories.
- A 6th runner for the screens job is accepted. Actions-minute cost on this public repo is still unconfirmed.

Sources: [LocalStack road ahead](https://blog.localstack.cloud/the-road-ahead-for-localstack/), [InfoQ](https://www.infoq.com/news/2026/02/localstack-aws-community).
- Other options considered, not evaluated in depth (guess): MSW (request interception, stateless by default), WireMock/Prism (spec-driven stubs, no state). None gives stateful GitHub for free.

### Recommendation

1. **Write our own GitHub emulator** as `packages/testkit-github` (or inside `apps/server/test/fakes/`), seeded from the existing `githubFake`, rather than adopt emulate directly. Reasons: GraphQL, ETag and `rules/branches` are missing there and are cairn's core paths; emulate is an experiment; one more locked dependency conflicts with the seam discipline in `CLAUDE.md`. Reuse emulate as a **reference and test oracle**: run its object-model tests (PR merge, checks) against ours.
2. Make it **stateful but thin**: repos, branches, pulls, checks, statuses, labels, issues, timeline; ETag and 304 handling; pagination with `Link`; rate-limit headers; a GraphQL handler for the one query. Everything else returns 501 with the route in the body so an unmodelled call fails loudly instead of passing.
3. Keep per-test `githubFake` for narrow unit tests. Add the emulator at two levels: a Vitest helper for server tests and `integration/` (in-process, `port: 0`), and a `GITHUB_API_BASE` (or fetch-rewrite) for the e2e that boots the real server.
4. Order: GitHub first. Second: a **model/CLI emulator** only if the scripted `AgentBackend` proves too coarse; it already enforces consumed-steps. Tailscale and Codex/Claude CLI: no emulator needed now (guess: few tests touch them and the real CLIs have their own nightly smoke).
5. Skip Slack/Stripe/Resend/Gmail: cairn does not call them (measured: a case-insensitive grep of `apps/*/src` and `packages/*/src` finds one stray `stripe` and one `resend` word and no client code). AI-written emulators for Composio/Daytona-like services apply when cairn adds integrations; not now.

### Failure modes and controls

| Failure mode | Control |
|---|---|
| Emulator drifts from GitHub; tests pass, prod fails (false confidence) | Weekly drift check, below. Unmodelled routes return 501. Each emulated route links its REST docs page in the route table. |
| Emulator accepts requests GitHub rejects (validation too loose) | Contract fixtures recorded from real GitHub for the 10 to 15 calls the gate depends on; replay asserts the emulator returns the same shape and status for the same request. |
| Tests assert the emulator's behaviour instead of cairn's | Tests assert via state (`emulator.inspect()`): what is in the PR after cairn acted, as in Rakazo's MCP emulator, not request strings. |
| State leaks between tests | `reset()` in `afterEach`; each test creates its own repo name. |
| Emulator becomes a second product to maintain | Cap scope to routes cairn calls; a test lists the routes cairn calls (from a recording) and fails if the emulator lacks one. |
| Agents "fix" a failing test by editing the emulator | Emulator and contract fixtures sit under a path that needs Codex cloud review (guess: add to a protected list only if this happens twice). |

### Weekly drift check

A scheduled workflow (`on: schedule`, weekly) that runs against the real API with a read-only token and **no secrets in PR code**:

1. For each recorded contract in `packages/testkit-github/contracts/*.json` (request, plus the response with volatile fields removed), call the real GitHub against a fixed public repository (candidates: `xiechimon/cairn` itself, read-only; or a dedicated sandbox repo; decision for ian) and diff the **shape** (keys, types, status, headers such as `etag`, `link`, `x-ratelimit-*`), not values.
2. Run the same request against the emulator and diff those shapes.
3. Any difference opens or updates one tracking issue (the `gardener-weekly.yml` pattern already does this: schedule, summary artifact, issue write permission).
4. GitHub's OpenAPI description is published at `github/rest-api-description`; the check also asserts each emulated route and its response schema exist in the current description (guess: this catches renames and removals without any token).

The drift workflow only reads public data, so it needs no secret beyond the default `GITHUB_TOKEN`. Write operations (merge, label) are never drift-tested against the real API; those are covered by the recorded contracts and the emulator state tests.

## 4. Screenshots: design

### Principles

- Reuse what exists: the fixture-mode app and its 101 scenarios, the gallery, `e2e-affected`'s spec selection, the `pr-evidence` image rules.
- **No new required check and no extra time on the critical path.** Capture runs inside existing `e2e`/`e2e-affected` shards; publishing runs after, in a separate workflow.
- Public repo: PR code must never run with secrets. Follow Rakazo's split (untrusted build, trusted publisher) but without S3.

### What to capture

1. **Product screens** (new): every route in the fixture app, in the scenarios that exercise distinct states, light and dark, desktop (1280×800) and phone (390×844). Start with the 11 in `screens.tsx`, grow to the scenarios the e2e specs already open (101 ids, to be de-duplicated by route and state). Estimated 11 screens × 2 themes × 2 viewports = 44 shots at the start; about 300 at full coverage (guess, scenario de-duplication unknown).
2. **Gallery specimens**: already covered by `gallery-snapshots` baselines (212). Reuse the same renders as the PR gallery source, no second pass.
3. **State shots from specs**: a `shot(page, name)` helper that specs call at meaningful states (as Rakazo's checkpoints). Not automatic per-test capture; automatic capture is noise.
4. Frozen clock, `reducedMotion: 'reduce'`, `animations: 'disabled'`, same Linux Chromium: copy the determinism settings from `gallery-snapshots.spec.ts` so unchanged screens hash identically.

### How to diff and what to post

- Each shot is written with its PNG hash into a `screens-manifest.json` (name, route, theme, viewport, sha256, spec path).
- On `main` pushes, the manifest of the latest successful run is stored as the baseline. Where: a `screens-baseline` artifact would expire; the practical choice is a small orphan branch `pr-screens` (manifest only, a few KB, plus the PNG blobs for changed screens).
- On PRs, compare manifests: `new` / `changed` / `unchanged`. Post a **single sticky comment** (marker, edited in place) with: counts, a list of changed and new screens, and up to 6 inline before/after pairs (before from baseline blob, after from this run). If nothing changed, the comment says so in one line, so reviewers can rely on silence.
- Rakazo restricts frames to specs the PR touched because its baseline lags. Cairn can avoid the lag: compare against `merge-base` instead of latest `main`, by looking up the manifest for the PR's merge-base SHA (fall back to latest main, then `unavailable`). (Inferred: this removes the "other merged PRs look new" false positive without needing the spec-stem filter. Verify on real PRs before dropping the filter.)
- PNGs of changed screens only are stored; unchanged ones are referenced by hash. This keeps the branch small (changed shots only; guess about 0.2 to 1 MB per PR).

### Storage

| Option | Pros | Cons |
|---|---|---|
| Actions artifacts only | Zero setup, no secrets | Not embeddable in a comment (needs login, expires in days); fails the `pr-evidence` image-link rules |
| Orphan branch in the repo (`pr-screens`) | Public, embeddable via `raw.githubusercontent.com` permalink to a commit SHA, which the pr-evidence gate already accepts; no secrets | Grows repo history unless pruned; needs a writer with `contents: write` |
| GitHub Pages | Clean URLs, gallery HTML | Needs Pages enablement; `site-deploy.yml` already uses Pages for the site (inferred: a second Pages site is not possible, a sub-path of the existing one is) |
| External S3 (Rakazo) | Scales | Secrets, cost, ian's account |

Recommendation: **orphan branch with SHA-pinned raw links**, pruning PR directories 30 days after close via the weekly gardener workflow. Embedding SHA-pinned raw links satisfies the existing image-link rule (measured: `pr-evidence-gate.py` accepts commit-SHA permalinks).

### Workflow shape

1. `e2e` / `e2e-affected` shards: after the existing run, one extra step runs the screens project (`playwright test --project=screens`, only on the shard assigned to it) and uploads `screens-<run>` with the manifest and PNGs. **Owner route** (workflow).
2. New `workflow_run` workflow `pr-screens.yml` (trusted default-branch code, like Rakazo's publisher): downloads the artifact with safe extraction (zip-slip safe; Rakazo's `extract-playwright-artifacts.py` is the pattern), compares manifests, pushes changed PNGs to `pr-screens`, edits the sticky comment. **Owner route** (workflow, `contents: write`, `pull-requests: write`).
3. `main` push: the same publisher stores the baseline manifest.

### Cost and time

- Product screens in fixture mode need no server, so each shot is a navigation plus a screenshot: about 0.5 to 1 s (guess; the measured gallery spec takes up to 240 s for 212 shots in one test, about 1 s each). 44 shots ≈ 45 s; 300 shots ≈ 5 min.
- Put the screens project on a dedicated 6th runner in parallel with the 5 `e2e-affected` shards (inferred from the current shard layout and the 3 to 4.5 min measured), so it adds a runner but not wall time while the screens project stays under about 4 min. Above that, split by viewport. If the PR does not touch `apps/web/**`, skip the job (the existing `changes` job already classifies this).
- Publisher runs after CI, off the critical path, about 1 min.
- Extra Actions minutes on a public repo: free (guess, needs confirmation for this account).

### Failure modes

- Flaky hashes (fonts, anti-aliasing, time): one render environment (CI Linux), frozen clock, `fonts.ready`, same settings as the gallery spec; comparison by pixel ratio (0.1%) rather than raw hash when raw hash flags an unchanged screen twice on `main` (decide after one week of data).
- Stale baseline: use the merge-base manifest; report `unavailable` rather than guessing.
- Baseline race (two merges to `main` at once): store manifests keyed by commit SHA, never overwrite a single "latest" key (Rakazo needed a recency-check script for this; keyed storage avoids it).
- Fork PRs: no secrets and read-only token. The publisher would see no write token; for forks, post only the artifact link. Cairn PRs are same-repo (measured: branches in `xiechimon/cairn`).
- Comment noise on every push: one sticky comment, edited, never appended.

## 5. Recommendation and PR list

Do both, in this order. Emulator first for GitHub; screenshots can ship independently, and its first step (adding baseline coverage for product screens) is useful alone.

| # | PR | Route | Scope |
|---|---|---|---|
| 1 | `testkit(emu-1)`: stateful GitHub emulator core (PRs, branches, checks, statuses, labels, ETag/304, pagination, 501 for unmodelled) + `FetchLike` origin rewrite; port `github-fake.test.ts` cases | normal | New test package; no production change |
| 2 | `testkit(emu-2)`: GraphQL handler for the closing-PR query, `rules/branches`, PR merge with `sha` pin; move `pr-merge-api`, `merge-gate-*`, `pr-reconcile` tests onto it | normal (tests only) | Touches test files, not the protected merge-gate sources |
| 3 | `testkit(emu-3)`: recorded contracts (10 to 15 gate calls) + replay test comparing emulator shape to the recording | normal | Fixtures plus one test |
| 4 | `ops(emu-4)`: weekly drift workflow + tracking issue (modelled on `gardener-weekly.yml`) | **owner** (workflow) | Read-only, `GITHUB_TOKEN` only |
| 5 | `web(shots-1)`: screens project in Playwright config: every route in the gallery "Screens" list, light/dark/phone, frozen clock, baselines committed | normal if it touches only `apps/web/e2e` and baselines | 44 shots, small |
| 6 | `ops(shots-2)`: manifest writer + compare script + sticky comment builder, unit-tested with fixtures (pure functions, no CI wiring) | **owner** if under `scripts/**`, else normal in `packages/` | Port Rakazo's `compareScreenshotsWithBaseline` and `buildScreenshotComment` logic, not their S3 code |
| 7 | `ops(shots-3)`: CI wiring: screens job on the `e2e` shards, `pr-screens.yml` publisher, `pr-screens` branch, baseline on `main` push | **owner** (workflows) | Needs `contents: write` on the orphan branch only |
| 8 | `ops(shots-4)`: prune closed-PR directories in `gardener-weekly`; add a line to `docs/pr-review.md` and `pr-cairn` skill on reading the sticky comment | **owner** if it changes `scripts/**` or the workflow | |
| 9 | `docs(verify)`: replace hand-captured `docs/verify/<ticket>` UI evidence with a link to the sticky comment where it applies | normal | Optional, after 7 |

Open questions for ian:

- Which repository does the weekly drift check read: `xiechimon/cairn` itself (no setup) or a dedicated sandbox repo (needed if write paths are ever tested)?
- Are Actions minutes on this repo free (public), and is a 6th runner acceptable?
- Is committing screenshot PNGs to an orphan branch acceptable on a public repo, with 30-day pruning?

Sources:

- Elie Steinbock, "How I Built an Open Source Grok Bot in a Day" (youtube `xk-aLMQRYfk`), transcript.
- Rakazo repository at `3d0887f0`: `.github/workflows/playwright.yml`, `.github/workflows/publish-playwright-report.yml`, `scripts/publish-playwright-report.sh`, `packages/testkit/src/{playwright-pr-screenshot-comment,playwright-report-dashboard,model-emulator,emulators.test}.ts`, `docs/agent-verification.md`.
- [vercel-labs/emulate](https://github.com/vercel-labs/emulate) at `1566b8e3`, [emulate.dev](https://emulate.dev).
- [LocalStack: the road ahead](https://blog.localstack.cloud/the-road-ahead-for-localstack/), [InfoQ on the Community edition](https://www.infoq.com/news/2026/02/localstack-aws-community).
- Cairn at `b8b2019bc`: files named inline.
