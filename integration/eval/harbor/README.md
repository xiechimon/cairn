# Harbor grading controls

These fixtures extract the task, oracle, tampering control, and separate verifier
configuration from closed PR #1885. They do not include a Cairn adapter or scoring
report. Harbor is pinned to 0.24.0 in `requirements.txt`.

Install the pinned CLI in an isolated Python 3.14 environment, with Docker Compose
available:

```sh
uv tool install --python 3.14 --from 'harbor==0.24.0' harbor
harbor --version
python3 -m unittest discover -s integration/eval/harbor -p test_exact_grading.py
python3 integration/eval/harbor/run_controls.py
```

The runner uses absolute paths because Compose resolves relative copy destinations
against the task environment directory. It runs both oracles and the tampering
agent sequentially, checks their rewards, retains Harbor's original job artifacts,
and records Docker inspection fields before removing its own containers. A new
run gets a timestamped job name. An optional first argument selects the output
directory. An optional second argument selects `all` (the default), `oracle`,
or `tamper` for a focused rerun. Runtime outputs default to `docs/verify/1946/jobs/`.

Both task graders use `cmp -s` for byte equality. The regression covers exact
contents, a missing final newline, extra final newlines, a missing file, and wrong
contents for both tasks. A missing or unreadable submission earns zero.

Harbor creates and manages the containers and transfers only the declared answer
artifact to a fresh verifier. Tests and expected answers stay outside the agent
container. The task Compose overlay sets `network_mode: none`; the separate
verifier inherits that overlay. The runner checks Docker's actual network mode,
not just the task configuration. Verifier stdout also records its hostname and
routing table. The tampering agent records its own hostname, failed reads of
hidden test/oracle paths, its forged reward, and its replacement test script.

The sealed token is a public benchmark fixture, not a production secret. Its
isolation claim concerns what Harbor exposes inside the agent container. The
oracle intentionally has the answer. This control does not defend against an
agent with access to the host, Docker socket, or public repository over a separate
channel.

# Harbor submission boundary

`submission.mts` exports `HarborSubmission`. It submits an instruction through real
Cairn routes and polls the todo, build and conversation messages. It does not
execute workspaces, install an executor or produce benchmark scores. The executor
tracked by #1792 is not present in this checkout; this boundary can be reused by
that adapter without introducing another executor.

Supply configuration through the calling process environment:

- `CAIRN_SERVER_URL`: HTTP or HTTPS origin, without credentials, a path or query.
- `CAIRN_SERVER_TOKEN`: the server's web authentication token. Used only on protected
  project, todo, build and conversation routes.
- `CAIRN_MACHINE_TOKEN`: the enrolled machine credential. Used only on
  `/api/machine/me`; it cannot replace the server token.
- `CAIRN_TEAM_ID` and `CAIRN_MACHINE_ID`: expected authenticated machine identity.
- `CAIRN_PROJECT_ID`: required explicit project belonging to that team.
- `CAIRN_AGENT_ID`: agent assigned to the build.

Load credentials from the environment using your existing secret provisioning.
Do not interpolate them into shell commands, benchmark instructions, command-line
arguments, checked-in configuration or artifacts. If a container adapter calls
this boundary, forward the complete configuration through its environment API,
including `CAIRN_PROJECT_ID`, rather than constructing a shell command.

Construct `new HarborSubmission(process.env)`, call `submit(instruction)`, retain
the returned `{ todoId, buildId }`, and pass it to `poll(task)`. Polling defaults
to 25 minutes with a five-second interval; `timedOut` distinguishes a nonterminal
todo from a completed one. Failed HTTP requests throw a status-only error;
transport and JSON errors do not include request headers or response bodies.
No project fallback exists. Configuration and machine/project membership are
validated before either creation request. Creation is not transactional: retain
`created` and `outcomes` if build creation fails after the todo was created, and inspect the
server before retrying to avoid duplicate submissions.

`outcomes` contains only method, route and HTTP status. Credential fields use
JavaScript private storage, and polled results redact literal credentials before
being returned. Treat other task content as sensitive independently. Do not
collect environment dumps or arbitrary transport diagnostics.

Run the authenticated integration coverage with:

```sh
pnpm exec vitest run integration/test/harbor-submission.test.ts
```

Set `HARBOR_EVIDENCE_PATH` to an output file to retain the successful scenario's
record IDs and request outcomes. The tests use random ephemeral credentials,
real server authentication middleware, real routes and an in-memory database;
no daemon or listening server is started. Workspace execution and benchmark
reporting remain separate tickets.
