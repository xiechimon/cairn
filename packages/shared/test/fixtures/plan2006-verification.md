## Verification

All commands run at the repo root on the executor's branch (cut from origin/main).
Expected outputs are stated per check.

**V0 — re-anchor the inventory (before editing):**

```sh
SIX="docs/spec/02-architecture-parity.md docs/spec/14-skills-execution-surface-injection.md docs/spec/19-test-layering-and-blast-radius.md docs/spec/20-attachment-reclaim-strategy.md docs/spec/28-bootstrap-closed-loop-self-authored-self-merged.md docs/spec/asset-replacement-plan.md"
grep -oh 'PACMAN_[A-Z0-9_]*' $SIX | sort | uniq -c
```

Expected at planning time: `1 PACMAN_`, `8 PACMAN_SKILLS_DIR`, `7 PACMAN_HOME`, and `1`
each of `PACMAN_API_KEY`, `PACMAN_ISSUE_INTAKE`, `PACMAN_SERVER`, `PACMAN_TEAM`,
`PACMAN_WORKSPACES_DIR` (total 21). If it differs, apply the issue's rule to what is
actually there (F5) and update the PR body tables accordingly.

**V1 — per-name code gates (before editing):**

```sh
for name in CAIRN_ CAIRN_SKILLS_DIR CAIRN_HOME CAIRN_ISSUE_INTAKE CAIRN_SERVER CAIRN_API_KEY CAIRN_TEAM CAIRN_WORKSPACES_DIR; do
  test -n "$(git grep -n "$name" -- apps packages scripts)" && echo "OK $name" || echo "FAIL $name"
done
```

Expected: eight `OK` lines, zero `FAIL`.

**V2 — the issue's acceptance loop, run once before and once after the edits; paste both
outputs in the PR body:**

```sh
for name in $(grep -oh 'PACMAN_[A-Z0-9_]*' $SIX | sort -u); do
  echo "-- $name"
  git grep -n "CAIRN_${name#PACMAN_}" -- apps packages scripts | head -3
done
```

Expected before: 8 names listed, each with at least one code hit — the evidence that all
must be renamed. Expected after: no output at all (zero `PACMAN_X` remain, so the
acceptance item "for every remaining `PACMAN_X`, `git grep CAIRN_X` is empty" holds);
paste the empty result together with a one-line statement.

**V3 — occurrence counts (after editing):**

```sh
grep -oh 'PACMAN_[A-Z0-9_]*' $SIX | wc -l    # expected: 0
grep -oh 'pacman' $SIX | wc -l               # expected: identical to the pre-edit run (lowercase stays, F3)
for f in $SIX; do printf '%s ' "$f"; (grep -c 'PACMAN_' "$f" || true); done
```

Expected: `0` for the first; the second unchanged from its pre-edit value; per-file
`grep -c` all `0` (pre-edit line counts: 1, 10, 2, 1, 2, 1).

**V4 — no file outside the six (issue acceptance item 2):**

```sh
git diff --name-only origin/main
```

Expected: exactly the six `$SIX` paths, nothing else. `git status --short` before commit
shows only the six staged (any pre-existing unrelated dirt in the worktree stays
unstaged).

**V5 — `pnpm lint` (issue acceptance item 3):** exit 0.

**V6 — `pnpm prepush`:** exit 0 (docs-only path selection; the language gate runs).

**V7 — PR body gates, before opening:**

```sh
python3 scripts/pr-evidence-gate.py /tmp/pr.md        # exit 0
python3 scripts/pr-tasks-gate.py /tmp/pr.md           # exit 0
node scripts/english-only-gate.mjs --text /tmp/pr.md  # exit 0
```

After `gh pr create` (and any later body edit via
`gh api -X PATCH repos/xiechimon/cairn/pulls/<n> --input -`): `gh pr view <n> --json body`
matches `/tmp/pr.md` byte for byte, and
`gh api repos/xiechimon/cairn/pulls/<n> -q .mergeable_state` is not `dirty`.

**V8 — semantics evidence for `## Verified` (the renamed names match code truth):**

```sh
grep -n 'input.skillsDir ?? env\[ENV_VARS.skillsDir\]' apps/daemon/src/config.ts   # 1 hit, default '~/.agents', 'skills'
grep -n 'issueIntake: envFlag' apps/server/src/config.ts                            # 1 hit (envFlag: 1/true/yes, default off)
grep -n "join(home, 'team-skills')\|join(home, 'step-attachments')" apps/daemon/src/state.ts  # 2 hits
```

Expected: the three greps return the lines above; cite them (plus
`.claude/skills/verify-cairn/SKILL.md:36` for the verify stack's `CAIRN_HOME` axis) in
the PR body's Verified section.
