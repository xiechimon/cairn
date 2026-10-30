# Security and independent review — #2291

Measured 2026-10-31: the implementation was reviewed in a fresh, read-only Claude Code process with `--model claude-sonnet-5-5`, separate from the Codex implementation context. The reviewer inspected the uncommitted diff, MCP registration, Thread services, key grants, and relevant consumers. No PR was opened and no GitHub mutation was performed.

`/security-review` was invoked twice in print mode. Both invocations returned zero turns and no assessment, so neither is counted as a completed review. A subsequent explicit security/code-review prompt completed and returned the findings below. This records the actual execution limit of the slash-command attempts.

## Findings and disposition

1. **Medium: stale integration registry counts.** `integration/test/m4b-mcp-e2e.test.ts` still expected 24 tools, 11 read and 13 write. Reproduced with the registry-only test: expected 24, received 29. Fixed to 29/14/15. The full integration file then passed all three tests.
2. **Low: stale specification counts.** Updated `docs/spec/01-stack-v2.md` and `docs/spec/02-architecture-parity.md` to describe 24 legacy tools plus five Coordinator/Thread tools and the unchanged authentication/team boundaries.

The reviewer reported no confirmed security vulnerability in registration/grant enforcement, cross-team Project/Thread access, structured answers, work conversation ownership, PR linkage, or queue/steer routing. This is a static review conclusion, supported separately by negative tests through an MCP client; it is not a production isolation certification.

The reviewer noted that the original read/write grant arrays are merged before tool registration, and that same-team Thread access follows the existing team boundary rather than introducing per-user authorization. Those existing semantics were preserved. The legacy snapshot prefix is retained; explicit assertions now also pin all five additional grants in that test, alongside the complete vocabulary and MCP discovery tests.

## Review limits

- The reviewer did not run tests or inspect GitHub/CI.
- The reviewer did not read `sendBuildSteer` or the existing MCP test files in full, and did not verify dependency-type compatibility. The implementer inspected those paths and ran typecheck and related runtime tests separately.
- The final integration-count/spec corrections and explicit extension assertions were author fixes after this review, not a second independent review round.
- Real Claude Code, Codex, and pi sessions and the Grok probe remain assigned to the orchestrator. Their placeholders are intentional and unverified.

No confirmed security finding was left unfixed. Before a future PR, the orchestrator must apply the repository's review and security gates to that PR's final head.
