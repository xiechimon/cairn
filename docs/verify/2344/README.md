# Verify #2344 — sandboxed batch `claude -p` denied reads of Mac secret paths

Host: the owner's Mac (`xmon`), claude 2.1.328, `@anthropic-ai/sandbox-runtime` 0.0.83
(the runtime `claude` shells out to for the `sandbox` settings). This round scopes the
sandbox to **batch** `claude -p` sessions only; the earlier project-settings approach
(commit `1d30a42a6`) was reverted after owner measurement showed it blocks everyday
development (git over the local proxy port, `gh`, Keychain) for every session.

## What changed

- `scripts/ops/secret-reach/batch-sandbox.settings.json` — standalone settings file
  launched with `claude -p ... --settings scripts/ops/secret-reach/batch-sandbox.settings.json`.
  `failIfUnavailable: true`, `allowUnsandboxedCommands: false`; `denyRead` covers the
  cairn secret roots, all of `~/.config` (the real credential stores on this Mac live
  there: cairn env files, `gh`, `anthropic`, `devin`, `mcp`, …), `~/.local/share/cairn`
  (runner state and tokens), `~/.local/share/devin` and `~/.local/share/opencode`
  (agent credential stores), `~/Library/pnpm/rc` (npm token), the shell rc files and
  `~/.npmrc` (key exports), `~/Library/Application Support/Claude` (Claude Desktop MCP
  keys) and the usual credential paths, with narrow `allowRead` carve-outs for
  `~/.cairn/{workspaces,plans,tools}`, `~/.config/git` and the runner workspaces.
  `permissions.deny` `Read(...)` rules cover the same secrets for the file tools,
  which run outside the sandbox. A `denyWrite` overlay protects what an unsandboxed
  process would later trust: the checkout's `.claude/**` (hooks/settings/skills —
  the sandbox-runtime baseline already denies `.claude/commands` and `.claude/agents`),
  `CLAUDE.md`/`AGENTS.md` (persistent prompt injection), `~/Library/pnpm/rc` (registry
  injection into the next unsandboxed `pnpm install`) and `~/.cache/lane-tmp` (other
  lanes' temp dirs). Package-manager credential stores (`~/.cargo/credentials.toml`,
  `~/.pypirc`, `~/.m2`, `~/.gradle`, `~/.azure`, `~/.terraform.d`, …), the shell and
  REPL histories (`~/.zsh_history`, `~/.local/share/fish`, `~/.aider.*.history`),
  `~/.cache/huggingface`, the VS Code app-data tree and the `@cairn/desktop`
  Electron stores (`Network/Cookies`, `Local Storage`, `Session Storage`,
  `IndexedDB`, `Cache`, `Code Cache`, `GPUCache`, `databases`, `Preferences`) are
  denied the same way. `permissions.deny` pairs the `Read(...)` rules — which also
  block Write on the same path — with `Edit(...)` denies for the trusted-write
  set the sandbox denyWrite already covers (`**/.claude/**`, `**/CLAUDE*.md`,
  `**/AGENTS*.md`, `**/.git`, `~/.cache/lane-tmp/**`); without them the file
  tools could `Write` a hook into `.claude/settings.json` that the next
  unsandboxed session executes.
- `scripts/heavy-slots.mjs` — the liveness probe socket moved from `/tmp` into the slot
  lock directory, so a sandboxed run can bind it wherever `CAIRN_HEAVY_SLOTS_DIR` points.
  A probe a waiter cannot reach (EPERM/EACCES, e.g. a seatbelt-denied path, or
  ENOTSOCK/ENOTDIR from a planted record) now falls
  back to `isAlive(pid)` instead of crashing the acquisition; stale-probe cleanup keeps
  accepting the legacy `/tmp` path and tolerates permission errors.
- `scripts/ops/secret-reach/README.md` — the batch launch command, the heavy-slots
  env override, and the corrected red control (an inline
  `--settings '{"sandbox":{"enabled":false}}'` does *not* disable a `--settings` file's
  sandbox — measured on this Mac).
- `.claude/settings.json` — unchanged from `main` (only the SessionStart hook). Project
  settings carry no `sandbox` block, so interactive sessions are unaffected.

## Batch `claude -p` launch points on the owner Mac

No launcher for batch `claude -p` sessions exists inside this repository — everything
that spawns `claude` here is a lane session (daemon `claude-code` backend via the
Agent SDK, `apps/daemon/src/engine/claude-tui.ts`), which is out of scope. The batch
launch points all live outside the repo; each needs `--settings
<checkout>/scripts/ops/secret-reach/batch-sandbox.settings.json` (absolute path when
the working directory is not a cairn checkout):

- `~/.agents/scripts/skill-probe.sh` (line 6) — the manual skill-probing helper.
- `~/.claude/scheduled-tasks/` — Claude Desktop scheduled tasks (the weekly retro
  moved there); the lane could not read this directory, so the owner must add
  `--settings` to each `claude -p` task inside it.
