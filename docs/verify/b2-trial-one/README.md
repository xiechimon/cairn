# Trial-one evidence

This directory is the fixed destination for the live acceptance evidence for
[#2278](https://github.com/xiechimon/cairn/issues/2278). Tooling changes do not
close that issue. Create `trial-one.json` only after the real trial completes;
local fake runs must never be recorded as live evidence.

## Fields

| Field | Recorded value |
| --- | --- |
| `repo` | Optional `owner/name`; defaults to `xiechimon/cairn`. |
| `issue` | Positive GitHub issue number transferred and completed by the trial. |
| `buildId` | Server build ID for the completed build. |
| `conversationId` | Thread conversation ID used by the Orb executor. For build steps this is the build ID. |
| `orbName` | Exactly `cairn-orb-<conversationId>`. |
| `machinectlStatus` | Nonempty output of `machinectl status <orbName>` captured while the trial runs. |
| `distRelease` | Required `{key, version, sha}` object copied from `/var/lib/cairn-orb/dist/current.json` while the trial runs. The key must contain the SHA and must not contain `-dirty`; the SHA must be reachable from `main`. |
| `pr` | Positive number of the merged PR delivering this issue. |
| `mergeCommit` | Full merge commit SHA reported by GitHub for that PR. It must be reachable from `main`. |
| `labelsBefore` | String array copied unchanged from the transfer script's JSON output. |
| `labelsAfter` | String array copied unchanged from the transfer script's JSON output. It must include `by:cairn`, no other `by:*`, and no `batch:*`. |
| `lanesAfter` | Object with `pending`, `mine`, and `hold`, each an array of issue numbers read after transfer. The issue must be absent from all three. |
| `hostWorkspaceAbsent` | Boolean `true`, based on an actual host-path absence check. |
| `hostWorkspacePath` | Absolute host workspace path tested; its final component is `conversationId`. |
| `claimedMachineId` | Exactly `omarchy-orb`, the trial machine's name. The server's step journal uses an opaque machine ID; resolve that ID to this machine name. |

`never` is an exclusion list: the issue belongs there after transfer. It must
not remain in the runnable `pending`, `mine`, or `hold` lists. Record `never` separately as optional `neverAfter` evidence, keeping the trial issue
present there. Keep unrelated numbers in every list. A remaining `batch:*` label prevents evidence
acceptance even when that label does not trigger an overnight timer.

## Capture sequence

1. Confirm that the dedicated `orb-builder` agent is active and bound to the
   approved `omarchy-orb` machine. See the
   [separate daemon instructions](../../../scripts/ops/orb/README.md#separate-trial-daemon).
2. Run `node scripts/ops/transfer-to-cairn.mjs <issue> --agent orb-builder --dry-run`
   against the host's actual lane state directory. Resolve any named lane PR
   or branch blocker before transferring.
3. Run the transfer without `--dry-run`, preserving its stdout JSON. Use
   `--state-dir DIR` if the host's lists are elsewhere. Copy both label arrays
   from that successful transfer, rather than reconstructing them afterward.
4. Let intake create the Thread and run through the ordinary merge gate.
   Record the build/conversation IDs, running Orb status, claimed machine,
   and actual host workspace absence check during the run. Copy the complete
   `{key, version, sha}` object from `/var/lib/cairn-orb/dist/current.json` into
   `distRelease` during that same run. The trial must use a clean, merged daemon
   build; preserve the publisher's SHA, which may be abbreviated.
5. After the PR merges and the issue is closed as completed, record the PR and
   merge SHA and re-read the lane lists. Do not copy tokens, machine credentials,
   private addresses, or unrelated personal information into public evidence.

The PR joins to its Thread through its head branch, exactly
`cairn/conv-<conversationId>`, using the rule in
`packages/shared/src/brand.ts`. The head repository must match `repo` and must
not be a fork. There is no build trailer contract; merge commit messages are
not used for this join.

Run the checker from the repository root:

```sh
node scripts/ops/orb/trial-evidence-check.mjs docs/verify/b2-trial-one/trial-one.json
```

The first reported check is `push: ok`. It verifies that the PR head commit
exists in `repo` on GitHub, with the expected same-repository Thread branch,
merged PR state and merge commit.
Checking the commit also works after GitHub deletes the merged head branch.
The next check is `dist: ok`. It requires a clean release key containing its
recorded SHA and checks ancestry with
`gh api repos/xiechimon/cairn/compare/<sha>...main`. Only `ahead` and `identical`
pass. Missing or malformed release metadata, a dirty key, a key/SHA mismatch,
an unmerged SHA, or an unreadable comparison produces a named `dist:` failure
and exits nonzero. A missing PR head commit or unreadable push response reports
a named `push:` failure first and exits nonzero. The completed issue and merge
reachability from `main` are checked afterward.
Invalid evidence reports `push: not checked (invalid evidence)` first.

For server verification, set both `CAIRN_SERVER_URL` and `CAIRN_API_TOKEN` in
the environment. The checker authenticates its reads and verifies that
`GET /api/builds/<buildId>` returns the recorded build. Build-step Thread IDs
are build IDs, so the returned ID must also equal `conversationId`. The build's
`todoId` resolves the issue and team through `GET /api/todos/<todoId>`.
`GET /api/builds/<buildId>/steps` must contain a claimed build step, and all
claimed build steps must resolve through `GET /api/teams/<teamId>/machines` to
the unique machine named `omarchy-orb`. Server errors fail validation.

When either environment setting is absent, the checker prints
`server: skipped (CAIRN_SERVER_URL and CAIRN_API_TOKEN are both required)`
after the push and dist results and trusts the recorded machine field. GitHub commit
existence supplies the push check; attributing that push to the Orb
step and its bound credentials also requires the live trial observations and
server machine verification. A server skip does not prove that attribution.
The final `trial-one: ok` appears only when every enabled check passes.
