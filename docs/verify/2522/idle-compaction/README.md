# #2522 idle compaction: a summary before the message instead of inside it

Raw rows: `idle-compaction.json`, one row per compaction and per user turn.

## Command

```sh
cd integration
node --import tsx eval/coordinator-context/idle-compact.mts --out ../docs/verify/2522/idle-compaction
```

## Setup

- Code path: the daemon's own `PiBackend` (`apps/daemon/src/backend/pi.ts`). `compactSession` is the call a compaction-only Coordinator step makes, and `continueSession` is the user turn. Both pass the server's `CHIEF_COMPACTION` settings: compact above 64,000 tokens and keep the most recent 16,384.
- Session: the spike fixture's first 275 turns, seeded into a pi session file, about 72k tokens by the chars/4 estimate. This is above the 64k threshold, so a user turn without an earlier compaction compacts inside the turn.
- Model `anthropic/claude-haiku-5-5`, thinking `low`, the metered Anthropic key the spike used.
- TTFT is the production `ttftMs`: the time from the daemon's prompt send to the first streamed token, which includes any compaction pi runs before the request.
- Two arms on identical copies of the session:
  - `in-turn`: two user turns, with no compaction before them.
  - `idle`: `compactSession` first (the idle step), then the same two user turns.

## Results

| Arm | Step | TTFT ms | Compaction ms | Prompt tokens of the turn's request (input + cacheRead + cacheWrite) | Cost USD |
| --- | --- | --- | --- | --- | --- |
| in-turn | turn 1 | 27,794 | 17,159 inside the turn | 36,529 (36,527 cache write) | 0.0047 |
| in-turn | turn 2 | 1,236 | 0 | 36,814 | 0.0004 |
| idle | idle compaction | none (no user waiting) | 20,019 wall, 72,389 → 18,699 tokens | n/a | 0.0107 |
| idle | turn 1 | 2,643 | 0 | 36,634 (35,322 cache write) | 0.0049 |
| idle | turn 2 | 994 | 0 | 37,641 | 0.0005 |

Spend: 0.021 USD as reported by pi, plus a smoke call of under 0.001 USD.

- With the compaction done while idle, the first message waited 2.6 s instead of 27.8 s. The rest of that 2.6 s is the cache write for the new, post-summary prefix: 35k tokens written and 1.3k read. The next turn is back at about 1 s.
- In the in-turn arm the 17.2 s summary ran between the prompt send and the first token, the same failure the spike measured at 21.6 s.

## Limits

- n = 1 per arm. The arms ran one after the other against the same API.
- The seeded assistant messages carry estimated usage, as in the spike, so pi's first threshold decision rests on that estimate.
- The first turn after an idle compaction cannot read the old prefix from cache, because the summary replaced it. That first turn is therefore about 2.6 s, not 1 s. Prewarm (item 8) is what could close that gap.
- Model and provider are the spike's stand-in, not production `relay-186/glm-5.3`.

## Live routes on a fresh server

A scratch server (`CAIRN_HOME` in a temp directory, port 8791, `CAIRN_COORDINATOR_IDLE_COMPACT_MS=30000`) answered the two new routes for the seeded team before any Coordinator turn:

```text
GET  /api/teams/<team>/coordinator/context
{"budgetTokens":64000,"usedTokens":10009,"sections":[{"name":"system","tokens":3428},{"name":"tools","tokens":6581},{"name":"brief","tokens":0},{"name":"index","tokens":0},{"name":"summary","tokens":0},{"name":"recent","tokens":0}],"summary":null,"cacheReadShare":null}

POST /api/teams/<team>/coordinator/compact
200 {"skipped":"unchanged"}
```

With no session yet, `usedTokens` is the system and tool estimate and the compact route has nothing to cover. The claim, compaction, landing, 409 and retry-cap paths run through the HTTP app and the machine claim/finish services in `apps/server/test/coordinator-compaction.test.ts`. No live daemon was attached to this scratch server.
