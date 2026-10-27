# ADR 0006 · Write direction: create a GitHub issue at task creation (server outbound, failure non-blocking)

> Status: **Decided** (2026-09-30).
> Source: grill of #452 (2026-09-30); the original demand comes from #446's "self-dispatched tasks should also have an issue".
> Relationship: **complements ADR 0005** (does not modify it). ADR 0005 D7 pushed the write direction to a follow-up ticket; this ADR is that ticket's decision record; it also answers the open question ADR 0005 left under "Reopen triggers" — who holds the truth once the write direction lands.

## Problem Statement

ADR 0005 established the fork rule: for `githubRepo` projects, the truth for tags and titles lives on the issue. But for "self-dispatched tasks" that sentence is empty — they have no issue at all. So the same board would carry two title provenances side by side: claimed tasks use the issue title; self-dispatched tasks go through placeholder → agent backfill. This is exactly the kind of fork ADR 0005 wanted to eliminate, just relocated.

This decision completes the other half: **self-dispatched tasks also create a GitHub issue**; when the executing agent backfills the title, it writes into that issue.

## Recon facts (measured 2026-09-30, with sources for each)

| # | Fact | Source |
|---|---|---|
| F1 | The repo has **no code that writes to `api.github.com` at all**: `lib/github.ts` has only two GETs, `/user` and `/user/repos`; the only POST is the OAuth token exchange ⇒ this decision makes the server write an external system for the first time | `apps/server/src/lib/github.ts`, `apps/server/src/services/oauth.ts` |
| F2 | Task creation has a single chokepoint `createTodo`: the web route, the chief `create_todo` tool, and the MCP face all go through it; it already validates `tagIds` against "within the project's tag set" | `apps/server/src/services/todos.ts`, `apps/server/src/services/chief-tools.ts`, `apps/server/src/services/mcp-face.ts` |
| F3 | The daemon side only has the per-step `x-access-token` for the git remote (spliced into the clone/push URL); **nothing shows it hands credentials to the agent's shell** ⇒ "let the executing agent create the issue itself" would require laying a new credential pipeline | `apps/daemon/src/runner.ts` |
| F4 | The execution surface today does not even create PRs (`build.prUrl` / `prNumber` are always null) — the first GitHub write of any kind is this decision's issue creation | `apps/server/src/db/schema.ts`, `apps/server/src/services/builds.ts` |
| F5 | The placeholder-title derivation is already a shared single source (first body line truncated to ≤50 characters) | `packages/shared/src/task-meta.ts` |

## Decision

| ID | Decision |
|---|---|
| **D1** | Issue creation is done **outbound by the server at the `createTodo` chokepoint** — immediately after the task persists. All three creation paths are covered at once; no per-surface duplication across web/chief/MCP. |
| **D2** | **Failure is non-blocking**: if creation fails (not connected / insufficient permissions / network), the task is still created, the source is marked "not created" and a retry entry point is kept. GitHub availability must not become a precondition for creating a task. Issue creation must stay off the critical path of the create-task request; the latency of creating a task must not depend on GitHub. |
| **D3** | The issue's initial title = the **placeholder title** truncated from the first body line (F5 single source); when the executing agent backfills, it writes the formal title into that issue. |
| **D4** | **Import guardrail on the pacman side**: one issue maps to at most one task; the import list dedupes by reverse-looking-up already-persisted sources — one rule covers both "a self-created issue gets imported" and "the same issue gets imported twice". No marker label is stamped on the GitHub side. |
| **D5** | **Half-coupling handled as "hint, don't override"**: the task detail page shows the source issue's current title and status (fetched once on entry); on mismatch, show one line of neutral hint, **no automatic override**. ⇒ This answers ADR 0005's open question: after the write direction lands, the truth relationship is not "who overrides whom" but **the issue side remains the truth, and the pacman side only displays the difference**. |
| **D6** | **Read-back failure degradation**: if the fetch fails (not connected / token expired / rate-limited / issue deleted), hide that line — show no stale value, pop no error. The echo is supplementary information and must not turn the detail page into an error scene. |

## Premortem (assuming it already failed: the three most likely failure modes + guardrails)

| Failure mode | Guardrail |
|---|---|
| **Server stalls on issue creation**: `createTodo` is a synchronous path backed by a synchronous sqlite driver; one hung outbound HTTP can drag down task creation | D2's "non-blocking" is a hard constraint, not a preference: issue creation stays off the request critical path (triggered after persistence + retryable on failure). During construction, write "task creation latency is unchanged for projects without a GitHub connection" as an acceptance criterion. |
| **The repo's issue list gets flooded by the task stream**: one issue per self-dispatched task, and that list stops being a "curated todo list" | This is the **core motivation** of the decision (all work visible on the GitHub side), not a side effect; no guardrail is set up to suppress it. D4 guarantees pacman won't re-ingest its own issues. If it gets noisy later, the remedy is filtering views by label on the GitHub side, not creating fewer issues. |
| **Credential surface expands**: the server goes from "GitHub read-only" to "GitHub writable"; this step is the easiest to miss when multi-tenancy comes | Keep the tenant-level single-row connection's `openGithubToken` as the only outbound boundary; add no new credential storage surface; there are **only two** write operations (create issue, write title), recorded in this ADR for future audit and narrowing. |

## Consequences

- **Positive**: the fork rule closes — github-project tasks have a landing spot on GitHub regardless of provenance; a human on GitHub can see all the work without returning to pacman to learn what is running.
- **Negative**: the server gains the ability to write an external system for the first time; the trust surface grows; the repo's issue list is flooded by tasks; the two truth sources enter an asymmetric relationship of "issue wins, pacman only hints" — this asymmetry would drift silently without D5's echo, so D5 is not an optional garnish.
- **Relationship to ADR 0005**: a complement. 0005's D1–D6 are unchanged byte-for-byte; this decision lands its D7 from "follow-up ticket" into shape and answers the question it left open.
- **Reopen triggers**: when a second external origin appears (PR / CI failure / external ticket), re-review the outbound boundary and the shape of the provenance family; when pacman needs to **automatically override** the issue, re-review D5; on multi-tenant deployment, re-review the credential surface and D2's degradation semantics.
