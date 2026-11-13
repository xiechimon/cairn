# Feature-map maintain

How Cairn keeps its feature map current. The model is poteto's feature map: materialized memory, stored with the verification skill, that tells an agent what features the app has, how a user reaches each one (routes, keyboard shortcuts, the elements to click) and what each one does, so a vague report or screenshot becomes a reproducible drive.

## Files

| File | Role | Edited by |
|---|---|---|
| `.claude/skills/verify-cairn/feature-map.json` | The registry: one row per user-facing feature with code areas, route patterns, reach steps, states, research, frontend design, backend design, evidence, verify recipes, and the gap batches | hand, in the PR that changes the feature |
| `.claude/skills/verify-cairn/feature-map.md` | Agent-facing map: per feature, the reach steps plus the routes, settings path, keyboard shortcuts and test ids extracted from `apps/web/src` | `node scripts/generate-feature-map.mjs` |
| `docs/feature-map.md` | Coverage view: research and design per feature, gaps by batch, notes not on main, eval coverage | `node scripts/generate-feature-map.mjs` |
| `.claude/skills/verify-cairn/features/` | Drive recipes for `/verify-cairn`, linked from the registry rows | `/maintain-verify-cairn` |

## The check

`node scripts/generate-feature-map.mjs --check` runs in the CI `gates` job on every PR (with `FEATURE_REGISTRY_BASE_SHA` set to the PR base) and fails when:

- a web route in `apps/web/src/App.tsx`, a settings section in `apps/web/src/settings/settings-page.tsx` or a server route in `apps/server/src/app.ts` and `routes*.ts` maps to no feature, or a route pattern matches nothing;
- a reach step opens a route, names a settings section, clicks a test id or a `t()` label, or presses a key that the source does not have;
- a research, frontend design or backend design slot is empty instead of linking files or saying `{"gap": ...}` or `{"na": ...}`;
- a linked file, code path, evidence path or verify recipe does not exist and is not listed under `pending`;
- a shipped feature has no evidence, or a built feature has no reach steps or states;
- a gap has no batch, a batch holds no gap, or the PR adds a gap that the base did not have, so a new feature must arrive with its research and designs;
- either generated file differs from what the registry and the code produce, which is how test-id, shortcut and route drift is caught.

`scripts/prepush.mjs` counts a document the registry cites as one a check reads, so a docs-only PR that deletes or renames a cited note still runs the gates.

## Daily Actions loop

Workflow: `.github/workflows/feature-map-daily-check.yml` (cron `17 18 * * *`, also `workflow_dispatch`). It runs `node scripts/feature-map-maintain.mjs --file-issue`:

1. **feature-map**: the same `generate-feature-map.mjs --check`, as a net for anything that reached main without the gates.
2. **verify-features-index**: every `features/*.md` except `README.md` is linked from `features/README.md`, and every link target exists.

On failure the job exits non-zero and opens or comments one deduped issue titled `chore: feature-map maintain failed` (labels `documentation`, `batch:next`, `by:cairn`, marker `<!-- feature-map-maintain -->`). A passing run closes that issue as completed with a link to the run, so the issue is open only while the check is red; the next failure opens a new one. Issue filing and closing need `permissions.issues: write` and `github.token` only.

## Live maintain routine

Use `.claude/skills/maintain-verify-cairn/SKILL.md`: index hygiene, a read-only source wave per feature, a live pass with verify-cairn Launch, Doctor and Drive, then one PR under the skill directory. When a live pass shows that a row's reach steps no longer get to the feature, fix the row in `feature-map.json` and regenerate. Do not edit product code to make a red drive look green; that is a product regression ticket.

## Local commands

```sh
node scripts/generate-feature-map.mjs
node scripts/generate-feature-map.mjs --check
node scripts/feature-map-maintain.mjs --file-issue --dry-run
node --test scripts/generate-feature-map.test.mjs scripts/feature-map-maintain.test.mjs
```
