# Nightly real-model smoke

`cairn-real-smoke.timer` runs one Claude Code read against a temporary Git repository each night. The runner refuses CI. Ordinary CI runs only the checker fixtures, simulator and negative controls.

On the daemon host, put `CAIRN_REPO=/absolute/path/to/cairn` in `~/.config/cairn/real-smoke.env`. The checkout must contain this script and its backend command bridge. Ensure the user service's `PATH` includes Node, Git and Claude Code. `CAIRN_HOME` defaults to `~/.cairn`; `CAIRN_SMOKE_MODEL` defaults to `sonnet`. Use the existing Claude Code login on the host or supply a short-lived `CLAUDE_CODE_OAUTH_TOKEN` through the private environment file. Do not copy refresh credentials into a container.

Install the service and timer from `scripts/ops/systemd/` into `~/.config/systemd/user/`, then run:

```sh
systemctl --user daemon-reload
systemctl --user enable --now cairn-real-smoke.timer
systemctl --user start cairn-real-smoke.service
node "$CAIRN_REPO/scripts/ops/check-real-smoke.mjs"
```

With `CAIRN_EXECUTOR=orb` in `real-smoke.env`, the runner creates a fresh `cairn-orb-base` clone, starts it, binds only the sandbox read-only, and runs Claude Code as `agent` through `systemd-run`. The base image must have Claude Code installed. The service user needs the same machine-manager permissions as the orb provider. Token environment values are inherited by name through `systemd-run`; values are never command arguments. Cleanup synchronously stops the container service before removing its image. Otherwise the same command runs in the host sandbox.

The runner atomically writes `{ok, at, model}` to `$CAIRN_HOME/smoke.json`, next to `daemon.json`. It writes `ok:false` before starting and only records success after a valid Claude Code result and successful cleanup. `model` comes from Claude Code's result on success. The checker prints `incomplete` and exits 1 for absent, malformed, failed, future-dated or older-than-24-hour records; a fresh successful record prints `complete` and exits 0.

The scripts and units are delivered in the repository; installation and real-provider execution are separate operational steps.

# Offline test helpers

The server suites share `apps/server/test/fakes/github.ts`. Issue fixtures, gate answers and merge state remain configurable by the suites. There is one fetch transport and one fake factory.

`apps/daemon/test/fakes/scripted-model.ts` exposes an `AgentBackend` plus `callTool`. Each named script step declares a tool, exact arguments and response. The backend executes configured local or remote tools and checks their responses. Unexpected calls throw immediately. A module-level Vitest teardown checks every script for unconsumed steps, even when a consumer forgets to call `assertConsumed`.

For real tests, create `realTestSuite()` at suite collection time. Call `suite.run(context, {name, credential, required}, callback)` inside each test. Missing credentials mark that test skipped with a reason. The registered suite teardown fails if any required-real test skipped. Optional real tests may skip without failing that summary. The negative-control fixtures prove the real Vitest exit status and skip summary.
