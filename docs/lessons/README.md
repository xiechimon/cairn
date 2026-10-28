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

## Counters, events and escalation (#1534)

`Intercepts` and `Recurrences` are written by the scripts, never by hand. The source of truth is the append-only event log `docs/lessons/events.jsonl`, one JSON object per line:

```
{"kind":"intercept","repo":"xiechimon/cairn","branch":"lane/2040","at":"2026-10-27T08:00:00Z","category":"single-use-helper-gate","gate":"scripts/single-use-helper-gate.mjs"}
{"kind":"recurrence","repo":"xiechimon/cairn","pr":"2043","at":"2026-10-27T09:00:00Z","category":"single-use-helper-gate","issue":"2077"}
```

- `category` is the entry's short name (the file name without the ticket prefix). Categories are matched by that key only, never by the `Category` prose.
- Intercept ids include repository, branch, category, gate and the UTC Monday date. Retries and new commits on the same branch count once per gate and category each week. Recurrence ids include the repository, PR, category and episode; merged counter increases use the commit SHA and increment index as their episode.
- Gate logging is opt-in through `CAIRN_GATE_LOG=<path>` (`1` uses the system temporary directory). Prepush appends external JSONL records and never rewrites repository counters. CI uploads these records as `gate-reds-*` artifacts even when checks fail. The trusted weekly workflow downloads retained artifacts, reduces duplicates and publishes the event history and counters in a dedicated PR. Local logs need to be supplied to `lessons-weekly.mjs --logs <directory>` for collection.
- An entry's own `Intercepts`/`Recurrences` at the moment it entered the event log is frozen in `docs/lessons/baselines.json`; the printed counter is that baseline plus the events recorded after the safeguard's `; since` date. This is why the 172 entries written before #1534 keep their hand-kept numbers without any rewrite.

Commands:

- `node scripts/lessons-ledger-gate.mjs` validates the ledger, the events and the counters; a counter that does not match the events makes it red, and the fix is `write`, not an edit.
- `node scripts/lessons-ledger-gate.mjs write` freezes missing baselines and rewrites the counters from the events.
- `node scripts/lessons-ledger-gate.mjs record --event <file.json>` records one event or a JSON array, then prints any escalation ticket the recurrence opened.
- `node scripts/lessons-ledger-gate.mjs summary [--now <iso>] [--idle-weeks 4]` prints the weekly summary: new categories, intercepts, recurrences, safeguards awaiting evaluation, escalations awaiting an issue, and entries with no safeguarding date.

The weekly collector examines first-parent merged history for increases to an existing category's `Recurrences` after safeguard activation. Increases already explained by committed recurrence events are excluded, including its own published counter updates. It records the remaining increases once per commit and searches existing escalation issues before creating a new issue. A `recurrence` event produces an escalation ticket body (title, `Labels: correction`, the suggested next rung) the first time the same kind reappears after its safeguard. Recording the same recurrence again with `"issue":"<number>"` marks the ticket as filed, so the summary stops listing it. The escalation suggests the next ladder rung only; it never deletes a safeguard. A safeguard with no intercept and no recurrence for `--idle-weeks` whole weeks is listed as awaiting evaluation for the #1407 gardener sweep, which is the only place that decides its fate.

The weekly summary is also written into the gardener's weekly report (`scripts/gardener-weekly.mjs`), and its JSON facts feed the evaluation loop's weekly summary; see `docs/spec/29-evaluation-and-data-loop.md` §4.
