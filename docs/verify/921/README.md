# #921 evidence: probe-dump tool acceptance run

One full end-to-end run of the probe-dump collector
(`apps/web/e2e/probe-dump.mjs` + `apps/web/e2e/probe-dump-instrument.mjs`)
against the fixture stack on the current main UI. The tool is the collection
half of the visual re-pin workflow (#910 ruling 5: script-assisted collection,
human-reviewed diff); it never rewrites specs — a human reviews the DRIFT rows
and separates expected drift (new canon) from suspected regression.

## Files

- `probe-comparison.md` — the human-review artifact: every visual assertion in
  the suite as `old baseline → new measured`, grouped by status. This run is
  against unchanged main, so every row is KEPT; the DRIFT / VIOLATION sections
  populate when a re-pin (#913 batch) actually moves a value.
- `probe-dump.json` — the structured JSON output: run metadata, coverage
  counts, enumerated probe sites, collected probe values (every
  computed-style / bounding-box object captured at runtime), and the joined
  assertion rows with raw old/new values.

## Method

- Worktree at `d9e90e55` (main UI, pre-redesign).
- Command: `pnpm --filter @pacman/web probe:dump -- --port 8398 --out <dir>`.
  The tool builds the fixture bundle (`vite build --mode fixture`), previews
  it on a free lane port, runs the full 101-spec e2e suite through the repo's
  own `playwright.config.ts` with the instrument preloaded via
  `NODE_OPTIONS=--import`, then joins the records to spec source.
- Capture is by delegation, not reimplementation: the instrument replaces the
  module-level `expect` with a recording proxy and patches the playwright
  client prototypes (reached through the live `page` fixture), each recording
  then calling the untouched original. Matcher semantics — web-first retries,
  `expect.poll`, failure messages — are unchanged. The green run is the proof.
- Result: **787 passed / 0 failed**, playwright 1.63.0, 4 workers.

## Coverage (enumerated → collected)

Enumerated = static scan of spec source (comments/strings blanked, template
`${…}` interpolations kept as code). Collected = distinct runtime call sites
that returned a value; polls and themed loops record repeatedly and de-dupe by
file:line.

| probe surface | enumerated | collected |
| --- | --- | --- |
| getComputedStyle occurrences (the #910 headline count) | 150 | — (captured per evaluate call, below) |
| probe-carrying evaluate/waitForFunction call sites | 131 | 132 |
| .boundingBox() call sites | 104 | 104 |
| .toHaveCSS() call sites | 17 | 17 |
| visual-matcher assertion sites | 778 | 961 rows (themed loops run some sites per theme) |

The ticket's "~110 boundingBox" is a looser `grep boundingBox` that also counts
prose in comments ("boundingBox is scaled"); the exact `.boundingBox()` call-site
count is 104, collected 104/104.

## Comparison rows

780 visual rows: **KEPT 780, DRIFT 0, NOT-RUN 0, VIOLATION 0** — every visual
baseline holds on unchanged main, which is the correct result and confirms the
collector reads the same values the specs assert. 23 of the rows are
`toHaveCSS` (all KEPT).

## DRIFT path (verified separately)

The DRIFT branch was exercised with a throwaway spec (deleted, never committed)
asserting a deliberately wrong baseline against a real computed color. It
produced exactly the review row the workflow needs:

    | spec                | line | matcher | old baseline  | new measured  | status |
    | zz-drift-921.spec.ts | 13   | toBe    | rgb(255, 0, 0) | rgb(23, 23, 26) | DRIFT |

`new measured` is the real sidebar background — the value a reviewer either
re-pins (expected drift) or treats as a regression. Status comes from the
assertion's runtime pass/fail, so a re-pin run surfaces every moved value.

## Notation finding (#411 contract)

7 rows across 5 sites consume tokens defined with `color-mix(in srgb, …)`,
which Chromium serializes as `color(srgb r g b / a)` — not rgb/hex. The tool
folds `color(srgb …)` to rgba losslessly (e.g. `color(srgb 0.5333 0.2235
0.9373 / 0.14)` → `rgba(136, 57, 239, 0.14)`), keeps the row KEPT, and flags in
the `note` column that a re-pin should write the rgb/hex form:

- `accent-typo.spec.ts:285` / `:290` — `--accent-soft` / `--danger-soft`
  (`color-mix(in srgb, … 14%, transparent)`), the row-hover / delete tints.
- `chief-drawer-model.spec.ts:111` / `:159`, `chief-settings.spec.ts:206` —
  measured side of `not.toBe('rgba(0, 0, 0, 0)')` (a surface must not be
  transparent); the folded rgb is the non-transparent actual.

`oklch` / `oklab` / `lab` / `lch` and `color()` in a non-sRGB space cannot fold
to rgb without a gamut transform the contract forbids, so those stay flagged
VIOLATION and are never silently converted. None appear on current main.

## Reproducibility notes

- The instrument fails open: it activates only when `PACMAN_PROBE_DUMP_FILE`
  is set and never touches the vite build/preview processes (the tool builds
  and previews without the preload, so only the playwright workers record).
- Port discipline: the tool refuses an occupied `--port` (another lane's
  build must never be tested against) and defaults to a free lane port, never
  8398/8399 which belong to the affected/full e2e lanes.
- Re-tabulate without a browser: `node e2e/probe-dump.mjs --skip-run --ndjson
  <records> --out <dir>`.
