# #1242 project identity mutable faces — verify-pacman evidence

probe: `.claude/skills/verify-pacman/scripts/drive-1242-project-identity.mjs` (pure live stack + fake machine wire + a real-browser user path, zero daemon zero LLM). Two independent runs at 16/16 PASS (the two timestamped directories 2026-10-12T20-25-06 / 2026-10-12T20-25-28 carry the same criteria; the in-repo archive takes the second run).

## Rerun recipe

```sh
node .claude/skills/verify-pacman/scripts/launch.mjs     # fresh library (depends on: the local-project creation gate + the fake machine enroll order)
node .claude/skills/verify-pacman/scripts/drive-1242-project-identity.mjs
node .claude/skills/verify-pacman/scripts/cleanup.mjs
```

Outbound prerequisite: the conversion leg's reachability check really calls `GET api.github.com/repos/octocat/Hello-World` (a public-repo anonymous ladder; verified 200 on a direct connection from this machine, no token dependency). `agent` creation first takes a machineId via `machine/enroll` (the home machine is required since #1259).

## Reading table (16 checks ↔ ticket acceptance)

| leg | check | ticket mapping |
|---|---|---|
| S0 | bedding: a local project (a scratch real git repo) + 3 todos + a fake machine | — |
| C1 | the pre-conversion claim payload's repo = `{kind:local, cloneUrl:<local path>}` | pre-conversion baseline |
| A1 | an empty body → 400 (all five keys missing = the silent no-op family judged dead) | failure mode 4 |
| A2 | an unknown field → 400 (strict explicit refusal) | failure mode 4 |
| B1 | renaming on the settings page → PATCH persisted + invalidate re-read | remedy 3 / acceptance 2 |
| B2 | the rename takes effect in the sidebar and on the card (01-board-renamed.png) | acceptance 2 |
| C1/C2 | the description lands / clearing → the column reads null (empty ≡ null) | remedy 3 |
| D1 | converting while a build is in flight → 409 + a visible toast (02-convert-409-toast.png) | failure mode 1 / acceptance 3, 4 |
| D2 | after the 409 the row is untouched (still local) | failure mode 1 |
| E1 | the conversion persists: repoKind=github + githubRepo + localPath retained (the local binding becomes an accelerator slot) | remedy 2 / acceptance 1 |
| E2 | the post-conversion settings page: the conversion card unmounts, the accelerator-slot row comes online (03-settings-converted.png) | remedy 3 |
| E3 | the record's cloneUrl switches to the https derivation (04-project-record.json) | remedy 2 |
| E4 | notes: 1 rename row + 2 conversion rows (05-system-notes.json; the #902 pit: content is a json column, compare after JSON.parse) | remedy 4 |
| E5 | the todo detail's transcript shows the note row (06-transcript-note.png) | remedy 4 (visible on the board) |
| F1 | the post-conversion claim payload's repo = `{kind:github, cloneUrl, localPath}` | remedy 2 (existing steps parse the new shape) / acceptance 1 (the clone arm + the accelerator arm) |

## Measured pitfalls (three, same text in the changelog)

1. claim response unwrapping: a worker step's `body.step` is the full ClaimedStep shape (the project/todo faces included), and its `.step` field is the inner step position — applying drive-903's chief double-wrap unwrap (`payload?.step ?? payload`) unwraps the claimed envelope into the inner step object and `project.repo` is constantly undefined.
2. a probe reading an input value must poll for convergence (the same semantics as e2e's toHaveValue): the invalidate-triggered React re-render lags the network response by a beat, and a single `inputValue()` reads the pre-click old state.
3. a probe criterion must wait for the invalidateAll refetch to settle before screenshotting/reading (waitForResponse on the GET /api/projects response) — same source as pitfall ① of #1251.

## mea dual-machine acceptance face (the real-machine half of ticket acceptance 1)

The machine half of the ticket's "after converting, cards can be built on mea (the clone arm) and this machine walks the localPath accelerator arm" is pinned by F1's dual-arm claim-payload criterion (the daemon's dual-condition source-selection logic = the existing ADR 0017 face from #1213, unchanged by this ticket); the conversion of the pacman main instance on the user's real machine is performed by the user in the UI themselves (after this PR merges and deploys).
