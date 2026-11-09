# Coordinator image input (#3625)

## 1. Reproduce

Run the targeted `coordinator/image-attachments.test.ts` suite. It uploads a PNG through the real Hono handlers, submits the owner's attachment reference, runs the Coordinator attachment tool, and replays that turn's captured context through each production provider serializer. The injected HTTP transport reads the serialized request body and returns a deterministic 400; it never contacts a model service.

On main, all four image assertions fail. Responses requests contain `(tool image omitted: model does not support images)` instead of `input_image`.

## 2. Root cause

`runtime/provider.ts` replaces absent model input metadata with `['text']`. Installed pi-ai 1.5.0 `api/transform-messages.js` treats that as an explicit instruction to replace both user and tool images with text placeholders. The previous faux-provider tests stop before this conversion and therefore pass despite the defect.

Installed OpenAI 7.19.0 `ResponseFunctionToolCallOutputItem.output` accepts `string | Array<ResponseInputText | ResponseInputImage | ResponseInputFile>`. The [official Responses reference](https://developers.openai.com/api/reference/typescript/resources/responses) likewise lists images in function-call output. Installed pi-ai already emits those image parts for both Responses transports; a synthetic user message is unnecessary.

## 3. Single path

Keep upload authorization, attachment lookup, image processing, transcript storage and provider serialization on the existing path. Replace the text-only fallback with `['text', 'image']`. This permits the remote provider to validate image capability when metadata is unknown. Explicit input metadata remains authoritative, including explicit text-only models. Text-only requests contain no added image parts.

| Decision | Reason | Reversal |
| --- | --- | --- |
| Permit image serialization when input metadata is absent | Missing metadata is not evidence that a model cannot see; silently stripping bytes hides the real request from the provider | Revert the fallback change |
| Retain attachment delivery | The installed serializers already support it; owner-turn inlining would separately require history, steering and recovery design | A future reviewed inline-delivery change must replace this path |

## 4. Readers, writers and failures

| Path | Expected behavior | Verification |
| --- | --- | --- |
| Owner upload and message submission | Stored token-key reference resolves to the authorized PNG | Real upload and conversation handlers in image-attachments suite |
| Coordinator attachment tool | Validated image survives as image content in the captured turn | Same suite and existing tools suite |
| Step/provider registration and replacement | Missing input metadata permits images; explicit input arrays survive | provider suite; both registration methods call stepProvider |
| Codex subscription and ordinary Responses | Function output contains input_image with the original PNG data URL | Both actual serialized request assertions |
| Anthropic | Tool result contains a base64 image source | Actual serialized request assertion |
| Chat Completions | SDK places image_url content in its following user message | Actual serialized request assertion |
| Corrupt, unsupported or oversized images; accumulated limits | Existing prepare/bound behavior remains authoritative | Existing targeted tools suite |
| Provider rejects an image | Existing provider error handling reports failure; no new retry, mode or fallback | Transport fixture returns 400; no production failure mechanism changes |

No persisted schema, wire protocol, lifecycle or concurrency changes are introduced.

## 5. Evidence and limits

The negative control uses the exact main version of `runtime/provider.ts`, with no fixture or SDK mutation. Four actual HTTP payload assertions fail there, then pass with the fallback corrected. The tests mock model decisions and HTTP responses; they do not establish real-model visual accuracy. No live-instance write is part of this work. After deployment, the owner repeats the blue-circle/red-square/text recognition test.

## 6. Delivery

Issue: [#3625](https://github.com/xiechimon/cairn/issues/3625). The PR links this design and records its own number in its delivery section. Implementation and verification use this Codex session; required review is the head-bound Codex cloud review in a fresh context. Run targeted Vitest with `--maxWorkers=4`, then lint, typecheck, spec parsing and prepush. Keep real-provider and owner live verification listed as uncovered until the owner runs them.
