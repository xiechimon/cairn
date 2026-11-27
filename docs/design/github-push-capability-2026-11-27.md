# GitHub push capability admission check

2026-11-27. One-page design for the machine→server capability wire change. Research: `docs/research/github-push-capability-2026-11-27.md`.

A newcomer installs Cairn, connects one runner, attaches a GitHub-backed project and starts a task. They do not know that the worker uses the runner computer's own `git`/`gh` login on GitHub projects. Today the task can run to completion and only then fail to push. After this change the task does not start on that computer; the task row says which computer needs `gh auth login` or repository access. They must already have a GitHub account with write access to the repository. Cairn never asks for or copies that token: it stays in the runner's GitHub CLI login.

| Scenario | What the user sees | What the system does | Wait / cost |
|---|---|---|---|
| Runner's GitHub login can write the repo | Task starts normally | Runner reports `write` for `owner/repo`; server admits it | One read-only GraphQL probe, cached five minutes |
| Runner has no GitHub login | Task waits; the queue names that computer and says to run `gh auth login` there | Probe reports `unauthenticated`; server rejects it for push-needing steps | No agent time is spent |
| Login exists but cannot write the repo | Task waits; same queue message says to grant that login write access | `viewerPermission` outside `ADMIN`/`MAINTAIN`/`WRITE` is `no-write` | No agent time is spent |
| GitHub/network probe fails or report is stale/missing | Task waits as unknown | Admission is fail-closed; the next presence/probe can clear it | Up to one probe cycle after recovery |
| Project is hosted by Cairn, local, plan-only or review-only | Unchanged | No GitHub push capability is required | No new probe blocks it |

## State

Machine capabilities gain one optional field, stored in the existing machine capabilities JSON (no database migration):

```ts
githubPush: {
  login: 'ok' | 'unauthenticated' | 'unknown';
  checkedAt: epochMs;
  repos: Array<{
    repo: 'owner/name';
    state: 'write' | 'no-write' | 'unauthenticated' | 'unknown';
    checkedAt: epochMs;
  }>;
}
```

The presence response gains `githubRepos: string[]`, the team's active non-archived GitHub-backed repository refs. Neither direction carries a token, scope list, account name or API response body.

The daemon keeps the probe cache in memory only. Daemon TTL is five minutes. The server accepts a `write` entry for at most fifteen minutes, leaving two missed probe cycles before a report becomes stale. Older runners simply have no `githubPush` field; absence is not write.

## Writers and transitions

1. Server presence writer (`apps/server/src/routes-machine.ts`): after recording presence, returns the sorted active GitHub repo refs for the machine's team.
2. Daemon probe writer (`apps/daemon/src/github-push-probe.ts`, driven by `machine-loop.ts`):
   - First presence has an empty or previously known report. The response's `githubRepos` updates the requested repo set and starts an asynchronous refresh; the next announced presence carries the result.
   - Each refresh first runs `gh auth status --hostname github.com`. Failure means every requested repo is `unauthenticated`.
   - With a usable login, a changed auth fingerprint (the local status output, never reported) clears the repo cache. Fresh cache entries are reused. Missing/stale entries run read-only `gh api graphql` for `repository(owner,name){viewerPermission}`.
   - `ADMIN`, `MAINTAIN` and `WRITE` become `write`; any other returned permission or a missing repository object becomes `no-write`; CLI, network, timeout or malformed-output failures become `unknown`.
3. Capability parser/writer (`packages/shared/src/records/machine-capabilities.ts`): parses and bounds the report like other machine-reported capabilities. Invalid entries are dropped rather than trusted.

## Readers

1. Server admission (`apps/server/src/services/machine-routing.ts` and `dispatch-eligibility.ts`): a GitHub-backed `build`, `session` or `merge` step requires a fresh exact-repo `write` report. A `verify` step requires it only when its prompt uses repository evidence; attachment-evidence verification is read-only. Missing field, missing repo, stale timestamp and every non-`write` state are ineligible.
2. Claim path (`apps/server/src/services/machine-claim.ts`): uses the same routing facts and re-checks the runner's `githubPush` report inside the fenced claim transaction (`withFencedTransaction`), so a runner cannot win the transaction after merely racing the queue projection.
3. Queue projection (`apps/server/src/services/step-queue.ts`): maps the new ineligibility to the new blocked kind `github-push-missing` and keeps the waiting machine id so the UI can name the computer. In a multi-runner pool with no explicit pin or default runner, if any otherwise-capable online runner lacks `write` for the step's repo, the queue emits `github-push-missing` (unnamed fallback) instead of `machine-offline` or `capability-missing`. Offline-runner failover recommendation (`apps/server/src/services/runner-offline.ts`) populates the same required `WorkerStepFacts.githubPushRepo` so it never recommends a runner lacking push permission.
4. Web queue copy (`apps/web/src`): renders one plain instruction for that machine: run `gh auth login` on it; if already logged in, grant that GitHub account write access to the repository.

## Failure behavior

- `gh` absent or not logged in: `unauthenticated`, ineligible, task remains pending.
- Repo deleted, renamed, or permission revoked: next probe becomes `unknown`/`no-write`; admission stops within the TTL. A revocation after admission cannot be prevented by any preflight check.
- Server older than runner: unknown field is ignored by the old parser; no crash.
- Runner older than server: no report, therefore ineligible only for push-needing GitHub steps; other work remains unaffected. Queue projection emits `github-push-missing` until the runner reports fresh `write` capability.
- Many repos: only team-active refs are returned, capped at 200; probes are per repo and cached. Cache memory is bounded by the same cap.
- Presence failure: capabilities remain last stored server-side and age out by `checkedAt`; fail-closed rather than assigning impossible work.

## Tests (one per path)

1. GitHub build step + runner report missing/unauthenticated/no-write/stale → claim is denied and the step remains pending.
2. Same step + fresh exact-repo `write` → claim succeeds; wrong repo or `verify` with attachment evidence does not satisfy or require it respectively.
3. Presence response returns active GitHub repos and omits archived/non-GitHub projects.
4. Daemon probe maps `viewerPermission` values and auth failure to the report states, reuses fresh cache entries, and invalidates them when the auth fingerprint changes.
5. Queue projection emits `github-push-missing` with the machine id, and web copy names the computer and the login/access action.
