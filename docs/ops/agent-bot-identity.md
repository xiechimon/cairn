# agent 改用机器人身份推送

issue #1666。目标：agent 的推送与开 PR 不再用 ian（xiechimon）的身份，这样打开「Require review from Code Owners」后 ian 能批准机器人开的 PR。本文只写事实；查不到的写「待确认」。

## 现状（2026-10-25 查）

- commit 作者：全局 git config，`user.name = xiechimon`、`user.email = xiechimon@qq.com`（`~/.gitconfig`）。仓库本地 config 没有设置作者。
- 推送与 `gh pr create`：`gh` 登录的 xiechimon 账号，令牌存 macOS 钥匙串（`gh auth status` 显示 `xiechimon (keyring)`）。`~/.gitconfig` 里 `https://github.com` 的 credential helper 是 `gh auth git-credential`，所以 `git push` 也走这个账号。
- agent（codex、pi、grok）自己不 commit、不 push：由派活方（Claude 线程）在 agent 完成后提交并推送、开 PR。

## 要换的位置

1. 派活方提交时的 git 作者。用仓库级或单次命令覆盖，不改全局：
   - 单次：`git -c user.name=<机器人名> -c user.email=<机器人邮箱> commit ...`
   - 或 worktree 级：`git config --worktree user.name <机器人名>`、`git config --worktree user.email <机器人邮箱>`（需先 `git config extensions.worktreeConfig true`）。
   - 机器人名与邮箱：待确认（ian 注册机器人账号后定；GitHub 给的 noreply 邮箱形如 `<id>+<login>@users.noreply.github.com`）。
2. 派活方推送与开 PR 用的 gh 身份。二选一：
   - `gh auth login` 以机器人账号登录，令牌由 gh 存进钥匙串；用 `gh auth switch` 切换，推送与开 PR 前确认 `gh auth status` 的 Active account 是机器人。
   - 不改 gh 的登录状态：只在推送命令的进程环境里设 `GH_TOKEN`，值当场从钥匙串读出，用完即消失，例如 `GH_TOKEN="$(security find-generic-password -s <钥匙串条目名> -w)" git push ...`。钥匙串条目名：待确认（ian 存入时定）。`git push` 走的 credential helper 是 `gh auth git-credential`；它是否读取进程环境里的 `GH_TOKEN`，在本机实际跑通：待确认。
3. `scripts/dispatch-agent.mjs`：读过，只 `spawn` 派给它的命令，不 commit、不 push、不开 PR，不用换。`scripts/dispatch-dedupe.mjs` 用 `gh pr list --repo xiechimon/cairn`、`git ls-remote --heads origin` 做只读查重，换成机器人账号后仍需对本仓有读权限；不用换。
4. `~/.local/bin/ai-route`（符号链接到 `~/.agents/automation/ai-route/ai-route.py`）：读过，只起 `codex app-server`、pi、grok 子进程，没有 git commit、git push、gh 调用，不用换。
5. 其它用到 gh 的脚本：`scripts/cleanup-merged-branches.sh`（`gh pr list`、`git push origin --delete`，删远端分支需要 write 权限，机器人加为 write 协作者后可用）、`.claude/skills/pr-cairn/SKILL.md` 里的 `gh pr create --repo xiechimon/cairn --head xiechimon:<branch>`（`--head` 的前缀是推送分支所在的账号；机器人是仓库协作者、分支推到 `xiechimon/cairn` 本仓时前缀仍是 `xiechimon`，在 fork 时才变，实际跑通：待确认）。
6. CI 里的 `GITHUB_TOKEN` 不属于以上身份，不用换。

## 令牌

- 只存 Mac 钥匙串，或交给 `gh auth login` 存。
- 仓库、agent、日志都不经手令牌；本文与 PR 里不写任何令牌值。
- 建议用 fine-grained 令牌，只授 `xiechimon/cairn` 一个仓库，权限按需（Contents、Pull requests 读写）；具体权限集：待确认。

## 顺序：先让机器人推过 PR，再打开 Code Owners 审核

`.github/CODEOWNERS` 把 `integration/eval/**`、`.claude/hillclimb/**` 和 CODEOWNERS 文件自身的 owner 设为 `@xiechimon`。这些路径合并闸本来就判给人审（`.claude/**`、`.github/**` 在保护清单里；`integration/eval/**` 在可自动合并集之外）。

「Require review from Code Owners」必须在机器人实际推送过一个 PR 之后再打开。原因：现在 PR 作者就是 xiechimon，ian 不能批准自己的 PR，而 CODEOWNERS 里 owner 也是 xiechimon，此时打开会让碰这些路径的 PR 永远拿不到有效的 code owner 审核。机器人开的 PR，作者是机器人，ian 才能批准。

步骤顺序：

1. 本票 PR 合并 CODEOWNERS 与本文（不改分支保护）。
2. ian 在 GitHub 网页注册机器人账号、加为仓库协作者（write）、生成 fine-grained 令牌并自己存进钥匙串或 gh 登录。
3. 派活方按上面「要换的位置」改用机器人身份，机器人实际推送并开出一个 PR。
4. 之后才在分支保护里打开「Require review from Code Owners」。
