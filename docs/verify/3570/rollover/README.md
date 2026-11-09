# Rollover confirmation verification

Coordinator-authorized final repair for PR #3643, thread PRRT_kwDOUSKs6c61PjWy. Bug class: queue lifecycle / subscription handoff. The source subscriber must receive the correlated delivery even when nobody has subscribed to the replacement build. The explicit destination keeps the delivered row out of source history.

## Red-first and sweep

Before the repair, all four server rollover cases (closed-PR completion, stop draft, manual delivery and locally merged continuation) received zero source message frames. The web stream test cached the destination row in source history instead. The browser regression switched to the replacement stream with GET held for 3000 ms and found zero delivered bubbles within 700 ms. The repaired suite passes these cases, duplicate source/target frames, equal-content sibling identity, unchanged source text/thinking buffers, and same-build/non-queue isolation.

The previous producer-only spy and synthetic target-subscriber test missed the real handoff. The new safeguard observes a real source hub subscription and the browser's actual build switch without a reload. Diff-wide inspection covered build and chief producers, transcript/hub forwarding, mutation callbacks and the SSE cache reader; all correlated build rollover paths share the repaired publisher. Chief delivery and non-queue events do not use this forwarding path.

## Live result

`result.json` records an isolated real server, browser, REST, SSE and SQLite run. A seeded synthetic worker completes a queued continuation after a local merge. No daemon or model executes. The source-stream confirmation arrives before the target subscription; after switching builds, one delivered bubble appears in 128 ms, with zero stale capsules and zero held GET responses released. Authoritative API and database each contain one delivered user row. Desktop light/dark and true 390 px phone captures were inspected; no phone horizontal overflow. Screenshots remain in the scratch evidence directory rather than requiring another asset-branch push.

Reproduction from the repository root, with ports 18868 and 18869 free:

```sh
mkdir -p "$HOME/.cache/codex-scratch/pi-168"
cp docs/verify/3570/rollover/probe.mjs "$HOME/.cache/codex-scratch/pi-168/rollover-probe.mjs"
node docs/verify/3570/rollover/verify-runner.mjs
```

The runner starts the isolated verify stack through its ownership-aware launcher and cleans it up. Runtime state and screenshots land under `$HOME/.cache/codex-scratch/pi-168/rollover-{stack,evidence}`. Enrollment credentials remain in process memory and are not in the archived result.

## Checks and limits

- 204 focused server/web/shared tests pass, including the intentional optional destination-field schema snapshot update. The same eight files pass with `--changed=HEAD`.
- 21 affected browser tests pass across `detail-composer-queue-stop.spec.ts` and `chief-send-retry.spec.ts`.
- `pnpm lint`, `pnpm typecheck`, `pnpm spec:parse` and `pnpm prepush` pass.
- The unrestricted `pnpm exec vitest run --changed` selected the broad shared-schema dependency graph and exceeded the 240-second command limit; it is not reported as a full pass. The explicit affected tests above passed. Full suites remain CI's responsibility.
- Closed-PR state is a stateful server-test fake; live evidence uses local-merge rollover. Real provider execution, production latency percentiles and arbitrary cross-stream network reordering are not verified.
