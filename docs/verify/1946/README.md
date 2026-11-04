# Issue #1946 verification

## Reproduce

From the repository root, follow `integration/eval/harbor/README.md`. The exact
Harbor pin is 0.24.0. `run_controls.py` records commands, original Harbor results,
verifier rewards and stdout, submitted artifacts, agent probes, and selected
Docker inspection fields under `jobs/`.

## Regression evidence

`exact-red-reproduced.log` runs the regression against the original test scripts
from PR #1885, commit `4a6ed1c2eb1b52b3819946ee0a439b7616292877`, without changing the working task
fixtures. It records four expected assertion failures: both tasks accept a
missing newline and extra newlines. `exact-green.log` records the fixed scripts
passing all ten task/case combinations.

To reproduce the expected failing baseline:

```sh
HARBOR_GRADER_REV=4a6ed1c2eb1b52b3819946ee0a439b7616292877 \
  python3 -m unittest discover -s integration/eval/harbor -p test_exact_grading.py
```

## Scope and concurrent work

Before editing, both requested open and recently merged PR inventories were read.
Open PR #2049 adds different files in `integration/eval/harbor/`; none of its
files are changed here. No recently merged lines are removed. Existing unrelated
changes to `pnpm-lock.yaml` were present at takeover and are outside this ticket.

## Runtime evidence

The initial relative-output run is retained under `jobs/1946-hello-oracle/` as an
unsuccessful diagnostic attempt. Subsequent runs use absolute output paths.
Only completed trials without exceptions count toward acceptance.

`first-control.log` records a successful oracle followed by a failed evidence
collection assertion: the first runner used an incomplete Compose project suffix
and captured only the agent container. `first-control-verifier-network.json`
retains a direct inspection of that run's stopped verifier. The final runner
requires exactly two container records, both with Docker network mode `none`.

The final controls run uses the suffix `20261028004645`:

- `jobs/1946-hello-file-oracle-20261028004645/`: oracle reward 1.0.
- `jobs/1946-hidden-answer-oracle-20261028004645/`: oracle reward 1.0.
- Each matching `*-containers.json` records the distinct agent and verifier IDs,
  their mount sources, stopped states, and actual Docker network mode.

Both oracle trials have no verifier exception. Their original `verifier/reward.txt`,
`verifier/test-stdout.txt`, and submitted answer artifacts are retained, with no
postprocessing. The routing tables contain no routes.

The final executed-tampering control is
`jobs/1946-hidden-answer-TamperAgent-20261028005043/`: reward 0.0, no exception.
`tamper-final.log` records the focused rerun command. Its agent probe records
three unreadable hidden answer/oracle paths. Its tampering log records the wrong
answer, a passing text reward produced by executing the replacement grader, and
a forged JSON reward. The independent verifier still emits `0`.

The corresponding `1946-hidden-answer-TamperAgent-20261028005043-containers.json`
records agent `6c61eac14e2f` and verifier `bec082864faf` as distinct stopped
containers, both with network mode `none`. Their hostnames also match the
agent probe and verifier stdout. No agent mount exposes the host task tests or
oracle directory. The agent container is stopped before the verifier runs, and
Harbor clears verifier logs before independent grading.

`tamper-script-regression.log` confirms that the inherited and simplified fake
graders both produce the valid bytes `1\n` when executed locally. The earlier
suspicion that inherited escaping made the fake grader invalid was disproved.
The final agent executes the fake grader explicitly to keep this evidence direct.

## Repository checks

- `lint.log`, `typecheck.log`, and `spec-parse.log`: passed.
- `prepush-vitest.log`: passed; no changed JS/TS tests selected.
- `exact-green.log`: all ten Python regression combinations passed.
- English-only, single-use helper, and comment-discipline gates: zero violations.
- New files were also checked directly for English because this sandbox handoff
  skips Git staging and the standard diff-based gates do not inspect untracked files.

Heavy repository checks used `flock /tmp/cairn-heavy.lock`, sequentially. No
application servers or Playwright processes were started. All containers created
by these controls, including diagnostic attempts, were removed. Only the task
branch files and `COMMIT_MSG.txt` are handed off; no push was performed.
