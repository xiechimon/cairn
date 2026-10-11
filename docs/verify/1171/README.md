# #1171 验收证据索引（团队技能原生插件通道）

探针：`.claude/skills/verify-pacman/scripts/drive-1171-native-plugin.mjs`（两相位）。
栈坐标：`VERIFY_PORT=8797 VERIFY_WEB_PORT=5279`，daemon 由探针自 spawn 自回收
（wire 相位 `PACMAN_CLAUDE_BIN` 注入假 CLI 零 LLM；behavior 相位真 claude + glm-5.3）。
复跑：先 `node .claude/skills/verify-pacman/scripts/launch.mjs`（上述端口），再
`node .claude/skills/verify-pacman/scripts/drive-1171-native-plugin.mjs --phase=wire|behavior`。

## wire/（32/32，零 LLM，假 CLI 捕获 argv）

| 文件 | 内容 |
|---|---|
| `result.json` | 32 条 check 逐条 ok/label |
| `wire-a-daemon-skills-log.txt` | 腿 A（allowlist [marker-alpha]）`[skills]` 行族：native-plugin 交付行 / deny 1 dir / catalog filtered 行 |
| `wire-a-cli-argv.json` | 假 CLI 捕获的 SDK spawn argv：`--plugin-dir <plugins/<key>>` + settings.permissions.deny 三条（`Skill(local-only-1171)` 等） |
| `wire-a-worktree-status.txt` | 腿 A 失败收尾后 worktree `git status --porcelain`（空 = 零残留） |
| `wire-b-*` | 腿 B 版本闸：claude 2.0.5 → `native-plugin: skipped (claude 2.0.5 < 2.1.74…)`、argv 无 --plugin-dir、无 plugins 目录、catalog 照常 |
| `wire-c-*` | 腿 C allowlist []：`team-manifest-empty` 行、无 native-plugin 行、argv 无 --plugin-dir |
| `wire-d-*` | 腿 D allowlist null：native-plugin 2 skills、skills/ 不含本机技能、零 deny 行、catalog 与 native 并存（injected 选择零命中时 entries=0 而 native 照交付 = P3 活体演示） |
| `wire-daemon1/2-version-line.txt` | #1050 探测行（假 CLI 版本回显） |
| `fake-cli-capture-1/2.jsonl` | 假 CLI 原始 argv 捕获流 |

盘上实物（探针内断言，未复制进仓）：`<DAEMON_HOME>/team-skills/plugins/<key>/.claude-plugin/plugin.json`
（name=pacman-team-skills、无 mcpServers）+ `skills/<dirName>/SKILL.md` 与 view 同 inode（hardlink）。

## behavior/（10/10，真模型腿）

| 文件 | 内容 |
|---|---|
| `result.json` | 10 条 check 逐条 ok/label |
| `behavior-skill-toolcall.json` | **主判据**：transcript 段行 `kind:'toolcall'` name=`Skill`、arguments.skill=`pacman-team-skills:haiku-native-1171`、result=`Launching skill: …`——任务文本未点名技能，原生发现自命中 |
| `behavior-messages.json` | 全 transcript（含 marker 复述行） |
| `behavior-daemon-skills-log.txt` | native-plugin 交付行 + catalog/deny 行族 |
| `behavior-plugin-dir.json` | 插件目录 skills/ 只含 allowed |
| `behavior-worktree-status.txt` | done 收尾后 worktree `git status --porcelain`（空） |
| `behavior-repo-skill-head.txt` | 预植 `.claude/skills/repo-native/SKILL.md` 在 HEAD 逐字节保留（验收 3） |
| `behavior-artifact-haiku.txt` | 真会话产物 haiku.txt |
| `behavior-attempts.json` | 步尝试记录（1 次 done） |

## 图

`native-plugin-channel.drawio.svg`（PR body `## What` 内嵌）：双通道并存全景——
server 授权过滤 → daemon 缓存（blobs/views/**plugins 新分区**）→ 原生插件通道
（collectTeamSkillEntries → hardlink 装配 → SDK plugins → --plugin-dir → CLI 原生
Skill 发现面）与既有 catalog XML / pi skillPaths 两通道；版本闸与 deny 面标注在位。
