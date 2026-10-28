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
