# Pacman Development Rules

> 仓库级 agent / 人类共同规则。规则**可覆写**但需用户显式确认（见末尾"User Override"）。
> 项目背景与历史决策在 `~/.claude/projects/-Users-xmon-Code-AgentProjects-pacman/memory/MEMORY.md`——本文件只列规则不重复事实。

## Conversational Style

- 技术散文。commit / issue / PR / 代码里**禁 emoji**。
- 禁套话（"Thanks @user!"、"Great question"、"Sure thing"），直接回答。
- 解释非平凡设计时按"问题 → 具体例子 / 短 trace → 方案；为何必要 vs 可选复杂度"四段走。
- 用户提问时**先答问题，再动编辑**。
- 同意/不同意用户反馈时先表态（"同意/不同意，因为 X"），再列改动。

## Code Quality

- **缝纪律先于一切**：biome 的 `noRestrictedImports` 已经把 `@earendil-works/*`、`@modelcontextprotocol/sdk`、`simple-git`、`isomorphic-git`、`cron-parser` 锁死只能经薄桥模块消费。**改这些 import 路径前先看 `biome.json` 注释**（缝纪律 01 §5/§7.3 等条款）——改文件位置之前先校验 seam 是否仍然成立。
- 改自己没完整读过的文件前先 Read；不要靠搜索片段做广义修改。
- 默认无 `any`；需要时写明 `any intentionally - <理由>`。
- 单行 helper 且唯一调用点 → inline。
- 外部包 API: bundled types → 读 `node_modules/<pkg>/dist/*.d.ts`; 仅 `@types/` → 读 `node_modules/@types/<pkg>/index.d.ts` + 同包 JS 源; 无类型 → 跑 `node -e` 或查 docs, 不靠记忆推。pnpm 仓顶层 node_modules 只挂直接依赖——路径不存在就去 `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/`（本仓实测）。钉 `npm ls <pkg>` 版本。详 `~/.agents/wiki/wiki/外部包 API 事实源调研.md`。
- **禁 inline import**（`await import()`、`import("pkg").Type`、动态类型导入）；top-level only。
- `apps/daemon/src/backend/` 是 GitOps / MCP / LLM provider 缝；其它模块要把他们当成接口边界 import，不要从外部模块绕过去。
- 移除"看起来是有意写的"功能或代码前**先问**。

## Commands

代码改动后（仅文档改动不跑）：
```sh
pnpm lint       # biome ci . —— CI 视角
pnpm format     # biome format --write . —— 不写文件就别跑
pnpm typecheck  # pnpm -r typecheck
pnpm spec:parse # spec 解析闸（#1052）：只收集不执行、秒级，覆盖 apps/web/e2e + integration/test
```
三类必须先通过才能提交。**别跑 `pnpm build`**（vite 全量；不值得 commit 前做）。

测试规则（强制，分层职责正本 = `docs/spec/19-测试分层与受影响面.md`）：
- **禁止写完实现再补 unit test**——要测就先于实现。
- **E2E 为主**：复杂功能用真 e2e 验证能跑通；开发期跑受影响面——`pnpm --filter @pacman/web e2e:affected`（改 `src/ui` / styles / i18n / api / fixtures 等共享面时自动回落全量）。**全量 e2e 的执行点在 CI**（4 分片，覆盖面不降）；本地全量仅在收尾复核确需时跑——实测 617 用例 154s（不是旧口径的 1h+），但它是多 lane 内存压力的主力，别当日常。
- unit 受影响面缩窄：`pnpm exec vitest related --changed`（vitest 5 原生，跨 project 生效，2026-10-03 实测）。
- **先列失败方式，再写实现**：动某块系统前，先枚举它可能失败的所有场景，写代码是让场景通过的手段。
- **e2e spec 文件合并/解冲突后必跑 `pnpm spec:parse` 验解析**（#1052 起有秒级闸：playwright `--list` 收集全部 web spec + integration tsc；M7 实战：typecheck 不覆盖 spec 语法，手工解冲突吞 `});` 到 EOF 才炸——typecheck 绿≠playwright 能解析）。
- **机制类改动，验收取实物**：「X 生效了」的机制声称（CSS/动效、落盘/wire 格式、schema、shim 流量、判据字段）必须从**编译产物 / 运行时日志 / 快照套件 / 该形态运行时真值**上取实物；读源码、看配置、装好依赖都不算验收——声称→实物→实案路径表见 `.claude/skills/verify-pacman/SKILL.md`「机制生效验收:实物判据」（#656/#677、#735、#700 等六实例）。