- Manual `/goal` headless runs — the copy-paste recipe is documented at
  `docs/spec/28-bootstrap-closed-loop-self-authored-self-merged.md` §7.4
  (`claude -p "<…>" --permission-mode auto --max-budget-usd <cap> --output-format
  stream-json --verbose`). Append the same `--settings` flag when running it.

Interactive `claude` sessions (the `cc` fish abbreviation, `claude` in a terminal)
deliberately get no `--settings` and no sandbox — everyday development is unaffected.

## Evidence files

- `owner-control.jsonl` — negative control, exit 1 (red): the canary run unsandboxed as
  the owner on the four real secret files this Mac has
  (`~/.config/cairn/{slack-app,composio,telegram}.env`,
  `~/Library/Application Support/@cairn/desktop/otel.env`). Every ordinary channel —
  direct, symlink, python, node, sh, subprocess-file — read bytes: 24 `yes`,
  7740 bytes total. The `git-*` channels report `no` because the files are not valid
  git config — expected even in the owner control, per the canary README. Run inside a
  seatbelt-confined cairn lane; those four paths are outside its deny list, which is
  what the control needs.
- `srt-profile.sb` — the Seatbelt profile `@anthropic-ai/sandbox-runtime` 0.0.83
  generates from the shipped settings with `~` expanded to the owner home (empty
  `allowedDomains`; `claude` adds its own domain list at launch — the filesystem rules
  are the payload here). It shows `(deny file-read* (subpath "/Users/xmon/.config")
  (subpath "/Users/xmon/.cairn") …)` followed by the narrower `(allow file-read* …)`
  carve-outs, and `file-write*` allowed only under the launch cwd, `/tmp/claude`,
  `~/.cache`, the package caches and `~/.cairn/plans`. It predates the
  security-review hardening (`denyWrite` overlay, extended `denyRead`), so step 4's
  owner run should regenerate it and confirm the new `deny file-write*` rules for
  `.claude`, `CLAUDE.md`, `AGENTS.md`, `~/Library/pnpm/rc` and `~/.cache/lane-tmp`
  appear. Reproduce with:

  ```sh
  npm install --ignore-scripts @anthropic-ai/sandbox-runtime@0.0.83
  node -e '
    const {SandboxManager} = require("@anthropic-ai/sandbox-runtime");
    const cfg = {network: {allowedDomains: [], deniedDomains: []},
      filesystem: {/* denyRead/allowRead/allowWrite from batch-sandbox.settings.json, ~ expanded, denyWrite: [] */}};
    await SandboxManager.initialize(cfg, async () => "allow");
    console.log(await SandboxManager.wrapWithSandbox("echo hi"));
  '
  ```

## Owner steps this lane cannot run

The verifying lane is itself seatbelt-confined: `sandbox_apply` returns EPERM (no nested
seatbelt) and `claude` is not logged in under its home, so the literal `claude -p`
acceptance runs stay owner steps.

1. Sandbox canary — expect every channel `no`, 0 bytes, exit 0:

   ```sh
   cd <cairn checkout>
   claude -p 'run `node scripts/ops/secret-reach/canary.mjs --profile mac \
       --path ~/.config/cairn/slack-app.env --path ~/.config/cairn/composio.env \
       --path ~/.config/cairn/telegram.env \
       --path "$HOME/Library/Application Support/@cairn/desktop/otel.env"` and paste its output' \
     --settings scripts/ops/secret-reach/batch-sandbox.settings.json
   ```

2. Everyday-dev regression — a plain `claude -p` in the same checkout must still reach
   git and gh (no `--settings`):

   ```sh
   claude -p 'run `git fetch --dry-run` and `gh api user --jq .login` and paste the output'
   ```

3. `pnpm prepush` inside the batch sandbox — the measured blocker was heavy-slots
   binding `/tmp/cairn-heavy-*.sock` (`listen EPERM`). The probe now binds inside
   `CAIRN_HEAVY_SLOTS_DIR`, so launch with the documented override and expect prepush
   to pass:

   ```sh
   CAIRN_HEAVY_SLOTS_DIR="$HOME/.cache/cairn-heavy-slots" CAIRN_HEAVY_SLOTS=1 \
     claude -p 'run `pnpm prepush` and paste its tail' \
     --settings scripts/ops/secret-reach/batch-sandbox.settings.json
   ```

   The slot dir is private to batch runs, so it no longer counts against the shared
   lane lease — `CAIRN_HEAVY_SLOTS=1` caps the bypass at one heavy job. If prepush
   still fails inside the sandbox, record the step and error here as a residual.

