# Harness confinement implementation plan

Date: 2026-11-09
Status: awaiting Coordinator review of the new pi child-process protocol; no implementation or PR

## Scope and authoritative source

Segment 1 only, tracking existing issue #3436. The host-local research revision 2 was read completely at the path supplied in the task. Its segment-1 policy is the baseline. The explicit task overrides its all-segments-in-one-change requirement. The user permits faithful English translation where repository language rules prevent unchanged copying. Preserve the translated source at `docs/research/user-computer-model-2026-11-08.md` in the implementation PR, identifying its provenance and translation; do not change the local original. No driver, orb, noVNC, lockfile, eval-ruler or live configuration changes.

## Overlap

1. Open issues: #3436 is this task; reuse it. #3437 and #3438 are sibling segments, not duplicate implementations. #3448 is unrelated feature design.
2. Open same-purpose PRs: none returned by the two successful overlap queries.
3. Recent matches: #3099 concerns the in-server Coordinator; #2569 changes Claude permission options; #2730 concerns pi web tools; #3383 concerns relay errors. Preserve these behaviors. #2729 is an unrelated eval-ruler match and must not be modified.
4. Open PRs touching the queried files: none. Queried paths: backend/confine.ts, backend/pi.ts, backend/acp.ts, backend/claude-code.ts, cli.ts and the research destination. No overlapping head branch was returned. Proceed only after protocol design review; recheck overlap when the file list grows and before opening a PR.

## Proposed implementation

Keep all harness and SDK integration inside `apps/daemon/src/backend/`, as required by the fully read `biome.json` seam rules. One mandatory `confine.ts` launcher constructs bwrap arguments or Seatbelt policy. Unsupported platforms, invalid paths, unavailable isolation and launch errors fail closed. No raw-spawn fallback. Apply it to every Claude SDK launch, including the no-token-FD path, every ACP launch, and the new pi child. Preserve credential FD delivery without logging values. Disable inner harness sandboxes and require Codex full-access configuration before prompting, on new and resumed sessions.

Resolve writable paths and denied paths before launch. Protect git common-dir hooks/config after binding metadata. Handle absent denied paths without creating host secrets or reopening parent paths. Explicitly test the task worktree and pi state directory nested beneath the denied daemon home. Do not broadly rebind that home. Retain network and GPU access without changing the specified boundary.

## New pi protocol and lifecycle

States: idle -> starting -> ready -> running -> stopping -> closed; startup, protocol or child failure transitions to failed and tears down outstanding requests. No session events are accepted after closure.

The parent sends validated JSONL requests with correlation IDs for session creation/continuation, prompting, steering, stopping and capability queries. The child owns the current pi session implementation and filesystem tools. It emits session identity, ordered StepEvents, usage and correlated replies. Nonserializable parent tool callbacks require an explicitly validated request/reply bridge; never serialize executable code. Keep protocol output separate from diagnostics and redact errors.

Reader/writer paths and required tests:

| Path | Required behavior/test |
| --- | --- |
| Create/continue | Ready only after child initialization; preserve resume identity; failed startup launches no session |
| Event stream/usage | Preserve ordering and usage; reject malformed, oversized or unknown messages |
| Tool callback/approval | Correlate request and response; unknown IDs fail; no direct parent filesystem-tool escape |
| Steer | Route to the owning live session; reject after stop |
| Stop/abort | Stop delivery, cancel callbacks and terminate descendants; idempotent cleanup |
| Child exit/EOF/error | Fail outstanding requests and close event readers; never report success |
| Parent exit | Terminate the entire confined process tree |

This new wire/lifecycle protocol requires Coordinator design review under repository rules before behavior changes.

## Failure-first checks and evidence

Write policy golden tests for all three profiles and both platforms, recording-spawner seam tests including all SDK/default/resume entry paths, the structural child_process-import test, and startup/IPC failure tests before production edits. Add the specified filesystem, network, devices and process probes plus all three real-harness fake-model E2Es. Never change the eval ruler.

On omarchy, run the actual launcher and record GPU visibility, denied home writes and secret reads, pnpm install with scripts disabled, and tests inside the sandbox. Run related tests, lint, typecheck, spec:parse and prepush; CI and cloud review must pass the pushed head. Use the verified App commit path and keep coordinator-hold where required. Do not self-merge or remove holds.

## Unresolved acceptance boundary

The prescribed macOS Seatbelt policy restricts file access but does not specify PID isolation, whereas probe 4 asks for daemon PID invisibility on both platforms. Linux explicitly uses a PID namespace. Do not claim macOS passes, remove its assertion or weaken another boundary to obtain a pass. Coordinator review must resolve the acceptance interpretation before implementation. No macOS runtime evidence has been collected.

## Actual evidence so far

Source and seam rules read; both GitHub overlap commands succeeded. The host identifies as omarchy and `/usr/bin/bwrap` exists. These facts are not sandbox probe results. No production edits, tests, package install, GPU/home-write probe, commit, push, PR, CI or review has been performed.
