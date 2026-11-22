# Autonomy pause: resume on the observed condition

Problem: when an autonomous merge turns the default branch's `check` red, the
circuit breaker (`recoverRedAutonomousMain`) opens an `autonomy_pause` entry and
a GitHub marker issue labelled `autonomy-paused`. The entry stayed open until
someone closed every marker issue or pressed resume. After main went green
again nothing told the team, so autonomous merging stayed off for hours
(issues #5327, #5199, #4737 were all closed by hand after main was already
green).

## State

One `autonomy_pause` row per pause request. New columns:

- `waitsFor` (JSON, nullable): the signal that ends the pause.
  `{ kind: 'main-green', repo, failedSha }` for a `main-red` pause; `null` for
  `settings` (manual), `unjudged-landing` and `legacy`, which never resume on
  their own.
- `resolvedReason` (text, nullable): why the entry closed, in words.
- `resolvedBy` gains `condition` beside `markers` and `owner`.
- Migration `0249` backfills `waitsFor` for existing `main-red` rows from
  their `requestKey` (`main-red:<repo>:<sha>`), so a team paused today resumes
  on the next green main after the upgrade.

The team is paused while any row has `resolvedAt IS NULL`
(`teamAutonomyPaused`, unchanged).

## Transitions

| From | Event | To | Writer |
|---|---|---|---|
| none | default-branch `check` completed `failure` at head H | open, `waitsFor={main-green, repo, H}`, deduplicated by repository, branch, head, workflow run and attempt | `recoverRedAutonomousMain` → `pauseTeamAutonomy` |
| none | owner pauses (settings) | open, `waitsFor=null` | `PATCH /api/teams/:id {autonomyPaused:true}` |
| open, `waitsFor` set | the repo's current default-branch head has its latest `check` run completed `success` | resolved, `resolvedBy=condition`, `resolvedReason="Main check passed at <sha> in <repo>."` | `resumeClearedAutonomyPauses` (CI poller sweep) |
| open | every published marker has a verified identity and is closed | resolved, `resolvedBy=markers` | `syncAutonomyPauses` |
| open | owner presses resume (banner or API) | resolved, `resolvedBy=owner` | `PATCH /api/teams/:id {autonomyPaused:false}` |

Every resolution is a compare-and-set on `resolvedAt IS NULL` for that row id,
so two writers in the same window resolve it once and the first reason wins.
After a resolution the writer closes the row's marker issues with a comment
stating the reason (best effort; a failed close leaves the issue open and the
row resolved, because the database row is the authority).

## Readers

- `teamAutonomyPaused` / `autonomousMergePolicy` / `claimAutonomousMerge` and
  `mergeReadiness` (`autonomy-paused` blocker): open rows only.
- `GET /api/teams` and `PATCH /api/teams/:id`: `autonomyPauses` (open rows,
  with `waitsFor`) and `autonomyAutoResume` (the most recently resolved row,
  only when it resolved by `condition`).
- Web home banner (`apps/web/src/board/autonomy-banner.tsx`, polled every
  60 s): an open pause shows one `NoticeBanner` saying why it paused, what it
  waits for, and a "Resume now" button; a manual pause beside a red-main pause
  wins, since green alone will not resume the team. With no open pause and an
  unseen `autonomyAutoResume`, one dismissible line says it resumed and why;
  the seen id lives in `localStorage`.
- Marker issues: a resolution closes only markers no other open row still
  holds (`pauseGithubRepo` reuses an open marker issue across rows).

## Failure behaviour

- Signal never arrives (main stays red, the check never completes, GitHub is
  unreachable, or no token can read the repo): the row stays open; the banner
  keeps saying what it waits for and offers resume now. No timer resumes it.
- Flapping red/green: a new failed execution at the same or a different head
  can pause again. A confirmed green observation resolves the open
  `main-green` rows for that repository and workflow, without ending other pauses.
- A green head in repo B never resolves a pause keyed on repo A.
- A manual pause (`waitsFor=null`) never auto-resumes, even while every main
  is green; only the owner or closing its markers ends it.
- The sweep is serialised by the CI poller's `sweeping` flag.

## Signal identity and marker ordering

The circuit breaker observes the repository's current default branch, not a
branch named `main` or a different branch with the same commit. The signal is
the `check` job in the latest push execution for that head. Discovery accepts
one workflow with that job; a new pause pins its workflow ID. A migrated row
without an ID infers it from the historical head only when its branch-scoped
check is unambiguous. An absent, ambiguous, pending or unreadable signal keeps
the brake in place. The poller rechecks the execution identity and head before
it decides; GitHub does
not offer an atomic read of the branch ref and Actions job. Red recovery
runs before condition resolution so marker cleanup never delays a red decision.
A failed run and attempt get one request key each: the owner can dismiss that
failure, but a new failure at the same commit can pause again. Legacy keys have
no attempt identity; an already open legacy row is preserved until recovery.
The first failure observed after an upgrade can pause again even if the owner
previously acknowledged the same commit under a legacy key.

Pause insertion and resolution are synchronous database decisions. Marker
publication and cleanup are ordered per server database, including across teams
that share a repository. Cleanup rereads marker ownership after earlier writes;
publication after cleanup cannot reuse a closing issue. A server only reuses
markers it created and still tracks. It checks the immutable GitHub issue node
ID before reusing, reading a closure, or sending a close request. An older
marker without a known identity can be closed in GitHub, but this will not
resolve its pause in Cairn. Use the owner’s Resume now action to release a
legacy non-condition pause. Explicit pause and resume in the team API require the
owner session. Red observations enter the database before the sweep waits
for queued publications. Successfully published references are retained even
if a different repository failed. Across repositories, marker comments contain
no source repository or commit details; those remain in the team API.

The home banner gives a blocking pause priority over informational notices.
When several repositories must recover, it says that all of their checks must
pass; a manually paused team still waits for human action. Explicit user merge
requests remain distinct from the autonomous admission gate. This change does
not add a new automatic merge executor or alter GitHub's queue promotion.

## Tests

`apps/server/test/autonomy-auto-resume.test.ts` drives the real CI poller
sweep against a fake GitHub, one test per transition: main turns green and the
pause resumes with its reason (red on the old code), a pending check keeps the
pause and exposes `waitsFor`, a green main in another repo leaves the pause,
a manual pause stays on green, red/green/red reopens on the new head, resume
now records the owner and closes markers, and a manual pause sharing the red
pause's marker issue survives the condition resume (closing a marker another
open row holds would end that row through `syncAutonomyPauses`).
`apps/web/test/autonomy-banner.test.ts` covers which line the home banner
shows.
