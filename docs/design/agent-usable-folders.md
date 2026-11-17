# Agent-writable folders per machine

Status: proposal for the owner's review. Nothing here is built. Baseline `e541ed535` on `origin/main`. Companion to `docs/design/machine-capability-defaults-and-folders.md`, which proposes additive `folderGrants`; this page is the write-boundary variant the owner asked for: a per-machine declaration of the directories the agent may write — scope `~/work` — with everything else refused, and unset meaning today's behavior.

## Problem

A step cwd is the prepared worktree or `join(workspacesDir, convId)` (`apps/daemon/src/runner.ts`, `apps/daemon/src/config.ts`), but nothing bounds writes outside it. `apps/daemon/src/backend/command-gate.ts` is wired only into the pi backend, matches bash text plus permission-rule slots, does not see file-tool paths, and is never called by Claude Code or ACP. `launchConfined` (`apps/daemon/src/backend/confine.ts`) builds the only real filesystem boundary — `--ro-bind / /` plus `--bind` per writable path — but today it runs only the availability preflight, not a step. So an owner cannot say "this machine's agent writes only under `~/work`".

## Decision

1. **Where the declaration lives.** New nullable `machine.writableRoots` column (json array of canonical absolute paths), not a per-project field: the boundary is a property of the machine's filesystem, while `project.localPath` stays a per-step source. `null` = unset = current behavior. Store canonical paths only; `~` is display-only. The daemon cannot canonicalize paths the owner types on another machine, so the value adopts the prior design's pin handshake: `PATCH` stores a path `pending`; the daemon re-stats it and reports `confirmed`/`rejected`/`absent` on the next presence response (the `machineOkResponseSchema` channel the folder-grant design already reserves); only `confirmed` roots enforce. An old daemon that ignores the list leaves pins `pending`, so they cannot take effect — fail closed.
2. **Who sets it.** Owner session only, through the existing `PATCH /api/machines/:id` (`apps/server/src/routes-resources.ts:265`), which already enforces `ownerIdentity`/`isOwnerSession` for grant fields. No Coordinator tool and no agent-writable field: a declaration the agent could edit is not a boundary (class three in `docs/design/ai-native-actions.md`). The agent can ask for a new root; only the owner confirms it.
3. **Effective writable set.** When `writableRoots` is set and confirmed, a step on that machine may write the declared roots ∪ the implicit step roots — `workspace`, `gitDirectories`, `taskTemp`, `state`, `caches`, the existing `ConfinementPolicy` fields (`confine.ts:8-16`). Everything else is refused. `~/work` as a declaration means home stays read-only except that root.
4. **How enforcement reaches commands and file tools.**
   - **Confinement is the boundary.** `ConfinementPolicy` gains `writableRoots: string[]`; `confinementArgs` canonicalizes each with `canonical(path, true)` — absolute, no symlink component, exists — and adds it to the `--bind` writable list, subject to the existing denied-overlap checks (`confine.ts:80-99`). Wiring step launch through `launchConfined` is required: while a machine reports confinement `not ready`/`not-applicable` (macOS today), confirming a root is a 409 and nothing is enabled — a declaration that cannot be enforced must not pretend to be one.
   - **The command gate is a tripwire, not the boundary.** `decideBashCommand`/`decideToolCall` (`command-gate.ts:955,985`) gain a path-egress check: write-target operands (redirections, `tee`, `cp`/`mv`/`ln` targets, `rm`, `git -C`) and file-tool `path` params are canonicalized and refused unless under the stamped set, answered with the existing `formatGateRefusal`/`formatToolRefusal` frames. This gives the model a clean refusal; it cannot stop a script that writes a path it never names, which is why confinement must wrap the step.
   - **Claim-time stamp.** The server resolves the confirmed roots and stamps them on the claimed step (`claimedStepSchema` in `packages/shared/src/protocol/machine-wire.ts`, same pattern as `mcpServers`), so the daemon enforces the snapshot the owner saw and a mid-step declaration change cannot drift. Runtimes that never call the gate (Claude Code, ACP) are covered only by confinement — that is sufficient because the boundary is the mount table.
5. **Failure when a task writes outside scope.** Inside confinement the write hits a read-only mount → `EACCES` surfaces as a normal tool error and the step continues (the agent replans, it is not killed). At the gate → refusal frame to the model, nothing ran. If a declared root disappears between confirm and launch, `canonical(path, true)` throws at launch → the step fails closed with a launch error, never silently unconfined. A symlink that escapes a root is rejected by `canonical`'s symlink check at both layers.
6. **Migration/default.** `null` default; no data migration; every existing machine is `null` = today's unconfined behavior. Setting roots affects only newly claimed steps (claim-time stamp); clearing (`→ null`) restores current behavior for future claims; in-flight steps keep their stamped set.

## States and transitions

| State | Values | Transitions |
|---|---|---|
| Declaration | `null`, set | Owner `PATCH` only. `null` → set starts enforcement for new claims; set → `null` restores current behavior. |
| Root pin | `pending`, `confirmed`, `rejected`, `absent` | `PATCH` creates `pending`; daemon report moves to `confirmed`/`rejected`; a vanished confirmed root → `absent` and stops enforcing until re-confirmed by the owner. |
| Step enforcement | unstamped, stamped | Each claim stamps the confirmed set; a step never reads `machine.writableRoots` live. |

## Paths, failures, and the first test

| Path | Reads or writes | On failure | First test |
|---|---|---|---|
| `PATCH /api/machines/:id` `writableRoots` | writes pins | non-owner 403; agent credential 403; enable while confinement not ready → 409, row stays disabled | owner pins `~/work`; paired-device PATCH is 403 and writes nothing |
| Daemon root report on presence | writes confirmed/rejected/absent per pin | non-canonical, unstatable, or symlink-escaping path is not confirmed | `..` and a symlink escape are not confirmed; a removed `~/work` reports `absent` |
| Step claim | reads confirmed roots, stamps `claimedStep` | no confirmed roots while set → step routes as if unset [inferred: or refuse the claim — an open decision below] | claimed step carries the resolved roots, not the raw pins |
| `launchConfined` step launch | reads stamped roots into `ConfinementPolicy` | `canonical` throw → step fails closed | a step with `~/work` can write there and cannot write `~/other` |
| `decideBashCommand`/`decideToolCall` | reads stamped roots + cwd | unresolvable or out-of-scope path → refusal frame, nothing ran | `tee ~/other/f` refused; `tee ~/work/f` passes; `write_file` outside the set refused |
| Runtimes without the gate | no read | covered by confinement only | [inferred] claude-code step confined writes `~/work`, fails on `~/other` |
| Clear declaration | writes `null` | none | new claims run unconfined as today |

## Open decisions for the owner

1. When `writableRoots` is set but no pin is confirmed (all `pending`/`absent`), whether new claims route as unset or are refused — refusing is the stricter reading of "everything else refused" and is this page's recommendation.
2. Whether `workspacesDir` is always implicitly writable (recommended: yes — the step cwd must work, matching the folder-grant design's always-enabled root).

## Out of scope

macOS Seatbelt, read-only grants, per-project declarations, and any agent-facing tool to request roots.
