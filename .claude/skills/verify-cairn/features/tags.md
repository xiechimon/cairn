# Tags (fixed vocabulary + agent backfill, spec 15 #394 / ADR 0002)

Tags = the task's category classification: **a fixed 6-word vocabulary** (bug / feature / improvement / refactor / docs / chore, fixed colors, shared `FIXED_TAGS` single source), seeded on project creation and backfilled for existing projects at server startup; **no manual create/pick UI** — the executing agent backfills via the worker narrow tool `set_task_meta({title, tag?})` before starting work (the todoId is pinned by the server from the stepId, a tag name outside the vocabulary = 400), at most 1 per task, and none if it cannot judge. The task detail's fresh meta area renders read-only TagChips by tagIds (the whole row does not render when there is no tag); **board cards render tags** (since #445, at most 1 per card = the render cap, zero placeholder when no tag; the original spec 08 appendix A "board cards do not render" calibration is retired, revised by ADR 0002 F4). Starting with the Paper card (PR #1371), the card-surface tag = a tag icon + name in the meta-info row, the icon taking tag.color, no longer a solid TagChip; TagChips survive only in the detail meta and the type-filter popup.

## Sub-features

- `tag-fixed-vocab` the vocabulary is a fixed set of 6 words (`FIXED_TAGS`, packages/shared/src/task-meta.ts), name/description/color single-sourced.
- `tag-seed-on-project-create` project creation seeds the 6 rows (both the REST POST /api/projects and the chief create_project surfaces).
- `tag-seed-backfill` server startup idempotently backfills existing projects by name (whoever is missing gets added, zero actions on the second startup).
- `tag-agent-assign` the executing agent backfills via `set_task_meta` (alongside the title backfill; server vitest `apps/server/test/task-meta.test.ts` pins the relay chain + the validation surface).
- `tag-render-detail-meta` the task detail's fresh meta area renders TagChips by todo.tagIds (one chip per tag, read-only); board cards also render since #445: the carrier is `[data-card-tag]` (value = tag id), the tag icon svg's color = tag.color, the text = the tag name; the first parseable tag, zero placeholder when no tag (the e2e pin = board-filter.spec).
- `tag-no-manual-ui` the new dialog has no tag row/panel; the detail page has no add affordance; the `POST /api/projects/{id}/tags` HTTP API stays (reused by seeding + the future filter-surface landing point).

## How to get to it (user POV)

- Users do not operate tags. After dispatching a task, the executing agent classifies it automatically; the detail-page meta area shows the backfilled chips (read-only).
- Driving (`vp.mjs list tags` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive tags fixed-vocab-untitled`: fixed-vocabulary backfill and untitled tasks.

## Driving it with verify-cairn

Preconditions:

1. `launch.mjs` brings the isolated stack up, `doctor.mjs` fully PASS. Seeding / read-only rendering are UI + server surfaces, no daemon needed.
2. Live surface: the board new-task dialog (auto-creates `默认项目` when there is no project, same as board-new-task).

- **Fixed vocabulary + untitled surface.** Board `新建任务` -> the dialog (no title input / no tag row) -> multi-line body -> save -> card title = first line. **How to run:** `node <skill>/scripts/drive-tags.mjs` (self-sufficient, no daemon/seed needed) — checks: the type-filter popup's selected-row TagChip landing contract (`[data-slot="badge"]`, 20px geometry; since XMON-14 it lands on the registry Badge) -> negative-space pins (no `.new-task-input`/`.new-task-tags`/`.new-task-tag-add`) -> the placeholder title lands on the card -> API todo.title/tagIds empty -> the seeded vocabulary has 6 rows (API + SQLite) -> the detail page has no tag row + h2 = the placeholder title -> a tagless card has zero placeholder (no chip on the card surface).
- **Agent backfill surface.** Needs a daemon + a real model, not scripted — server vitest covers the relay chain (the three set_task_meta tests in `task-meta.test.ts`); a live re-check = bring the full stack up, dispatch a task, watch the board-card title get overwritten after execution starts and a chip appear on the detail page.
- **Verification state (2026-09-29)**: rewritten with #394, waiting for this ticket's verification to produce its first evidence.

## Gotchas

- Board cards render tags since #445 (from the Paper card on = the `[data-card-tag]` icon + name, the icon taking the vocabulary color, at most 1 per card) — the old "board cards do not render" calibration rule (spec 08 appendix A) is retired; a tagless task's card surface must still have zero placeholder (what drive-tags's board-card-no-chip pins is exactly this).
- The vocabulary verification mirror is **deliberately hard-coded** in `drive-tags.mjs` (EXPECTED_TAGS) — decoupled from shared, a vocabulary drift must FAIL the script; when changing the vocabulary, update it in sync.
- A task saved without dispatch keeps its placeholder title + no tag for a long time — expected behavior (ADR 0002 Premortem), not a defect.
- The old-ticket note (#309 manual tag surface) was removed with ADR 0002 D5; historical evidence lives in `docs/verify/309/` (archives are not deleted).
