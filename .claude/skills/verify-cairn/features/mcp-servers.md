# MCP 页(只读本地 config 面)

spec 13/#368 起 MCP 页 = server 本机 `~/.claude.json` mcpServers 段的只读投影:无新建/编辑入口,空态文案即配置指引。执行面在 daemon:claim 载荷只携 slug 列表(版本墙 ≥0.2.0),daemon 读**自己机器**的 config 解析端点并 per-turn 连接——凭证(env/headers 值)只活在 config 文件与执行机,从不进 server DB / wire / API 响应。

## Sub-features

- `mcp-list`: GET `/api/teams/{id}/mcp-servers` = config 投影 record(label=键名、slug=键小写、stdio 的 url 槽=command 预览、hasCredential/credentialKeys 只键名)。
- `mcp-readonly`: 页面无新建入口(`[data-testid="resource-new"]` 计数 0)、行无更多菜单 ink(`[data-testid="resource-row"]` 行内 `button` 计数 0,dead-buttons.spec 同 canon)、无弹窗;POST/PATCH/DELETE 同路径 = 404。
- `mcp-empty`: config 文件缺失/无 mcpServers 段 = 空态,文案指向 `~/.claude.json`(fixture e2e dead-buttons #368 钉)。
- `mcp-exec`: agent.mcpServers[] 勾选后,daemon 本机解析连接;未知 slug 降级行 `[mcp] <slug>: not in local config — …`,每回合 `[mcp] loaded from <path>: …` 打出实际加载集。

## How to get to it (user POV)

- 侧栏 资源 ▾ → MCP;用户菜单 → MCP;搜索面板导航行 MCP。
- URL 直达 `/app/resources/mcp-servers`(live 模式,不带 `?scenario=`)。
- 驱动(`vp.mjs list mcp-servers` 列出全部 case 与 usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive mcp-servers readonly-config`:MCP 页只读 config 投影;launch 时带 `CAIRN_MCP_CONFIG=<fixture claude.json>`。
  - 判 stale、不带 `--force` 拒跑的 case(拒跑时打印原因):`vp.mjs drive mcp-servers command-gate-mcp-bridge`(建 agent 不带 machineId,ADR 0019 起 400)。

## Driving it with verify-cairn

Preconditions:
1. 写 fixture config(勿用真 `~/.claude.json`,防真配置键名进证据):
   ```sh
   cat > /tmp/verify-claude-368.json <<'EOF'
   {"mcpServers":{
     "demo":{"url":"https://example.invalid/mcp","headers":{"Authorization":"Bearer v3r1fy-header-secret"}},
     "local":{"command":"node","args":["-e","0"],"env":{"PROBE_KEY":"v3r1fy-env-secret"}}
   }}
   EOF
   ```
2. launch 时带 env(server 进程经 `{...process.env}` 透传):
   ```sh
   CAIRN_MCP_CONFIG=/tmp/verify-claude-368.json VERIFY_REPO_ROOT=<worktree> \
     VERIFY_PORT=<port> VERIFY_WEB_PORT=<port> node .claude/skills/verify-cairn/scripts/launch.mjs
   ```
3. 定制 probe:
   ```sh
   VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-cairn/scripts/drive-mcp.mjs
   ```

- probe 断言面:API JSON(slugs/transport/credentialKeys 投影 + 密钥值不出现 + 写面三动词 404)、SQLite(`mcp_server` 表不存在)、UI(行渲染 = config 键名(`[data-testid="resource-row"][data-mcp]` 行 + 行内精确文本节点)、`[data-testid="resource-new"]`/行内 `button` 均 0)+ 截图。
- 执行面(daemon 解析 slug 真连外部 MCP server)不铺 UI 栈配方——正源 = `integration/test/m4b-mcp-e2e.test.ts`(真 server + 真 daemon + stub LLM + 测试内起外部 MCP),跑该集成测试即本面证据;断言含 `mcp__demo__echo` 真调用、dead 端点 connect-failed 行、ghost slug not-in-config 行、loaded-from 行。

## Gotchas

- `CAIRN_MCP_CONFIG` 必须在 launch **之前** export(launch.mjs 起 detached 子进程时快照 env);栈起后再设无效,须 cleanup 重 launch。
- 不带该 env = server 读**真** `~/.claude.json`——用户真实配置的键名会进截图/API 证据,验证一律用 fixture。
- record 的 createdAt/updatedAt = config 文件 mtime,页面相对时间列(「X 分钟前」)语义是「配置最近修改」,不是登记时间。
- daemon 执行面读的是 **daemon 所在机器**的 config(多机各读各机,spec 13 Q6)——单机验证栈两侧同文件是退化形;跨机分歧看 `[mcp] loaded from <path>` 行的实际路径。
- 改码后必须重 launch(worktree 在 `.claude/worktrees/` 下,vite watch 忽略罩住整个 worktree,运行中改码不生效)。
- **#944 载体迁移**:类名钩 → 语义/data-* 载体(断言语义不变)——`.res-rowcard--mcp` → `[data-testid="resource-row"][data-mcp]`、`.res-empty` → `[data-testid="resource-empty"]`、`.res-row-title` → 文案一级(行内精确文本节点)、`.res-new` → `[data-testid="resource-new"]`、`.res-row-more` 负向 → 行内 `button` 计数 0。
