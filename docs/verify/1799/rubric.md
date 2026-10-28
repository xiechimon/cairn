# Relevance rubric (#1799)

Judge each stored injection against its task text. Do not reuse the #1874
"loose keyword" proxy as a relevance label.

## Labels

- `relevant`: the skill's purpose helps the task. Explicit skill cues count.
  Shared domain matches count only when the skill's described job matches the
  task intent.
- `unrelated`: the skill does not help the task. Typical cases are weak or
  coincidental keyword bridges (for example `ci` selecting a publish helper)
  and path-token domain opens that do not ask for that skill's work.
- `uncertain`: the task text is too thin, or the domain overlap is real but
  the need for that skill is unclear. Prefer `uncertain` over forcing a call.

## Process

1. Read the task title and spec together (`taskText`).
2. Read the stored hit's skill id, rule, and reason.
3. Compare the skill's frozen catalog description to the task intent.
4. Assign one label and a one-sentence rationale in English.
5. Totals must reconcile with the snapshot population (`classification.json`
   hit count equals `snapshot.population.hitCount`, no missing or duplicate
   step/skill/rule keys).
