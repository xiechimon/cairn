# Issue 1611 verification

## Implementation

The Gemini bridge launches `gemini --acp`, negotiates protocol v1 with SDK 2.0.2, and supplies no Cairn provider credentials. Session creation includes an empty MCP-server list. Non-empty remote or local tool definitions fail closed.

Continuation uses the advertised `session/resume` or `session/load` capability. Load notifications are suppressed until setup completes, then the new prompt is sent. Text is sealed as `message_end`; partial tool updates preserve the original name and arguments and retain the ACP result content. Successful turns emit `done` with an empty usage array. Cancellation maps ordinary prompt errors to a schema-valid `message_stop`. Other stop reasons fail the step.

Image prompts require the advertised image capability. Advertised model configuration receives the requested model ID; without that configuration the bridge reports that it is using the CLI default. Permission requests are rejected once or cancelled; this ticket does not claim command-gate coverage.

An unauthenticated CLI is reported as Gemini's own login failure. The daemon does not read a token.

## Automated evidence

- `red-transport.log`: the original bridge fails all nine new NDJSON transport cases.
- `red-model.log`: the model-configuration test fails before the configuration request is implemented.
- `regression.log`: bridge, Gemini runtime eligibility, pi event mapping, and Claude Code authentication. Five files, 47 tests passed (`acp.test.ts`, `acp-stdio.test.ts`, `gemini-runtime.test.ts`, `map-pi-event.test.ts`, `claude-code-auth.test.ts`).
- `typecheck.log`: `pnpm typecheck` passed under `flock /tmp/cairn-heavy.lock`.
- `spec-parse.log`: `pnpm spec:parse` passed under the same lock. 1253 web e2e tests in 177 files, 35 integration test files.
- `prepush-vitest.log`: `node scripts/prepush-vitest.mjs` passed under the same lock. 40 files, 138 tests. `prepush-vitest-partial.log` is an earlier interrupted run and is not the acceptance run.
- `lint.log`: `pnpm lint` passed, with two informational diagnostics in existing web code.
- English-only, single-use-helper, and comment-discipline gates: 0.

The transport tests use Node streams and the real SDK encoder, decoder, request dispatch and notification dispatch. Their child-process boundary is supplied by an in-memory protocol fixture, not a live Gemini process. Every emitted event is validated against `stepEventSchema`; resumed turns have exactly one new message and exclude replayed history.

## Live Gemini CLI

`gemini` resolves through the mise shim and reports version `0.65.0`. `~/.gemini` has no settings file and no credential file. The environment has no `GEMINI_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI`, or `GOOGLE_GENAI_USE_GCA`.

A headless `gemini -p` exits with: set an auth method in `~/.gemini/settings.json` or export one of those variables.

`apps/daemon/scripts/probe-gemini-acp.ts` was run with the daemon tsx loader. The real CLI completed ACP `initialize` with `protocolVersion` 1 on both sides, then stopped because no API key is configured. No assistant text, tool call, `done` event, or session continuation was produced.

- `probe-gemini-auth-red.log`: before the login matcher included this sentence, the bridge wrapped it as `ACP initialize failed (protocolVersion client=1, agent=1): Gemini API key is missing or not configured.`
- `probe-gemini.log`: after the matcher change, the same probe prints `Gemini login failed: run gemini and complete its login flow. Gemini API key is missing or not configured.`

A transcript with text, one tool call, empty usage, and a second turn on the returned session id still requires a machine where `gemini` is logged in. This host is not that machine.

## Existing UI evidence

The six PNG files in this directory predate this implementation pass. They show machine runtime marks and the Gemini provider tab in light and dark themes. They are retained as historical UI evidence, not as proof of ACP execution.
