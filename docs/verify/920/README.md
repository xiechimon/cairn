# #920 verification evidence index — skill distribution "manifest + fetch-on-demand"

Probe = `.claude/skills/verify-pacman/scripts/drive-920-skills-manifest.mjs` (pure HTTP + fs + SQLite read-only, no browser face).
Run date 2026-10-07; new stack = this branch's worktree (server 8791 / web 5273, scratch `PACMAN_HOME`, the fixture skill library dropped by the probe); the before baseline stack = a throwaway `origin/main` worktree (server 8793 / web 5275, an independent run dir); daemon = this branch's code `tsx src/cli.ts start --foreground`, each with its own independent scratch home (`/tmp/pacman-920-daemon-home-{c1,d1}`); stub LLM = `stub-llm-verify.mjs` (`STUB_PORT=8919 STUB_DELAY_MS=500`).

**46/46 checks all green**, five evidence groups:

| directory | phase | checks | ticket acceptance seams covered |
|---|---|---|---|
| `wire-new/` | `--phase=wire --expect=new` | 14/14 | an oversized file no longer fails the whole bundle (a 727,976B single file + a 2.98MB library still produce a manifest); the manifest triples = on-disk ground truth (12/12 sha256/size matched); the file endpoint verifies byte-level 12/12 + binary honesty; the negative 8 faces 404 (another machine's credential / unknown step / outside the whitelist / escape shapes) |
| `daemon-success/` | `--phase=daemon-success` | 11/11 | skill files land on disk and are readable, the count matches the manifest (12 files byte-equal to the server-side ground truth; `[skills] loaded: 4 skills from <views dir>` = the runtime catalog really consumed); blobs are content-addressed and deduplicated (8 unique contents) |
| `daemon-incremental/` | `--phase=daemon-incremental` | 8/8 | incremental: after changing one file, the second step reports `fetched 1 file(s) / 1060 byte(s), reused 11` — the byte count is assertable (1024B before the change → 1060B after, only the new one transferred) |
| `wire-old-before/` | `--phase=wire --expect=old` | 5/5 | before baseline: the same library and request against the `origin/main` old whole-bundle endpoint → 400 `skill file too large: assets/template.html is 727976 bytes (limit 512000)` — the #920 root-cause fingerprint reproduced |
| `daemon-fail-old-server/` | `--phase=daemon-fail` | 8/8 | endpoint 4xx errors are observably explicit, not a silent empty manifest: new daemon × old server → the step closes `failed`, `build.errorMessage = team skills distribution failed: machine api 400: …` (the SQLite row is in the DB = UI-observable), daemon.log `team-skills-failed` + a direct `[step] failed:` line, zero materialization, zero session |

The substitute reading for the "remote machine" criterion: the daemon and the server communicate only over the HTTP wire and each holds an independent home — the isolated daemon home walks the same code path as a real remote machine (enroll/claim/skills/done), so "this machine holds no skill copy" is equivalent to the "a different machine gets an empty skill face" scenario.

## Rerun recipe

```sh
# new stack, three phases
node .claude/skills/verify-pacman/scripts/launch.mjs            # VERIFY_REPO_ROOT=<worktree>
node .claude/skills/verify-pacman/scripts/drive-920-skills-manifest.mjs --phase=wire --expect=new
STUB_PORT=8919 STUB_DELAY_MS=500 node .claude/skills/verify-pacman/scripts/stub-llm-verify.mjs &   # background
# seed: GET /api/teams for the teamId; POST /api/teams/{t}/api-keys for the plaintext (curl always with --noproxy '*')
cd apps/daemon && env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY NO_PROXY='*' \
  PACMAN_HOME=/tmp/pacman-920-daemon-home-<new-suffix> pnpm exec tsx src/cli.ts start --foreground \
  --server http://127.0.0.1:8791 --api-key <plaintext> --team <teamId> --name verify-920 &        # background
DAEMON_HOME=<same as above> node .../drive-920-skills-manifest.mjs --phase=daemon-success
DAEMON_HOME=<same as above> node .../drive-920-skills-manifest.mjs --phase=daemon-incremental

# before baseline, two phases (a throwaway origin/main worktree + independent ports/run dir)
git worktree add --detach /tmp/pacman-before-920 origin/main && (cd /tmp/pacman-before-920 && corepack pnpm install)
VERIFY_REPO_ROOT=/tmp/pacman-before-920 VERIFY_RUN_DIR=/tmp/pacman-before-920-run VERIFY_PORT=8793 VERIFY_WEB_PORT=5275 \
  node /tmp/pacman-before-920/.claude/skills/verify-pacman/scripts/launch.mjs
SERVER=http://127.0.0.1:8793 VERIFY_RUN_DIR=/tmp/pacman-before-920-run \
  node .../drive-920-skills-manifest.mjs --phase=wire --expect=old
# seed another api-key on the old server, start a second daemon home pointing --server at 8793, then:
SERVER=http://127.0.0.1:8793 VERIFY_RUN_DIR=/tmp/pacman-before-920-run DAEMON_HOME=<d1 home> \
  node .../drive-920-skills-manifest.mjs --phase=daemon-fail
```

## Reading the results (the three points a rerun will hit)

- **A step closing failed with `构建零改动` is expected**: the stub session has zero write-class tool rows → `sawChangeTool=false` → the artifact gate (`stepArtifactGate`) judges failed. That gate sits **after** the skills seam, so reaching it proves the distribution/materialization/session chain was not blocked; the probe accepts this shape per `sessionRanToCompletion`.
- **The first pull reports `fetched=8 / reused=4` instead of 12/0**: the fixture's five heavy/p0..p4 files share content → same sha256 → the blob content-addressing dedups them on the very first pull. The expected value is computed dynamically from the fixture's unique-sha count.
- **The `step` table has no errorMessage column**: the step-failure root cause lands in `build.errorMessage` (written by `completeStep`); the SQL criterion must read the build row.
