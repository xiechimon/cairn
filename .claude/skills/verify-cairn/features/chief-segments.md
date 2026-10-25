# Segment-row sealing (#955 / ADR 0011)

When the chief runs a round, the model's continuous output is sealed into transcript rows at the **write end** (daemon) per "one continuous run of same-type increments" - sealing writes the journal + reports in real time (the fifth shape `transcript_row`, the server persists then broadcasts). So the streaming phase and the persistence phase share one source: the same segment is both the row that appears instantly during streaming and the row in the final draft. Tool calls are independent records (not segments); thinking gets its own single-line row per segment. Sealing trigger = type change / tool arrival / message end / step finish.

The client does **no splitting at all**: after each segment persists in real time, the web's existing #857 handoff turns that round's text into a persisted row, the typing tail keeps only the "current unsealed segment".

## Sub-features

- `segment-order` — the body segment sorts **before** the tool row that follows it (seal first at the moment the tool arrives). The persisted row's createdAt is forced monotonic, the segment order does not jitter from same-millisecond ties.
- `thinking-row` — the thinking segment gets its own row (collapsed = one italic preview line, expand for the full text), the drawer and the detail page share `components/chat/agent-rows.tsx`'s `ThinkingRow`.
- `inflight-tool-row` — while the round is in flight (`activeRun` non-empty) the tool rows **flatten** into the main presentation, the in-progress one carries "calling X + seconds" (the seconds anchor = that call's true start, no anchor no number); after the round closes it folds back into the robot row's "expand process" disclosure (the r5 canon persisted shape).
- `hub-clear-law` — the in-flight text buffer is only terminated by persisted rows other than "tool rows / thinking-only rows". A tool row's report carries a 500ms/2000ms retry chain and can arrive late; the old law (any row clears) would wipe the next segment while it is still streaming.

## How to get to it (user POV)

- Open the chief drawer (Cmd+J) and send a line, watch it appear segment by segment: a thinking row, a body row, a tool row (in-progress with the seconds).
- The detail page (worker step) is the same shape.
- Driving: this feature has no current case; all registered are judged stale, refused without `--force` (prints the reason on refusal), `vp.mjs list chief-segments` lists usage:
  - `vp.mjs drive chief-segments avatar-geometry`: creating an agent without machineId 400s since ADR 0019.
  - `vp.mjs drive chief-segments compress-model-select`: the compression-model selector already deleted with #1259/#1260.
  - `vp.mjs drive chief-segments segment-sealing`: creating an agent without machineId 400s since ADR 0019.
  - `vp.mjs drive chief-segments stream-catchup`: creating an agent without machineId 400s since ADR 0019.
  - `vp.mjs drive chief-segments threads-scroll`: creating an agent without machineId 400s since ADR 0019.

## Driving it with drive-chief-segments.mjs

Preconditions: `launch.mjs` already started the isolated stack (fresh DB); proxy env all unset.

```sh
env -u http_proxy -u https_proxy -u all_proxy VERIFY_REPO_ROOT=<worktree> \
  node .claude/skills/verify-cairn/scripts/drive-chief-segments.mjs
```

Seeding all goes through public REST + fake machine (provider / agent / PATCH chief / POST chief/threads / api-key / machine enroll / claim), then pushes frames per the **sealed true wire order**: `transcript_delta` (in-flight text), the fifth shape `transcript_row` (segment row), the existing shape toolCallRecord (the tool row's two halves). Zero daemon, zero LLM. 9 assertions: segment order / segment-row shape / persist-then-broadcast / late-entry invariant / idempotence / the tool-row start-half persisted / the drawer's three DOM rows. Evidence `docs/verify/955/`.

The daemon-side sealing itself is pinned by `apps/daemon/test/segment.test.ts` (the segment buffer, 10 cases) and `apps/daemon/test/machine-loop.test.ts` (full-chain row order).

## Gotchas

- **The row id must be unique per run**: `chief_message`'s idempotent upsert uses id as the conflict key and `set` does not change `threadId` - reusing the same `call-1` makes the second run's row write back into the **first** run's thread.
- **An external read-only connection cannot read the just-persisted rows**: the server connection holds the WAL, a new connection reads the old snapshot. Assertions go through the server's own read face (`GET /api/conversations/{id}/messages`), SQLite is only the on-disk artifact.
- The read face returns `content` **already parsed** as array/object, the probe internally sends the string shape.