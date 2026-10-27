# Cairn Harbor adapter

This directory contains the Harbor adapter used by the evaluation lane. It is a development tool and is not part of the Cairn product package.

## Prepare

Build the daemon package from this checkout. The tarball is uploaded into each task container before installation:

```sh
pnpm --filter @xiechimon/cairn-cli pack --pack-destination /var/tmp/harbor-1518
export CAIRN_CLI_TGZ=/var/tmp/harbor-1518/xiechimon-cairn-cli-0.2.0.tgz
```

Create a mode-600 environment file outside the repository containing the URL, the dedicated machine token, the dedicated agent id, and the tarball path. These values are passed to container commands through their environment, never embedded in command strings:

```sh
umask 077
cat > /var/tmp/harbor-1518/cairn.env <<'EOF'
CAIRN_SERVER_URL=http://100.125.21.46:8787
CAIRN_MACHINE_TOKEN=<machine-token>
CAIRN_MACHINE_ID=<machine-id>
CAIRN_TEAM_ID=<team-id>
CAIRN_AGENT_ID=<eval-harbor-agent-id>
CAIRN_PROJECT_ID=<harbor-project-id>
CAIRN_CLI_TGZ=/var/tmp/harbor-1518/xiechimon-cairn-cli-0.2.0.tgz
EOF
```

The adapter installs Node through nvm instead of the distro package: the CLI declares `engines.node >=22.19.0` while `apt` on `ubuntu:24.04` ships Node 18, and a global `npm install` into the distro prefix needs root. Every later command resolves the nvm-managed binary through the `versions/node/*/bin` path prefix. The adapter creates one todo from the Harbor instruction, starts a build assigned to `CAIRN_AGENT_ID`, links the build workspace to the task's `/app` directory, and starts the daemon with a mode-600 `machine.json`. It polls until the build reaches review or a terminal failure phase, with a 25-minute limit, then stops the daemon. Only the daemon log, task ids, build record, conversation messages, and final result are collected; machine credentials and runtime state are excluded.

## Run

```sh
cd integration/eval/harbor
PYTHONPATH=. uv tool run --from harbor==0.24.0 harbor run \
  --config omarchy.job.yaml \
  --path <harbor-task-directory> \
  --agent cairn_agent:CairnAgent \
  --env-file /var/tmp/harbor-1518/cairn.env
```

Use a 1800 second job limit for the smoke run. Harbor 0.24.0 resolves a custom agent as a Python module, not as an absolute script path; `PYTHONPATH=.` makes the adapter directory importable by the installed Harbor executable. Its `--config` option loads the job YAML and `--path` selects the task directory. The compose override uses host networking.

After the run, record the Harbor job directory, trial score, elapsed time, machine id, and agent id. Harbor 0.24.0 has no `cleanup` command; its default `--delete` behavior removes the environment. After a forced stop, remove only container and network IDs matched to that job's random trial directory names, not global Docker resources.

## Machine and agent cleanup

First remove the agent, then remove the machine after no other agent is bound to it:

```sh
curl -X DELETE "$CAIRN_SERVER_URL/api/teams/$CAIRN_TEAM_ID/agents/$CAIRN_AGENT_ID"
curl -X DELETE "$CAIRN_SERVER_URL/api/machines/$CAIRN_MACHINE_ID"
```

Run those requests with the normal server web authentication available on the host. Do not place the machine token in a command string or checked-in file.

The UI equivalent is:

1. Open `/app/resources/agents/$CAIRN_AGENT_ID`, select the overview tab, scroll to `Delete Agent`, and confirm deletion of `eval-harbor`.
2. Open `/app/resources/machines/$CAIRN_MACHINE_ID`, scroll to the danger zone, select `Delete`, and confirm deletion of `eval-harbor-omarchy`.

Delete the agent first. If the machine has another binding, unbind that agent first; the server refuses machine deletion while bindings remain.

Once `@xiechimon/cairn-cli` is published, replace the uploaded tarball step and `CAIRN_CLI_TGZ` with the published package name.

## Score a job

Harbor writes one directory per job. Infrastructure failures stay out of the pass rate: a missing reward or an exception is not a score of zero. `pass@1` is the mean, across tasks, of scored successes over scored attempts. `pass^3` is the unbiased chance that three scored attempts all succeed, averaged over tasks that have at least three scored attempts. The Wilson interval uses the pooled scored attempts. Cost sums every trial, including the ones left out of the rate. Five scored rounds of the same task produce a minimum detectable difference; the gate threshold is the largest of those differences.

```sh
pnpm --filter @cairn/integration exec tsx eval/harbor/score.mts /var/tmp/harbor-1518/jobs/<before> /var/tmp/harbor-1518/jobs/<after>
```

One path prints the bench report. Two paths also print the paired adoption verdict. The pair uses the mean of the scored attempts on each side. A side with no scored attempt is an infrastructure failure and the judge drops that task.

## Hidden-answer control

`tasks/hidden-answer` grades `/app/answer.txt` in a fresh container. The expected token is only in `tests/expected.txt` and `solution/solve.sh`. The instruction does not contain it. `tamper_agent.py` writes a forged reward file and replaces `/tests/test.sh` inside the agent container. The verifier never sees that container, so the forged reward does not pass.

The scoring container is offline because `environment/docker-compose.yaml` sets `network_mode: none`. Harbor 0.24's `network_mode = "no-network"` asks local Docker for an nftables sidecar, and the kernel probe times out at 30 seconds on this machine, so the task does not set that field. A job-level host-network compose overrides the agent container only: the separate verifier clears extra compose files and keeps `network_mode: none`.

The `artifacts` key sits at the root of `task.toml`, before the first table. A key written after `[environment]` belongs to that table, Harbor drops it, and the separate verifier never receives the file.

`tasks/hello-file` is the one-task smoke: the instruction states the file contents, and the same separate offline grader checks them.

```sh
cd integration/eval/harbor
PYTHONPATH=. uv tool run --from harbor==0.24.0 harbor run \
  --path tasks/hidden-answer \
  --agent oracle \
  --job-name hidden-answer-oracle \
  --jobs-dir /var/tmp/harbor-1518/jobs
PYTHONPATH=. uv tool run --from harbor==0.24.0 harbor run \
  --path tasks/hidden-answer \
  --agent tamper_agent:TamperAgent \
  --job-name hidden-answer-tamper \
  --jobs-dir /var/tmp/harbor-1518/jobs
```
