# Review-gate watchdog

`codex-gate-watchdog.mjs` is a host-side fallback for delayed GitHub Actions
`schedule` events. It scans open non-draft PRs, finds `github-actions`
`review-gate` check-runs that have stayed `in_progress` for at least 12 minutes,
and dispatches `review-gate.yml` once per PR/head/check-run through the Checks
API. It also exits nonzero when the newest scheduled `review-gate.yml` run is at
least 20 minutes old, so the host timer's log records the platform-side delay.

The dispatch is idempotent through `CAIRN_WATCHDOG_STATE`: once a key has been
dispatched, it is not repeated for an hour. API read errors, malformed check-run
data and malformed state fail closed. A stale check can still be a legitimate
Codex review in progress; a dispatch only re-evaluates the gate and may request
`@codex review`, it never marks the check green or bypasses P0/P1 findings.

Install the user units from a `cairn-exec` checkout:

```sh
mkdir -p ~/.config/cairn ~/.local/state/review-gate
printf 'CAIRN_CHECKOUT=%s\nNODE_BIN=%s\nGH_TOKEN=...\n' \
  "$HOME/Code/AgentProjects/cairn-exec" \
  "$HOME/.local/share/mise/installs/node/24/bin/node" \
  > ~/.config/cairn/review-gate-watchdog.env
chmod 600 ~/.config/cairn/review-gate-watchdog.env
cp scripts/ops/systemd/cairn-review-gate-watchdog.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now cairn-review-gate-watchdog.timer
```

`GH_TOKEN` needs repository `actions:write`, `checks:read` and `pull-requests:read`
access. Keep the env file private; never commit its contents. The service uses
the host's ordinary `gh` authentication, not the restricted app-token wrapper.
A nonzero service status is an alert, not a merge gate; the required GitHub
Actions checks still decide whether a PR enters the Mergify queue.
