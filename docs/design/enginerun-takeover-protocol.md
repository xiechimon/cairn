# EngineRun live takeover: PTY scrollback + input lease

Status: draft for owner review. Builds on `docs/design/durable-threads-engine-dispatch.md` ("Live view", "Takeover lease" rows) and the shipped slice `a8fcec9b1` (transcript-derived live EngineRun). Scope: the takeover wire and lease only. Prerequisite flagged throughout: takeover exists only when the engine run was spawned under a PTY; SDK-pipe runs keep today's behavior (`transcript-fallback`).

## What already exists (measured on origin/main)

- `EngineRun.state` includes `'taken_over'`; `EngineRunActions.takeOver/handBack` and `TakeOverDialog` are UI-ready but unwired on live runs (`apps/web/src/board/engine-run.ts:7,42`, `engine-run-view.tsx:66`, `side-chat.tsx:695`). Live `rawOutput` is synthesized from events "until the engine scrollback wire exists" (`live-engine-run.ts`).
- Channel precedent: `ComputerScreenGateway` pairs a viewer WS (`/api/computer-screen/<id>`, same-origin + sealed capability in `Sec-WebSocket-Protocol`) with a machine WS (`/api/machine/computer-screen/<id>`, Bearer machine token), then `pipe()`s them (`apps/server/src/services/computer-screen.ts:266-351,451`). Channels are in-memory; `invalidReason`+`sweep`+`machineHub.onDisconnect` revoke them.
- Server→daemon push: SSE `/api/machine/stream`, `machineStreamEventSchema` (`packages/shared/src/protocol/machine-wire.ts:319`) via `MachineWakeHub` (`services/machine-wake-hub.ts`). Unknown event types are skipped by older daemons (forward-compatible); a `computer.screen` event with an unknown `kind` would throw — so new kinds must not ride the `computer.screen` envelope.
- Daemon→server: REST `/api/machine/*` (claim, heartbeat, `tool/:stepId`, `done`, `stop`/`steer` polls, `uploadUrls`+`putUpload` used for `session.jsonl`). No new machine-client calls needed: the daemon dials the channel WS outbound itself (`apps/daemon/src/computer/screen-channel.ts:86-103`).
- Lease precedent: `computer` row carries `controlHolder/controlLeaseId/controlLeaseExpiresAt/controlFence`; `acquire` overwrites (last-wins), `hasComputerControl` checks leaseId+fence at use time (`services/computer-control.ts`). `COMPUTER_CONTROL_LEASE_MS` = 30 min; viewer renews every 10 min (`use-computer-control.ts:11`).
- PTY precedent: `pty.fork` python shim, no node-pty dep (`apps/daemon/src/computer/control-pty.ts`). Already used for `kind:'terminal'` computer channels (`screen-provider.ts:137`).
- Redaction: `credentialSafeEvents` tail-hold (withhold `maxSecretLen-1` bytes so split secrets redact whole, `apps/daemon/src/credential-output.ts:36`) + `redactSecrets` (`packages/shared/src/secret-redaction.ts`).
- Engine handle: `AgentSessionHandle {sessionId, sessionFile?, events, steer(), stop(), usage()}` (`packages/shared/src/agent-backend.ts:185`). Stop flow: `stop_pending` row + `stopSignal` SSE + daemon `GET /api/machine/stop` poll (`build-stop.ts`, `machine-loop.ts` `deliverStop`).
- Protected paths this design must mostly avoid: `routes-machine.ts`, `services/machine*.ts`, `daemon/src/machine-client.ts`, `secret-channel.ts`, `command-gate.ts`, `**/drizzle/**` (`merge-gate-paths.json`).

## Decisions

