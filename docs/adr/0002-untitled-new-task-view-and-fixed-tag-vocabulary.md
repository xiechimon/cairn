# ADR 0002 · Untitled new-task view + agent backfill + fixed tag vocabulary

> Status: **Decided** (2026-09-29).
> Source: product direction decision — "humans only dispatch (write the task body); metadata (title/tags) is left to AI". Starting with this change, the new-task dialog **no longer replicates todos.dev 1:1** (the original site's dialog has a title input and manual tags).

## Problem Statement

The new-task dialog asks the user to fill two fields (title + body) and allows manually attaching tags. The demand: only write the task itself; the title is auto-backfilled by the agent; if tags were a free-form vocabulary they would keep creating micro-decisions ("attach or not, which one"), so the vocabulary should be fixed and classification left to AI. Also, the dialog body font size of 13px is hard to read; bump to 14px.

## Recon facts (measured 2026-09-29, with sources for each)

| # | Fact | Source |
|---|---|---|
| F1 | **The server has no LLM call surface at all**: repo-wide (web/server/daemon, excluding node_modules/test) there is no `generateText`/`streamText`/`messages.create`/`chat.completions`; the LLM only lives in the pi runtime embedded in the daemon | repo-wide grep |
| F2 | **The daemon has no todo write-back endpoint**: the machine-client endpoint set = enroll / presence / tasks​/claim / heartbeat / tool / token / upload-urls / done / steer / stop / sync-result | `apps/daemon/src/machine-client.ts` |
| F3 | **A write-back channel already exists and can be narrowed**: `update_todo` (title/spec/tagIds) is in the chief 49-word vocabulary; the remoteTools for worker steps are **delivered by the server in the claim payload** (the worker currently receives the memory three-piece set + attachment reads); the daemon only relays, so adding a tool does not touch the daemon protocol | `packages/shared/src/protocol/chief-tools.ts`, `apps/server/src/services/chief-tools.ts`, `apps/daemon/src/runner.ts:244` |
| F4 | Tags have existed since #309; the only consumption surface is the fresh-state chips on the detail page; board cards do not render tags (calibrated in spec 08 Appendix A); there is no filter/search surface by tag. **Amendment (two tickets after the decision)**: the filter surface was established by #403; starting with #445 board cards render a tag chip (render limit 1 per card) and the top bar was rearranged into repo filter + type popover — the "board cards do not render tags" calibration (including that row in spec 08 Appendix A) is retired with #445. Of this ADR only recon fact F4 is affected; decisions D1–D7 stand unchanged (the D4 vocabulary and the "at most 1" rule fork by repo shape per ADR 0005) | `apps/web/src/detail/fresh-block.tsx`, `#309` ticket notes; amendment see `#403`/`#445` |
| F5 | Dialog spec: title input 16px/500, body textarea 13px/400, both Inter (`font-family: inherit` → `--font-sans` → self-hosted inter-var.woff2); sidebar byline = 14px/400/`--text-secondary` | `apps/web/src/overlay/overlay.css:185-220`, `apps/web/src/styles/fonts.css`, `apps/web/src/board/sidebar.css:258` |
| F6 | The dialog structure and class names are pinned by three sides: apps/web e2e specs, integration `m5-web-e2e.test.ts` (`.new-task-start` and other locators), visual spec geometry assertions (dialog height includes a 58px title slot) | `apps/web/e2e/`, `integration/test/m5-web-e2e.test.ts` |

## Decision

| ID | Decision |
|---|---|
| **D1** | **Remove the title input** from the dialog; the body textarea becomes the only field: save gate = non-empty body (originally pinned to non-empty title), autofocus moves to the body, placeholder keeps the five-line template (the `我想要的结果：…` family) |
| **D2** | **Placeholder title** = first body line truncated to ≤50 characters, derived by the server when persisting in createTodo (the web no longer sends title; the chief `create_todo` tool keeps its self-filled title unchanged) |
| **D3** | **The formal title is backfilled by the executing agent**: the worker-step systemPrompt injects a "before starting work, call `set_task_meta` to backfill a ≤50-character title + at most 1 tag" instruction block (the block carries the current placeholder title + vocabulary name/meaning); add a narrow worker tool `set_task_meta({title, tag?})` — tag is the vocabulary **name** (the agent need not know the id); todoId is pinned by the server from stepId (not exposed in the agent's parameter surface, so it cannot tamper with other tasks) — reuses F3's remoteTools relay; **no new HTTP endpoint, no daemon protocol change** |
| **D4** | **Tags = fixed 6-word vocabulary**: `bug` / `feature` / `improvement` / `refactor` / `docs` / `chore`, fixed colors, seeded as 6 rows at project creation + backfilled for existing projects at server startup; at most 1 per task; if the AI cannot decide, no tag is attached |
| **D5** | **All manual tag UI is cut**: the dialog tag row + tag panel (the #309 surface) and the fresh-state add row on the detail page are removed; read-only chip display is kept; the server `POST /api/projects/:id/tags` HTTP API is kept (reused by seeding + a landing point for future "filter board by tag") |
| **D6** | Fonts: only the dialog body changes 13px → 14px; the font family (Inter), weights, and the global `-webkit-font-smoothing: antialiased` (original-site replication fidelity surface) are untouched |
| **D7** | This change is the **first deliberate divergence from the original site** UI: the divergence is recorded here; any later divergence must get its own ADR |

## Premortem (assuming it already failed: the three most likely failure modes + guardrails)

| Failure mode | Guardrail |
|---|---|
| **The agent does not backfill** (ignores prompt / tool call fails / model does not support tools) → placeholder title persists forever, the board stays on first-line truncation | Backfill failure **does not block** the build (the narrow tool call is wrapped in try/catch; failure only logs); the placeholder title is itself readable; the verify-pacman acceptance asserts "after start, the title is backfilled to a non-placeholder value" |
| **Placeholder title collisions** (creating several tasks in a row with similar first lines like "fix the …", board misread) | seqNum is always on the card as a distinguishing anchor; the agent overwrites within seconds of claiming. **Known trade-off**: the ellipsis only appears on >50-character truncation, so short first lines have no visual marker in placeholder state (the tension in spec 15 Story 10 is closed by this decision) |
| **Fixed vocabulary does not fit** (real workflows want their own taxonomy) | The vocabulary is a server-side single-point constant; changing one place swaps it; the kept HTTP API allows programmatic extension; read-only chips on the detail page can regain an edit surface at any time (F4 shows the consumption surface is thin, so the cost of adding it back is low) |

## Consequences

- **Positive**: creating a task changes from "filling a form" to "writing one thing"; metadata quality improves automatically as models improve; tags go from decorative metadata (F4) to a zero-manual-cost classification surface.
- **Negative**: the manual tag UI surface from #309 becomes dead code and is removed; tasks saved without dispatch keep placeholder titles long-term; pixel parity with the original site's new-task dialog is permanently abandoned (the F6 three-sided pinning is rewritten in the same ticket).
- **Reopen triggers**: the user asks for a custom tag vocabulary; or "save without dispatch" becomes the normal workflow (then server-side title generation is needed, and the seam cost of F1 is re-evaluated then).
