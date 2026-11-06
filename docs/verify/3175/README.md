# D121 B API handoff

Source: issue #3175, owner decisions D121 #1 and #2 (coverage audit N6/N7).

## Failure modes and acceptance

| Failure | Required behavior | Coverage |
| --- | --- | --- |
| Agent lacks merge or push permission | Finish remains available; merge returns 403; PR survives | HTTP calls and owner-controls tests |
| API disagrees with merge permission gate | Both read the same current agent switches | Owner-controls and machine-wire tests |
| Countdown changes after restart | Deadline remains phaseAt + 600000 | Real process restart and database reopen tests |
| Paused plan starts automatically | Pause persists for that plan version | Real scheduler after process restart and database reopen tests |
| Disabled project starts automatically | Setting persists and suppresses the deadline | Real scheduler after process restart and database reopen tests |
| Pause targets an obsolete plan/build | Return 409; unrelated plan/build returns 404 | Owner-controls tests |
| Existing approval safety gate is bypassed | No deadline for blocked plans | Owner-controls and plan-server-auto-confirm tests |
| Pause disables explicit approval | Manual confirmation still works | HTTP calls and owner-controls tests |

## UI integration

- `PATCH /api/todos/:id` with `{"phase":"done"}` is the existing finish-without-merge path. It accepts review tasks without merge permission. It retains the PR and does not enqueue merging.
- `GET /api/builds/:id/merge-permission` returns `{permitted, missingTools, prUrl}`. This represents agent tool authorization, not PR readiness or GitHub credentials. The merge action still validates those gates independently.
- `GET /api/builds/:id/plans` adds `autoApproveAt` (epoch milliseconds or null) and `autoApprovePausedAt` (epoch milliseconds or null). Only the current eligible plan has a deadline. Existing human-policy, open-decision, live-step, revision, split and watched-question gates remain in effect.
- `POST /api/builds/:id/plans/:planId/pause-auto-approve` needs no body and returns the plan with its persisted pause timestamp and null deadline. Retrying preserves the timestamp. A replacement plan version has its own pause state.
- `GET/PATCH /api/projects/:id/merge-policy` includes `planAutoApproveEnabled`, default true. Patching false suppresses the server's timed approval for all plans in that project. Existing settings survive the patch. Re-enabling uses the original confirmation time and preserves per-plan pauses.
- `POST /api/builds/:id/steps` with `{"action":"confirm"}` remains the explicit approval path.

The migration adds one nullable integer column to `plan`; project configuration uses the existing autonomy JSON. No lockfile or web changes.

## Evidence limits

The API card uses isolated real Hono/SQLite stacks and seeded tasks. GitHub, model providers and a daemon were not exercised. The restart probe starts a fresh process against the same database and observes the actual scheduler. UI integration belongs to the separate UI lane.
