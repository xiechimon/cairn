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
   and actual host workspace absence check during the run.
5. After the PR merges and the issue is closed as completed, record the PR and
   merge SHA and re-read the lane lists. Do not copy tokens, machine credentials,
   private addresses, or unrelated personal information into public evidence.

The build-to-merge trailer check is blocked on the B1 trailer contract at this
branch's base `3980d6f46`. The merge writer in
`apps/server/src/services/builds.ts` currently sends only `closes #<issue>` or
`Merged by cairn.` as the commit body, with no build-ID trailer. The exact
trailer format and writer must be identified before the validator can certify
a trial. A passing unit test with a fabricated trailer cannot establish that
missing production contract.

When the checker is completed, run it from the repository root:

```sh
node scripts/ops/orb/trial-evidence-check.mjs docs/verify/b2-trial-one/trial-one.json
```

For server verification, set `CAIRN_SERVER_URL` and, when authentication is
required, `CAIRN_API_TOKEN` in the environment. The server exposes steps at
`GET /api/builds/<buildId>/steps`; the build's `todoId` resolves the team through
`GET /api/todos/<todoId>`, and `GET /api/teams/<teamId>/machines` resolves machine
IDs to names. Without a server URL, the checker must print
`server: skipped (no CAIRN_SERVER_URL)` and trust the recorded machine field.
This skip does not prove that the host ran the trial on the claimed machine.
