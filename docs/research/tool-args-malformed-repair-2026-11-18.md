# Malformed tool-call arguments: repair vs constrain (prior art)

Scope: an LLM emits a tool call whose `arguments` text is not valid JSON (the
observed case: an unquoted bare string value — `"research": 先读 t3-code...` —
inside the args object). Decide between (a) local JSON repair inside the
harness, (b) schema/prompt hardening, (c) provider-side constrained output, or a
combination. Trigger: `deepseek-v4.1-flash` (via the `workbuddy`
OpenAI-compatible completions endpoint) failed the harness's error-feedback
retry twice in one user turn, ~73 s of extra model calls.

Evidence classes: **verified** = read or ran first-hand this session (repo files,
installed `dist`, or primary docs/PRs). **inferred** = deduced from verified evidence,
re-checkable. **unverified** = unverified.

## How cairn handles it today (verified, installed `@earendil-works/*` 1.5.0)

Parse → validate → feed-error-back, all inside locked deps:

1. **Parse.** `@earendil-works/pi-ai/dist/utils/json-parse.js`
   `parseToolCallArguments(json)` runs a **narrow** `repairJson`: escapes raw
   control characters and doubles bad backslashes **inside string literals
   only**. If the result still isn't a JSON object it returns
   `{ arguments: {}, argumentsError }`, where `argumentsError` embeds the raw
   text (`"...\n\nReceived arguments:\n<raw>"`). An unquoted CJK value like
   `"research": 先读...` is **not** repaired — `repairJson` only edits inside
   `"..."` literals.
2. **Validate.** `pi-ai/dist/utils/validation.js` `validateToolArguments`
   throws `Invalid arguments for tool "<name>": <argumentsError>` before
   touching the JSON Schema.
3. **Feed back.** `pi-durable/dist/harness/tool.js` catches that error into
   `invalid_arguments`; the error becomes the tool result the model reads on
   the **next** request — one extra model round-trip per malformed call. This
   is the ~73 s the incident paid.

Seams cairn can actually wrap (verified):

- **`GenerationTask.afterResponse` extension hook — the only working seam.**
  `pi-durable/dist/harness/generation.js` runs `afterResponse` hooks **before**
  `startToolRound` dispatches calls, on the same mutable `message` object.
  `createCutOffRecovery`
  (`apps/server/src/coordinator/runtime/cut-off-recovery.ts:23-37`) already
  mutates `message.content` there (strips `toolCall` blocks on `length` stop) —
  the established precedent. A repair hook finds `toolCall` blocks carrying
  `argumentsError`, re-parses the embedded raw text, sets `call.arguments`, and
  deletes `call.argumentsError` — validation then proceeds normally and no
  extra round-trip happens.
- `tool.prepareArguments` **cannot** rescue this failure class: it receives
  `call.arguments` (= `{}` after parse failure), and `validate` re-checks
  `call.argumentsError`, which survives the `{...call, arguments}` spread.
  Same for the `beforeTool` hook — a second `validate` after hooks re-checks
  `call.argumentsError`.
- Daemon path (`apps/daemon`, `pi-coding-agent` bundle): the same
  parse→validate→reject order applies; the `tool_call` extension event also
  fires only after validation. The repair point there would be a `message_end`
  extension handler mutating the assistant message's `toolCall` blocks —
  inferred, needs a verification test.
- Provider-side strict plumbing **already exists in the SDK**: `Tool` has
  `constrainedSampling?: false | {type:"json_schema",strict:"prefer"|"require"}
  | {type:"grammar",variants}`; `openai-completions.js` emits `strict:` when
  `compat.supportsStrictMode !== false`. Default for a generic
  OpenAI-compatible endpoint is `supportsStrictMode: false`. `pi-durable`
  itself sets `constrainedSampling: {type:"grammar"}` on its codemode tool.
  **But** cairn's `ProviderCompat`
  (`packages/shared/src/records/provider.ts`) only exposes
  `supportsDeveloperRole`/`maxTokensField`/`supportsStore` — the flags are not
  wired into cairn config yet. `stepProvider` already forwards `config.compat`
  onto the model (`apps/server/src/coordinator/runtime/provider.ts`).

