# Escape trace resolution verification

Resolve #1952 candidate JSON to introducing commits and merged PRs.

```sh
node --test scripts/escape-trace.test.mjs
node scripts/escape-trace.mjs candidates --since 2026-10-01T00:00:00Z --until 2026-10-15T00:00:00Z \
  | node scripts/escape-trace.mjs trace --respond-file /path/to/recorded.json
```

`red.log` is the suite failing on main before `resolveTraces` existed (missing export). `green.log` is 14 passing cases after implementation: #1884 wrong-attribution (`introduced by #100` vs trailing fixing `(#201)`), revert-body SHA resolution, `Fixes #N` issue-not-pr retention, parent blame with file/line evidence, multiple-origin blame, shallow unresolved reason, exactly-14-day window vs +1s outside-window, introducing merge before `--since`, resolved trace shape, and `candidates | trace` CLI wiring with a recorded responder.

Resolution order is revert body, then validated explicit references, then blame on the fix parent. Tests inject a recorded GitHub responder; the command performs no network writes. Candidate collection semantics from #1952 are unchanged. Review classification and weekly aggregation stay out of this ticket.
