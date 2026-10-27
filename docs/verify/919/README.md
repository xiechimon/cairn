# #919 verification evidence index — behavioral acceptance of skill routing

Ticket: #919 (integration: behavioral acceptance of skill routing). The primary criterion = **behavior**: the ticket text mentions only the requirement, not a word about skills, and after the lane finishes the work it can point in the artifact/log/UI to which skill it hit itself. The structural criteria (full-catalog, no-truncation, hard-block, empty-catalog, version compatibility) are pinned by integration and unit tests (`integration/test/skills-routing-e2e.test.ts`, `apps/daemon/test/skills-version-skew.test.ts`); this directory is the **real-dispatch** behavioral evidence + the live capture of the deny-events-visible face.

The front-end visible face was merged to main first by the parallel ticket #918 (shared classifier `packages/shared/skill-facts.ts` + activity live-row disclosure + the detail page's persistent summary row); this ticket's seam-4 acceptance object is exactly that face — the fixture e2e `apps/web/e2e/skills-routing.spec.ts` pins the persistent face and the zero-event control, and the live face is pinned by this directory's screenshots. The parallel web face this ticket carried was retired during the merge (the same fact is not rendered as two faces).

Probe = `.claude/skills/verify-pacman/scripts/drive-919-skills-routing.mjs`
(two phases; the behavior leg walks a real model = claude-code runtime + the local claude login, default glm-5.3; the deny-ui leg walks the probe's embedded script stub). Run date 2026-10-07 (rerun after merging origin/main).

| directory | phase | checks | ticket acceptance seams covered |
|---|---|---|---|
| `behavior/` | `--phase=behavior` | 11/11 | primary criterion: the ticket text carries zero skill words (self-certifying check) → the real-model step is done → the artifact `haiku.txt` contains the skill body marker `SKILL-ROUTE-919` (artifact face) + the commit face `HEAD:haiku.txt` contains the marker (hosted project, step close-out commit + push) + the transcript's SKILL.md read row (log face) + daemon.log `team: 1 skill(s) materialized` / `catalog: entries=1` / `deny: 2` + the detail page's persistent summary row `技能：haiku-helper` screenshot (real-user-path front-end face) |
| `deny/` | `--phase=deny-ui` | 10/10 | events blocked by deny are likewise visible: the summary row `挡下：secret-local` screenshot; in the same run, the acceptance side (the authorized read marker lands in the DB), the refusal side (the refusal copy lands in the DB, the unauthorized marker does not), the `denied-read:` line, and the live-stack LLM input-face catalog assertion (names the skill, no entries outside the whitelist) |

## The primary criterion's four faces of ground truth (behavior/)

- **Artifact face** `behavior-artifact-haiku.txt`: the full text of the haiku.txt written by the real model — three lines of haiku + `SKILL-ROUTE-919` on its own line (that marker exists only in the skill body; neither the ticket text nor the task text has it).
- **Log face** `behavior-daemon-skills-log.txt` + `behavior-messages.json`: the `[skills]` line family in daemon.log (team distribution materialization, catalog entries, the hard-block set); and the model's Read hit row against the team-distributed SKILL.md in the transcript, including the model's own thinking segment ("The skill says: …" = the live record of an autonomous match by description).
- **UI face** `behavior-detail-skills-summary.png`: the detail page's persistent summary row reads out the hit skill by name (the #918 face, real user path).
- **Commit face** the probe's in-script `git show HEAD:haiku.txt` assertion (the hosted repo's step close-out commit).

## Rerun recipe

```sh
# stack and daemon (8791/5273 are often held by a neighbor lane: lsof first, then move ports)
node .claude/skills/verify-pacman/scripts/launch.mjs   # VERIFY_REPO_ROOT=<worktree> VERIFY_PORT=8795 VERIFY_WEB_PORT=5277 VERIFY_RUN_DIR=/tmp/pacman-919-run2
TEAM=$(curl -s --noproxy '*' http://127.0.0.1:8795/api/teams | ...take [0].id)
KEY=$(curl -s --noproxy '*' -X POST http://127.0.0.1:8795/api/teams/$TEAM/api-keys -H 'content-type: application/json' -d '{"name":"probe-919-machine","gitAccess":true,"mcpAccess":false,"toolGrants":{"read":[],"write":[]}}' | ...take .plaintext)
cd apps/daemon && env -u http_proxy -u https_proxy -u all_proxy NO_PROXY='*' \
  PACMAN_HOME=/tmp/pacman-919-daemon-home2 PACMAN_SKILLS_DIR=/tmp/pacman-919-local-skills \
  pnpm exec tsx src/cli.ts start --foreground --server http://127.0.0.1:8795 \
  --api-key "$KEY" --team "$TEAM" --name verify-919 &
# two phases (the behavior leg requires this machine to reach the model through the claude login; relay intermittent failures: retry the whole step up to 3 times)
node .claude/skills/verify-pacman/scripts/drive-919-skills-routing.mjs --phase=behavior
node .claude/skills/verify-pacman/scripts/drive-919-skills-routing.mjs --phase=deny-ui
```

## Reading the results (the five pits hit in this round)

- **enroll defaults to `enabledRuntimes:['pi']`; since #682 it is a real claim gate**: claude-code-runtime steps stay pending forever on a pi-only machine and the daemon logs nothing (the root cause of the first round's three 600s waits). The probe now PATCHes `/api/machines/:id` to open both runtimes.
- **The step terminal vocabulary is `done`** (shared stepStatusSchema), not `success`; the build table has no status column, and the failure root cause lives in `build.errorMessage`. The drive-920 template only ever saw the failed shape — copying its terminal-state list waits forever.
- **The project must be `repoKind:'hosted'`**: the default manual shape has no repository, the artifact cannot enter any commit (the commit-face assertion has no ground truth to take), and the right-pane changes face is empty too.
- **The stub's toolcall ids must be unique across processes**: message rows are globally deduplicated by toolcall id — when two probe processes both send `call-stub-N`, the later run's rows are silently dropped by the server (rows in the outbox, none in the DB, the UI waits empty for 60s). The probe adds a per-process salt.
- **The probe's embedded stub must `closeAllConnections()` at close-out**: when the daemon's provider keep-alive connections do not let go, `server.close()` never settles and node exits with code 13 + an unsettled top-level-await warning (all checks are already on disk; only the exit code is dirty).
- **agent.skills whitelist references are filtered by the live scan of the team catalog** (dead references silently fall off): to get a daemon-local skill into the whitelist it must simultaneously be a team-catalog-known id (the probe also creates the whole fixture library on the team side; on a name conflict the team entry wins, the local copy becomes a collision loser that does not enter the deny set and reads are still allowed).