跑验证服务（port 与 dist/ 互斥）：
- `dev:web` / `dev:server` / `dev:daemon` ——dev server，端口 `5173` / `8787`。vite 带 `strictPort`——撞端口即启动失败，不静默顺延到下一个空闲口（顺延才是危险的：proxy 目标不变，界面会去驱动持有该端口的别的栈）。覆写：`PACMAN_DEV_WEB_PORT` / `PACMAN_DEV_SERVER_PORT`。
- **E2E_PORT** 默认 8399——跑前先 `lsof -iTCP:8399` 查占用，占用的是别的车道**不能杀**，换端口。**`e2e:affected` 默认走 8398**（`E2E_AFFECTED_PORT` 覆写，显式 `E2E_PORT` 优先）——与全量分道，同款撞端口纪律。
- **同 worktree 内不要并跑两个 playwright**——`vite build --mode fixture` 写同一个 `dist/`，会互踩。跨 worktree 各用各的 dist 无碍。

## Dependencies & Install Security

- 锁文件 `pnpm-lock.yaml`：**入 commit 前先确认**——除非是依赖变更伴随的合法 lockfile diff，否则视为误操作（`git reset pnpm-lock.yaml` 退出 staging）。已获授权的合法改动，过闸唯一出口是 `PACMAN_ALLOW_LOCKFILE_CHANGE=1 git commit ...`（对齐 pi 的 `PI_ALLOW_LOCKFILE_CHANGE`，接受 `1`/`true`/`yes`）；pre-commit 锁文件闸不提供其它出口。
- 本地 `pnpm install`；CI 用 `pnpm install --frozen-lockfile`。
- 引入第三方包前先看 `biome.json` 的禁列：simple-git / isomorphic-git 等已被缝纪律取代，**不要再装**。
- 不跑 postinstall 脚本除非用户明确允许。

## Git

仓库单 remote：`origin = xiechimon/pacman`（正主，开 PR 去这里）。曾挂的 upstream（craft-ai-agents/craft-agents-oss，项目起步时的借鉴来源）已于 2026-09-29 移除，勿再加回。

Commit 约定：
- 格式：`<scope>(<ticket>): <subject>` 或 `web(<PR>): <subject>`——scope 跟现有节奏（`web` / `daemon` / `server` / `shared` / `integration` / `docs` / `chore` 等）；subject 短、要点。
- PR 编号或 issue 编号挂末尾：`(#123)` PR 号。
- **关票关键字写进 commit message，不是 PR body**：结尾一行 `closes #N`（多 issue 用 `closes #N1, closes #N2`，不能合并写）。squash 合并只把 **commit message** 带进 main，PR body 根本不进 commit——关键字只写在 PR body 里等于没写，票会留着 OPEN（477/478/479/480 四票全中，2026-09-30 又中 #487/#488）。对照实测（2026-09-30 #495）：PR body 一个关键字都不写、只写进 commit message，合并即自动 CLOSED/COMPLETED。开 PR 前先在 commit message 收尾这一行。
- **否定句里的关票关键字照样生效**：GitHub 的关键字解析器**不认否定词**。写成「不 closes #417」这种否定句，仍然会在合并落地时把 #417 关掉——2026-09-30 实测：Map #417 就是被 PR #522 的 squash 提交这样关掉的（timeline 把 closed 事件挂在该 commit 上），写那句话的本意恰恰是「声明不要关它」。要表达「本 PR 不关某票」，**去掉那个动词**：写「不关闭 #417」或「本 PR 与 #417 无关」，并确认整个 commit message 里没有任何「关票关键字 + 票号」的形态。同上一条，这条也只在 commit message 通道上生效，PR body 不进 commit。
- **只 commit 自己改过的文件**。`git add <path1> <path2>` 显式路径，**禁 `git add -A` / `git add .`**——同 cwd 可能多个 lane 并行（agent / 人类）。例外：merge 落盘（解决冲突后的 merge commit）语义上是全量 stage，允许 `git commit --no-edit` 完成 merge 而不再 add（merge 状态自带 index）；手工模拟 merge 落普通 commit 不在此例。
- 永远别 `git commit --no-verify`。
- 被 pre-commit 闸拦下、且改动确属有意时，唯一放行出口是该闸的显式环境变量：锁文件闸 `PACMAN_ALLOW_LOCKFILE_CHANGE=1`、禁词闸 `PACMAN_ALLOW_BANNED_VOCAB=1`（均接受 `1`/`true`/`yes`）；不提供其它出口。

