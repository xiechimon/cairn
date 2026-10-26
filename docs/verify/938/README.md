# #938 verification evidence index — the cleanup script under squash merges

Object: `scripts/cleanup-merged-branches.sh` (criterion = the GitHub merged-PR list, no ancestor guessing).
Acceptance method: real runs against this repo's real branch residue (under squash merges no criterion can be constructed from ancestor relations, so both directions use real branches: truly-merged residue → should be cleaned; truly-unmerged branches → must not be touched). The failure-mode enumeration canon = the script's header comment (9 items); this directory's transcripts correspond to it.

## Script version notes

The acceptance spans three script states; transcripts are distinguished by version prefix:

| version | content | transcripts |
|---|---|---|
| v1 | first version (without guard 9) | `t2/t3/t4-*-t0194.txt`, `full-dry-run-prefix-v1.txt` |
| v2 | + guard 9 (tip == merged headRefOid) | `t1-*`, `t5-*`, `t7-*`, `t9-*`, `r1/r2/r3-*`, `full-dry-run.txt` |
| v3 (the version delivered with the PR) | review tidy-ups: `keep()`/`lookup()` convergence, change-making git calls get `</dev/null`, per-op log truncation, `OPEN_LIMIT` overridable | `v3-*.txt` |

v1→v2 only adds the guard (the KEEP direction tightens, the already-proven cleanup path is unchanged); v2→v3 is a pure pipeline refactor (zero change to the decision logic, corroborated by the v3 whole-repo dry-run agreeing with v2's decisions). The ticket-named fixture (t-0194) ran on v1; its tip was audited == the merged head (see below), guard 9 is a no-op for it, and the judgment matches the final version.

## Acceptance matrix (ticket two-way + idempotency + guard red/green)

| face | primary evidence (final v3) | supplementary/historical | result |
|---|---|---|---|
| should clean: the positive four-link chain = three dry faces planned → dirtied KEEP → clean run CLEANED (worktree + local + remote) → four-way disappearance verification → idempotent rerun | `v3-positive-fourface-impl105.txt` (impl/105-react-router-8, PR #118) | `t3-clean-{dry,yes}-t0194.txt` + `t4-idempotent-t0194.txt` (the ticket-named fixture, v1; the yes run appends the session-captured three-face disappearance verification) | all PASS, exit 0 |
| must not touch: unmerged branch + worktree, dry and `--yes` double run | `t1-unmerged-keep-{dry,yes}.txt` (v2; the yes run appends the fixture's three-faces-intact verification) | — | KEEP "not in the GitHub merged-PR list", zero changes |
| must not touch: an active lane (a real organic case, not constructed) | `v3-keep-active-lane-open-pr.txt` | — | KEEP "open PR #1014 still uses this branch name" (guard 2 proven) |
| dirty-worktree guard + `--force-dirty` | `v3-positive-fourface-impl105.txt` §2 | `t5-dirty-keep-force-dirty-impl104.txt` (v2 full chain: KEEP → force CLEANED → idempotent) | KEEP without the flag, discard only with the flag |
| guard 9 red/green: continued runs on the same branch after merging | 7 organic KEEPs in `v3-full-dry-run.txt` (below) | `t9-oid-guard-impl106.txt` (v2 constructed red/green: an empty commit past the merge head → KEEP; tip restored → CLEANED) | tip != merged head must KEEP |
| failure mode 1: no gh / gh network dead / git network dead | `v3-r1-no-gh-abort.txt`, `v3-r2-gh-network-abort.txt`, `v3-r3-git-network-abort.txt` | `r1/r2/r3-*` (v2) | all three abort with exit 2, never degrade to guessing; the acceptance evening's proxy flapped for real many times, so the abort path was hammered organically |
| failure mode 7: the remote delete's network breaks mid-run (organic) | — | `t7-remote-delete-network-fail-impl104.txt` (v1): worktree + local already deleted, push broken → single-line FAIL, exit 1; the remaining face was completed by t5's final run | a single-point failure does not spread, reported faithfully |
| whole-repo dry-run (read-only) | `v3-full-dry-run.txt`: 218 WOULD-CLEAN / 67 KEEP | `full-dry-run.txt` (v2: 219/68), `full-dry-run-prefix-v1.txt` (v1: 229/61) | exit 0 |

The deltas across the three whole-repo dry runs reconcile line by line: v1's 229 = v2's 219 + 3 (ci/e2e-merge-gate-762, impl/104, impl/106 were really cleaned by the acceptance runs in between) + 7 (flipped to KEEP when guard 9 landed); KEEP 61 + 7 = 68. v3's 218 = 219 − 1 (impl/105 was cleaned by the v3 positive run); 67 = 68 − 1 (the negative-case fixture branch was withdrawn).

## OID audit of the deleted tips

`oid-audit-deleted-tips.txt`: every branch really deleted during the acceptance (t-0194, ci/e2e-merge-gate-762, impl/104, impl/106, impl/105) — the deleted tip and the corresponding merged PR's head.sha are **5/5 exactly equal on all 40 hex digits** — everything cleaned was residue of landed work, zero unmerged-commit loss. The audit channel = GitHub REST (`pulls/<n>` → `.head.sha`) fetched over a direct connection from this host, bypassing the local proxy.

## Guard 9's organic evidence (v3 whole-repo dry-run)

The 7 KEEPs carrying "has commits past the merged head" in `v3-full-dry-run.txt`:
`pacman/conv-01a10c27-…`, `ui-reuse`, `web/442-chief-hotkey-cmdj`,
`web/443-444-chief-fab`, `web/445-board-topbar`, `web/448-mention-center`,
`xmon-18-status-row` — all real branches that grew commits locally after merging; without guard 9 they would have entered the cleanup plan.

## Cleanup side-effects during acceptance (recorded faithfully)

The acceptance really ran on real residue and reclaimed 5 merged branches in total: `hp/pacman/t-0194-932-320px-933` (three faces), `ci/e2e-merge-gate-762` (three faces; the early harness's branch-picker filter did not exclude branches that already carried a worktree and picked it — that worktree was clean, had no herdr workspace anchor, and PR #764 was merged, verified as a harmless legitimate reclamation), `impl/104-ts-upgrade` (three faces), `impl/106-tailwind-4` (local + remote), `impl/105-react-router-8` (three faces). The negative-case fixture (`hp/pacman/t-0222-938-negfixture`, a self-made branch with no PR) was manually withdrawn after the acceptance. The final-version harness names branches explicitly and no longer picks by pattern.

## Reproduction

```sh
# whole-repo plan (read-only)
bash scripts/cleanup-merged-branches.sh
# single-branch dry → execute → idempotent
bash scripts/cleanup-merged-branches.sh <merged-branch>
bash scripts/cleanup-merged-branches.sh --yes <merged-branch>
bash scripts/cleanup-merged-branches.sh --yes <merged-branch>   # nothing to clean
```

The harnesses (`scripts/acceptance-battery-v2.sh` / `-v3.sh`) are **this machine's history**: the entry `cd` is an absolute path to a local worktree, and the fixtures consume real merged residue (one run cleans them), so a rerun needs similar residue branches on record.
