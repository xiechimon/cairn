# ADR 0005 · Tag and title truth forks by repo shape

> Status: **Decided** (2026-09-30).
> Source: triage and grill of #446 (2026-09-29 ~ 09-30); original feedback = "tags should map onto concrete issues".
> Relationship: this ADR **narrows the applicability of ADR 0002 D2/D3/D4 to local-shape projects** and records the re-decision for the github shape; the rest of ADR 0002 (D1/D5/D6/D7) remains in full force.
> Numbering note: 0004 was occupied by in-flight lane #447 (chief panel form), so this file takes 0005; if #447 has not merged, renumber before merging per the repo discipline "numbers follow main's tail at merge time".

## Problem Statement

Since ADR 0002 D4, tags = fixed 6-word vocabulary (bug / feature / improvement / refactor / docs / chore), seeded per project, at most 1 per task, backfilled by the executing agent at dispatch. Since ADR 0002 D2/D3, the title = first-body-line placeholder truncation, with the formal title backfilled by the executing agent after claiming.

The shared premise of these two decisions is: **pacman is the single source of truth for metadata** — there is nowhere else that already holds this metadata. But that premise fails for github-shape projects: the repo side already holds a **human-written** issue (title + labels included), and the same task holds one truth on each side. What the user wants is not "a different vocabulary" but an answer to "which side holds the truth".

## Recon facts (measured 2026-09-30, with sources for each)

| # | Fact | Source |
|---|---|---|
| F1 | The server's GitHub surface only has **connection and repo listing**: `lib/github.ts` only calls `/user` and `/user/repos`; there is no issue read surface, no label surface, no create-issue surface at all | `apps/server/src/lib/github.ts`, `apps/server/src/services/github-connection.ts` |
| F2 | The OAuth request scope = `read:user repo` (`GITHUB_CONNECTION_OAUTH`, single source); `repo` already includes issues/labels read-write ⇒ **no new scope needed** for this decision | `apps/server/src/services/oauth.ts`, the token exchange in `apps/server/src/lib/github.ts` |
| F3 | The github shape of the execution surface = the executor connects directly to the remote with `x-access-token` and pushes the conv branch; **no PR is created, no issue is created**; the `build.prUrl` / `prNumber` columns exist but are always null | `apps/daemon/src/runner.ts`, `apps/server/src/db/schema.ts` |
| F4 | **"At most 1 tag per task" lives only in text and prompts**: `todo.tagIds` is already an array; `todo_tag` is a pure join table keyed on `(todoId, tagId)`; the constraint is actually enforced only at three places: the ADR 0002 body, the `set_task_meta` tool's single `tag` parameter, and the daemon-injected prompt | `apps/server/src/db/schema.ts`, `packages/shared/src/protocol/chief-tools.ts`, `apps/daemon/src/runner.ts` |
| F5 | `tag` is one word per row per project (`name` + `color`); GitHub labels carry their own colors ⇒ syncing them in gives us the color scheme for free | `apps/server/src/db/schema.ts`, `apps/server/src/services/tags.ts` |
| F6 | `todo` already has a provenance family (`sourceTodo` / `createdBy` / `ownerId` / `sourceBuildId`); source binding can join the same family | `apps/server/src/db/schema.ts`, `packages/shared/src/records/todo.ts` |
| F7 | The user's instance has **zero usage surface today**: `github_connection` has zero rows (GitHub was never connected), and the only project is still the legacy `hosted` shape | measured on `~/.pacman/server/server.db` |

## Decision

