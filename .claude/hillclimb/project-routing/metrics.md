# project-routing scoring rubric

Object under test: which project the Chief puts each todo in when the team has several projects
(#1920). Reuses chief-dispatch's runner and isolated stack. On top of `eval-project`, the seed
creates `docs-site`, `digest-bot` and `bench`, each with a description and a small hosted repo
(`integration/eval/project-routing/seeds/`). Judged on the final todo rows (`projectId`), not the
transcript.

## Metrics

| id | type | definition |
|---|---|---|
| `decision_ok` | binary (primary) | The step is `done` and: for `route`, the new todos sit in exactly the expected projects, one per project; for `ask`, no todo is created, the reply or `ask_user` names every candidate and no project outside the candidates; for `answer`, no todo is created and the reply is not empty. |
| `receipt_ok` | binary (`route` only) | The reply names every project a todo was placed in. |

A project counts as named when its name or one of its aliases (`projects.mts`) appears, with
name boundaries for the ASCII names.

## Case classes

- Named (`n01`–`n02`): the request names the project.
- Inferable (`i01`–`i05`): no name, but descriptions or repo contents decide it. `i01` is only
  decidable by reading the READMEs: `docs-site` is the one with a relative link to a missing
  file, and `integration/test/project-routing-grade.test.ts` re-derives that from the seeds.
- Tied (`t01`–`t02`): two projects still match after investigating (both Python at 3.11; both
  READMEs carry the old contact address). Expected: ask, listing only those two.
- Cross-project (`x01`–`x02`): one request touching two projects. Expected: one todo in each.
- Question only (`q01`–`q02`): no change requested. Expected: answer, no todo.
