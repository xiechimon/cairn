# Production task entry

This task-container entry calls the exported production `runStep` with the
production `PiBackend`. The evaluator supplies one `ClaimedStep` snapshot rather
than reconstructing a worker prompt. Production code composes the prompt,
discovers skills, resolves effort, executes tools, and writes its executor record.
The local `MachineApi` implementation replaces only server transport; it does not
provide model responses or grading results.

Run from the repository's `integration` directory after dependencies have been
packaged into the task image:

```sh
pnpm exec tsx eval/harbor/production/run-task.mts /run/task.json /logs/agent
```

The descriptor contains `taskDir`, `stateDir`, `claimed`, `provider`, and optional
`skillsDir` and `timeoutMs`. The provider uses the production `ProviderConfig`
shape with `apiKey` forbidden. Its loopback base URL must reach a trusted relay
inside the task container. The entry supplies a placeholder auth value; the real
provider credential and spend accounting belong to the host relay. No credential
is read from the task descriptor or environment by this entry.

For a Harbor snapshot at `/app`, use `claimed.conversationId = "app"` and
`claimed.project.repo = null`. The runner then uses `/app` directly without git
operations or replacing its contents. State initialization touches only private
daemon directories; it preserves the external task and parent permissions.
The claim must be a fresh implementation step (`session` or legacy `build`) with
a matching provider/model. Agent description, project instructions, memories,
skill selection, and thinking level remain the production claim's inputs.
The session brief is supplied in the claimed instruction, as production dispatch
does; the adapter does not recreate it. External remote tools and MCP servers are refused until a trusted transport is
provided. The TypeScript API also accepts a team-skill manifest and its bytes for
native production materialization and integrity checking; the CLI currently
accepts packaged local skills only.

The output directory receives native `transcript.json`, `session.jsonl`,
`executor-record.json`, `execution.json` (completion and tool calls), and
`daemon.log`. A failed step exits 1. Missing completion, executor record, or
production transcript/session artifacts rejects execution. None of these files
is a grade; the trusted parent still owns grading and score persistence.

## Verification and limits

Failure modes covered by `runner.test.mts`: task directory replacement, workspace
mismatch or repository cloning, prompt loss, changed/omitted skill content sharing
a hash, provider failure or timeout reported as success, effort dropped before
the provider request, and CLI artifacts missing the native session. The stateful
SSE model issues a real `write` tool call and checks its result on the next turn.
No backend or runner is mocked.

```sh
pnpm exec vitest run --config integration/vitest.config.ts \
  integration/eval/harbor/production/runner.test.mts
```

These tests run with a fake model on the development host. They establish the
production runner/backend path and its output contract. They do not establish
container isolation, trusted host orchestration, a real-provider baseline,
spend-limit behavior, or completion of Epic 3. The task image must package the
candidate code without exposing ruler code, sibling arms, parent results,
Docker sockets, or real provider credentials. The existing candidate Python host
plugin must not import this candidate entry on the host. A separate trusted
Harbor adapter and runtime boundary must invoke it inside the task container.

## Trusted runtime packaging

Run the packager from a trusted checkout, with trusted installed dependencies:

```sh
pnpm exec tsx eval/harbor/production/package-runtime.mts \
  /candidate /trusted-checkout /fresh-runtime-output
```

The output directory must not already exist. `packageProductionRuntime` invokes
Bubblewrap with a cleared environment, separate network/PID/user namespaces,
read-only system libraries and Node executable, read-only trusted builder and
dependencies, and an explicit read-only set of candidate source paths. Only the
fresh output directory is writable outside the namespace's temporary filesystem.
The candidate's package scripts, build scripts, plugins and TypeScript config
are never executed. Absolute and symlink imports outside those mounts fail.
The build additionally checks every loaded import against its source/dependency
allowlist.

The fixed esbuild config bundles the production task entry and Cairn/shared
runtime code while leaving Pi external, as the daemon does. It emits no
sourcemap and includes no Cairn checkout or evaluator files. It copies the exact
installed Pi dependency closure without running install scripts, removes test,
eval, grader and `.git` directories and sourcemaps from dependency packages, and
reconstructs relative package links entirely inside the staged directory.
Package assets remain in their original relative locations. The returned manifest
records the bundle digest and installed package versions.

Execute the staged entry with Node, without pnpm, tsx or a source checkout:

```sh
node /opt/cairn-runtime/run-task.mjs /run/task.json /logs/agent
```

`package.test.mts` first rejects absolute and symlink imports of a temporary
outside-root secret. It inventories the staged package, checks every package
symlink stays inside it, then executes that staged entry against a stateful fake
model and verifies a real file write and native session/completion artifacts.
`VERIFY_EVIDENCE_DIR` optionally preserves its staged runtime and output files.
This host-side fake-model smoke does not establish the final task container's
isolation or real-provider behavior.

Compiled JavaScript remains readable implementation code. Historical task fixes
can survive in a bundle even after original source files and sourcemaps are
excluded. This packager does not treat minification or package inventory as an
answer-contamination control. The final runtime-present adversarial controls
remain required before baseline activation.

## Linux packaging CI

The ordinary integration suite discovers the packaging tests but reports them as
skipped unless `CAIRN_EVAL_PACKAGING_TESTS=1` is set. Portable runner and platform
failure-path tests still run. A skipped packaging suite produces no packaging
proof. An explicit request on macOS, a missing Bubblewrap binary, or denied
namespace creation fails rather than falling back to an unconfined build.

`.github/workflows/eval-production-packaging.yml` runs the packaging suite on an
ephemeral Ubuntu 24.04 runner for relevant PR/main changes and manual dispatch.
It installs Bubblewrap, enables the runner's unprivileged user namespaces when
kernel policy restricts them, and requires a real namespace preflight before
running the tests. Dependency installation uses `--ignore-scripts`. The job has
read-only repository permissions, no model credentials, and only a local fake
model. Its artifact contains the package manifest and fake-provider runtime
outputs, not a metered baseline.

The dedicated job explicitly opts in to packaging tests. Its preflight refuses
a missing opt-in, so an accidental omission cannot report a passing packaging
job with every packaging test skipped. To reproduce those exact checks locally
on a supported Linux host:

```sh
CAIRN_EVAL_PACKAGING_TESTS=1 pnpm --filter @cairn/integration exec tsx \
  eval/harbor/production/packaging-preflight.mts
CAIRN_EVAL_PACKAGING_TESTS=1 pnpm exec vitest run \
  --config integration/vitest.config.ts \
  integration/eval/harbor/production/packaging-platform.test.mts \
  integration/eval/harbor/production/package.test.mts \
  integration/eval/harbor/production/runner.test.mts
```

When setting `VERIFY_EVIDENCE_DIR`, use a fresh directory to preserve that run's
staged package without overwriting a prior package's symlinks. Local success does
not establish that the dedicated workflow has run on a GitHub-hosted runner or
that its check has been configured as required by branch protection.
