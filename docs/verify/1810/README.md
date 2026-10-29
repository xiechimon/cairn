# Issue #1810 verification

Parent ticket for the "not evidence" checklist and machine checks. Split after
PR #1870 failed review into #1981 (checklist), #1982 (fixture URLs), and #1983
(archive provenance). Those three landed on main. This directory records the
parent close-out: the checklist now names the landed gates, and the existing
negative controls still reject each machine-checkable case.

## Machine checks

| Case | Gate verdict | Control |
|---|---|---|
| Image URL query carries `scenario` (markdown, HTML img, source srcset; empty value; after another parameter; HTML-escaped separators) | `FAIL fixture:` | `fixture-gate.txt`, `negative-controls.txt` |
| Screenshot embed outside this repository's associated `docs/verify/<issue>/` (user-images upload, other repo, wrong issue, path traversal) | `FAIL archive:` | `archive-gate.txt`, `negative-controls.txt` |
| Correct raw embed under the associated issue archive | `PASS archive:` / GREEN | `negative-controls.txt` archived control |

Reproduce:

```sh
python3 scripts/pr-evidence-gate.test.py -v
python3 scripts/pr-evidence-archive.test.py -v
```

`fixture-gate.txt` and `archive-gate.txt` are the verbose runs from this branch.
`negative-controls.txt` replays the parent ticket's machine-checkable shapes
(fixture `scenario` query in markdown and HTML, unarchived upload, wrong-issue
archive) plus the green archived control, with HTTP fixed at 200 so
reachability never decides the result. Stub-only is not in that probe; see
Review-only above.

## Review-only

Stub-only runs that claim real-provider behavior are not machine-gated. Evidence
does not yet carry provider provenance the gate can read. The checklist and
verify-cairn skill require reviewers to limit stub claims to the exercised
layers and mark real-provider claims unverified when credentials are missing.

## Checklist

Shared text lives in `docs/agent-dispatch-prompts.md#evidence-limits-checklist`
and `.claude/skills/verify-cairn/SKILL.md` (Evidence limits checklist). This
close-out rewrites the automation bullet so it no longer claims #1982/#1983 are
planned or that #1810 is incomplete.
