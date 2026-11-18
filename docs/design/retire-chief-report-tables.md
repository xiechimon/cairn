# Retire `chief_report`/`retro_proposal` tables and `research-intake-item` (#5346)

## Why

Migration 0177 retired daily reports: it stopped active report-linked steps and removed
every route, scheduler path and writer. What remains is dead storage — `chief_report`
and `retro_proposal` still exist in `apps/server/src/db/schema.ts` with zero runtime
readers or writers, the `'research-intake-item'` member of `TASK_SOURCE_KINDS` has no
producing or consuming path, and DESIGN-RULES C17 still describes the report as an
active interactive surface.

## States and transitions

- `chief_report` / `retro_proposal`: removed. Historical report content lives only in
  `chief_message` rows (`kind: 'chief_daily_report'`), which `chief-report-row.tsx`
  renders read-only. No data is backfilled out of the dropped tables — their rows are
  bookkeeping for a retired pipeline, not user content.
- `TASK_SOURCE_KINDS`: loses `'research-intake-item'`; every other member stays.
  Existing rows in the wild never carry the value (zero producers shipped).
- `chiefReportContentSchema`, `chief-report-row.tsx`, `INTAKE_SOURCE_KIND`, and the
  `research-intake` source kind stay — they serve live surfaces or historical message
  rendering.

## Read/write paths

- `chief_report` and `retro_proposal` have no readers/writers outside `schema.ts`.
- `ChiefReportInputs`/`ChiefReportSourceRef` exist only to type the dropped columns.
- Migration 0177 already stopped report-linked steps, reading `chief_report.stepId`
  before this ticket's drop, so the drop does not orphan a live consumer.
- Web mappers parse `chief_daily_report` message content, never the tables.

## Failure behavior

Both drops are plain `DROP TABLE` inside the migration's transactional batch; a failed
statement aborts the batch and rolls the database back to its pre-migration shape.

## Tests

- `retire-chief-report-migration.test.ts`: legacy tables hold rows, upgrade drops both,
  `foreign_key_check` is clean, unrelated tables (`chief_message`, `chief_thread`,
  `todo`) keep their rows, and a mid-migration abort leaves both tables intact.
- `daily-report-retirement.test.ts` / `daily-research-retirement.test.ts` keep covering
  the retired behavior — absent routes, silent scheduler ticks — without seeding the
  dropped tables.
- `vocabulary.test.ts` reflects the two removed internal tables and snapshot
  regeneration drops the stale projection.
