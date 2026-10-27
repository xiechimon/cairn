# #926 verification evidence: daemon retry and convergence timing made explicit

Two ticket spots change from "assumed" to "declared + observable":

1. **Retry face**: pi's `retry.*` is set explicitly in the daemon (no longer eating the upstream default), and the runner's no-progress guardrail constant `RETRY_STORM_MAX` is derived from the same source as `retry.maxRetries`.
2. **Convergence judgment**: `done` is triggered by pi's `agent_settled` (the authoritative "will not continue automatically" signal), replacing the old `agent_end(!willRetry)` guess.

## Mechanism-effect acceptance: artifact criteria

Per the in-repo `verify-pacman` "mechanism-effect acceptance: artifact criteria" hard rule, every claimed mechanism is evidenced from **runtime ground truth**, not by reading source. The probe `drive-926-convergence.mts` starts a real pi runtime against a stub LLM; the artifact = `convergence-evidence.json`.

### Phase A — the retry face is actually consumed by pi (not a decoration, not a default coincidence)

The settings object produced by `buildPiSessionSettings()` is fed into the **real pi `SettingsManager.inMemory`**, then read back via `getRetrySettings()`:

```
piGetRetrySettings         = { enabled: true, maxRetries: 3, baseDelayMs: 2000, maxAgentDelayMs: 60000 }
piGetProviderRetrySettings = { maxRetries: 0, maxRetryDelayMs: 60000 }
RETRY_STORM_MAX            = 3
```

The read-back values == the daemon's explicit declared values. **But these explicit values happen to be byte-identical to pi 1.0.4's built-in defaults** — the read-back alone cannot distinguish "read our settings" from "fell back to defaults". So the probe does one more comparison (`drivenProbe`): feed the same `inMemory` a retry setting with `maxRetries = 5` (≠ the default 3), and the read-back immediately becomes 5, proving `getRetrySettings` reads the passed-in settings (**settings-driven read-back**). Combined with the unit test's reference identity (`buildPiSessionSettings().retry === PI_RETRY_SETTINGS`) and `pi.ts` feeding those settings into `SettingsManager.inMemory`, this yields: in a real session the `maxRetries=3` pi reads comes from our explicit settings, and **changing the setting value changes the value pi's retry logic reads** (not a decoration).

`RETRY_STORM_MAX === getRetrySettings().maxRetries` — the guardrail constant and the retry budget pi actually reads are same-source, structurally not decoupled (single source = `apps/daemon/src/backend/pi-retry.ts`).

### Phase B — the raw event sequence of a real pi session + the done timing

A real `AgentSession` (daemon `materializeProvider` + `buildPiSessionSettings` + `ModelRuntime` + `createAgentSession`) against a stub LLM, subscribing to the **raw pi events** and passing them through the daemon's `mapPiSessionEvent`:

```
raw pi events : … → turn_end → agent_end(14) → agent_settled(15)
mapped events : … → message_end → done
```

- Real pi emits `agent_end` first (idx 14), **then** `agent_settled` (idx 15) — settled is the convergence authority signal.
- The mapping produces **exactly one** `done`, and its corresponding raw event index == `agent_settled`'s index (15).
- `agent_end` (idx 14) does **not** trigger done — the old path would have fired done here early (and disposed the session while queued work / overflow recovery still had to continue, strangling the subsequent runs).

This is the convergence contrast the ticket asks for: real pi's `agent_settled` drives done, and `agent_end(!willRetry)` no longer drives it.

### Phase C — the mapping function determinism contrast

`mapPiSessionEvent` fed the two events directly:

```
agent_end(willRetry=false) → []                      (no done)
agent_settled              → [{ type: 'done', … }]   (done)
```

## Unit/integration faces (standing in CI)

- `apps/daemon/test/map-pi-event.test.ts`: `agent_settled → done`, `agent_end` never fires done, the "model will continue" path does not fire done early, usage accumulation is more complete with settled.
- `apps/daemon/test/pi-retry-config.test.ts`: the retry face is explicitly wired (reference identity), explicit values aligned with docs, `RETRY_STORM_MAX` same-source as the session settings.
- `apps/daemon/test/runner-error-lifecycle.test.ts`: the guardrail budget is injectable and changes the close-out behavior (`retryStormMax=1 → closes on the 2nd attempt`).
- `integration/` (22 files / 62 tests): real daemon + real PiBackend + stub LLM end to end, the step converges to completion (`finished`) — agent_settled → done holds at the full-chain runtime.

## Rerun

```sh
cd apps/daemon
corepack pnpm exec tsx \
  "$(git rev-parse --show-toplevel)/.claude/skills/verify-pacman/scripts/drive-926-convergence.mts"
```

The probe starts the stub LLM itself and self-recycles (the scratch directory is deleted after use); exit code 0 = all assertions pass, and the artifact refreshes `docs/verify/926/convergence-evidence.json`. The loopback stub stays on this machine — if a proxy is set before the run, use `env -u http_proxy -u https_proxy -u all_proxy NO_PROXY='*'`.
