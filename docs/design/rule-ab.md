# A/B check for a UI rule

Method from Vercel's DESIGN.md write-up (2026-08-31): a rule stays only if agents given it produce visibly better pages than agents without it, on fixed scenes. Mechanical problems are decided by the `M` assertion; hierarchy and composition by a person looking at the screenshots. This is a manual procedure and does not run in CI.

## Scenes

Fixed briefs, written once. Each names a surface, its reference folder and the states to produce. Keep them stable so runs are comparable.

| Scene | Brief | Surface | Rules it exercises |
|---|---|---|---|
| S1 | Coordinator chat with 12 short messages, one long reply with code, one pending question card | coordinator-chat | C1, C3, C11, V3, V4 |
| S2 | Settings page for providers: empty, one connected, one failing with a raw error | settings | C2, C5, C6, C7, V10, T1 |
| S3 | Thread list with six threads: working, waiting for you, ready for review, failed, done, snoozed | thread-list-sidebar | C1, C10, V5, V6 |
| S4 | First run: no provider, no machine, no agent; the user types a first message | first-run | C7, C8, C9, C2 |

## Procedure

1. Pick the rule and its scenes (the table above; a new rule adds its own scene or reuses one).
2. Make two worktrees from `origin/main`. Arm B keeps `apps/web/DESIGN-RULES.md` as is. Arm A has the rule row removed, and nothing else changed (removing the id from the brief's rule list too).
3. In each arm start a fresh agent session with the same brief from `.claude/skills/design-cairn/SKILL.md`, the same reference shots and the same model. Run each arm 3 times for each scene.
4. Capture every result at 1440px and 390px, light and dark, with the stack's own tools (`vp.mjs capture` for the live stack or the CI screenshot job).
5. Shuffle the results under random ids and put each beside its reference shot. Score blind: violates the rule or not (run the `M` assertion if the rule has one), and which of each pair is closer to the reference.
6. Record the run in the ledger below. Keep the rule when arm B violates it in clearly fewer runs than arm A and no new problem shows up in B. Rewrite it when both arms violate it (the wording does not steer the agent). Delete it when both arms comply (the model already does it) and no gate depends on it.

## Ledger

One row per rule check. Raw screenshots stay on the PR that ran it.

| Date | Rule | Scenes | Runs per arm | Arm A violations | Arm B violations | Decision | PR |
|---|---|---|---|---|---|---|---|

No rule has been through the procedure yet. The rules in `apps/web/DESIGN-RULES.md` at its first merge are taken from `DESIGN.md` and the 2026-11-06 audit, and each is checked the first time a PR is reviewed against it; the first full A/B run is the first row above.
