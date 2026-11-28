# Open files named in messages — plan, 2026-11-28

## User scenario

A new Cairn user sees `report.md` in an agent reply. Click it to read the current contents without finding the computer or its workspace. No new settings, accounts, copies, or user action besides clicking. Today the transcript loses execution provenance ([research](../research/task-file-links-2026-11-28.md)).

## Scope

1. Stable assistant text rows record their producing step and runner; never infer either from a filename. Runner-driven steps use their prepared cwd. A server-native Coordinator may automatically select a managed, step-specific cwd for file deliverables through its existing own-computer shell; existing implicit/explicit cwd and attachments remain unchanged. Multiple calls use the same step directory; if bindings conflict, do not link. An absolute path from any other tool is not a fallback.
2. Task and Coordinator share one inline opener and read-only preview. Recognize relative filenames, paths and Markdown file-link targets using one shared matcher; preserve normal links, code blocks, owner text, history, scrolling and composer. Reject absolute, dot/traversal segments, backslashes, percent escapes, URL schemes, and protected/hidden paths. No line anchors. Limit to 256 KiB, regular files with one link, valid UTF-8 and no binary controls. Display source as text, not as rendered HTML or Markdown. Opening again reads the current file.
3. The browser sends conversation, message and relative path only. Each click reauthorizes the conversation and exact assistant mention; only the original runner may read. Gone, unavailable and offline have different feedback. Never fall back to another runner.

## State, writers and readers

The nullable DB source on task/Coordinator rows holds server-stamped step, runner and workspace instance, not supplied by the browser. Worker transcript writer accepts an instance only under the active generation; Coordinator shell claims the same proof from its authenticated, matching call. The runner seals its canonical root plus device/inode/birth identity in an opaque instance token, with a per-installation key persisted outside workspaces (no per-step registry to clean up). Managed Coordinator directories live with runner workspaces, using the existing workspace lifetime; deletion returns gone, and path reuse does not revive a deleted instance. Existing rows remain unchanged. A row-ID conflict from a different attempt may update text as it does today but must clear stale authority, not inherit or restamp it. History and SSE project eligibility only. The browser route resolves only the authorized row's opaque instance. Runner stream/result contracts are additive; advertised support is required, including availability of a descriptor-relative no-follow reader. The runner enforces identity plus a descriptor-relative, bounded, read-only open through every component; unsupported platform or missing helper fails closed. A bounded request binds one runner connection and ID and retires on result, abort, disconnect or deadline. Old runners and servers continue ordinary transcripts.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Task and Coordinator, same reference on different runners; reopen after edit | The panel shows current text from the stamped step, not the active runner; Coordinator shell calls on one step share a workspace | `apps/server/test/message-file-open.test.ts` | this change |
| Additive migration; retry, replay, old rows, missing or conflicting proof | History is unchanged; unstamped rows get no eligibility; retries never inherit a different attempt's authority; history and SSE reveal no roots | `apps/server/test/message-file-open.test.ts` | this change |
| Revoked conversation access; foreign message, wrong path or supplied root | Click is refused before dispatch | `apps/server/test/message-file-open.test.ts` | this change |
| Gone or replaced root; unstable path, symlink at any depth, traversal, protected name, hardlink, binary, oversized or nonregular file | Gone or unsupported; no outside bytes; verify swap refusal at descriptor traversal | `apps/daemon/test/workspace-file-read.test.ts` | this change |
| Offline, older or restarted runner; abort, timeout, replacement connection, foreign/late/duplicate reply | No fallback; old or disconnected runner cannot complete the request; retry clicks work once the producing runner reconnects | `apps/server/test/message-file-open.test.ts` | this change |
| Task and Coordinator pending, slow, repeat, close, gone/offline/unsupported, long name, 390px or dark | Same preview structure, focus and chrome; only latest open updates; localized distinct notices | `apps/web/e2e/message-file-open.spec.ts` | this change |

Draft on both surfaces: `Saved report.md` → underlined filename → preview headed `report.md`, then `Opening file…`, text, `This file is no longer in the step’s workspace`, `The runner is offline`, or `This file cannot be previewed`. Use existing panel/dialog primitives; nothing shifts the reply, including during pending questions. Reference: Duet file panel and t3code changed-file row; P1–P7, A3/A4/A8, C23/C24, T1/T7 and V24. Register the new runner capability and both UI entry points in the product surface registry and feature map.

## Out of scope

- Historical path inference, editing, binary previews, arbitrary host paths, and a fallback reader on the server.

## Review

- Verdict: PASS
- Fix-check: PASS
- Plan-SHA256: 664dc862de3542dc800b0ee8a6018aec86f974f362cd5c6743d7696815119f5c
- Author-Model: openai-codex/gpt-6.2-sol
- Reviewer: independent reviewer a5e7bf4a; findings 1–8 confirmed fixed
- Reviewer-Model: claude-sonnet-5-5
- Findings: eight addressed and confirmed (reader proof, state, Coordinator scope, references, protection, authorization and transport proofs, both UI surfaces, registration).
- Implementation review refinement: Coordinator deliverable workspaces are not aged out by the staged-upload sweeper. They can still become unavailable when the producing workspace is removed. Source conflicts permanently revoke the link, and an unchanged replay does not backfill it.