4. Escape probes the security review flagged — `mach-lookup` to LaunchServices and
   `securityd` is allowed by the sandbox-runtime baseline and not settable in the
   settings file. If `open` can launch a program outside the seatbelt profile, or
   `security` can dump a keychain item, the denyRead list is bypassable and this needs
   a Cairn-owned profile (like `confine-seatbelt.ts`) instead of `--settings`:

   ```sh
   claude -p 'run `echo "cat ~/.ssh/id_rsa > ~/.cache/leak" > ~/.cache/poc.command && chmod +x ~/.cache/poc.command && open ~/.cache/poc.command; sleep 2; ls -la ~/.cache/leak` and `security find-generic-password -l "Claude Code-credentials" -w 2>&1 | head -1` and paste the output' \
     --settings scripts/ops/secret-reach/batch-sandbox.settings.json
   ```

   Expect: `open` fails or `~/.cache/leak` never appears, and `security` returns an
   error/empty. Also confirm the denyWrite overlay took effect — appending to
   `.claude/settings.json` or `~/Library/pnpm/rc` inside the sandbox must fail, and
   `cat ~/.local/share/devin/credentials.toml` must be refused.

## `dangerouslyDisableSandbox` and permission modes

- `allowUnsandboxedCommands: false` makes Claude Code ignore the
  `dangerouslyDisableSandbox` Bash parameter — unsandboxed retries are refused.
- `permissions.deny` rules are enforced in every permission mode; `bypassPermissions`
  skips prompts, not deny rules.
- The red control is the unsandboxed owner run — measured: an inline
  `--settings '{"sandbox":{"enabled":false}}'` cannot undo a `--settings` file's
  `sandbox.enabled`.
- Residuals outside the sandbox boundary by design: hooks, MCP servers and file tools
  run outside the sandbox (file tools covered by `permissions.deny` best-effort).
  A sandboxed command can still edit `package.json`/`pnpm-lock.yaml` to plant a
  `postinstall` the next unsandboxed `pnpm install` would run — mitigated by
  `**/scripts/**` and package files being protected merge-gate paths on landing, and
  by the outer launcher reviewing `git status` before unsandboxed installs; a
  denyWrite on `package.json` was weighed and rejected because batch sessions
  legitimately add dependencies.
- `~/.gitconfig` stays readable so batch sessions can `git commit` (it carries the
  author identity); token-bearing helpers it could reference are covered separately
  (`~/.git-credentials`, all of `~/.config`, the keychain paths).
- Not covered: secrets outside the denied roots (other `~/Library` stores, browser
  profiles beyond the listed ones, `~/Library/Group Containers`), `~/Library/Caches`
  contents, `~/.cairn` files added after this list was written (the file-tool deny
  enumerates known names, not the whole tree, so workspace carve-outs keep
  working), writable-scope spillover (`~/.cairn/plans` is intentionally writable
  and could feed tainted content to other sessions), and any session launched
  without `--settings`. Whether `pnpm install` tolerates `~/Library/pnpm/rc` being
  unreadable inside the sandbox is open until step 3 runs; the `open`/`security`
  escapes are open until step 4 runs.
- Sandbox `denyWrite` entries resolve as plain paths and get no `**/name` glob, so
  sandboxed Bash can still write a *nested* `apps/web/AGENTS.md` or
  `apps/web/.claude/settings.json` under the launch cwd (persistent prompt
  injection into later sessions, and `claude` reads subdirectory instructions
  when its cwd permits). The `Edit(**/...)` denies close the same path for the
  file tools; the Bash residual stands until launch points cd into a dedicated
  subdir or the runtime learns glob denyWrite. The `.git` entry itself cannot be
  denyWrite'd — a whole-`.git` write deny breaks `git`'s own index/ref writes in a
  normal checkout — so a linked-worktree pointer rewrite stays Bash-possible;
  the file tools are covered by `Edit(**/.git)`/`Edit(**/.git/**)`, and the
  runtime baseline already denies `.git/hooks` and `.git/config`.
- `~/.cache` is readable and writable, so the package caches can be poisoned for
  the *next unsandboxed* consumer: `~/Library/Caches/ms-playwright` browser
  binaries (executed by a later `playwright` run) and `~/Library/pnpm` store
  files (hardlinked without re-verification by a later `pnpm install`) — same
  bug class as the documented `package.json` postinstall residual, mitigated the
  same way (merge-gate protected paths + outer-launcher `git status` review).
  `go/pkg/mod`, `.cargo/registry` and `.npm` are checksum-verified consumers.
- `~/.cache/lane-tmp` is denyWrite'd but still readable — other lanes' temp files
  are readable to a batch session; they are treated as non-secret by design. The
  batch slot dir it writes (`~/.cache/cairn-heavy-slots`) can carry planted
  `slot-*.lock`/`queue-*` records: a forged live pid wedges the pool (same-uid
  DoS only — `chmod 0700` blocks other uids), and a probe path that is not a
  socket now degrades to pid liveness instead of crashing every acquirer.
- The sandboxed process inherits the launcher's environment unscrubbed:
  `GH_TOKEN`, `ANTHROPIC_API_KEY` and friends exported in the launching shell are
  visible inside the session. Batch launch points should scrub token env vars;
  the settings file cannot express it.

## Lane sessions

Out of scope by owner decision: daemon `claude-code` lane sessions keep their own
confinement (`apps/daemon/src/backend/confine-seatbelt.ts`); their credential
isolation is tracked in #5393, designed together with #5006.
