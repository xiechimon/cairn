# ADR 0011 · Chief process segments in real time at event boundaries; streaming and persistence share one source

> Status: **Decided** (2026-10-06). Landing ticket #955 (under the #908 map; `chief.css` untouched).
> Source: user observation — "all of his conversations are in one single dialog, and it keeps growing non-stop until the task is done. Didn't he separate this state?" — plus one source-level investigation of Multica (`docs/research/r15-multica-run-rendering.md`, HEAD `b4ca5b4a`).

## Problem Statement

When the chief runs one turn, the whole turn's narrative is stitched into a single ever-growing text block: you cannot see which tools it called mid-turn, nor tell "which sentence finished last turn and which one it just thought of this turn", until the turn ends and everything is split **at once**.

This is not the rendering failing to split — it is **stitched as one string in the first place**.

## Recon facts

| # | Fact | Source |
|---|---|---|
| F1 | One turn = one step = one `activeRun`; while in flight, the whole turn's `text_delta` goes into **one string buffer** (`append` is string concatenation with no separators), rendering only a single typing tail line | `apps/web/src/api/live-text.ts`, `apps/web/src/api/mappers.ts` `mapChief` |
| F2 | Assistant text lines **persist only at step end** (`message_end` only writes the local journal; the final version is uploaded in one shot via `upload-urls`); the only thing persisted in real time mid-turn is tool lines | `apps/daemon/src/runner.ts`, `apps/server/src/services/machines.ts` `reportTool` |
| F3 | Physical artifact: in `docs/verify/857/tail-samples.jsonl`, three turns of narrative are stitched into one line, sharing **a single** identity chip | `docs/verify/857/` |
| F4 | Multica splits at the **write side**: consecutive same-type deltas accumulate in a buffer, and a type change / `tool_use` arrival / window tick closes the segment; **persist first, then broadcast**; the real-time line and the final line **share one stable line key** | `docs/research/r15-multica-run-rendering.md` §2/§6 |
| F5 | Thinking text **already persists**: `message_end`'s content is the backend's raw block array (including `{type:'thinking'}`); the runner upserts it as-is, the server writes it as-is; the UI has zero consumption surface (`textOfContent` only extracts `type:'text'`) | `apps/daemon/src/backend/claude-code.ts:227`, `apps/daemon/src/backend/pi.ts:411`, `apps/server/src/services/machines.ts:1701`, measured on the local `~/.pacman/server/server.db` |
| F6 | #905's "content does not go on the wire" refers to the **active-phase surface** it added carrying no content; it does **not** mean "thinking does not enter the database" | `docs/verify/905/baseline.md:64-66` |
| F7 | The two sides' buffer-clearing rules have already forked: the server clears on "any persisted line" (including tool lines); the web clears on "only assistant text lines hand off" (#857). And tool-line reporting carries a 500ms/2000ms retry chain and **may arrive late** | `apps/server/src/services/events.ts:159`, `apps/web/src/api/sse.ts:210`, `apps/daemon/src/runner.ts` `REMOTE_TOOL_RETRY_DELAYS_MS` |

## Decision

| ID | Decision | Reasoning |
|---|---|---|
| **D1** | Splitting happens at the **write side** (daemon runner): each step maintains a "current segment" buffer; seal triggers = type change (text ↔ thinking) / `tool_use` arrival / `message_end` / step end | Client-side splitting would have to guess boundaries; the write side has the truth |
| **D2** | Sealed segments are **reported in real time** (the fifth form of the machine tool), and the server **persists before broadcasting** | Late joiners naturally get completed lines by re-fetching via REST; the replay surface is reduced to "the current unsealed segment" |
| **D3** | The persisted assistant-line shape = **single-type block array** (`[{type:'text'}]` / `[{type:'thinking'}]`); `tool_use` no longer enters assistant lines | A segment is a line; existing raw-block-array lines remain readable as-is |
| **D4** | Segment ids keep `msg-<stepId>-<seq>`, with `seq` redefined from "every `message_end`" to "every seal"; `createdAt` is forced monotonic (`max(now, last+1)`) | Final upload and real-time report share the same id for idempotency; same-millisecond ties would make ordering unstable |
| **D5** | **Show thinking lines**, accepting them entering the UI and the public evidence screenshots | User's ruling. The risk is named: thinking often contains re-stated prompts and user data, and this repo commits verification screenshots into a public repo |
| **D6** | Tool lines are **flat while streaming, folded into the disclosure of the following line after `activeRun` closes** | Keeps the r5-canon persistence shape; isomorphic to Multica's "expanded while streaming, collapsed when settled" |
| **D7** | Server-side buffer clearing is **triggered by assistant text lines only**; tool lines no longer clear | A late-arriving tool line would wipe the next segment being streamed; after the change both sides unify on "buffer = the currently unsealed text" |
| **D8** | **The client does no splitting at all** | D1 + the web's existing #857 handoff already makes each segment land as one line automatically; splitting logic has no reason to exist |
| **D9** | The detail page (worker steps) **changes the same way** | Both share the same daemon sealing; the two surfaces stay the same shape, adding no branch to the shared layer |
| **D10** | **Do not adopt** Multica's preface / middle / final process layering | That belongs to the "one turn one line, steps listed within the line" wave; this ticket only solves "everything crammed together while running" |

## Alternatives considered and rejection reasons

| Alternative | Rejection reason |
|---|---|
| **Client splits the buffer at tool lines** | The client can only see tool lines, not which segment the text belongs to; and a late joiner's replay is one already-glued string with no offsets to split at |
| **Report only at `message_end` (seal timing unchanged)** | **Mathematically incompatible** with "tool lines visible while streaming": tool lines are reported when the tool **starts**, necessarily before the text that precedes them persists, so the UI would show the tool above the text, then jump into the fold at turn end |
| **Seal text only (drop thinking)** | It would make "show thinking" an island requiring a brand-new channel; sealing by type instead makes thinking a by-product of sealing |
| **Keep the status quo** | The user reported exactly the status quo |

## Premortem (assuming it failed: the most likely failure modes + guardrails)

| Failure mode | Guardrail |
|---|---|
| **Segment order flips** (same-millisecond ties, late tool lines) | D4 monotonic `createdAt` + D7 clearing rule; a real e2e asserts "text segment first, its tool line after" |
| **Final upload and real-time line both persist** | Same-id idempotent upsert (existing `onConflictDoUpdate`) + an assertion "the segment's text appears exactly once" |
| **The persistence-shape change breaks existing readers** | `textOfContent` accepts both shapes (string / block array); existing lines are not migrated |
| **Thinking text enters public evidence screenshots** | Evidence screenshots are always taken in the collapsed state; when the expanded state is needed, crop by hand and self-review screenshot content before the PR |
| **Detail page and drawer fork** | D9 changes both; the two surfaces share the line sequence produced by the mapper |

## Read-back verification

This ADR is a design ruling and lands no "server-snapshot-style configuration", so there is nothing to read back. The post-landing read-back surface = the DOM artifact of a real e2e + the evidence chain in `docs/verify/955/` (see the ticket's acceptance criteria).
