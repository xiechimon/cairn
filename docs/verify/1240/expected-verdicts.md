# Expected verdicts (recorded before the gate script exists)

Fixtures isolate the task rules: every fixture carries answered Upstream/Verified
sections so the pr-tasks verdict depends only on the Acceptance section's shape.
Written before `scripts/pr-tasks-gate.py` was implemented (#1240 fixture-first
rule). Any mismatch between these expectations and the recorded runs in
gate-*.txt means the script is wrong, not the expectation.

| fixture | expected verdict | why |
|---|---|---|
| no-section | RED no-tasks | no Acceptance heading at all |
| prose-only | RED no-tasks | bullets carry no machine-judgeable completion signal (#1229/#1233 shape) |
| unchecked | RED unchecked-task, both offenders named with line numbers | `- [ ]` present among checked (#1235 shape) |
| all-checked | GREEN | every box checked |
| codeblock-task | RED no-tasks, not unchecked-task | the fenced box is invisible to the gate (fence-stripped), so existence is still unmet; the ticket's codeblock scenario requires it not to red as unchecked |
| indented-nested | RED unchecked-task, 2 offenders (lines of `    - [ ]` and `2. [ ]`) | indentation and list style are irrelevant to detection |
| uppercase-x | GREEN | `[X]` counts as checked (GitHub task-list syntax) |
| comment-wrapped | RED no-tasks | HTML comments are stripped before scanning; a commented-out checklist is not live |
| exemption | GREEN | `- [x] no task surface: <reason>` is a checked task by construction |
| empty-checkbox | RED unchecked-task | `- [ ]` with no text still counts as an unchecked task |
| template-untouched (new template verbatim) | RED unchecked-task | the template ships one live unchecked seed task |

Line numbers reported are absolute positions in the whole body.
