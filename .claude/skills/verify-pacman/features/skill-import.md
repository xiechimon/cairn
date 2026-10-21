# 技能导入通道（技能页 + server 收集器 + refresh，#1170）

技能进入 server 库的既有唯一通道是 web 表单/API 手建（`createLocalSkill`）；
#1170 加第二条：**导入**——`POST /api/teams/{id}/skills/import`（body
`{localPath}` 或 `{url}` 二选一）+ **refresh** `POST
/api/teams/{id}/skills/{sid}/refresh` 按记录的来源重拉（id 不变，复用
`updateLocalSkill` 覆写语义）。落盘一律复用 createLocalSkill/updateLocalSkill
既有校验（目录名正则 / frontmatter 唯一真值 / 字节闸 / 审计行），**不另开写
路径**——`services/skill-import.ts` 只做「把来源变成 CreateSkillBody」。

来源记录（refresh 的数据源）落**数据根侧车** `<PACMAN_HOME>/server/
skill-sources.json`：技能本体是现扫目录（spec 13 #367「不入库」域律），来源
登记同样不入 DB——零 migration、不污染用户技能池目录。键 = skillId；值 =
`{kind: localPath|github, ref, importedAt, refreshedAt}`（ref：localPath =
realpath 归一；github = canonical URL 含 ref——refresh 确定性重拉）。

安全面（票面硬要求）：URL 分支的用户输入只作「规格」不作「抓取目标」——
实际出站只打**固定 host**（api.github.com / raw.githubusercontent.com），
owner/repo/ref/子路径先过字符白名单；输入校验仍显式拒非 https 与
私网/回环/link-local host（贴错内网地址的用户拿到点名报错）。localPath：
resolve+realpath 归一后落在技能根内 = 400（已被 pacman 现扫管理）；根外任意
可读目录 = local 形态的信任面（server 进程权限 = 操作者本人）。只读复制
（源目录零写入）；walk 不追符号链接（listSkillFiles 同律）；`.git` 不入包。
二进制文件显式 400（写面 body 是 utf8 文本；Multica 因 PG TEXT 列选择跳过
——pacman 写面纪律是显式拒绝，见 `skill-import.ts` 头注）。

## Sub-features

- `skill-import-local` localPath 导入：收集器只读 walk + 逐文件字节闸 +
  utf8 严格解码 → createLocalSkill。源在技能根内（含 symlink 解析后）→ 400
  「it is already visible to pacman」。
- `skill-import-url` GitHub URL 导入：repo meta（默认分支）→ recursive tree
  （truncated = 400）→ 子目录前缀过滤 + 路径守卫 + **树声明尺寸预检**（超限
  在拉取前拒绝、零 raw 请求）→ 逐文件 raw 拉取（每请求 15s 超时 + 整体 120s
  截止 + content-length/实读双上限）→ utf8 严格。文件数上限 256 [设计]
  （Multica maxImportFileCount 同量级——每文件一次出站请求）。
- `skill-refresh` refresh 重拉：无来源记录 → 409；frontmatter name ≠ sid
  （来源身份漂移）→ 409 拒绝、盘上不动；通过后 updateLocalSkill 覆写
  （**列出者覆写、未列者保留**——源删的文件本地保留，与手动 PUT 同律）。
  refresh 后物化清单 sha256 变 → 新 digest 视图（#920 接力，零额外改动）。
- `skill-import-wire` web 面：技能页 topbar「导入」钮（`data-testid=
  resource-import`，ResourceShell headerExtra 槽首用）开 `SkillImportDialog`
  （localPath / GitHub URL 两字段，客户端 xor 预检，400/409/502/504 落内联
  错误行）。

## How to get to it (user POV)

- 侧栏「资源 → 技能」→ `/app/resources/skills` → topbar「导入」钮(data-testid=resource-import)→ 导入对话框,本地路径与 GitHub URL 二选一。
- API:`POST /api/teams/{id}/skills/import`、`POST /api/teams/{id}/skills/{sid}/refresh`。
- 驱动(`vp.mjs list skill-import` 列出全部 case 与 usage):
  - `node .claude/skills/verify-pacman/scripts/vp.mjs drive skill-import import-rollback`:导入失败回滚、重试成功写来源记录(默认带修复后开关 `--expect=new`)。
  - `env -u http_proxy -u https_proxy -u all_proxy NO_PROXY='*' node .claude/skills/verify-pacman/scripts/vp.mjs drive skill-import local-and-github-import --force`:本地目录与 GitHub URL 导入、refresh,即下面的驱动步;调 GitHub,要 `--force`;launch 时带 `NODE_USE_ENV_PROXY=1`(Gotchas 1)。

## 驱动步（drive-1170-skill-import.mjs）

1. `launch.mjs` 起栈（**命令行带 `NODE_USE_ENV_PROXY=1`**——见 gotcha 1）。
2. `env -u http_proxy -u https_proxy -u all_proxy NO_PROXY='*' node
   .claude/skills/verify-pacman/scripts/drive-1170-skill-import.mjs`。
3. 判读 = `docs/verify/1170/README.md`（A/B/C/D 六面 31 checks，每条 `ok` 是布尔）。

## Gotchas

1. **栈的 GitHub 出站必须走代理**：直连 raw.githubusercontent.com 间歇被重置
   （api.github.com 稳定）；launch 命令行带 `NODE_USE_ENV_PROXY=1`（Node
   fetch 默认不吃 proxy env——lib/github.ts 头注的部署形态）。
2. **anthropics/skills 挑单行 description 的子目录**：`skills/academy-guide`
   一类 `description: >` 折叠形被 parseSkillFrontmatter 按缺省回落 → 导入
   400（既有解析语义，非缺陷）；`skills/pdf` 是安全目标。
3. B 相位跑真网络（14 次出站请求）——网络抖动重跑即可，A/C/D 相位零外网
   依赖可单独定位。
4. 假机器物化腿（C5-C7）走 REST 全链（api-key → enroll → agent 白名单 →
   build → claim → manifest），claim 响应是 `{step:{step,…}}` 双层包装——
   `.step.step.id`（#519 同坑）。
5. 来源记录断言要 `realpathSync` 对拍——macOS `/var → /private/var` 族
   变换会让裸等值假红（本次栈在 /Users 下无此问题，通用护栏）。

## 验证账

- live：`drive-1170-skill-import.mjs` 31/31 PASS，证据 `docs/verify/1170/`
  （2026-10-10）。来源登记失败时导入删掉刚建的目录（#1185），同名可以再导入。
- server 单元：`apps/server/test/skill-import.test.ts` 35 用例（失败方式
  先行枚举——LP0-LP11 / U1-U11 / R1-R8 / M1 / W1，外加来源空登记不被失败写污染）。
- web e2e：`apps/web/e2e/skill-import.spec.ts` 4 用例（fixture 字段集 +
  xor 闸 + accept 律；live 201/400/409 打桩）。
