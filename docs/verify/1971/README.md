# Issue 1971: skill_audit inject rows on worker claim

Claim-path only. Matcher behaviour, claim wire shape, and historical `skillInjection` rows are unchanged.

## Inject event

When a worker claim wins the pending→claimed transition, the server inserts one `skill_audit` row per persisted `skillInjection.hits` entry, in hit order, inside the same SQLite transaction as the step update.

| Column | Value |
| --- | --- |
| `skillId` | `hit.id` |
| `actorType` | `agent` |
| `actorId` | claiming agent id |
| `action` | `inject` |
| `createdAt` | the claim timestamp written on the step (`claimedAt`) |
| `bytes` | UTF-8 byte length of `hit.reason` (`Buffer.byteLength(hit.reason, 'utf8')`) |

`bytes` is not JavaScript string length. Injection reasons are Chinese templates from `selectSkillsForTask`, so UTF-8 length is strictly greater than `.length` for every real hit. Create/update skill writes keep their own byte meaning (file content totals); inject rows only count the reason string.

Zero-hit worker claims, chief claims, rejected candidates (no grant), and losing claim attempts (`UPDATE ... WHERE status = 'pending'` changes = 0) write no inject rows. A failed audit insert aborts the transaction: the step stays `pending`, `skillInjection` stays null, and no partial audit rows remain.

## Commands

```sh
pnpm --filter @cairn/server exec vitest run test/skill-inject-claim.test.ts
pnpm lint
pnpm typecheck
```
