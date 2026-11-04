# Nightly whole-repo review scan

Each night `run.mjs` ranks the files that changed most in the last 90 days times their length, takes tonight's slice of the top 60 (five files, rotating by day) and asks Claude (`claude-sonnet-5-5`, only the Read, Grep and Glob tools exist for the run: `--tools` restricts the set, and `--strict-mcp-config` drops MCP servers) to review only that slice with `prompt.md`. Each finding is filed as an issue labelled `found-by:nightly-scan`; the scan never blocks a PR.

- Dedupe: a finding's key is the file plus the normalized bug class, stored as `<!-- nightly-scan:<key> -->` in the issue body. A key that appears in any open or closed scan issue is not filed again. At most 3 issues are filed per night, high severity first.
- Run record: every night appends one line to `~/.local/state/cairn-nightly-scan/runs.jsonl` (`NIGHTLY_SCAN_STATE` overrides the directory) with the slice, findings, created issue URLs and duplicates. Three consecutive nights of records plus one filed issue is the completion check of plan section 11.1.
- Host: the scan uses the Claude login of the machine it runs on, so it runs from a systemd user timer, not from GitHub Actions (no Claude token is stored as an Actions secret). Install:

```sh
git clone https://github.com/xiechimon/cairn ~/cairn-nightly-scan
mkdir -p ~/.config/systemd/user
cp ~/cairn-nightly-scan/scripts/nightly-scan/systemd/cairn-nightly-scan.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now cairn-nightly-scan.timer
```

The runner fetches and checks out `origin/main` in that clone before each scan.

Tests: `node --test scripts/nightly-scan/nightly-scan.test.mjs`.