## Source comparison

| Source | How it handles malformed / guarantees valid tool args | Trade-offs | Link |
|---|---|---|---|
| OpenAI function calling | `strict: true` per function tool → Structured Outputs (constrained decoding) guarantees args match the schema. Requires `additionalProperties:false` and all fields `required`; nonconforming schemas rejected up front. (verified) | Best guarantee; strict-schema subset limits; only on OpenAI (and compatibles that implement it) | https://developers.openai.com/api/docs/guides/function-calling |
| Anthropic tool use | Server-side buffering + validation by default; `strict` tool use guarantees `input` follows `input_schema`. Opt-out `eager_input_streaming` yields possibly-invalid JSON — docs say validate and return unparseable input as feedback. (verified) | Default path prevents malformed args reaching the client; strict mode has limits (~20 strict tools) | https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use |
| Google Gemini | `functionCallingConfig.mode`: `AUTO`/`ANY`/`NONE`/`VALIDATED` — constrained decoding for calls. (verified) | Server-side schema adherence; state-machine complexity limits | https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling |
| xAI (Grok) | Tool-call args "strictly conform to the tool's input JSON Schema" — implicit `strict`. (verified docs) | Service claim, not verified by us | https://docs.x.ai/developers/tools/function-calling |
| DeepSeek | `strict` mode is a **beta**: requires `https://api.deepseek.com/beta` and `strict:true` on every function. JSON Output mode constrains message content only, not tool args. (verified) | Endpoint-gated, all-or-nothing, beta; whether `workbuddy` passes `strict` through is unverified — needs a live probe | https://api-docs.deepseek.com/guides/tool_calls.md |
| vLLM-class gateways | `structured_outputs` extra params (`json`/`regex`/`grammar`/`structural_tag`); request-opt-in. (verified docs) | May exist behind nonstandard params if workbuddy fronts an open-weight model; unverified | https://docs.vllm.ai/en/stable/features/structured_outputs/ |
| Vercel AI SDK | `repairToolCall`/`experimental_repairToolCall`: a harness seam to fix args without an extra round-trip; default stays error-feedback retry. (verified) | Same trade-off: "without additional steps that pollute the message history" | https://ai-sdk.dev/docs/reference/ai-sdk-core/repair-tool-call |
| OpenCode | Merged PR #45002: repair malformed tool args **before** schema validation (stringified objects, coercion, scalar→array, unknown-field removal); never edits already-valid input. Also treats `finishReason:"length"` truncation with an actionable message. (verified PRs) | Closest shipped precedent: repair-before-validation with validation kept as boundary | https://github.com/anomalyco/opencode/pull/45002 |
| Pydantic AI | First-party `RepairToolArguments`: runs json-repair in `before_tool_validate`, before schema validation; repaired args written back into history, original kept in `provider_details`. (verified) | Same architecture; writes back so transcripts stay honest | https://pydantic.dev/docs/ai/harness/repair-tool-arguments/ |
| Claude Code | PreToolUse hooks can rewrite an already-parsed tool input; no public docs on malformed-args repair (API-side validation covers it). (verified docs) | n/a | https://code.claude.com/docs/en/hooks |
| Cursor | Forum: identical bug class (`['network']` single quotes → invalid JSON) answered "known issue, no fix timeline". (verified) | Confirms the class ships in competitors | https://forum.cursor.com/t/command-failed-to-spawn-unexpected-token/151773 |
| MCP spec | `tools/call` args are a plain JSON object; server MUST validate against `inputSchema`; malformed → protocol error, schema-valid-but-invalid → tool result `isError:true`. (verified) | Confirms the layering cairn already uses | https://modelcontextprotocol.io/specification/2026-07-28/server/tools |
| `jsonrepair` npm lib (josdejong) | Broad heuristic repair: unquoted keys/values, single quotes, trailing commas, truncation, comments, code fences. (verified README) | **verified cairn 2026-11-18: fails on the incident input — an unquoted value containing `/` (`（1. / 2.）`) throws "Object key expected"; bare values without `/` repair fine** | https://github.com/josdejong/jsonrepair |
| cairn/pi-ai status quo | `repairJson` = control chars + bad backslashes inside strings only; everything else → `argumentsError` → `invalid_arguments` → model retry. (verified) | Pays a full round-trip per failure; misses the common LLM classes (unquoted values, slashes, single quotes, truncation) | repo files above |

