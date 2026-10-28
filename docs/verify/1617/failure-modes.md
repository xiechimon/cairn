# Drift scan repair failure modes

1. A deleted root-relative path is reported with its documentation line.
2. A deleted suffix-relative path, such as `api/mode.ts`, resolves through repository history just as it resolves at HEAD.
3. A similarly named historical directory, such as `not-api/mode.ts`, does not establish that `api/mode.ts` existed.
4. Existing relative paths and names that never existed remain absent from the drift report.
5. The weekly `--drift` report retains the lessons ledger section from current main and writes the drift JSON beside the weekly Markdown.
6. The scan reads committed HEAD, so uncommitted repairs do not hide published drift.
7. The CI self-test and weekly workflow retain their current jobs and add the drift invocation without changing baselines, allowlists or candidate-pattern logic.

8. A historical function name retained only under integration fixtures must not conceal its disappearance from the acceptance checklist code scope.

9. A relative path carrying a line or range suffix must be normalized before classification, including when its historical file was deleted.