D1 — New SSE event `engine.screen`, new paired-WS gateway `EngineScreenGateway` (new file `services/engine-screen.ts`), one new `pushEngineScreen` on `MachineWakeHub`. Rides the existing channel topology (SSE push + paired WS + REST control), not the `computer.screen` envelope — an unknown `kind` there kills older daemons' streams, and the doc says the scope is different ("do not reuse a computer channel").
D2 — Lease is in-memory at server and daemon, never persisted. Server restart = release-all (channels die anyway); daemon restart = process dead anyway. No drizzle migration.
D3 — Hold is bound to the takeover channel: any channel death (viewer WS close, lease loss, machine disconnect) releases the hold and resumes engine stdin. A released holder re-opens a `view` channel. Alternative rejected: hold surviving disconnect — needs a release push event and leaves the agent paused with nobody watching; "fail toward the agent" is safer.
D4 — Last-acquire-wins steal, same as computer control (fence bump revokes the previous holder's channel within one 250 ms sweep). Alternative rejected: 409-on-held — single-owner product, and steal is already the computer semantics.
D5 — Scrollback is a daemon-side redacted ring (1 MiB), replayed chunk-wise into the channel; resync via `fromSeq` in the open request. No server-side chunk storage. On step finish the daemon uploads the redacted tail (≤1 MiB) beside `session.jsonl` via existing `uploadUrls`/`putUpload`. Raw view keeps today's synthesized fallback when no live/persisted scrollback exists.
D6 — PTY mode is a new spawn mode for interactive engines (Claude Code CLI as TUI first), spawned through the `pty.fork` shim. Structured events, usage and stop keep coming from the session JSONL tail (`sdkTranscriptPath` already exists) and signal control — never scraped from PTY bytes. `steer()`/`answer` in PTY mode = write text+CR to PTY stdin. If an engine can't supply structured data off-PTY, that run is view/transcript-fallback and offers no takeover (per dispatch doc: "do not invent a terminal around pipe bytes").
D7 — Server pipes bytes opaquely in both directions; ALL control is out-of-band (REST, SSE fields, channel lifecycle). Daemon enforces input-gating itself (mirrors `ReadOnlyViewGate` precedent: server never gates view input).

## State machine

Per (stepId, i.e. one engine run):

```
view:     closed → streaming ────────────────────────────────→ closed
takeover:         none → requested → held → released
                            │         │
                            └→ rejected (daemon never pairs,   └→ lost (lease TTL, steal,
                               pause fails, step ends,          machine disconnect,
                               15 s pair timeout)               server restart, holder WS close)
```

- `none → requested`: `POST /api/teams/:t/engine-runs/:stepId/takeover` → server verifies owner session (`pairedDeviceIdOf` null + `ownerIdentity` set, same as `requireOwnerSession`), step→build→todo belongs to `ctx.team` (+ thread owner where the thread-owner field applies), step `claimed`, `machineHub.isConnected`, daemon advertised `capabilities.enginePty`. Inserts `{leaseId, fence++, expiresAt, userId}` in the in-memory map (in a transaction-consistent check: replacing any existing lease = steal).
- `requested → held`: daemon receives `engine.screen{kind:'takeover', takeoverLeaseId, takeoverFence}`, pauses engine-stdin writers (see Input), opens machine WS; pairing = held. Grant requires the pause to have succeeded before any owner byte is written (doc rule).
- `requested → rejected`: no machine WS within `PAIR_TIMEOUT_MS` (15 s) → REST caller gets channel expiry / sweep revoke; UI shows "engine can't be taken over" and offers view. Also rejected immediately at acquire: step not claimed, no PTY capability, machine offline.
- `held → released`: `DELETE .../takeover {leaseId}` → server bumps fence, revokes the takeover channel → daemon sees channel close, resumes engine stdin.
- `held → lost`: `sweep` expiry (30 min TTL, renewed by `PATCH`), newer acquire (steal), `machineHub.onDisconnect`, server `close()`/restart, holder viewer-WS close (D3).
- Concurrent requests serialize on the server's in-memory lease map (single-writer check-then-set inside the request handler; sqlite-free so no race beyond JS atomicity). Daemon-side, only the channel whose `takeoverLeaseId`+`fence` match the current lease may deliver input bytes.

## Wire messages

REST (owner → server), mirroring `routes-computer-screen.ts`:
- `POST /api/teams/:teamId/engine-runs/:stepId/takeover` → `201 {leaseId, fence, expiresAt}` | `404 step` | `409 not claimable/no machine` .
- `PATCH .../takeover {leaseId}` → `{leaseId, fence, expiresAt}` | `409 lease lost`.
- `DELETE .../takeover {leaseId}` → `{released:true}` (idempotent).
- `POST /api/teams/:teamId/engine-runs/:stepId/screen {kind:'view'|'takeover', leaseId?, fromSeq?}` → `201 {path:'/api/engine-screen/<id>', wsProtocols:['binary','cairn-escreen.<sealed>'], kind, expiresAt, generation}` — sealed via `secretBox.seal({purpose:'cairn-engine-screen-v1', channel})`, same pattern as `CAP_PURPOSE`.

SSE (server → daemon), new option on `machineStreamEventSchema`:
- `{type:'engine.screen', channel: engineScreenRequestSchema}` where
  `engineScreenRequestSchema = {id: hex64, stepId: recordId, buildId: recordId, generation: int, kind: 'view'|'takeover', takeoverLeaseId: string|null, takeoverFence: int, fromSeq: int≥0, expiresAt: epochMs}` `.strict()` + refine `kind==='takeover' ⇒ takeoverLeaseId!==null`.

WebSocket upgrade (new paths handled inside the gateway; `routes-machine.ts` untouched):
- viewer: `GET /api/engine-screen/<id>` — same-origin + exactly one `cairn-escreen.<token>` subprotocol matching the sealed channel; single use.
- daemon: `GET /api/machine/engine-screen/<id>` — `Authorization: Bearer <machine token>` → `findMachineByToken`, machineId+teamId must match the channel; single use.
- After both connect: opaque bidirectional byte pipe (same `createWebSocketStream`+`pipe`). Frames ≤ `ENGINE_SCREEN_MAX_FRAME_BYTES` (256 KiB); buffered cap 8 MiB aborts, as today.

In-pipe bytes:
- daemon→viewer: raw redacted PTY bytes: first the replay from `fromSeq`, then live tail. No framing; a terminal emulator consumes it.
- viewer→daemon: raw input bytes; daemon forwards to PTY stdin only while the channel's lease matches the live hold (else silently dropped — channel degrades to view).
- daemon→server→viewer "engine exited": channel close; exit state arrives via the existing step `done`/SSE path, not in-pipe.

## Scrollback model

- Daemon ring: 1 MiB of redacted PTY bytes per step, stored as chunks `{endSeq, bytes}` (endSeq = cumulative byte offset). Chunks are the daemon's write units (≤64 KiB) so resume cuts on chunk boundaries.
- Replay vs live tail: on channel open, daemon sends chunks with `endSeq > fromSeq` then streams live. `fromSeq` is the viewer's received-byte count (0 on first open). If `fromSeq` < oldest retained offset, daemon prepends `ESC[2J ESC[H` then the whole ring, so a reconnected terminal rebuilds exact state.
- Reconnect resync: viewer supplies `fromSeq` in `POST .../screen`; server copies it into the channel request. No server storage.
- Redaction before both the ring and the wire: one stateful redactor per PTY — tail-hold of `maxSecretLen-1` bytes (pattern from `credentialSafeEvents`) over `redactSecrets` + the step's `StepCredentials` values. Unscannable tail at process end is flushed redacted; a chunk that can't be scanned is dropped and the channel falls back to transcript view (doc rule). Residual: owner-typed secrets echo into scrollback unredactable (not in `StepCredentials`); accepted — scrollback is owner-gated only.
- Persistence: none during the run. At step finish, the daemon uploads the redacted tail as `engine-pty.log` (≤1 MiB) through `uploadUrls`+`putUpload`, the `session.jsonl` path. Raw view reads it via the transcript attachment when live scrollback is absent.

## Input path

- Engine stdin has exactly two writers: cairn (steer text, permission answers — in PTY mode both are PTY writes) and the owner channel. A daemon-side mux allows exactly one active writer: `agent` by default, `owner` while the takeover hold is live.
- Hold acquire (daemon): on `engine.screen{kind:'takeover'}`, verify `takeoverLeaseId/fence` against the lease carried in the channel request, suspend cairn-origin stdin writes (in-flight `steer()` calls queue — steer is already queue semantics; `pendingSteers` stay pending), mark hold live, then connect the machine WS. Pause failure → no connect → server-side `rejected`.
- Hold release (daemon): channel close → flush nothing, resume queued cairn writes, mark hold cleared. Daemon treats machine-WS death as release even without server notice.
- Echo: none at app level — the engine's own TTY echo renders owner keystrokes in the output stream. Owner bytes are not written to the scrollback ring a second time (PTY echo already lands there).
- While held: the agent process keeps running; only its stdin supply pauses. `command-gate` and tool handling are untouched — the lease gates owner keystrokes, never agent-originated commands (doc rule).
- `askUser`/`answer` path stays independent: pending engine questions answered via UI while held still queue as cairn writes and flush on release — or are typed by the owner directly.

## Failure behavior

- Daemon disconnect mid-hold: `machineHub.onDisconnect` → `invalidReason 'machine disconnected'` → channel revoked → viewer sees close → UI returns to transcript view with a notice. Daemon-side hold may linger only until the daemon's channel WS dies (it does, with the stream) → resume agent stdin. If the daemon itself died, the engine child is dead anyway; the step settles through the existing heartbeat/`done` path.
- Server restart: channels and leases are in-memory → all revoked on `close()` (mirrors `computerScreens.close`), daemon WS drops → local release → agent resumes. Post-restart acquire starts fresh; no stale-lease recovery needed.
- Owner disconnect while holding: viewer WS close → revoke → machine WS close → daemon releases (D3). Engine resumes agent stdin.
- Lease TTL expiry mid-hold: `sweep` → `'takeover lease lost'` → same release path. Web renews on a 10 min tick while the tab holds takeover.
- Engine exit while held: daemon finishes scrollback flush, closes channels; step `done` proceeds normally. Viewers reopen `view` on a finished run and get the persisted tail or the synthesized fallback.
- Daemon offline at acquire: `isConnected` check → 409. Step ends before acquire: status check → 409. Step ends mid-pair: machine WS closes; sweep releases.

## Persistence delta

None. No drizzle change. In-memory only: server `Map<stepId, {leaseId, fence, expiresAt, userId}>` + channel map (the `computer`-row lease pattern, minus the table — restart semantics differ: a dead server should not leave a recorded lease a live daemon might honor). Scrollback tail reuse: `uploadUrls`/`putUpload`/`transcriptRow` paths, unchanged. `EngineRun.state 'taken_over'` derivation: a new team-SSE event `{type:'engine.lease', stepId, held}` (small additive change to `protocol/sse.ts` + publish on acquire/release/loss) feeds `liveEngineRun`; absent the event, state derives from steps as today.

## Protected-path blast radius

Touches `services/machine-wake-hub.ts` (one `pushEngineScreen`, ~10 lines) — `machineAndCommandBoundary` humanQueue, owner-routed per repo rules; plus `/security-review` before push (owner keystrokes + secret-adjacent output cross the machine boundary). Avoids: `routes-machine.ts` (upgrade handled in gateway), `machine-client.ts`, `secret-channel.ts`, `command-gate.ts`, `drizzle/**`, `package.json` (no new deps — python `pty.fork` shim reused). Everything else lands in new/autoMerge files: `packages/shared/src/protocol/engine-screen.ts`, `machine-wire.ts` (additive), `services/engine-screen.ts`, `routes-engine-screen.ts`, `index.ts` attach, `apps/daemon/src/engine/*` (channel, ring, redactor, stdin mux, pty adapter), `machine-loop.ts` dispatch line, `apps/web/src/{api,board}/engine-*`.

## Tests (one per transition)

1. acquire on claimed PTY step → 201 lease; second acquire (steal) → new fence, first holder's channel revoked.
2. acquire on pending/finished step or offline machine → 409, no lease written.
3. foreign step/thread → 404, seals nothing (mirror `computer-screen.test.ts`).
4. takeover channel paired only after daemon pause: fake daemon that never connects → 15 s `rejected`, no owner bytes written.
5. input gating: bytes on a `view` channel and bytes on a `takeover` channel whose leaseId is stale are dropped; bytes on the live channel reach PTY stdin.
6. release: DELETE → channel revoked → daemon resumes cairn stdin; queued steer flushes in order.
7. holder disconnect → daemon release observed without a DELETE.
8. machine disconnect mid-hold → channel revoked, lease lost; daemon reconnect re-acquire works.
9. scrollback resync: ring of 3 chunks, `fromSeq` at chunk 2 boundary → only chunk 3 replayed; `fromSeq` below oldest → clear sequence + full ring.
10. redaction: a `StepCredentials` secret split across two PTY chunks never leaves the daemon unredacted (tail-hold), and lands redacted in the ring.
11. `engine.screen` SSE skipped cleanly by an old-schema daemon (unknown event type → ignored, stream stays up).
12. lease TTL expiry mid-hold → same release path as DELETE.

## For the owner

1. Takeover keystrokes may spend the owner's engine subscription — already decided (dispatch doc, decision 3); re-flag only.
2. Recommended: hold bound to the live takeover channel (D3). Alternative: lease survives disconnects with a `engine.release` push — more wire for a case steal+reacquire already covers.
3. Recommended: last-acquire-wins steal (D4), matching computer control. Alternative: refuse while held.
4. Recommended: engine takeover ships on Claude-Code-CLI-PTY runs first; pi/`acp` runs stay transcript-fallback until their engines get PTY adapters.
