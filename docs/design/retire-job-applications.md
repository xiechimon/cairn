# Retire job applications (#5340)

Decision (owner, 2026-11-18): job workflows will use generic browser threads and
action-approval cards; the dedicated `job-applications` subsystem is retired.
`mail_*` stays.

## Surface

- `job_application` table (`userId` PK -> `user`, `document` json): single table,
  dropped by migration `0201_retire_job_applications`. Rows are owner profile
  documents; no FK points at the table, so a plain `DROP TABLE` suffices.
- `routes-job-applications.ts` (3 PUT routes: hosts, profile, cap) and its
  `registerJobApplicationRoutes` call in `routes.ts`; the
  `/api/job-applications` allowlist regex in `token-auth.ts`; the three route
  strings in `wire.test.ts`.
- `services/job-applications.ts` (618 lines, 20 exports). Live callers today:
  `isJobOwnerCaller` + `jobSubmitAnswerActor` in `routes-chief.ts`,
  `readFillableProfile` in `chief-tools.ts`, `writeJobHost` / `writeOwnerProfile`
  / `setJobCapLimit` in the retired route file. The other 15 exports have no
  caller outside the service and its test.
- `chief-tools.ts`: the `job_profile` tool case (calls `readFillableProfile`).
- `protocol/chief-tools.ts`: `job_profile` spec, `CHIEF_TOOLS_ADDED` entry,
  `CHIEF_TOOL_CATEGORIES.read` entry; `CHIEF_TOOL_COUNT` 47 -> 46.
- `routes-chief.ts`: the `jobSubmitAnswerActor`/`isJobOwnerCaller` wiring that
  passes `answeredBy` for `job_submit` cards. `answeredBy` stays in the wire
  (`machine-relay` / `answer-delivery` / `action-proposals` still produce it);
  the REST answer path simply stops setting it.
- `chief-questions.ts`: the `askedFor: ['job_submit']` owner-only answer rule.
  No producer of `job_submit` cards remains after the service is deleted, so the
  rule is dead; a stale stored card degrades to an ordinary question.
- `tables.ts`: `job_application` removed from `DB_TABLES` and
  `INTERNAL_ONLY_TABLES`; `schema.ts` table removed; `vocabulary.test.ts` table
  list and `DB_TABLES` count 90 -> 89.
- `test/job-applications.test.ts` deleted; `vitest-shard-weights.json` entry
  removed; `chief-tools.test.ts` additions-registry and count expectations
  updated.
- `feature-map.json` `job-applications` entry removed and
  `docs/feature-map.md` regenerated; `docs/design/job-applications.md` marked
  superseded (research docs cite it as a measured point-in-time source).

## Tests

- New `retire-job-applications-migration.test.ts`: pre-drop seed of a
  `job_application` row, upgrade drop verified by `PRAGMA table_info`, fresh
  database has no table. (The `document` payload is intentionally not preserved:
  the retired surface has no reader.)
- Existing chief question/answer tests cover `answeredBy` producers that stay.
