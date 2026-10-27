# #1195 artifact-gate branch drift — verification evidence

Mechanism-class change (gate judgment + wire fields + git primitives); the artifact criterion = two-way test output legs: the same set of tests red on `origin/main` (old code) and green on this branch.

## Evidence files

| file | content |
| --- | --- |
| `server-gate-before-red.txt` | old code (`git worktree add --detach /tmp/pacman-1195-before origin/main`) running `artifact-gate.test.ts -t '偏离点名'`: a done payload carrying `workBranchDrift` is still stripped by zod and the gate still answers `构建零改动` — `AssertionError: expected '构建零改动' not to be '构建零改动'` |
| `daemon-drift-before-red.txt` | old code running `runner-branch-drift.test.ts`: 6 failed — the drift field `expected undefined to deeply equal {expected, actual}`, and the union face / probed head set all absent |
| `daemon-scan-before-red.txt` | old code running `workspace.test.ts -t 'branchesWithNewCommits'`: 6 failed — `TypeError: gitPrim.branchesWithNewCommits is not a function` (the real git scan primitive does not exist) |
| `server-gate-after-green.txt` | same command on this branch: 13/13 green (incl. the three new drift-naming tests) |
| `daemon-drift-after-green.txt` | this branch `runner-branch-drift.test.ts`: 12/12 green |
| `daemon-scan-after-green.txt` | this branch `workspace.test.ts`: 24/24 green (incl. the 6 real git scan primitive tests) |
| `shared-note-after-green.txt` | this branch shared `work-branch-note.test.ts` + `plan-first-round-prompt.test.ts` + `vocabulary.test.ts`: 61/61 green (note vocabulary + filter-chain regression) |
| `e2e-affected-green.txt` | the web e2e face from `e2e:affected`'s judgment (`token-gate.spec.ts`) + the filter chain's e2e pin (`transcript-user-words.spec.ts`, the shared vocabulary consumption face): E2E_PORT=8432, 12/12 green |

## Rerun commands

```sh
# before leg (old code)
git worktree add --detach /tmp/pacman-1195-before origin/main
cd /tmp/pacman-1195-before && corepack pnpm install
cp <this branch>/apps/server/test/artifact-gate.test.ts apps/server/test/
cp <this branch>/apps/daemon/test/{runner-branch-drift.test.ts,workspace.test.ts} apps/daemon/test/
cd apps/server && pnpm exec vitest run test/artifact-gate.test.ts -t '偏离点名'
cd ../daemon && pnpm exec vitest run test/runner-branch-drift.test.ts
pnpm exec vitest run test/workspace.test.ts -t 'branchesWithNewCommits'

# after leg (this branch)
pnpm exec vitest run test/artifact-gate.test.ts        # apps/server
pnpm exec vitest run test/runner-branch-drift.test.ts  # apps/daemon
pnpm exec vitest run test/workspace.test.ts            # apps/daemon
pnpm exec vitest run test/work-branch-note.test.ts     # packages/shared
```

## Incident-shape match (mea 2026-10-11)

Ticket incident: an agent delivers on its self-created branch `dogfood/tracer-1153-*` (commit + push + PR all green), the server counts by session branch `countAhead=0` → `build.errorMessage=构建零改动` → the chief burns a remedy round for nothing. After this change, the same-shape close-out behavior is pinned by `runner-branch-drift.test.ts` failure mode 2 (switch-back shape: scan claim + PR backfilled with the real head) and failure mode 3 (no commits anywhere: the failure reason names the branch drift); the real git semantics (window filtering, the attribution split for excluding neighboring conv branches) are pinned by the `#1195` describe in `workspace.test.ts`.
