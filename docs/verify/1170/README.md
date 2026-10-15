# #1170 技能导入通道（localPath + GitHub URL + refresh）— live 证据

- probe：`.claude/skills/verify-pacman/scripts/drive-1170-skill-import.mjs`
- 运行日：2026-10-10（栈 = worktree live 栈，server 8795 / vite 5277 / 独立
  `PACMAN_HOME` scratch；server 以 `NODE_USE_ENV_PROXY=1` 启动——出站 GitHub
  走本机代理，`lib/github.ts` 头注记录的部署形态）
- 判读：`result.json` checks 31/31 全 PASS，每条 `ok` 是布尔；红态面（D 组）为真拒绝，非模拟。

| 组 | 覆盖 | 关键真值 |
|---|---|---|
| A | localPath 导入（web 真用户路径：topbar 导入钮 → 弹窗 → 提交） | `a-localpath-list.png`、`a-import-rest-rows.json`（record + 12 文件对拍盘上文件集）、`sources-records.json`（kind=localPath + realpath ref） |
| B | GitHub URL 导入（真 anthropics/skills 子目录 skills/pdf，12 文件） | `b-github-list.png`、`sources-records.json`（kind=github + canonical URL 含 ref） |
| C | refresh 重拉 + 物化接力 | `c-manifest-before.json` / `c-manifest-after.json`（同 id `my-live-skill`，SKILL.md sha256 `9dfa1e23…` → `fb01a52d…`）、`c-skill-audit-rows.json`（create×2 + update×2，actor=member）、C1 手建技能 409 说明 |
| D | 红态面（真拒绝） | `d-red-states.json`：SSRF 逐形（http://127.0.0.1、私网段 192.168.1.5、非 GitHub host）、localPath 落技能根内、二进制文件、超单文件上限（512001 > 512000）；`d-red-ui.png` = 弹窗内联错误行 + server 原文 |

## 已知边界（实测定格，非缺陷）

- `anthropics/skills` 的 `skills/academy-guide` 一类折叠形 frontmatter
  （`description: >`）被最小解析器按缺省回落 → 导入 400「description is
  required」——与 `parseSkillFrontmatter` 的既有解析语义同律（shared
  records/skill.ts 头注：折叠块标量不受理）。选导入目标时挑单行
  description 的目录（`skills/pdf` 即是）。
