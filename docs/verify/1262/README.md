# docs/verify/1262 — errorMessage ANSI/OSC8 stripping evidence

Ticket #1262: ANSI escapes / hyperlinks from tool output went verbatim into `build.errorMessage`, making the board error unreadably long.

## Fix faces

- **Single source**: `packages/shared/src/ansi.ts` `stripAnsiEscapes` (CSI incl. SGR + OSC incl. OSC8; the OSC content class excludes ESC — it stops before ST, keeping the visible label between the open/close pair).
- **Write side (daemon capture)**: stripped at the doneBody `errorMessage` construction point in `apps/daemon/src/runner.ts` (the wire, the #1026 journal, build.errorMessage and the chief error rows are all clean downstream).
- **Display side (web fallback)**: stripped in `apps/web/src/api/mappers.ts`'s failure-row title + run-history meta (existing dirty data is readable without migration).

## Evidence list

| file | content |
|---|---|
| `row-from-user-db.txt` | **before**: a polluted row from the user's real DB, verbatim (359,698 characters, 75,458 ESCs — biome output dragged in by a git commit hook) |
| `biome-colored.txt` | a real biome `--colors=force` output (SGR + OSC8 hyperlink pairs) |
| `biome-plain.txt` | the same diagnostics with `--colors=off` |
| `biome-onoff-strip-analysis.json` | acceptance 2: the two tiers compared after stripping (the diagnostics' first lines identical verbatim; the residual = biome's symbol glyph tiers ⚠/ℹ/✖ vs !/i/× and the timing lines, not escapes) |
| `e2e-daemon-raw-capture.txt` | the full-chain e2e (real server + daemon + git + stub LLM): the daemon capture-side raw text + the test results |
| `fail-row-1262.png` | **after**: a real board screenshot on the live stack (8796/5278) — the polluted row rendered as plain text |
| `rendered-text.json` | the board driver 5/5 PASS (textContent has no ESC, no `]8;;`, the first line contains file:line:column + the rule name) |

## Rerun entries

- unit: `pnpm --filter @pacman/shared exec vitest run test/ansi.test.ts` (9 tests); `apps/web test/fail-row-ansi.test.ts` (3 tests); `apps/daemon test/runner-error-lifecycle.test.ts` (12 tests incl. the two #1262 cases).
- full chain: `pnpm --filter @pacman/integration exec vitest run test/ansi-errormessage-e2e.test.ts` (the pre-commit hook emits a real biome colored diagnostic → git commit fails → the daemon captures → the done report → the server persists → assert plain text).
- board visual: `node .claude/skills/verify-pacman/scripts/launch.mjs` (VERIFY_PORT=8796 VERIFY_WEB_PORT=5278) → `node .../scripts/drive-1262-ansi-error.mjs` → `cleanup.mjs`.

## Multica comparison

`sanitizeCLIOutput` (`server/pkg/agent/codearts.go:801`) is the same domain: `"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))"` strips at the CLI-output capture side. Its OSC branch greedily `[^\x07]*`-matches and would swallow the visible label (the rule name) between an OSC8 open/close pair — this implementation's OSC content class excludes ESC and does not make that shape.
