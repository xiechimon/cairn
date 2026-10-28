# #1516 failure-replay verify

## Acceptance

- Three events each produce one pending candidate (`candidates.jsonl`, `bank-gate.log`).
- Pending candidates write zero files into the bank (`pending_bank_files=0`).
- Confirmed candidates materialize under `cases/` (`confirmed_bank_files=3`).

## Commands

```
pnpm --filter @cairn/shared exec vitest run test/failure-replay-candidate.test.ts
pnpm --filter @xiechimon/cairn exec vitest run test/trajectory-failure-replay.test.ts
pnpm lint
pnpm typecheck
pnpm spec:parse
```

Logs in this directory: `shared-schema.log`, `server-failure-replay.log`, `lint.log`, `typecheck.log`, `spec-parse.log`, `bank-gate.log`, `candidates.jsonl`.
