# agent 改用 GitHub App cairnwright 推送与开 PR

issue #1666。目标：派活方的推送与开 PR 不再用 ian（xiechimon）的身份，这样打开「Require review from Code Owners」后 ian 能批准 App 开的 PR。本文只写事实。

## App 与 bot 用户

- App：`cairnwright`。原名 `cairn-bot` 被现有 GitHub 账号占用，先用过 `cairn-bot-xmon`，2026-10-25 改名为 `cairnwright`。
- App ID `5462173`，installation ID `174994433`。
- 只装在 `xiechimon/cairn` 一个仓库。
- 权限：Contents、Pull requests、Issues、Workflows 读写，Metadata 只读。无 webhook。
- bot 用户：`cairnwright[bot]`，id `347615582`（`gh api /users/cairnwright%5Bbot%5D --jq .id`，`[` `]` 写成 `%5B` `%5D`）。
- noreply 邮箱：`347615582+cairnwright[bot]@users.noreply.github.com`。

## 私钥

- 文件：`~/.cairn/cairnwright.private-key.pem`，权限 600。
- 只在本机进程内读：不复制、不进仓库、不打印、不交给 agent。

## 换 token 的工具

在仓库外的 `~/.cairn/tools/app-token/`，仓库不加依赖。

- `token.mjs`：用 GitHub 官方 `@octokit/auth-app`（v8）写成。读 `~/.cairn/cairn-bot.json`（字段 `appSlug`、`appId`、`installationId`、`privateKeyPath`），换一枚一小时有效的 installation token。
- `as-bot.sh <命令>`：调 `token.mjs` 换 token，只放进该命令的进程环境后 `exec` 该命令：
  - `GH_TOKEN`：给 `gh`。
  - git 的 http extraheader：经 `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` 环境变量注入，不进命令行参数。同时把 `credential.helper` 置空，推送不走 `gh auth git-credential`。
  - git 作者与提交者：`GIT_AUTHOR_*`、`GIT_COMMITTER_*` 设为 `cairnwright[bot]` 与上面的 noreply 邮箱。
- gh 全局默认账号仍是 xiechimon，没跑过 `gh auth login` 或 `gh auth switch`。

用法：

```sh
~/.cairn/tools/app-token/as-bot.sh git commit ...
~/.cairn/tools/app-token/as-bot.sh git push origin <branch>
~/.cairn/tools/app-token/as-bot.sh gh pr create --repo xiechimon/cairn --head <branch> ...
```

## 实测

2026-10-25 用 App 推送测试分支并开 PR（#1670 用旧名，#1672 用新名）：PR 作者显示 `app/cairnwright`（`is_bot=true`），提交作者 `cairnwright[bot]`。两个测试 PR 已关闭，分支已删。

## 要换的位置

已改走 `as-bot.sh`（派活方）：

- 提交（git 作者与提交者）。
- 推送。
- 开 PR（`gh pr create`）。
- 开自动合并（`gh pr merge --auto`）。

agent（codex、pi、grok）自己不提交、不推送。

其它写远端的脚本要以 App 身份跑时，同样在命令前加 `as-bot.sh`：`scripts/cleanup-merged-branches.sh`（`git push origin --delete`、`gh pr list`）。

不用换：

- `scripts/dispatch-agent.mjs`：只 `spawn` 派给它的命令，不提交、不推送、不开 PR。
- `scripts/dispatch-dedupe.mjs`：`gh pr list --repo xiechimon/cairn`、`git ls-remote --heads origin` 只读查重，用 xiechimon 的 gh 登录。
- `~/.local/bin/ai-route`（链到 `~/.agents/automation/ai-route/ai-route.py`）：只起 `codex app-server`、pi、grok 子进程，没有 git commit、git push、gh 调用。
- CI 里的 `GITHUB_TOKEN`：不属于这些身份。

合并、审批、改标签这类需要人身份的操作仍用 xiechimon 的 gh 登录，不走 App token。

## token 的约束

- 一小时过期，每次现换，不缓存。
- 不写进文件、不进仓库、不进日志、不进 PR 与 issue 文字；本文不含任何令牌值。
- 不把 token 或 `.pem` 交给 agent 进程：换 token 与推送由派活方在命令前缀里完成。

## Code Owners 审核

`.github/CODEOWNERS` 把 `integration/eval/**`、`.claude/hillclimb/**` 和 CODEOWNERS 文件自身的 owner 设为 `@xiechimon`。这些路径合并闸本来就判给人审（`.claude/**`、`.github/**` 在保护清单里；`integration/eval/**` 在可自动合并集之外）。

「Require review from Code Owners」要在 App 能开 PR 之后才打开。原因：PR 作者若是 xiechimon，ian 不能批准自己的 PR，而 CODEOWNERS 里 owner 也是 xiechimon，打开后碰这些路径的 PR 永远拿不到有效的 code owner 审核。App 开的 PR，作者是 `cairnwright[bot]`，ian 才能批准。App 开 PR 已在 2026-10-25 实测成功。

开启条件与方式：

- 条件：#1669 合入 main，且 ian 本人确认。
- 设置：`required_approving_review_count=0` 加 `require_code_owner_reviews=true`。这样只有碰 CODEOWNERS 路径的 PR 需要 ian 批准，其它 PR 不要求审核。
- 改之前保存 main 分支保护的当前快照，以便回退。
