# chief-dispatch-real metrics

Aggregate numbers only. Per-case text stays on omarchy under
`~/.local/share/cairn-eval/dispatch-real/`.

## Status

Pending product-owner decision: the first omarchy production run (export,
redact, dual-vendor label, split, visible + held-out eval) has a real model
and machine cost. This PR does not invent placeholder pass rates. Fill the
tables below on omarchy after that go-ahead, then paste aggregates only into
the PR / this file.

## Pipeline counts

| step | n | notes |
| --- | --- | --- |
| exported (reassigned / cancelled / failed) | pending omarchy | |
| kept after redaction | pending omarchy | |
| dropped (high-risk after redaction) | pending omarchy | |
| kept after dual-vendor label agreement | pending omarchy | |
| dropped (disagree or unclear) | pending omarchy | |
| visible half | pending omarchy | |
| held-out half (sealed) | pending omarchy | |

## Label agreement

| metric | value |
| --- | --- |
| agreement rate (same non-unclear) | pending omarchy |
| vendor pair | glm + deepseek (planned) |

## Chief pass rates

| half | decision_ok | 95% CI | scored | date |
| --- | --- | --- | --- | --- |
| visible | pending omarchy | — | — | — |
| held-out | pending omarchy | — | — | — |

## Regression gate

The 64-case `.claude/hillclimb/chief-dispatch/cases.json` set is unchanged.
