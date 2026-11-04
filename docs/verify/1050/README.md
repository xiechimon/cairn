# #1050 claude binary as the source of truth · live-run evidence

Rerun recipe (isolated stack; does not touch the active dev stack on 8787/5173):

```bash
cd <absolute worktree path>
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  VERIFY_REPO_ROOT=$PWD node .claude/skills/verify-pacman/scripts/launch.mjs
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  VERIFY_REPO_ROOT=$PWD node .claude/skills/verify-pacman/scripts/drive-1050-claude-bin.mjs
```

The probe starts the daemon itself (an isolated `PACMAN_HOME` scratch) and self-recycles; the two legs each use a scratch home, with the same machine name `probe-1050` (leg B overwrites leg A's report — exactly the one-way-ness wanted: the later-reported fact supersedes the earlier).

## Result: 13/13 PASS

Leg A (a stub claude placed first in PATH, `--version` answering `9.9.9-probe`, `auth status` answering logged-in)

- `A1` daemon.log: `[machine] claude binary: <path> (9.9.9-probe)`
- `A2` machine row `claudeCodeReport.bin = {path, version: "9.9.9-probe"}`
- `A3` machine row `claudeCodeReport.auth.state = "logged-in"`
- `A4` the claude-code section of `GET /model-sources` carries `bin`/`auth` (server pass-through)
- `A5` the providers page's fine-print line: `claude 9.9.9-probe · <path>`
- `A6` the page has `data-auth="logged-in"`, no `未登录` badge

Leg B (same machine, `PACMAN_CLAUDE_BIN` pointing at a nonexistent path; `~/.claude/settings.json` untouched)

- `B1` daemon.log: `[machine] claude binary: not found on PATH`
- `B2` machine row has the `bin` key with the value **null** (probed, and absent)
- `B3` the `GET /model-sources` section likewise `bin: null`
- `B4` **the page answers `未安装`** — this machine is `installed:true` at this very moment (settings.json present, the five model slots still resolving) and still says not installed. This is the class of false green this ticket eliminates: before the change it said `已安装在 DESKTOP-N9CSRE4`.
- `B5` the page has no fine-print line and does not write `未知`

## Reading points

- The `bin` three states are **not merged** on the wire: an object = probed and found; `null` = probed and not found; the key absent = never probed (an old daemon). The page branches on these three accordingly: installed / not installed / the old "look at installed only" fallback behavior. `B2`/`B3` pin that "probed and not found" must not degrade to absent — degrading to absent would degrade back to the false green.
- The page's judgment priority = **binary > config file**. When the config file is present but the binary is gone, the binary speaks (`B4`); when the binary is present but no config is written, it says "installed, model slots not configured" (pinned by the `10-cc-noconfig` fixture's e2e, with a different remedial sentence than "not installed").
- The claude this probe really runs is a **stub** (version 9.9.9-probe is unmistakable), so the versions and paths in the evidence are the probe's own, not readings of this machine's real claude.
- Leg B's model slots come from this machine's real `~/.claude/settings.json` (the isolated stack's daemon reads the real home), so `model-sources-b.json` shows the real slots — this is not a leak, the same face as `docs/verify/707`.

## Files

| file | content |
|---|---|
| `01-installed-logged-in.png` | leg A header card screenshot (fine-print line + version + path) |
| `02-binary-missing.png` | leg B header card screenshot (not installed + guidance) |
| `result.json` | the 13 checks itemized with results and details |
| `daemon-a.log` / `daemon-b.log` | the two legs' daemon output (the probe lines live here) |
| `model-sources-a.json` / `model-sources-b.json` | the API envelope verbatim (the bin/auth two-state contrast) |
| `page-a.txt` / `page-b.txt` | the header card's innerText verbatim |
