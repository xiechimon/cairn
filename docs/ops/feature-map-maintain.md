# Feature-map maintain

Continuous upkeep for Cairn's two feature maps. Modeled on poteto's `/maintain-verification-skill` daily loop, split so mechanical ticket-register freshness and empirical verify-cairn maintain do not share one gate.

## Dual-map roles

| Map | Path | Role | Upkeep |
|---|---|---|---|
| Ticket living register | `docs/feature-map.md` | Mechanically extracted ticket × tier × verification anchors | `node scripts/generate-feature-map.mjs` / `--check` |
| Empirical verification map | `.claude/skills/verify-cairn/features/` | User-POV entries, drive recipes, Gotchas for `/verify-cairn` | `/maintain-verify-cairn` (source + live); index hygiene in daily Actions |

Do not hand-edit `docs/feature-map.md`. Do not edit product code during empirical maintain to make a red drive look green — that is a product regression ticket, not a map fix.

## Daily Actions loop

Workflow: `.github/workflows/feature-map-daily-check.yml` (cron `17 18 * * *`, also `workflow_dispatch`).

Runs `node scripts/feature-map-maintain.mjs --file-issue`:

1. **ticket-register** — `generate-feature-map.mjs --check` (needs `gh` + API; workflow sets `GH_TOKEN`).
2. **verify-features-index** — every `features/*.md` except `README.md` is linked from `features/README.md`, and every README link target exists.

On failure the job exits non-zero and opens or comments one deduped issue titled `chore: feature-map maintain failed` (labels `documentation`, `batch:next`, `by:cairn`). Marker in the body: `<!-- feature-map-maintain -->`.

This check is **not** a PR merge gate. Putting ticket-register `--check` on PR CI reds unrelated PRs whenever GitHub issue state churns (#1527). Empirical map merge coverage stays with `vp-registry-gate` inside the verify-cairn self-test.

## Cursor Cloud / agent routine (empirical map)

Use `.claude/skills/maintain-verify-cairn/SKILL.md` (poteto maintain semantics, scoped to verify-cairn):

1. Index hygiene on `features/`.
2. Source wave per feature file (read-only).
3. Live pass via verify-cairn Launch → Doctor → Drive; evidence survives Cleanup.
4. Outcome: `clean` | `changed` (one PR under the skill directory only) | `blocked` (file/report; do not patch product).

Schedule that pass with a Cursor Cloud Automation or Project timer. GitHub Actions cannot substitute a real browser live pass.

## Human setup

1. Enable scheduled GitHub Actions for the repository (GitHub pauses schedules on long-idle repos).
2. **No extra secret** for issue filing: `permissions.issues: write` + `github.token` is enough. Labels `documentation`, `batch:next`, and `by:cairn` must already exist (they do on this repo).
3. Optional later: a PAT (`FEATURE_MAP_REFRESH_TOKEN` historically) only if you want the bot to open regeneration PRs that still trigger CI — out of scope for the daily check.
4. Optional later: restore a slim path-existence staleness check; the full class/css baseline gate stays retired after #2200 unless re-approved.

## Local commands

```sh
node scripts/feature-map-maintain.mjs
node scripts/feature-map-maintain.mjs --file-issue --dry-run
node scripts/feature-map-maintain.mjs --skip-ticket-register
node scripts/generate-feature-map.mjs --check
node --test scripts/feature-map-maintain.test.mjs
```
