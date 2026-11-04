# 1299 acceptance record — skills execution face borrows the T3 route

## What

Three things (the ticket's design, scope not enlarged):

1. **Joint scan**: the daemon skills face's skillPaths expands to `[PACMAN_SKILLS_DIR, <task worktree>/.claude/skills]`; the pi backend's `.pi/skills` joins by the same law when present. The identity/dedup/budget laws carry over as-is (spec 14 + #1116) — only the scan surface expands.
2. **Skill tool**: the pi session gains a custom tool `Skill` (modeled on the tag-tool.ts seam): input skill name → validate against the visible set → return the SKILL.md full text + a `[skills] invoke` log. The claude-code backend is untouched.
3. **/name guaranteed invocation**: when the runner assembles the worker prompt, it recognizes `/<skill-name>` (inside the visible set) → prepends a deterministic load instruction; an unknown name is a no-op + a `[skills] unknown-dispatch` log.

## Verified

### Unit tests (three states / five states)

```
pnpm --filter @pacman/daemon exec vitest run test/skills-worktree.test.ts test/skill-tool.test.ts test/skills-catalog.test.ts test/skills-hard-block.test.ts test/skills-native-plugin.test.ts
```

| test file | cases | failure modes covered |
|---|---|---|
| skills-worktree.test.ts | 8 | both directories present / team only / worktree only / same-name conflict (winner + log) / neither / default zero-regression / piWorktreeSkillDirs returns both directories |
| skill-tool.test.ts | 5 | hit returns full text + invoke log / unknown-name error text / empty name / file read failure / tool name = Skill |
| skills-catalog.test.ts (existing) | 43 | #1116 byte budget and binding-order regression |
| skills-hard-block.test.ts (existing) | 14 | #917 deny face regression |
| skills-native-plugin.test.ts (existing) | 13 | #1171 team view regression |

Five states (joint scan):
1. both directories present → all visible
2. team only → the worktree directory's absence silently narrows (no crash)
3. worktree only → worktree skills visible even with PACMAN_SKILLS_DIR empty
4. same-name conflict → the PACMAN_SKILLS_DIR entry wins (first-wins, the skillPaths order team → skillsDir → worktree), buildSkillsCatalog logs a `collision:` line naming it
5. neither → the empty set does not crash

Three states (/name expansion, implemented on the runner side, see the mechanism evidence below):
1. hit → the prompt prepends the "call the Skill tool to load <name> first" instruction + a `dispatch:` log
2. unknown name → no-op + an `unknown-dispatch:` log, the step does not crash
3. no slash → no-op

### Mechanism artifacts

The `/name` expansion runs while the runner assembles the worker prompt (the real dispatch path), and the unit tests directly cover runner.ts's behavior face. Evidence method: capture a fixture with a mock pi session (see `docs/verify/1299/mock-transcript.md`).

### Gates

- `pnpm lint` — green (54 existing warnings, 0 errors)
- `pnpm -r typecheck` — green (5 packages)
- `pnpm spec:parse` — green (apps/web/e2e 922 tests in 127 files; integration/test 30 files)
- daemon affected-surface unit tests — green (skills-worktree + skill-tool 13 new cases, the skills-* family 118 cases, runner-team-skills / runner-local / runner-delivery 29 cases)

## Upstream

None. All three changes live inside the daemon process: backend/skills.ts (scan surface + visible-set export), backend/pi.ts (passing worktreeSkillsDirs through the brief and deny faces), runner.ts (Skill tool assembly + /name expansion), skill-tool.ts (the new tool), machine-loop.ts (passing skillsDir through deps).

## Risk

- **the claude-code backend does not register the Skill tool**: its native Skill mechanism is already observable (the `Skill` branch of `skillCallName` in skill-facts.ts recognizes claude-code native invocations). This change touches pi only.
- **a missing worktree skill directory**: loadSkills emits a warning diagnostic and does not error (the #1299 failure-mode-2 silent-narrowing semantics, same law as the existing scan surfaces).
- **collision ruling**: worktree entries sit at the tail of skillPaths → under first-wins the PACMAN_SKILLS_DIR / team entries win. Consistent with the existing law that teamSkillsDir beats skillsDir.

## Acceptance

- the PR is opened and the commit carries `closes #1299`
- all gates green (lint / typecheck / spec:parse / affected-surface unit tests)
- docs/verify/1299/ carries invocation evidence

## Issues

None.
