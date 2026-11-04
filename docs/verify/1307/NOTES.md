# #1307 three-state managed MCP — verification evidence index

Ticket: #1307 (the daemon's claude-code sessions inherited the user's global MCP — 320 tools / 960KB of schema
ate the glm window, autocompact thrash inevitable). The fix aligns with Multica's three-state managed MCP
(`multica` `server/pkg/agent/mcp_config.go` / `claude.go`): the claim/SessionOpts `mcpServers` default =
inherit the runtime config (the old-server shape / version-walled machines, the escape hatch); an array
(including `[]` = managed strictly-empty) = the managed set → the claude-code backend sends the `mcpServers` key
(always sent, including the in-process `pacman` seam) + `strictMcpConfig: true` (SDK → CLI
`--strict-mcp-config`: the user's global / project .mcp.json / plugin MCPs are all ignored,
`sdk.d.ts:2200` verified present on the local 0.3.278).

Mechanism-class claims all take runtime ground truth (the repo rule "mechanism-effect acceptance: artifact criteria"). This directory has three artifact groups:

## 0. The pre-fix field baseline (the same session archive shape as the ticket's forensics)

- `baseline-dogfood-b70499b7.json` — the failed session of the dogfood task `abycCXdnb0yXJQN0TXKdF`
  (`~/.claude/projects/-private-tmp-pacman-chain-daemon-home-workspaces-*/b70499b7-*.jsonl`,
  agent DB `mcpServers='[]'`, 4/4 autocompact thrash), the histogram of the last
  `attachment[type=prompt_snapshot].tools`: **319 tools / 960,035 bytes**,
  `mcp__rea` 170 / `mcp__plugin_figma_figma` 42 / `mcp__agent-native-design` 41 /
  `mcp__playwright` 25 / `mcp__pacman` 7 — matching the ticket's "320 entries ≈ 960KB" verbatim.
  This is the field artifact of "inheriting the user's global MCP".

## 1. The probe (real SDK + the real daemon assembly function)

- `probe-sdk-1307.mts` — the probe script. The real `@anthropic-ai/claude-agent-sdk@0.3.278`
  + **the real `buildClaudeSdkOptions` itself** (tsx directly loads `apps/daemon/src/backend/claude-code.ts`,
  not a hand-copied shape). Reproduce (the two group-B prerequisites below):

  ```sh
  cd apps/daemon && env -i HOME="$HOME" TMPDIR=/tmp PATH="<fnm bin>:/opt/homebrew/bin:/usr/bin:/bin" \
    ANTHROPIC_AUTH_TOKEN="$ANTHROPIC_AUTH_TOKEN" ANTHROPIC_BASE_URL="$ANTHROPIC_BASE_URL" \
    pnpm exec tsx ../../docs/verify/1307/probe-sdk-1307.mts
  ```

  - Group B must start in a **clean environment** (no `CLAUDECODE` / `CLAUDE_CODE_*` nesting markers):
    in a nested Claude Code session environment the child CLI does not load the user's global MCP — the control arm would go
    **false negative** (measured in the first two rounds: builtin-only, the leak does not reproduce).
  - Group B must use the **machine's claude executable** (this machine's 2.1.294, overridable via `PROBE_EXECUTABLE`):
    the SDK's bundled CLI 2.1.278 likewise does not load user-global mcpServers in the SDK spawn shape; the dogfood leak session
    and the daemon's production shape (#1050 executablePath probing) were both written/started by the machine's claude, so the control arm must align with that shape.
  - The model defaults to glm-5.3 (`PROBE_MODEL` overridable); `SKIP_B=1` runs group A only.
- Group A (argv capture, no network): a stub executable as `pathToClaudeCodeExecutable`,
  capturing the arguments the SDK actually hands to the CLI:

  | arm | input (buildClaudeSdkOptions parts) | artifact result |
  |---|---|---|
  | A1 managed | `mcpServers: {}` + `strictMcpConfig: true` | ✅ argv contains `--strict-mcp-config` (`argv-managed.json`) |
  | A2 inherit | `mcpServers: {}` (strict defaulting) | ✅ argv has no mcp flags at all (`argv-inherit.json`, zero regression on the escape hatch) |

- Group B (real-session contrast, the prompt_snapshot criterion same method as §0):

  | arm | shape | tools histogram | verdict |
  |---|---|---|---|
  | B1 control-inherit | the pre-fix shape (managed-empty but the key not sent) | **56 tools / 148,947B = builtin 31 + `mcp__playwright` 25** | ✅ the user's global MCP leaks into the session (the #1307 mechanism reproduced) |
  | B2 managed-strict | the post-fix shape (strict + the in-process pacman seam with 1 dummy tool) | **28 tools / 122,030B = builtin 27 + `mcp__pacman` 1** | ✅ zero global MCP; the host seam stays alive |

  The same clean environment, the same machine claude, the same model — the only variable is the managed state (the strict flag) —
  the `mcp__playwright` that leaks in B1 disappears completely in B2, and the `mcp__pacman` seam tool
  (`probe_echo`) is present in B2. B1 leaks only the playwright family (the dogfood field was the whole
  rea/figma/design/playwright family at 319 entries): under `env -i`'s trimmed PATH the other global
  stdio servers cannot start — this does not affect the verdict; the leak face "present/absent" is binary, and the strict lock
  locks away even the one that was present.

  Raw artifacts = `session-contrast.json` (sessionId / transcript paths /
  promptSnapshotBytes / per-arm histograms / model replies). The group-B session archives live at
  `~/.claude/projects/-var-folders-*/<sessionId>.jsonl` (reviewable on this machine).

## 2. The unit-test pin faces (red → green, frozen before the implementation)

- `apps/daemon/test/claude-mcp-strict.test.ts` — the assembly face's four states (managed: the empty key always sent +
  strict / managed: non-empty passed through + strict / default: empty does not send the key / default: non-empty sends the key without strict).
- `apps/daemon/test/runner-mcp-managed.test.ts` — the runner's three-state pass-through (claim `[]`
  → the SessionOpts key present as `[]`; claim default → the key defaults; an unknown slug degrades without flipping the managed-ness;
  the managed-empty observation row).
- `apps/server/test/mcp-servers.test.ts` — the claim payload's three states (managed-empty carries `[]`;
  only below the version gate does it default). The old assertion "unauthorized (nothing checked) = not carried" is exactly
  the pin face of this ticket's main fix position, flipped with the semantics.

Red-light archive: 5 failed before the fix (the daemon's new faces) + 1 failed (the server claim face),
and every failing assertion is the main-fix-position criterion (`'mcpServers' in opts` / `strictMcpConfig` / `toEqual([])`).
