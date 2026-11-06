# Probe team isolation: blocked audit

Issue: [#3136](https://github.com/xiechimon/cairn/issues/3136).

Implementation stopped at the issue's explicit protected-harness boundary.
This audit does not implement isolation or prove that probe runs leave the
default team unchanged. Do not merge it as the completed fix.

## Observed creators

The following findings come from source searches in this checkout.

| Creator | Project or agent creation | Boundary |
| --- | --- | --- |
| `integration/eval/chief-dispatch/stack.mts` | `seedWorld` posts agents to `/api/teams/${server.teamId}/agents` and `eval-project` to `/api/projects` with `server.teamId`. | Protected: not edited. The stack uses temporary homes. |
| `integration/eval/project-routing/seed.mts` | Posts routing projects to `/api/projects` with `server.teamId`. | Protected: not edited. |
| `integration/eval/memory-regression/seed.mts` | Posts `other-project` to `/api/projects` with `server.teamId`. | Protected: not edited. |
| `scripts/ops/orb/canary-stack.mjs` | Selects the first team, then creates providers, a machine credential, agents and projects in that team. | Creates its own scratch server home; no production write was observed. |
| `integration/verify/image-fallback-live.mts` | Creates agents and a project with `trial.team.id`. | Uses `bootServer` and temporary directories; no production write was observed. |
| `integration/test/helpers.ts` and individual integration tests | Create projects and agents against test-server team IDs. | Test fixtures; not evidence of writes to the owner's running server. |

`integration/eval/harbor/submission.mts` validates an externally supplied
project and machine team, then creates tasks and builds. It does not create
the supplied project. Its caller/bootstrap must be traced before attributing
the archived `harbor-eval-1518` project to this file.

Searches under the local automation and tools directories found no matching
project or agent creation calls. The named archived projects were found in
historical evidence and runtime records; their originating executable scripts
have not been established. The home-directory search included many duplicate
checkouts and generated artifacts and is not a complete creator inventory.

## Public API prerequisite

Observed in `apps/server/src/routes-core.ts`: `GET /api/teams` returns only
`ctx.team`; no `POST /api/teams` registration exists in the server source.

Observed in `apps/server/src/routes-helpers.ts`: `requireTeam` rejects every
ID other than `ctx.team.id`. Project creation in
`apps/server/src/routes-projects.ts` calls that guard. Agent creation also
uses the team guard in `apps/server/src/routes-agents.ts`.

Inference: a script-only get-or-create helper cannot create or use a second
team through this checkout's public API. Inserting a team directly into SQLite
would bypass the requested public API and would not remove the route guard.
Multi-team API behavior needs an explicit scope decision before implementation.

## Failure modes and tests to write before implementation

| Failure mode | Required regression proof |
| --- | --- |
| Missing `probes` team falls back to the default team. | Run each supported creator against an isolated real API with only the default team; assert that all new projects and agents belong to the created `probes` team and default-team rows are identical before and after. |
| An existing `probes` team is ignored or duplicated. | Seed both teams and rerun each creator twice; assert reuse of the same probes team and no default-team writes. |
| Team lookup or creation fails. | Return lookup and creation errors; assert the run exits before any project or agent POST, without a fallback. |
| Concurrent runs create duplicate teams. | Race two get-or-create calls and assert one shared team ID, with any conflict resolved through the public API. |
| Project, agent, machine and provider teams diverge. | Enroll the probe machine in the probes team and exercise agent creation and a build; assert matching team ownership and an unchanged default team. |
| A creator is missed. | Maintain an explicit creator inventory and execute its entry points; protected harness creators require owner-authorized follow-up outside this change. |

No behavior changes or new tests were made after the protected creator was
identified. No lockfile change is needed for this audit. The eventual fix
must include the requested isolation regression; passing existing tests does
not establish that property.
