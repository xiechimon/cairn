# #931 verification evidence: rework returns to the original branch / the original PR

The two rework paths (failure restart with feedback + review-gate rejection) no longer produce a second
conversationId / second branch on the same todo; the original branch receives new commits (the mechanism surface of the PR updating in place = conv
branch push). Canonical copy = `docs/spec/23-rework-to-original-branch-and-pr-convergence.md`.

## Reproduction (how this directory's evidence was generated)

```sh
# integration E2E (real server + real daemon + hosted bare repo + gated stub LLM)
# with PACMAN_IT_EVIDENCE=docs/verify/931 the eight artifacts land in this directory (same law as
# apps/web/e2e/evidence.ts: opt-in, unset = no-op).
cd integration
PACMAN_IT_EVIDENCE=docs/verify/931 pnpm exec vitest run test/rework-branch-reuse-e2e.test.ts

# server face (reuse judgment / merged visibility / fail-open / latest-of-existing / pin fallback / pure-restart negative case)
cd apps/server && pnpm exec vitest run test/rework-branch-reuse.test.ts

# regression pins: a no-PR plain restart stays byte-identical + affinity/pinning do not regress
cd integration && pnpm exec vitest run test/m7-failed-send-e2e.test.ts
```

The github shape cannot be really cloned at the integration layer (the daemon would really connect to github.com), so the PR fields are simulated by direct test insertion following the daemon's real backfill shape (`runner.ts` prProbe → `finishStep`) — the input face of the reuse judgment; the merged/closed judgment face is pinned in the server unit test with a `githubFetch` mock (`rework-branch-reuse.test.ts` failure modes 4/5).

## Evidence → assertion reconciliation

| file | proves |
|---|---|
| `builds.json` | only **1 build row** for the whole run (neither rework path swaps builds): `prevPhase='failed'`, `errorMessage=null` (the failure reason is carried by the note), `prUrl/prNumber` intact (the PR unchanged) |
| `git-conv-branch.txt` | the conv branch has 6 commits: init → round-1 plan/build → **rework-round plan/build** → **reject-round plan** — all rework commits land on the original branch, no second `pacman/conv-*` branch |
| `daemon-canon-lines.txt` | rework round: `[workspace] Worktree reused` + `[workspace] 返工新会话：工作区回退到分支头` + `new session <conv>` + `pushed <branch>`; reject round: `continue session` (the same conv session continues, the #701 edge holds); one conv id throughout |
| `steps.json` | the rework round's first step carries `freshSession=1` + a prompt carrying the rework instruction; the reject round's re-planning step prompt = the output of `buildReviewRejectPrompt` (both paths converge at the same source) |
| `messages.json` | the feedback user row + the round-boundary note `返工回到本分支继续，更新原 PR #888。上一轮失败原因：…` land in the same conversation |
| `plans.json` | plan versions v1→v2→v3 increase continuously (a reuse round does not reset them) |
| `stub-user-prompts.json` | the rework round's new-session first user = `composeTaskPromptWithInstruction(full task text, buildRestartPrompt(feedback))` (the #720 composite — the session face of "reuse the branch only, context vacuum") |
| `todo.json` | `latestBuildId` does not drift (= the same build id), `phase='confirm'` (reject round close-out) |

The web presentation face (the note row visible, not impersonating a user bubble) is pinned by `apps/web/test/transcript-user-words.test.ts` F14 (the system rows of `buildReworkReuseNote` / `buildReworkNewBranchNote` → note rendering).
