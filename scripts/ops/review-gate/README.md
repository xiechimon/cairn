# Review gate timer (omarchy)

`review-gate.mjs` is the script the `cairn-review-gate` user timer runs on the dispatch host every few minutes. It reviews open non-draft PRs that touch protected paths, carry the `review-gate` label, or come from `lane/<n>` branches, with one model through `ai-route`, and posts the verdict as a PR comment: one line on PASS, the model's final message (at most 3000 characters) on BLOCK. On BLOCK, or when the reviewer run ends without a verdict, it disarms auto-merge and remembers the merge method under `~/.local/state/review-gate/disarmed/<pr>`; a no-verdict run also leaves one comment saying auto-merge is paused. When a later head passes, it re-arms auto-merge with that method through the human `gh` login. It never arms auto-merge that nobody armed.

The verdict is also a `review-gate` commit status on the reviewed head, posted through the human `gh` login with `gh api --method POST repos/xiechimon/cairn/statuses/<sha>` because the App has no commit-status permission: `pending` when the gate starts a head and on its no-verdict and stall comments, `success` on PASS (carried over included), `failure` on BLOCK, each linking its comment. The last status posted per PR is kept under `~/.local/state/review-gate/status/<pr>`; a failed post is logged and retried on the next round from the head's verdict comment. Only comments by `cairnwright` count as gate comments, and a head that moved between listing and fetching waits for the next round.

The reviewer is never the author's vendor: for `lane/<n>` PRs the author vendor comes from the last `implement` run in `~/.local/state/ai-route/runs.jsonl` and is excluded through `AI_ROUTE_EXCLUDE_VENDORS`. When ai-route then reports `no usable model for role review` and the excluded author vendor is not Anthropic, the gate reviews with `claude -p --model opus` on this host, limited to read-only tools, and the verdict comment names the Claude reviewer. A head with no verdict for over an hour gets one `<!-- review-gate-stalled:<sha> -->` comment and the `review-stalled` label; the coordinator lists them with `gh pr list --label review-stalled`, and the label is removed when a verdict is posted.

Files:

- `review-gate.mjs`: the timer script.
- `prompt.txt`: the review prompt.
- `size-facts.mjs`: counts non-evidence lines and files of the PR diff; the script writes the result into the prompt, and an oversize PR (over 800 lines or 40 files) makes the reviewer answer `Why is it this big:` from the PR body's `## Size` section.
- `reviewer-route.mjs`: the fallback and stall decisions, imported by the script.
- `size-facts.test.mjs`, `verdict.test.mjs`, `glob.test.mjs`, `rearm.test.mjs`, `reviewer-route.test.mjs`, `fallback.test.mjs` (runs the script against a fake host): the checks the unit runs in `ExecStartPre` (`node verdict.test.mjs review-gate.mjs` from this directory; `fixture-1828.txt` is its input).

The host currently runs its own copy under `~/.cairn/tools/review-gate/`; this directory holds the same code so changes go through a PR. To run it from a checkout instead, point the unit's `ExecStart` and `ExecStartPre` at a checkout of `origin/main` with a drop-in.

Known limits: reasoning effort is low, and an Anthropic-authored PR with no usable non-Anthropic model still waits, now with the stall alert.
