# Image input fallback verification

This change completes the text fallback implementation recovered from `cairn/1671-wip`. It does not select a different vision model.

## Failure cases

An explicitly text-only model must receive annotated text without downloading images. An unknown model may receive images, but a model capability rejection must cause at most one fresh text-only attempt. Unrelated request errors, quota errors, user cancellation, and failures after useful progress must not trigger this fallback. Image steering must reuse the capability decision even when the initial task contains no images. A fresh attempt must exclude the rejected session's image history.

The runner persists a system transcript row containing the unread-image notice. Existing task transcript rendering displays that row. The test captures the final transcript uploaded through the machine API.

Gemini capability starts unknown and follows the ACP initialize response. Vision-capable sessions receive image blocks in both initial prompts and steering. A text-only session reports an explicit capability rejection; the runner can then make its bounded text-only attempt. The daemon refreshes the capability after opening a session, and unread steered images produce a system transcript row through both live relay and final upload.

## Reproduction

The recovered implementation's tests passed before the follow-up changes: eight files, 254 tests. New follow-up tests then exposed four failures, recorded in [followup-before.txt](followup-before.txt): synchronous session rejection, image rejection after a network retry, missing capability state for later steering, and the Claude Code learned capability cache.

Independent review exposed session history retention and a thrown event-iterator rejection. [session-history-before.txt](session-history-before.txt) records three failures. [session-history-after.txt](session-history-after.txt) records the same runner suite passing after correction.

[acp-before.txt](acp-before.txt) records four failures for negotiated capability, image steering, and the ACP rejection signal. [steer-capability-before.txt](steer-capability-before.txt) records two failures for late capability and the user-visible transcript notice. [acp-after.txt](acp-after.txt) records all five relevant suites passing after correction.

[steer-buffer-before.txt](steer-buffer-before.txt) records two final-upload failures caused by separate cached transcript writers. The machine loop now writes through the runner's existing buffer. The final-upload assertion is included in the passing [acp-after.txt](acp-after.txt) run.

[acp-cache-before.txt](acp-cache-before.txt) records a negotiated vision-capable session ignoring a later model rejection. The existing learned-capability cache now takes precedence over the handshake, and the same case passes in [acp-after.txt](acp-after.txt).

Two existing server test fixtures now use an injected empty GitHub response unless their case supplies its own fetch function. This keeps their claim and report checks independent of public GitHub traffic. [network-fixture-after.txt](network-fixture-after.txt) records both fixture suites passing.

Run the complete affected set:

```sh
pnpm exec vitest run apps/daemon/test/image-support.test.ts apps/daemon/test/runner-image-degrade.test.ts apps/daemon/test/step-attachments.test.ts apps/daemon/test/machine-steer.test.ts apps/daemon/test/pi-config-effect.test.ts packages/shared/test/task-failure.test.ts packages/shared/test/records.test.ts packages/shared/test/snapshot.test.ts
```

[followup-after.txt](followup-after.txt) contains the actual result. The provider configuration tests read the generated `models.json` from disk; the shared suite checks the wire schema snapshot. The runner tests exercise machine API transcript upload and final step status.

## Limits

No real provider or relay credential is available in this cloud environment. These runs use scripted model responses and real runner execution. They do not prove that a deployed model can describe image content. Automatic vision-model selection and its real-model acceptance remain separate work under issue #1671.

If an unknown custom model first receives an image through steering after useful work has already started, an asynchronous provider rejection does not restart the entire step. The progress guard preserves the existing session's work. This change does not claim to cover that unresolved case.

A browser demonstration of the notice in a real task card has not been recorded in this evidence directory. The server transcript payload is covered, but that user-facing acceptance remains unverified here.
