# Paper redesign PR 2: type-scale keys and arbitrary-value ledger

Evidence for `apps/web/docs/paper-redesign-plan.md` PR 2. Every `.txt` file is
the verbatim output of the command on its first line, with the exit code on the
last line.

Gate runs (`scripts/ui-debt-gate.mjs`):

- `01-green-in-tree.txt`: branch checked against its own baseline. PASS, 180 text + 319 spacing.
- `02-green-bootstrap-vs-main.txt`: `--base` = origin/main 81bc4d37, whose baseline has no `arbitraryValues`. PASS in bootstrap mode for the new ledger.
- `03-red-text-13px.txt`: one `text-[13px]` added to `board/todo-card.tsx`. D5 red, exit 1, names the file.
- `04-red-text-13px-vs-main.txt`: same edit, with `--base` origin/main. Still red (bootstrap compares against the in-tree numbers).
- `05-red-refreeze-cannot-legalize.txt`: same edit plus `--write` on the branch (baseline raised to 181), checked against a probe base commit that carries the 180/319 ledger. D5 and D3 both red.
- `06-green-vs-ledger-base.txt`: clean branch against that probe base. PASS.
- `07-red-d4-malformed-ledger.txt`: `textTotal` edited so per-file counts no longer sum to it. D4, exit 2.
- `08-red-d4-matcher-canary.txt`: matcher edited to drop `rem|em`. The built-in canary catches it, exit 2.

The throwaway edits in 03 to 08 were reverted; the committed tree is the one in 01.

Type keys (`apps/web/src/styles/app.css` + `tokens.css`):

- `10-type-keys-compiled-utilities.css`: the utilities Tailwind 4.3.3 emits when the real `app.css` is compiled with the six keys and `font-heading` as candidates.
- `09-type-keys-computed.txt`: computed `font-size` / `line-height` / first font family in Chromium, at `data-density=comfortable` and `compact`.
