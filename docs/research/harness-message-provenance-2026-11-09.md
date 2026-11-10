# Harness message provenance: source inspection and browser walk

Started: 2026-11-09. Browser walk: 2026-11-10 UTC. Scope: preserving a user's message, quoted context, image attachments, and subsequent assistant replies when work moves from a coordinator conversation into an execution harness.

## Evidence boundary

Measured means read or executed during this investigation. Distinguish measured UI behavior from source inspection. Inferred means derived from those observations. The initial missing-browser finding was superseded: the installed Claude CLI exposes a Chrome MCP server, which was connected to the owner's already selected Mac Chrome. Claude, Amp, Cursor, and t3code were opened there. Only the behavioral scope below was exercised; this is not a complete product audit or a visual design reference.

The selected designated-source row is Chat / agent product UX. Every designated source is accounted for below. Do not describe a thumbnail or a plausible model answer as an inspected provider request.

## Source comparison

| Source | Measured material and behavior | Trade-off or limit | Product walk |
| --- | --- | --- | --- |
| [claude.ai](https://claude.ai/) | Measured UI: an uploaded test image remains on its original user message; the assistant answers below it. Selecting assistant text exposes Reply. Reply stages a removable Quote block; sending retains that quote above the new user text. Reload restores all four messages. The original image opens again in a preview. | The original image is not duplicated into the follow-up. Its continued presence depends on preserving the source conversation. Provider request contents and cross-harness transfer were not inspected. | Completed for image upload, answer, selection reply, sent quote, reload, and restored image preview. |
| [Claude desktop Code tab](https://claude.com/product/claude-code) | No measured desktop Code behavior. | Browser access does not grant control of the native desktop app. Do not substitute the web Code tab for this designated source. | Uncovered: native desktop control was not available in this session. |
| [t3code](https://github.com/pingdotgg/t3code/tree/16a6c1c41fc608015d8ea129d7d270c488b7893d) and [web app](https://app.t3.codes/) | Measured UI: the app shows No computer connected and no projects. GitHub sign-in was attempted, but returning to the app still showed Sign in. Measured source: the user-message row reads structured attachments and context references; the provider prompt builder lists attachment paths or explicitly reports unresolved attachments. | Context references in code do not establish historical message quoting. Source alone does not prove runtime delivery. | Blocked: usable authenticated app and connected runtime were not established. No chat-layout recommendation relies on it. |
| [Cursor documentation](https://cursor.com/docs/agent/overview) and [web app](https://cursor.com/agents) | Measured UI: a new draft accepts an image and text separately, exposes image preview/removal, and requires a repository. A test submission was blocked before the cloud agent started; the account-specific state is omitted from this public record. | Only draft composition and the explicit launch failure were observed. Do not infer sent history, quoting, or reload behavior. | Partial: no successful agent turn was verified. |
| [Amp manual](https://ampcode.com/manual) and [web app](https://ampcode.com/) | Measured UI: the new-thread composer has an Attachments region separate from prompt text. A private test thread in a sandbox project preserved the submitted image on the user message, showed startup status, and appended the agent's successful image-based answer as a separate message. Reload restored the prompt, answer, and loaded image with its original 1470 by 667 dimensions. | A screenshot of a quoted conversation was used as the image fixture. This does not by itself demonstrate Amp's native quote behavior. Provider input was not inspected. | Completed for image submission, assistant answer, and restored history; native quoting remains uncovered. |
| Cairn candidate, derived from the user's requested behavior | Inferred, proposed contract: retain the user's submitted message, its referenced message, and its attachments across dispatch, then append execution replies. | Requires an explicit scope for inherited context and attachment authorization. This proposal is not an observed competitor behavior. | Live incident investigation belongs to the coordinator's separate evidence. |

The t3code source observations come from [TimelineUserMessageRow.tsx](https://github.com/pingdotgg/t3code/blob/16a6c1c41fc608015d8ea129d7d270c488b7893d/apps/web/src/components/chat/TimelineUserMessageRow.tsx) and [attachmentPrompt.ts](https://github.com/pingdotgg/t3code/blob/16a6c1c41fc608015d8ea129d7d270c488b7893d/packages/provider-core/src/server/attachmentPrompt.ts). They were read from GitHub during this investigation; they are implementation observations, not UI acceptance evidence.

## Project recommendation to investigate

Inferred from the requested behavior and the Claude walk: make the submitted message and its provenance reviewable in the harness. Preserve the earlier user message that owns the image, the quoted assistant response, and the owner's subsequent dispatch instruction as distinct, attributed messages. The dispatch instruction did not itself contain the original image. Its relevant source context must be resolved explicitly. Append execution replies after the inherited context. Internal provenance markers must not become the visible title or message text.

Inferred: a complete record of the material actually handed to the harness is preferable to silently copying an entire coordinator conversation. The latter can imply that the execution model received context it never received. If an image cannot be authorized, downloaded, or accepted by the provider, retain its visible place in history and expose the actual delivery failure.

Measured incident: the stored quote source referred to an assistant acknowledgment, not an attachment. Task creation cited only the later owner instruction. Both attachment grant lists were empty. The first persisted execution user message contained two reply markers and no attachment token or delivered-image anchor. The task title and issue title were the marker itself. This establishes missing image context at dispatch startup, not a claim about everything the agent could retrieve later.

Measured source chain: `packages/shared/src/reply-quote.ts` encodes the selected message ID and quote into text. `apps/server/src/services/coordinator-request.ts` copies cited owner message text into request segments and derives grants from those segments. `packages/shared/src/task-meta.ts` takes the first nonempty non-attachment line as a placeholder title. `packages/shared/src/records/prompts.ts` combines the title and request text. `apps/daemon/src/runner.ts` resolves attachment tokens before passing text and images to the backend. These observations were checked against the running checkout, not just the older working checkout.

Before implementation, make an anonymized reproduction with three messages: original user image, assistant acknowledgment, and an owner reply quoting that acknowledgment. Assert failure on the old path for visible marker leakage, a marker-derived title, missing inherited attachment grants, and missing image input. Verify visible history separately from actual provider delivery. Do not inherit unrelated neighboring requests merely because they are recent.

## Browser evidence

Measured evidence is stored privately in `/tmp/cairn-harness-walk-20261109/`. Do not commit the raw browser logs: account pages and unrelated sidebar items can contain personal information.

- `claude-answer-with-image-1.jpg`: original submitted image, user text, and first answer.
- `selection-and-t3-screens-2.jpg`: selected assistant text with the Reply action.
- `claude-quote-draft-3.jpg`: the staged Quote block.
- `claude-restored-quote-final-2.jpg`: quote, follow-up text, and answer after reload.
- `restored-image-preview-t3-account-3.jpg`: original image reopened after reload; DOM readback confirmed loaded image dimensions of 1470 by 723.
- `amp-answer-screenshot-cursor-runtime-2.jpg`: submitted image, startup status, owner text, and agent answer.
- `amp-restored-history-final-2.jpg`: that thread restored after reload; separate DOM readback confirmed the test image was loaded at its original dimensions.
- `cursor-amp-attachment-drafts-4.jpg` and `cursor-amp-attachment-drafts-8.jpg`: separate image and text in the two draft composers.
- `amp-comment-entry-cursor-limit-3.jpg`: Cursor's blocked launch state; keep this account-specific capture private.

The Chrome action recording captured 32 frames and was exported privately to the Mac's downloads as `cairn-harness-message-reference-walk.gif`. This was not a 60 fps interaction-feel measurement; do not use it to make animation, timing, or pixel-style claims.

Measured cleanup limit: the browser service confirmed closing the Claude test tab with three tabs remaining, then reported no MCP tab group. A fresh context read also found no group. The remaining three created reference tabs could not be confirmed closed; do not claim all tabs were cleaned up.

## Remaining acceptance work

For uncovered competitor states, retain the limits in the comparison rather than describing the whole survey as complete. For Cairn implementation, verify the original user message, quoted source, attachment authorization and downloaded bytes, provider input, visible execution history, reload restoration, and attachment failure state as separate observations. Showing a thumbnail alone does not prove provider delivery; a provider path alone does not prove a faithful visible history. This investigation changed no product code.