## Which pattern fits cairn

**(a) a small local repair at the harness seam is the direct fix; (c)
provider-side strict output wherever the endpoint supports it; (b) prompt
hygiene stays as cheap prevention, never the mechanism.**

- **(a) Local repair before validation.** Every serious coding-agent harness
  converged here: OpenCode merged repair-before-validation (#45002), Pydantic
  AI ships `RepairToolArguments`, the AI SDK exposes `repairToolCall` to avoid
  the extra round-trip. Cairn's working seam is a `GenerationTask`
  `afterResponse` extension hook — the same mechanism `createCutOffRecovery`
  already uses. The hook: find `toolCall` blocks with `argumentsError`,
  extract the raw text after `"Received arguments:\n"`, repair, on success
  assign `call.arguments` and delete `call.argumentsError`; schema validation
  still runs afterward (repaired-but-wrong args get the existing validation
  error). On failure leave `argumentsError` untouched → today's behavior.
  Record repairs for telemetry/eval honesty.
- **Repairer choice (corrected by live testing, 2026-11-18):** `jsonrepair`
  fails on the incident class — an unquoted value containing `/` ("Object key
  expected"). A narrow in-house pass for the observed classes — quoting bare
  string values (including `/`-containing CJK prose), single→double quotes,
  trailing commas — handles what we measured; `jsonrepair` can sit behind it
  as stage two for the long tail, at the cost of a new dependency.
- **(c) Provider-side strict — opportunistic.** DeepSeek supports strict tools
  only on `api.deepseek.com/beta`; whether `workbuddy` honors `strict` is
  unverified — needs a live probe. Wiring exists: extend
  `providerCompatSchema` with `supportsStrictMode`, set
  `constrainedSampling: {type:'json_schema', strict:'prefer'}` on coordinator
  tool registrations.
- **(b) Schema/prompt hardening can't fix this class.** The observed failure
  was a weak model emitting unquoted CJK prose — a generation defect no schema
  text prevents. It lowers the rate, never guarantees.
- Not recommended: model-in-the-loop repair — reintroduces the latency being
  removed.

## Concrete recommendation

1. New `afterResponse` hook in a small extension
   `apps/server/src/coordinator/runtime/tool-args-repair.ts`, registered in
   `coordinatorToolsExtension`'s `hooks` (`runtime/tools.ts`), sibling to
   `cut-off-recovery.ts`.
2. Narrow in-house repair for observed classes; keep `validateToolArguments`
   as the boundary after repair. Keep the original error text on the block
   under a marker field for audit (Pydantic AI precedent).
3. Daemon path (`apps/daemon`): same repair via `message_end` handler —
   separate seam, separate ticket if wanted.
4. Optional: probe `workbuddy` strict support live, then wire
   `supportsStrictMode` through `providerCompatSchema` and set
   `constrainedSampling` on tool defs.
5. Bound the feedback loop: cap `invalid_arguments` retries per turn so a
   repeated failure surfaces instead of paying repeated round-trips.

Tests to write red-first: assistant message with the incident's
`{"research": 先读 t3-code 的输入框实现，看它怎么让有序列表标记（1. / 2.）…}`
payload → after the hook, `arguments` parses and `argumentsError` is cleared;
unrepairable payload keeps `invalid_arguments`; repaired args still run
through schema validation.

## Not verified (blocked / follow-ups)

- `workbuddy` strict-tool support: needs a live HTTP probe.
- Daemon `message_end` mutation propagating into the agent loop's toolCall:
  inferred — needs one test.
- Devin docs: nothing public found on tool-arg validation.
