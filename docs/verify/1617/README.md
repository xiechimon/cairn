# Spec/ADR drift scan (1617)

The weekly gardener sweep (`scripts/gardener-weekly.mjs`) now appends a
spec/ADR to code drift report when run with `--drift`. The scan lives in
`scripts/doc-drift.mjs`: for every `docs/spec/*.md` and `docs/adr/*.md` it
extracts repo paths and exported identifiers from inline code spans at HEAD,
skips fenced code blocks, URLs, and history lines (headings or table rows
containing "superseded", "retired" or "removed"), and reports a name only when
it is missing at HEAD and existed somewhere in the repo's history. A name that
never existed (reference-product paths, intentional examples) is not reported.

## Negative control on current main

`node scripts/doc-drift.mjs` reports **43 missing names (43 paths, 0
identifiers) across 58 docs** at the current main. All 43 rows name paths that
existed in git history and were later removed; the first 10 reports contain 0
false positives. Full output: `drift-main.log`, machine-readable rows:
`drift-main.json`.

Hand-verified examples from the first ten reports:

| reported missing path | removal commit | verdict |
| --- | --- | --- |
| `apps/web/src/board/sidebar.css` | `84ff1108 web(414): shadcn migration` | real |
| `apps/web/src/overlay/overlay.css` | `7f90b261 web,docs(948): zero overlay per-face CSS` | real |
| `apps/web/src/chief/chief.css` | `b0003125 web(950): retire chief.css` | real |
| `docs/research/assets/r1/f965382e067739e9.css` | `c4a54b1f chore: remove todos.dev capture material` | real |
| `apps/server/src/routes-webhook.ts` | `8822ffb8 chore(1796): remove GitHub webhooks` | real |
| `docs/lessons.md` | `961750ca scripts(1656): split lessons into entries` | real |

Each traced to its removal commit with `git log --oneline -1 -- <path>`.
Reference-product paths that never existed in this repo (`auth/chatgpt-oauth.ts`,
`packages/ui/styles/tokens.css`, `apps/web/ſrc/x.ts`) are not reported.

## Tests: red then green

`tests-red.log` shows the 10 failing tests written before the implementation
(every test fails because the module does not exist). `tests-green.log` shows
`node --test scripts/doc-drift.test.mjs scripts/gardener-weekly.test.mjs`:
19 tests, 19 pass, 0 fail. Coverage: existing path + existing function report
nothing; deleted path reports once with its line; renamed function reports as a
missing identifier; fenced code and URLs ignored; superseded table rows ignored;
short words (`id`, `name`, `true`) not identifiers; never-existing paths not
reported; relative paths resolving under a tracked file not reported; line-range
suffixes stripped; directory references not reported; `--drift` appends the
section and writes the JSON next to the weekly summary.

## Weekly integration

`node scripts/gardener-weekly.mjs --drift --out /tmp/g` appends
`## Spec/ADR drift at HEAD` to the weekly report and writes
`drift-<date>.json` next to `weekly-<date>.md` (`weekly-drift-green.log`,
`drift-main.json` shows the JSON shape). The `gardener-weekly.yml` workflow
passes `--drift`; `ci.yml` runs `scripts/doc-drift.test.mjs` in the baseline
ratchet gate self-test job.

## Gates

`node scripts/single-use-helper-gate.mjs`, `node scripts/comment-discipline-gate.mjs`
and `node scripts/english-only-gate.mjs` all report 0. `pnpm lint` passes.
`node scripts/prepush-vitest.mjs` passes.
