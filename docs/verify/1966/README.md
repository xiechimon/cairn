# #1966 plan rejection revision with no-feedback control

## Acceptance

- Prior plan and feedback reach the agent through the real revision sequence (`paired-run.log`, execution tests).
- Feedback arm fixes the named defect and preserves the test step; no-feedback control fails the same requirements.
- Grader negative controls: feedback omitted, feedback ignored, prior unchanged, mustPreserve dropped.
- Arms use separate stacks; control DB has no feedback message.
- Missing arm writes `harness_error` to `errors.jsonl`, never a score.
- Single-turn plan cases without revision fields still run (`plan-grade` / `plan-flow`).

## Commands

```
pnpm --filter @cairn/integration exec vitest run test/plan-revision.test.ts test/plan-grade.test.ts test/plan-flow.test.ts
pnpm typecheck && pnpm lint
```

Logs: `red-missing-modules.log`, `acceptance-integration.log`, `acceptance-typecheck.log`, `acceptance-lint.log`, `paired-run.log`.
