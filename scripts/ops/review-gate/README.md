# Review gate timer (omarchy)

`review-gate.mjs` is the script the `cairn-review-gate` user timer runs on the dispatch host every few minutes. It reviews open non-draft PRs that touch protected paths, carry the `review-gate` label, or come from `lane/<n>` branches, with one model through `ai-route`, and posts the verdict as a PR comment: one line on PASS, the model's final message (at most 3000 characters) on BLOCK. It never arms GitHub auto-merge. On BLOCK it disarms auto-merge if someone armed it.

Files:

- `review-gate.mjs`: the timer script.
- `prompt.txt`: the review prompt.
- `verdict.test.mjs`, `glob.test.mjs`: the checks the unit runs in `ExecStartPre` (`node verdict.test.mjs review-gate.mjs` from this directory; `fixture-1828.txt` is its input).

The host currently runs its own copy under `~/.cairn/tools/review-gate/`; this directory holds the same code so changes go through a PR. To run it from a checkout instead, point the unit's `ExecStart` and `ExecStartPre` at a checkout of `origin/main` with a drop-in.

Known limits: reasoning effort is low, and `ai-route`'s review route falls back to `deepseek-v4.1-flash` when Codex is unavailable.
