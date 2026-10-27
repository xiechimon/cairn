# Compaction recovery review fixes

The summary fetch wrapper bounds recovery when the final conversation block exceeds the available budget. It identifies summaries from system or developer text, so ordinary user/tool messages quoting the summary marker are forwarded unchanged. JSON null, primitives and malformed message arrays also pass through unchanged.

Failure cases, written before changing the implementation:

- An earlier short message followed by a 40,000-character final assistant block returns 400 after one request on the old implementation.
- A user message quoting the summary marker is silently truncated on a context-ceiling response; a tool quotation is incorrectly logged as summary failure.
- The first system-only detection revision dereferenced JSON null and null message entries. The independent reviewer caught both; new cases fail with TypeError on that revision and pass after boundary validation.

## Red then green

Command: `pnpm exec vitest run apps/daemon/test/pi-compaction-ceiling.test.ts`.

- `recovery-red.log`: three failed, seven passed on the original PR code.
- `structure-red.log`: two failed, fifteen passed on the first review revision.
- `recovery-green.log`: seventeen passed after both fixes and validation guards.

The tests run the actual wrapper and upstream pi summarizer against deterministic provider-style context errors. This verifies wire-body recovery; it does not claim a fresh real-provider deployment experiment or a production step lifecycle recording.

## Integration

At review time, main was one commit ahead and this branch one commit ahead. `git merge-tree --write-tree origin/main refs/review/codex-1744` exited 0, with no textual conflicts. Main did not contain the recovery wrapper. The existing default compaction reserve remains unchanged. Each retry and terminal summary error retains the daemon logging callback.

The independent review identified both original defects. The follow-up review also identified the JSON boundary regression, which now has red-first coverage. Ordinary task context is never truncated by this wrapper.
