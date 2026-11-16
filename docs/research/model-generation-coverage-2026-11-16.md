# Model generation coverage

Every generation must describe a real model operation. An agent turn or context-window update cannot substitute for one. This investigation covers the observability sources designated by the research skill and the installed executor interfaces. The approved staged delivery instruments Claude Code and Pi while preserving ACP execution with documented gaps.

## Primary-source comparison

| Source | Observed behavior | Trade-off and implication |
| --- | --- | --- |
| [Langfuse native OTel integration](https://langfuse.com/integrations/native/opentelemetry) | Verified by reading: the OTLP endpoint ingests spans and maps GenAI attributes to observations. | The receiving system cannot invent executor data that was never exported. Keep the existing OTel SDK and redaction boundary. |
| [Langfuse v4.68.0 observation mapper](https://github.com/langfuse/langfuse/blob/v4.68.0/packages/shared/src/server/otel/ObservationTypeMapper.ts) | Verified by reading the deployed version's source: `gen_ai.operation.name=chat` maps to `GENERATION`; `invoke_agent` maps to `AGENT`. | Root-span presence proves orchestration coverage, not inference coverage. This is not a missing UI conversion of existing chat spans. |
| [OpenTelemetry GenAI spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md) | Verified by reading: spans describe logical operations observed by the caller and cover their execution interval, including automatic retries. Content is opt-in. | Do not label a multi-call prompt turn as one inference. Keep response identity, operation boundaries, and known versus unavailable usage distinct. |
| Installed `@anthropic-ai/claude-agent-sdk`, `SDKAssistantMessage` and `SDKPartialAssistantMessage` | Verified by reading `apps/daemon/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`: several assistant frames can share a message ID, each with one content block and non-final usage. Stream events include `message_start`, `message_delta`, and `message_stop`; `parent_tool_use_id` distinguishes subagents. | Per-frame generation counting duplicates calls and tokens. Session-level result usage is not per-request usage. SDK-visible messages do not contain the CLI's full model request. |
| [Claude Code monitoring](https://code.claude.com/docs/en/monitoring-usage#traces-beta) | Verified by reading and a real CLI 2.1.325 local probe: native `claude_code.llm_request` spans carry model, token/cache usage, request identity, timing, and error data. Raw request/response body events are separately opt-in and correlate by `request_body_id`. | A daemon-owned, sanitized capture retains the actual request rather than reconstructing it from chat history. Native interfaces require version/capability validation and preserve the prohibition on unsanitized direct export. |
| Installed `@earendil-works/pi-ai` 1.5.0 | Verified by reading `dist/utils/event-stream.{js,d.ts}`: each stream exposes a final `result()` containing the assistant message and usage. The final message is timed by the stream. | Instrument the model-call boundary, not only the session's visible `message_end`, to include compaction/auxiliary calls and avoid shared pending-input state. Validate which complete APIs dispatch through that stream. |
| Installed `@agentclientprotocol/sdk` 2.1.0, stable v1 | Verified by reading `dist/v1/schema/types.gen.d.ts`: `PromptResponse` exposes `stopReason` and extensible metadata. `UsageUpdate` exposes `used`, `size`, and optional cumulative cost. | There is no standard per-inference request, response, usage, or boundary event. Do not interpret context occupancy as input-token consumption. |
| [ACP session usage RFD](https://agentclientprotocol.com/rfds/session-usage) and installed unstable v1 schema | Verified by reading: usage updates deliberately cover session context and cost; unstable end-turn usage is optional and is not a per-inference stream. | Changing to the unstable SDK alone does not fulfill per-model-call observability. A native telemetry bridge or an adapter extension is necessary. |

## Coverage at the investigation base

Verified by reading the following local owners:

- `apps/server/src/coordinator/runtime/generation-telemetry.ts` observes the in-server runtime's `GenerationTask` requests and responses, not daemon-owned CLI sessions.
- `apps/server/src/coordinator/runtime/failure-report.ts` and `compaction.ts` have a separate summary-call exporter. The existing summary policy deliberately omits summary content; changing that policy needs an explicit decision rather than silently weakening it.
- `apps/daemon/src/backend/pi.ts` captures request messages in `runtime.streamSimple` but emits generation spans from the visible session `message_end` callback. Main-loop calls already have generation export. Auxiliary model calls must be checked at the stream boundary.
- `apps/daemon/src/backend/claude-code.ts` constructs `PiStepSpanSink` but calls only its tool methods. Neither SDK assistant frames nor streamed usage are sent to `chat()`. Direct CLI telemetry is disabled to keep unredacted content and exporter credentials out of subprocess exports.
- `apps/daemon/src/backend/acp.ts` has no equivalent generation sink and currently returns empty token usage. Neither Gemini ACP nor configured Claude/Codex ACP adapters expose hidden model operations through the stable ACP contract.
- `apps/daemon/src/machine-loop.ts` and `apps/daemon/src/orb/worker.ts` are both entry paths. A correction must work without a particular user's saved configuration and must preserve optional, disabled-by-default export.

## Approved decision: preserve execution with explicit coverage gaps

Inference from the verified interfaces: fulfilling the literal all-executors contract requires instrumentation inside opaque executors, not just a shared turn-end mapper. Keep all outbound export in Cairn and apply both exact credential redaction and shared secret patterns before bounded observation serialization.

Use Pi's real model-call boundary. For Claude Code, validate the supported native trace/body interface against the installed CLI before adopting it; a controlled local capture must not send raw data directly to Langfuse. For ACP, agree a versioned adapter telemetry capability, or explicitly scope support to adapters with validated native model telemetry. An uninstrumented arbitrary ACP command cannot be advertised as fully covered.

Do not silently replace missing per-call fields with the configured model, cumulative session usage, reconstructed full prompts, or zero token counts. Exporter failures must remain non-fatal and bounded. Whether an ACP adapter without the required capability remains executable with an explicit coverage gap or is rejected when full tracing is requested is an intended-behavior decision, not a parser fix.

The Coordinator approved option A: preserve execution, implement Claude Code first and close Pi gaps, document opaque ACP gaps without fabricated generations or execution rejection, and retain the existing summary-content privacy policy. A promise that every call contains input/output conflicts with that deliberate omission.

## Proposed implementation contract

Status: approved before implementation. Local validation used the real Claude CLI 2.1.325 and Agent SDK against a synthetic Anthropic SSE server: two native requests produced two sanitized generations with returned model, input/cache/output usage, and content. This is not evidence of production deployment.

Retain the existing no-summary-content policy unless the owner explicitly changes it. Export is optional for new installations and must require no particular user's provider settings. When export is configured, every observable inference has its own generation; missing executor capabilities remain a separately reported coverage gap, never fabricated model or usage fields.

| Entry or owner | Proposed responsibility | Failure behavior |
| --- | --- | --- |
| Machine loop and orb worker | Pass the existing step trace context to every backend on create and resume. | An absent telemetry context does not enable a subprocess exporter. |
| Pi `ModelRuntime.streamSimple` | Capture the request and final `result()` for the same call, with its actual interval, model and usage. Verify that complete/compaction dispatches use this boundary. Stop emitting duplicate chats from session events. | Record an actual failed call when supplied by the runtime. Never invent a successful completion from a turn-end event. |
| Claude Code backend | Receive native `claude_code.llm_request` spans and opt-in body logs at a per-session loopback HTTP endpoint. Correlate `request_id` and `request_body_id` despite reordered batches; deduplicate native span ids. Export only selected sanitized fields through Cairn's OTel SDK. | Missing, truncated or malformed bodies leave metadata-only generations; a missing native span produces no invented generation. Failure to open the capture endpoint preserves execution with direct export disabled. Older or managed-policy-overridden CLIs remain a coverage gap, not a reason to reject execution. |
| ACP backend and adapters | Retain existing execution behavior for Gemini ACP and configured Claude/Codex ACP commands. Stable ACP usage updates are not generation events. Future adapter-native telemetry needs a separately validated bridge. | No standard per-inference telemetry means no fabricated generation, model, usage, or prompt. Context occupancy is never billed as consumption. |
| Shared span sink | Accept input per call rather than one shared pending request. Bind each completed span to the step parent and apply exact-credential plus shared-pattern redaction before bounded serialization. | Export failures remain non-fatal. No exporter credentials or unsanitized bodies reach subprocess-controlled external endpoints. |
| In-server Coordinator and summary exporter | Preserve existing request/response generations and summary metadata-only policy. | Calls outside a step retain thread attribution; later turns must not acquire their spans. |

Per-call states are `started`, then `completed`, `failed` or `cancelled`. A request identifier owns its input, start time and eventual result. Different calls and subagents may overlap without consuming each other's input. Repeated terminal notifications cannot duplicate a generation or charge tokens twice. A session ending with an unobserved result must not turn cumulative session usage into a made-up final inference.

Acceptance checks include two calls around a tool continuation, multiple content blocks for one call, configured-versus-returned model differences, cache accounting, overlapping calls, subagents, create/resume/steer, failed and cancelled calls, compaction, exact and patterned secrets, disabled telemetry, and a failing collector. A production probe is valid only after the new head is merged and deployed: send one distinguishable Coordinator message, identify its step trace, then query Langfuse for actual `GENERATION` observations and inspect the returned model, usage and redacted content.

## Capture and privacy boundaries

The bridge is a thin parser for Claude's documented OTLP/JSON events, not a replacement exporter or trace SDK. Zod validates the envelope; Cairn's existing OTel SDK owns outbound transport and secret masking. Raw native logs are never forwarded or persisted by the bridge. Both signal-specific endpoints, protocols, compression and headers are pinned to the owned loopback collector in subprocess environment and SDK flag settings; inherited exporters cannot redirect the opt-in raw bodies. Managed policy still outranks flag settings and must be audited by the administrator.

The collector caps HTTP bodies at 8 MiB, native content at 2 MiB, pending correlation maps at 128 entries and deduplication at 4096 span ids. It closes with the session. Pending real spans can export metadata-only on close; abrupt process loss and bounded-buffer overflow remain best-effort telemetry gaps. External input/output uses the existing 32 KiB bounded serializer after exact credential and shared-pattern redaction. Summary/compaction/memory calls retain model, interval and usage but omit their input/output. Pi treats the installed summarization path's `cacheRetention: none` conservatively as metadata-only, including any other caller explicitly choosing that mode.

Pi records `streamSimple().result()` rather than visible `message_end`. The installed SDK dispatches `completeSimple` and session compaction/branch summaries through this boundary. A physical call owns its bounded input snapshot and start/end interval. Virtual routing wrappers are not additional model calls. The model APIs not used by Cairn's session path (`stream`, image generation and classification) are not advertised as covered.

This is staged coverage, not an all-executors guarantee. No new installation needs a particular user's provider or saved settings: export remains off without an OTel context and never determines whether an executor can run.