| ID | Decision |
|---|---|
| **D1** | **Fork rule**: for `githubRepo`-shape projects, **the truth for both tags and titles lives on the issue**; for `local`-shape projects, both stay inside pacman. The applicability of ADR 0002 D2/D3/D4 is accordingly narrowed to local. |
| **D2** | **Vocabulary source forks**: the tag vocabulary of a github project = the repo's actual label set (dynamic); a local project = the fixed 6-word vocabulary (ADR 0002 D4 as-is). The vocabulary source is a property **of the tag**, not a new entity. |
| **D3** | **Vocabulary landing**: repo labels are upserted into the `tag` table keyed on `(projectId, name)`, colors taken from GitHub's color. Labels later deleted on the repo side **keep their rows** — deleting rows would cascade through `todo_tag` and strip tags already attached to tasks; a tag's history must not be rewritten by an external repo. |
| **D4** | **Tag count forks**: github projects are unbound (attach however many the issue carries); local projects stay at most 1. The reason "at most 1" is voided on the github side: the original intent of that limit was to eliminate the micro-decision of **manually** picking a tag (ADR 0002 premortem), while an issue's labels are a fact already attached by a human, not options to pick on the spot. |
| **D5** | **Title provenance forks**: tasks created from an issue use the issue title directly, skipping the placeholder→backfill two-phase flow; local projects keep the two-phase flow as before. |
| **D6** | **Tasks have a "source"**: a task can be bound to one external origin (today only the GitHub issue kind), and the binding joins `todo`'s existing provenance family. |
| **D7** | **This decision fixes only truth and shape, no write direction**: creating an issue on GitHub for self-dispatched tasks, and writing the backfilled title back to the issue = separate follow-up ticket; automatic sync and phase write-back are likewise outside this decision. |

## Premortem (assuming it already failed: the three most likely failure modes + guardrails)

| Failure mode | Guardrail |
|---|---|
| **Two truth sources drift**: the repo side renames / deletes a label or edits the issue title, and pacman not refreshing becomes inconsistent with the repo | D3's kept rows guarantee "attached tags never silently vanish"; the import surface pulls fresh each time and is not cached into a second truth. The ticket's acceptance criterion is written as "when the repo changes, pacman must at least not become more wrong", not as a consistency promise. |
| **Vocabulary runs wild**: real repos often have 20+ labels mixing in process words like `needs-triage` / `area:*`, and both agents and users lose the classification value | **Do no name-heuristic filtering on the pacman side** — filter rules shatter as repos get renamed and silently swallow words the user actually uses. The vocabulary mirrors the repo's truth; layout problems go to the card render cap, not to the vocabulary. |
| **The fork becomes two rule sets**: on the same board, github tasks carry multiple tags while local tasks carry one, and the implementation grows two branches | Both sides share one invariant — **an attached tag must be in the project's tag set** (github project = repo label mirror; local = 6-word seeding). `set_task_meta`'s validation changes from "whitelisted 6 words" to this invariant, and the count cap becomes a parameter of the call surface rather than a property of the vocabulary. |

## Consequences

- **Positive**: each truth goes to its place — a github project's metadata follows the repo, and what a human wrote on GitHub no longer needs re-typing in pacman; the data surface barely moves (F4), lifting the multi-tag cap is free; colors come for free (F5).
- **Negative**: **the same concept grows two semantics** (vocabulary source, tag count, and title provenance all fork by repo shape). This is the main cost of the decision: the corresponding entry in `CONTEXT.md` must state the qualification, or the next reader will assume both sides are the same. The fork's legitimacy comes from "a local project has no external truth to defer to at all" — it is a constraint, not a preference.
- **Zero usage surface**: F7 — the user's instance has never connected GitHub; this decision shapes future github-shape projects. It changes no existing behavior today; the local-project side is untouched byte-for-byte.
- **Relationship to ADR 0002**: a narrowing, not an overturn. Tag and title behavior for local projects is exactly as decided the day ADR 0002 landed.
- **Reopen triggers**: after the write-direction follow-up lands, re-examine D7's boundary (which side is source of truth changes from "each rules its own segment" to "who overrides whom"); when a second origin kind appears (PR / CI failure / external ticket), re-review D6's shape; when local-project users start complaining "why can't my repo have real labels", re-review the D2 fork (that is the signal to bring back the editable vocabulary).