Worktree（pacman 是多 lane 设计，所以特别强调）：
- **建 worktree 必须绝对路径**。`git worktree add /Users/xmon/Code/AgentProjects/pacman/.claude/worktrees/<name>`。相对路径 + cwd 漂移（heredoc / cd 改变 cwd 后）会把 worktree 嵌进 `apps/web/src/.claude/worktrees/`，vite watcher 撞上去触发 reload 风暴拖死 dev server。
- 切 lane 时从 `origin/main` 切（本地 main 常落后）；PR 合并顺序撞上，GitHub 报 CLEAN 才合，冲突 rebase 重验。
- **半场交接必 commit**（M7 实战踩坑）：同一 worktree 换施工者（主线↔lane 或 lane↔lane）前，把手头改动 commit 落盘——未 commit 的解法会被下一手的 merge --abort / merge 尝试现场覆盖，对象不可恢复（05 册 M7 合并期 #309 位实测丢失一轮 drizzle 解法）。
- **drizzle migration 撞号纪律**：并发票都加表时序号必撞。序号永远以**合并时点** main 的尾部为准，lane 施工期不占固定号（票面不写死序号），合并期冲突时重编到 main 尾部+1。

Git 拦截（autoresearch / pre-commit 共识）：
- `git reset --hard` / `git checkout .` / `git clean -fd` / `git stash` ——**别跑**，会砸 lane 同事的活。
- `git branch -D` / `git restore` 在 autoresearch loop 内会被 hook 拦——绕法：`git branch -d` / `git worktree remove --force`。
- 永远别 `--force push`。

## Issues and PRs

**写 PR body 一律走 `.claude/skills/pr-pacman/SKILL.md` 照做**（本仓六节契约 What/Verified/Upstream/Risk/Acceptance/Issues；`pr-evidence` 闸按字面小节名查）。**全局 `/pr` 技能（show-me 三节 Summary/Evidence/Merge Danger）在本仓过不了闸**——同名时个人级 skill 优先级压过项目级，仓里没法接管 `pr` 这个名字，所以本仓正本叫 `pr-pacman`（#1110，四条 lane 撞同一坑后定）。

**审 PR 走 `docs/pr-review.md`**（#1080）：五步流程 + 固定六节评分卡（What it does / Good / Bad / Ugly / Tests / Open questions）。其中「**不切分支看 diff**」是硬要求——`gh pr view` / `gh pr diff` / `gh api` / `git show <ref>:<path>`，绝不 `gh pr checkout`：本仓多车道并行、各占独立 worktree，评审者一 checkout 就撞别的 lane 的现场。

仓库只有 origin（xiechimon/pacman），裸 `gh` 命令解析正确；显式 `-R xiechimon/pacman` 写法仍可用：
- `gh issue list -R xiechimon/pacman`
- `gh pr view 149 -R xiechimon/pacman`
- `gh repo view` 不支持 `-R`——用位置参数：`gh repo view xiechimon/pacman`

Worktree 车道开 PR：
```sh
gh pr create --repo xiechimon/pacman --head xiechimon:<branch>
```
裸 `--head <branch>` 曾在双 remote 时期报 `Head sha can't be blank`（worktree + 多 remote 下 head ref 解析走偏）；现单 remote 未复验，继续用全限定写法最稳。已误开裸 body 的 PR 用 `gh pr edit <n> --title --body-file /tmp/pr.md` 补全。

PR body / 长 issue 评论：**写临时文件再 `--body-file`**，不内联 `--body` 多行 markdown。
- **改完回读**：`gh pr edit <n> --body-file ...` 会被 gh 的 Projects-classic GraphQL 报错打断且**不生效**（#550 实测：命令报错、body 仍是旧的）。改走 `gh api -X PATCH repos/xiechimon/pacman/pulls/<n> --input -`（JSON 由脚本生成，避开 shell 转义），写完用 `gh pr view <n> --json body` 拉回逐字节比对。
- **要进 PR 的截图/证据必须提交到分支**：Multica 的附件 URL 对匿名读者不可读（`static.multica.ai/...` → `403 MissingKey`、`/api/attachments/<id>/download` → `401`），直接嵌进 PR body 只会渲染成碎图；而 PR body 只能嵌 URL，本地文件没有 URL。故按既有约定提交到任务分支的 `docs/verify/<票号>/`，body 引 `https://raw.githubusercontent.com/xiechimon/pacman/<sha>/<path>`（repo public，raw 匿名可读）。本地留副本只是保底，不是通路。

## User Override

本文件规则在用户指令冲突时可覆写——但**必须先得到用户显式确认**（"我同意打破 No X 规则，因为 Y"），再执行。仅执行确认过的部分。
