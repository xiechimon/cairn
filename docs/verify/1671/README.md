# Reviewed image fallback delivery

## Scope and source

This delivery ports PR #1928's immutable source `750715d47820bf690fca7b14c422aa655e51abdc` onto main `90a7e74c654c323eb9fef58e0b4fc40ba31152c3`. The optional per-model input declaration, provider capability probes, bounded fresh text retry, negotiated Gemini image support and unread-image transcript notices remain the original feature scope. Parent #1671 stays open.

Main's local merge execution, remote-tools restrictions, compaction handling, network retry delays, iterator-exception recovery, completed-session cleanup, steer liveness checks and delivery acknowledgement remain intact. The server fixture isolation from the original PR is already present on main, so this port adds no server source or fixture changes.

## Failure modes

1. Declared text-only models must skip image downloads, retain an explicit text annotation and upload an unread-image system notice.
2. Unknown models must retain image delivery until a measured capability rejection; one fresh text retry must exclude the rejected session's image history.
3. Network recovery must not consume the image retry or erase useful progress already made by this step.
4. A lost continued session can reveal images in the rebuilt task prompt; those images must participate in the same capability and retry state as the actual session request.
5. The fresh retry after a lost session must retain the rebuilt task, rather than sending only the continuation instruction.
6. A text-only fresh session after a resume miss must still upload the skipped-image notice.
7. Unrelated errors, quota/capacity, timeout and cancellation must not initiate text fallback. Useful progress prevents fresh image fallback.
8. Steering must reuse the capability decision, retain its notice in live relay and final upload, reject ended sessions and acknowledge only delivered content.
9. Gemini image delivery must follow its actual ACP handshake, including pixels sent during steering; learned rejection overrides earlier advertised support.
10. Provider input declarations must survive the shared schema and generated `models.json` without discarding existing main schema fields.

## Reproduction and results

The original feature tests were applied before implementation. `reviewed-port-before.log` records 34 failures and 87 passing tests against main, including image downloads that should have been skipped, missing text retry and missing transcript notices.

The initial reconciled port passed 277 tests. Three additional integration regressions were written before their fixes. `reviewed-integration-before.log` records both the lost-session retry omission and the unwanted fresh restart after progress followed by network recovery. `reviewed-resume-notice-before.log` records the missing system notice when the resumed instruction had no images but the rebuilt task did.

The runner now tracks the active unannotated prompt and its actual resolved images when rebuilding a missing session. A separate cumulative progress guard survives the per-attempt retry resets. Rebuilt text-only task images emit the same system notice as initial text-only inputs.

`reviewed-related-green.log` records 21 passing files and 409 passing tests after the final source changes. These cover ACP, image support, steering, materialized provider configuration, runner image/recovery/network/stop/error/timeout/local execution, Pi compaction, both server fixture suites and shared schema snapshots. The generated `models.json`, final machine API transcripts and shared wire snapshots are inspected by these tests. The branch-switch messages in the log belong to isolated test repositories.

`reviewed-lint.log`, `reviewed-typecheck.log` and `reviewed-spec-parse.log` pass. Lint reports one existing informational `useFlatMap` diagnostic in `apps/server/test/feishu-config.test.ts`; no lint error or warning was introduced. Spec collection found 1,368 web cases in 192 files and parsed 50 integration test files. `reviewed-source-hashes.json` binds the tested source and test files to SHA-256 hashes. Node is 24.14.0; dependencies were installed offline with a frozen lockfile and scripts disabled. Husky was initialized explicitly.

## Review and simplification

The author reviewed the source diff against the captured main revision for security, correctness, state lifetime, retry interactions and seam discipline. Three recovery-state defects were corrected with the negative controls above. No listed mandatory security-review path is changed. All external provider APIs remain behind the backend seam. The input-declaration helper with one caller was inlined, and the duplicate annotation rendering branch was removed. This author review does not replace independent review of the final commit.

## Remaining acceptance

No real provider was called and no browser task-card demonstration was recorded for this checkpoint. The coordinating lane owns that evidence before delivery acceptance. Scripted provider responses and API transcript assertions do not prove the deployed card displays the notice or a real provider completes the text-only retry.

Automatic routing to a different vision model remains outside this delivery. An unknown model first receiving an image through steering after useful progress may reject it asynchronously; this delivery preserves the progress guard and does not restart the whole step for that unresolved case. Parent #1671 and its original acceptance remain open.

## Commit-message verification

The initial checkpoint body contained escaped newline characters from a shell-quoted argument. The message was rewritten through a UTF-8 file and amended through normal hooks. This check rejects that initial raw message and verifies the final message against the file passed to Git:

```python
from pathlib import Path
import subprocess
raw = subprocess.check_output(['git', 'log', '-1', '--format=%B'], text=True)
assert chr(92) + 'n' not in raw
assert raw.rstrip('\n') == Path('/tmp/1928-message.txt').read_text().rstrip('\n')
```
