# Lessons ledger

Things that went wrong during the process and were later fixed, one file per error kind: `docs/lessons/<ticket>-<short-name>.md`. Every entry must carry a safeguard, chosen at the highest feasible rung of the ladder below; anything a machine check can cover must not stay at the wording level. Design basis: the "process error retro" scheme ian confirmed on 2026-10-22.

One file per entry exists so parallel lanes each add their own file and merges do not conflict (the old single table `docs/lessons.md` conflicted at the table tail on every merged PR).

## Ladder

1. Architecture or types make it unwritable
2. Lint, script gates, tests, CI checks
3. Rules in AGENTS.md or prompts
4. Skills
5. Memory (softest; only works inside a Claude thread)

## File format

File name: ticket number, a hyphen, and a lowercase English short name, e.g. `1566-prepush-stale-origin-main.md`. For a thread-internal mistake without a ticket, use the current task's ticket number.

The entry has seven fields in a fixed order in leading frontmatter, one field per line. Any text after the closing delimiter is excluded from validation and table generation:

```
---
Category: one sentence naming the symptom
Source: PR or ticket number (date)
Level: 1 to 5
Safeguard: what the safeguard actually is
Intercepts: how many times the safeguard actually blocked it
Recurrences: how many times the same kind reappeared
Notes: negative controls, why a higher level is not feasible, etc.
---
```

## Writing rules

- One file per error kind, merge the same kind, do not open duplicate files. On recurrence update the original file's "Recurrences" count and safeguard; do not create a new file.
- A new gate must use the real mistake as its negative control: the old error going red under the new gate is what counts as landing it.
- "Intercepts" records actual blocks by the safeguard, "Recurrences" records reappearances of the same kind. A Recurrences count above 0 means this layer is not hard enough; escalate one rung.
- Levels 4 and 5 must state in Notes why a higher level is not feasible; a "pending upgrade" note must carry a ticket number.
- Validation: `node scripts/lessons-ledger-gate.mjs` (shared by `pnpm prepush` and CI). It checks file names, the order and values of the seven fields, the level range, the level 4/5 reasons, and the ticket number on "pending upgrade".
- The summary table is not committed; print it on demand with `pnpm lessons:table`.
