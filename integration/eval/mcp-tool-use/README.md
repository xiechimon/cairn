# MCP tool-use replay

This offline harness checks required calls, ordered calls, forbidden calls, argument
subsets, per-tool call limits, and schemas exported from the current Cairn chief
registry. It never executes product tools or writes product data. `play()` presents
the actual registry to an injected adapter, records calls and mock results, returns
schema errors to the adapter, and bounds rounds and calls. A missing mock returns
an error rather than silently claiming that a write succeeded.

## Status and provenance

M4 acceptance is **pending**. Ten scenarios are present, but they are not ten
independent Cairn model incidents:

- One reconstructed recovery scenario comes from decision D65 in the owner's
  private master plan. The decision records two unauthorized `mcp__cairn__todos`
  calls on November 2. Neither raw call nor surrounding conversation is available.
- Two scenarios exercise create/update paths affected by public issue
  [#627](https://github.com/xiechimon/cairn/issues/627). The issue documents a
  missing discovery tool and unchecked model identifiers. It is code-path
  evidence, not a transcript of an actual guessed model identifier.
- Seven scenarios adapt documented T3 mistakes to existing Cairn chief tools.
  Every record identifies the external source, original case id, pinned commit,
  file digest, observed experience, and semantic adaptation. These are external
  incidents; they do not establish that Cairn made the same mistakes. Delegation
  cases that require the unsupported M3 surface are excluded.

The T3 source is pinned to commit
`8b44f42b14c8e273156474a924ccf29680dd7857`; the orchestration file SHA256 is
`166b6eeffaedb671fa3d49ee517ac5f74f5422d74c76bc6bd4db74cf89079037`.
Issue [#647](https://github.com/xiechimon/cairn/issues/647) records a real missing
runtime tool surface, and [#1307](https://github.com/xiechimon/cairn/issues/1307)
records real MCP contamination failures. They are not turned into tool-choice
cases: tool-call assertions alone cannot demonstrate that backend wiring or
context isolation is fixed.

## Run offline

From the repository root:

```sh
python3 -m unittest discover -s integration/eval/mcp-tool-use -p 'test_*.py'
pnpm --filter @xiechimon/cairn-cli exec tsx ../../integration/eval/mcp-tool-use/export-registry.mts /tmp/mcp-registry.json
python3 integration/eval/mcp-tool-use/replay.py --run /tmp/run.json --registry /tmp/mcp-registry.json --output /tmp/report.json
```

An input run is an object with `kind` (`fixture` or `metered`) and `traces`, keyed
by every case id exactly once. A trace is an ordered array of
`{"tool":"models","args":{},"result":[]}` calls. `error` marks unsuccessful
calls; they cannot satisfy required calls. Names are canonical chief tool names;
provider adapters must explicitly normalize MCP prefixes before recording them.
The registry exporter consumes the shared declaration, not a live MCP server's
registered tool list. It covers the chief surface, not M1 thread tools.

A metered run additionally requires `model`, `harness_sha` (40 hex characters),
`task_set_sha` (SHA256 of the exact case file), `run_id`, `executed_at`, and a
finite nonnegative `cost_usd`. The CLI verifies the case digest. These fields bind
an imported artifact; they do not authenticate its producer. The model relay must
write costs and identities itself. `metered` labels an imported run, not a proof
that this harness made an API call. The grader deliberately always reports
`model_improvement_evidence: false`: one artifact or hand-authored passing trace
cannot prove an improvement.

No paid runner is wired in this change. No API requests, spend, or before/after
model comparison have been performed. Metered paired runs must use the owner's
authorized runner and spend ledger, preserve model/prompt/tool-description versions
and raw responses, and compare the same case digest. Fixture red/green controls
prove the grader reacts to mistakes; they are never model improvement evidence.
