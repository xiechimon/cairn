# #740 acceptance evidence index — mid-session catch-up for conversation-stream entries

probe = `verify-pacman/scripts/drive-chief-catchup.mjs` (added with this ticket; all bedding goes through public REST + a fake machine claiming the chief round step / pushing transcript_delta / uploading the final text / closing out, zero daemon zero LLM — the round's data face is the same shape as a real machine's; `--expect=old` inverts the expectations to take the equivalent-scenario baseline on a throwaway origin/main detached worktree stack, the drive-agent-identity precedent). Stack = an isolated live instance (`VERIFY_PORT` 8791/8792 + `VERIFY_WEB_PORT`
5273/5274, scratch `PACMAN_HOME`, a fresh library seed per launch).

| directory | content | result |
|---|---|---|
| `after/` | this branch's code, full chain: the API face's mid-session catch-up/seam/reconnect + the browser face's drawer mid-entry/live typing + the final convergence without duplicates + zero catch-up for a new stream after the final state | **8/8 PASS** (`after/result.json`) |
| `before/` | `origin/main` (b9aeac1b), same probe with `--expect=old`: the API face shows zero catch-up / only the first frame lost + the browser face shows zero text on mid-entry (the prefix is lost) | **8/8 PASS** (`before/result.json`) |

check details (corresponding item by item to `result.json`):

- `after`: A1 the first text_delta on mid-entry is the exact concatenation of the already-streamed prefix · A2 catch-up +
  live increments concatenate exactly (length 2) · A3 the reconnect snapshot = the whole prefix · B1 the drawer's typing row completes the prefix within one refresh window · B2 the increments after entry type as usual · C1 the final-text row takes over · C2 the persisted text appears exactly once · D1 zero text_delta for a new stream after the final state.
- `before`: O-A1 zero text_delta after subscribing · O-A2 only live increments arrive (the first frame is lost, not a broken channel) · O-A3 zero catch-up on reconnect · O-B1 zero text on mid-entry · O-B2 live increments as usual
  (the channel itself is healthy) · C1/C2/D1 same laws as after.

Motion evidence: `after/catchup-flow.gif` (entry snapshot → incremental segments → final convergence, 6 frames from the same viewpoint; the three static images are same-frame PNGs).

The unit/integration faces (not in this directory): `apps/server/test/conv-stream-catchup.test.ts`
(13 cases: hub catch-up/schema/clear point/dual caps/multi-subscriber/isolation + the chief wire's mid-entry/rewind clear) + `apps/web/test/sse-conversation-stream.test.ts` (6 cases:
clear-on-subscribe/watchdog-rebuild-clear/resync invalidation/convergence law/pass-through).

e2e fallback full run: the `sse.ts` change triggers the shared-face fallback across 90/90 specs, 687/687 PASS
(`/tmp/740-e2e.log`).
