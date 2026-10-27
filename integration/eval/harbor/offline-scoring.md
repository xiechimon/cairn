# Offline Harbor scoring

Harbor 0.24.0 runs the oracle. The task image installs uv 0.9.7, the base image's Python, pytest 8.4.1 and pytest-json-ctrf 0.3.5. `tests/test.sh` calls `/opt/verifier/bin/pytest` and does not download. The verifier environment sets `UV_OFFLINE=1`.

The running container sets `network_mode: none`. Harbor runs the oracle and the verifier in that same container, so this proof's agent phase is offline too. The oracle only writes a file. A task whose agent needs the network would need a separate verifier service; this proof does not add one.

`build-offline-oracle-image.sh` downloads uv 0.9.7 on the host and installs pytest into a site directory with `uv pip install --target`, then builds the image with `docker build --network=host` so apt can reach the Ubuntu archive. The GitHub download does not run inside the image build. Harbor's compose build cannot pass BuildKit `--allow=network.host`, so the image is referenced as `docker_image`. Do not add a compose overlay that sets `network_mode: host`; that leaves scoring on the host network.

```sh
integration/eval/harbor/build-offline-oracle-image.sh
```

Harbor's `[verifier] network_mode = "no-network"` is not set. On this Docker host the egress-control probe runs `docker container run` against a digest-pinned Alpine image, the registry check hangs past Harbor's 30 second probe, and Harbor then rejects the trial with `network_mode='no-network' is not supported`. The compose override is the network cut that actually starts.

```sh
harbor run \
  --config integration/eval/harbor/offline-score.job.yaml \
  --path integration/eval/harbor/tasks/offline-oracle \
  --agent oracle \
  --yes
```

A reward of 1 also requires `/logs/verifier/network.txt` to read `offline`. The verifier treats the container as online when a TCP connect to `8.8.8.8:53` succeeds. That connect succeeds on the host network and fails with `network_mode: none`. When the connect succeeds the verifier exits nonzero before pytest, so an online scoring container scores 0 instead of silently passing.
