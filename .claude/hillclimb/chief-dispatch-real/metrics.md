# chief-dispatch-real metrics

Aggregate numbers only. Per-case text stays on omarchy under
`~/.local/share/cairn-eval/dispatch-real/`.

## Pipeline counts

| step | n | notes |
| --- | --- | --- |
| exported (reassigned / cancelled / failed) | — | await first omarchy export |
| kept after redaction | — | |
| dropped (high-risk after redaction) | — | |
| kept after dual-vendor label agreement | — | |
| dropped (disagree or unclear) | — | |
| visible half | — | |
| held-out half (sealed) | — | |

## Label agreement

| metric | value |
| --- | --- |
| agreement rate (same non-unclear) | — |
| vendor pair | glm + deepseek (planned) |

## Chief pass rates

| half | decision_ok | 95% CI | scored | date |
| --- | --- | --- | --- | --- |
| visible | — | — | — | — |
| held-out | — | — | — | — |

## Regression gate

The 64-case `.claude/hillclimb/chief-dispatch/cases.json` set is unchanged.
