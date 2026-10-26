# #1055 brand-ink role-change faces — better-colors incremental measurement

Formula: WCAG 2.1 relative luminance, `(Lhi+0.05)/(Llo+0.05)`, byte-identical method to the measure-912 canon. Source: computed token values rendered on two fixture stacks (the probe element resolves `var()`/`color-mix`, before = a throwaway origin/main @ `5d9d91d6` worktree stack :8412, after = this branch's stack :8413), both themes, measured not estimated. Tool = `../../1054/probe/probe-evidence.mjs`; raw output = `../../1054/measure-{before,after}.{md,json}`. Gates: text 4.5 / non-text UI 3. Screenshots = `../shots/` (mention-foot and account-hover before/after same-scene pairs, both themes).

## Changed face 1: the mention-picker insert button (brand-ink text → registry default tier)

| face | theme | measured fg | measured bg | ratio | gate | result |
| --- | --- | --- | --- | --- | --- | --- |
| before: ghost button with brand-ink text | dark | rgb(242, 148, 216) (--card-button) | transparent, lands on --popover rgb(38, 34, 31) | 7.52 | 4.5 | PASS (the E palette already fixed the contrast; **the defect is the role**, not the reading) |
| before: same | light | rgb(151, 34, 126) | --popover rgb(240, 235, 230) | 6.23 | 4.5 | PASS (same) |
| after: default-tier label on primary fill | dark | rgb(31, 27, 24) (--primary-foreground) | rgb(238, 232, 228) (--primary) | 14.08 | 4.5 | PASS |
| after: same | light | rgb(250, 250, 250) | rgb(18, 15, 11) | 18.31 | 4.5 | PASS |

Role basis: the #1055 slot table "primary action button → --primary (neutral)"; disabled goes through the registry opacity step-down (the same retirement as source-issue #1006).

## Changed face 2: the account name-value button hover (brand-ink hover ink-swap → ghost component default hover)

| face | theme | measured hover fg | measured hover bg | ratio | gate | result |
| --- | --- | --- | --- | --- | --- | --- |
| before: hover:text-(--card-button), bg transparent | dark | rgb(242, 148, 216) | lands on the page base --background rgb(31, 27, 24) | 8.14 | 4.5 | PASS (the defect is the role) |
| before: same | light | rgb(151, 34, 126) | --background rgb(246, 241, 236) | 6.57 | 4.5 | PASS (same) |
| after: ghost component default hover (accent fill) | dark | rgb(238, 232, 228) (--accent-foreground) | rgb(45, 41, 38) (--accent) | 11.87 | 4.5 | PASS |
| after: same | light | rgb(18, 15, 11) | rgb(234, 228, 224) | 15.17 | 4.5 | PASS |

Ruling mirror: the agent-detail face #980 "the hover ink-swap recipe retires, hover fill = registry affordance" (the AGENT_NAME_CLS precedent); the account face's e2e carrier goes by role/text (#910 ruling 1), no class-name pin moves.

## Registered faces (the brandInkText ledger's 7 entries / 9 rows) — spot role-contrast re-measurement

| pair | theme | fg | bg | ratio | gate | result |
| --- | --- | --- | --- | --- | --- | --- |
| bell glyph on --notify-icon-bg (badge-glyph) | dark | rgb(242, 148, 216) | rgb(64, 60, 57) | 5.2 | 3 (ui) | PASS |
| same | light | rgb(151, 34, 126) | spot-soft composite srgb(0.892, 0.811, 0.845) | 4.99 | 3 (ui) | PASS |
| check on the popover panel (selection-mark) | dark | rgb(242, 148, 216) | rgb(38, 34, 31) | 7.52 | 3 (ui) | PASS |
| same | light | rgb(151, 34, 126) | rgb(240, 235, 230) | 6.23 | 3 (ui) | PASS |
| check on the dialog base (selection-mark) | dark | rgb(242, 148, 216) | rgb(31, 27, 24) | 8.14 | 3 (ui) | PASS |
| same | light | rgb(151, 34, 126) | rgb(246, 241, 236) | 6.57 | 3 (ui) | PASS |
| spinner on the stream base (indicator) | dark | rgb(242, 148, 216) | rgb(31, 27, 24) | 8.14 | 3 (ui) | PASS |
| spinner on the card face (indicator) | dark | rgb(242, 148, 216) | rgb(38, 34, 31) | 7.52 | 3 (ui) | PASS |
| spinner on both bases | light | rgb(151, 34, 126) | rgb(246, 241, 236) / rgb(240, 235, 230) | 6.57 / 6.23 | 3 (ui) | PASS |
| crown on --spot-soft (badge-glyph) | dark | rgb(242, 148, 216) | srgb(0.261, 0.196, 0.223) | 5.7 | 3 (ui) | PASS |
| same | light | rgb(151, 34, 126) | srgb(0.892, 0.811, 0.845) | 4.99 | 3 (ui) | PASS |
| reference (non-incremental): link-tier primary on card (#1006 R4) | dark / light | rgb(238, 232, 228) / rgb(18, 15, 11) | rgb(38, 34, 31) / rgb(240, 235, 230) | 13 / 16.14 | 4.5 | PASS |

The full table has 0 FAILs. Dark-side minimum margin = the bell glyph 5.2 vs gate 3; light-side minimum = crown/bell 4.99 vs 3. On the text-gate side the minimum = the light-side brand-ink old text position 6.23 vs 4.5 — under the E palette (#988 final) the brand-ink readings pass, and **this ticket changes a role misplacement** (a canon slot used in the wrong position), not a failing reading; the two things are stated separately, to avoid misreading a role fix as a contrast fix.

## Gate two-way verification (gate-demo-*.txt in this directory)

1. `gate-demo-1-red.txt` — a line of unregistered `text-(--card-button)` stuffed into a consumption file: G6 red, exit 1.
2. `gate-demo-2-green.txt` — after registering role+reason+contrast: green, exit 0.
3. `gate-demo-3-stale-red.txt` — the ink is fixed but the ledger entry stays: STALE red, exit 1.
4. `gate-demo-4-green.txt` — the entry is deleted with the fix in the same PR: green, exit 0.
