# Public eval-result publishing: prior art (2026-11-27)

Question: Cairn's real-task eval now runs daily on the Mac mini. How should the public static site show the latest run — date, per-case pass/fail and model — without exposing Langfuse credentials, internal tailnet URLs, local paths, or quota details?

Evidence markers: **Observed** = read first-hand in this pass; **Derived** = consequence of Observed; **Unverified** = not checked.

## Comparison

| Source | How it publishes benchmark results | Trade-offs for Cairn | Link / marker |
|---|---|---|---|
| SWE-bench website | Static site generated from `data/leaderboards.json`; the README documents the flow JSON → build-time template rendering → static HTML, and says updating the JSON propagates on the next build. | Very simple and robust, but Cairn's site deploys only when `site/**` changes, so committing results to `main` would make every daily eval pay the merge queue and site deployment cost. | [SWE-bench/swe-bench.github.io README](https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/README.md) — Observed |
| Aider polyglot leaderboard | Static documentation renders `aider/website/_data/polyglot_leaderboard.yml`; rows carry model, date, pass counts/rates, command and cost. | Proves benchmark consumers expect model + date + pass counts next to the score. Committing YAML to the product repo has the same daily-merge cost for Cairn; cost/quota fields are explicitly out of scope here. | [polyglot_leaderboard.yml](https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml) — Observed |
| Terminal-Bench website | The leaderboard is typed static TypeScript data with agent, model, date, accuracy and verification status. Separate submission repositories keep raw trial artifacts. | Separating public score rows from raw traces is the right boundary: public rows need outcome and model, not internal trace URLs or logs. Static TS data still requires a site rebuild. | [terminal-bench-website data.ts](https://raw.githubusercontent.com/harbor-framework/terminal-bench-website/main/app/(home)/leaderboard/data.ts) — Observed |
| Terminal-Bench submission repo | Raw jobs are submitted under `<agent>__<model>/` with metadata and per-trial `result.json`; validation demands multiple trials. | Cairn should aggregate repeated trials per case but keep the public row at case granularity, not upload raw session logs. | [terminal-bench-2-leaderboard search result](https://github.com/harborframework/terminal-bench-2-leaderboard) — Observed through search snippet; repository fetch was unavailable |
| Cairn's existing deploy path | `site-deploy.yml` builds static `site/dist` and deploys to Vercel only after `site/**`, `eval/suite.json`, or `eval/tasks/**` changes on `main`; the homepage already reserves an eval proof card with an empty "No public eval run yet" state. | A purely build-time data file cannot stay current unless the eval creates daily main-branch commits. A small client-side JSON fetch is the only static-site-compatible way to update daily without merge-queue noise. | `site-deploy.yml`, `site/src/components/Home.astro` in this checkout — Observed |
| GitHub raw content | Measured response headers for `https://raw.githubusercontent.com/xiechimon/cairn/main/eval/suite.json` include `access-control-allow-origin: *` and `cross-origin-resource-policy: cross-origin`, with a five-minute cache. | A public branch in the same repository can serve a small sanitized JSON file to the static site with no new hosting secret, no Vercel API token, and no public exposure of the mini. Five-minute staleness is acceptable for a daily eval. | curl header measurement, 2026-11-27 — Observed |

## Pattern that fits Cairn

Use two artifacts with different trust boundaries:

1. **Private/local evidence** stays where it is: `$EVAL_DAILY_STATE/{latest.json,history.json,index.html}` and Langfuse traces. These may include tailnet URLs and scrubbed diagnostics for maintainers.
2. **Public score rows** are generated as a separate sanitized JSON document and pushed by the daily runner to a dedicated public `eval-results` branch in this repository. The site fetches `https://raw.githubusercontent.com/xiechimon/cairn/eval-results/latest.json` in the browser and renders it with `textContent`/DOM nodes only.

This follows the SWE-bench/Aider static-data pattern but moves the mutable data one branch away from `main`, avoiding a daily merge-queue commit. It also follows Terminal-Bench's boundary between public leaderboard rows and raw artifacts: the public JSON contains date, suite version, SHA, aggregate counts, per-case pass/fail/incomplete counts and model/executor labels; it deliberately omits trace URLs, hostnames, local paths, secrets, quota text, cost, stderr/stdout and diagnostics.

## Recommendation

Implement `scripts/ops/eval-public-results.mjs` as the single sanitizer/publisher used by `scripts/ops/eval-daily.mjs` after a run produces valid item results. Publish failure must not rewrite the already measured scores; it is recorded in the local summary and surfaced by a stale public date. Render the fetched data in the existing homepage proof card in both English and Chinese, with a static no-results fallback when the fetch is unavailable.

Code areas: `scripts/ops/eval-public-results.mjs`, `scripts/ops/eval-daily.mjs`, `scripts/ops/eval-daily.test.mjs`, `site/src/components/Home.astro`, `site/src/components/copy.ts`, `docs/ops/eval-daily.md`, and `docs/design/eval-public-results.md`.
