# Verify #1960 — page benchmark question bank and evidence contract

## Commands

```sh
pnpm --filter @cairn/integration exec vitest run test/page-bench-contract.test.ts
pnpm typecheck
pnpm lint
node scripts/english-only-gate.mjs
pnpm spec:parse
```

## Artifacts

| File | Meaning |
| --- | --- |
| `contract-red.txt` | Same vitest command on main-shaped tree before `questions.json` existed (7 failed) |
| `contract-green.txt` | Same command after the contract files landed (7 passed) |
| `typecheck-full.txt` | `pnpm typecheck` |
| `lint-full.txt` | `pnpm lint` (biome ci; info-only finding elsewhere) |
| `english-only.txt` | English-only gate |
| `comment-discipline.txt` | Comment discipline gate |
| `spec-parse.txt` | Spec parse gate |

No runner or scorer was added. Scope is the question bank, run-record schema, rubric, README, and contract tests only.
