# agent 改用 GitHub App cairn-bot 推送

issue #1666。目标：agent 的推送与开 PR 不再用 ian（xiechimon）的身份，这样打开「Require review from Code Owners」后 ian 能批准 App 开的 PR。本文只写事实；查不到的写「待确认」。

方案：不注册机器人用户账号，用 GitHub App `cairn-bot`。推送与开 PR 前，用 App 私钥换一枚一小时有效的 installation token，只放进该命令的进程环境，不改 gh 全局默认账号，不落盘。

## 现状（2026-10-25 查）

- commit 作者：全局 git config，`user.name = xiechimon`、`user.email = xiechimon@qq.com`（`~/.gitconfig`）。仓库本地 config 没有设置作者。
- 推送与 `gh pr create`：`gh` 登录的 xiechimon 账号，令牌存 macOS 钥匙串（`gh auth status` 显示 `xiechimon (keyring)`）。`~/.gitconfig` 里 `https://github.com` 的 credential helper 是 `gh auth git-credential`，所以 `git push` 也走这个账号。
- agent（codex、pi、grok）自己不 commit、不 push：由派活方（Claude 线程）在 agent 完成后提交并推送、开 PR。
- `gh api /users/cairn-bot%5Bbot%5D` 在 2026-10-25 返回 404：App 此时还没建好或还没生效，下面的 App 参数都是待确认。

## App 配置（ian 在 GitHub 网页上做）

- 名称 `cairn-bot`。
- 权限（Repository permissions）：Contents、Pull requests、Issues、Workflows，读写；Metadata 只读由 GitHub 自动附带。
- 不开 webhook。
- 只装在 `xiechimon/cairn` 一个仓库（Install App 时选 Only select repositories）。
- 生成私钥，得到 `.pem`，放在 Mac 的 `~/.cairn/` 下。
- 记下 App ID 与 Installation ID：待确认（建好后填）。Installation ID 也可以用 `gh token installations` 列出。

## 私钥 .pem 的处理

- 只在本机读：不复制到别处、不放进仓库、不进日志、不 `cat`、不打印内容、不传给 agent。
- 权限 600：`chmod 600 ~/.cairn/<pem 文件名>`；`~/.cairn/` 目录建议 700。
- 换 token 的工具只收文件路径（`--key`），由它自己读文件，shell 里不出现私钥内容。
- 文件名：待确认（ian 存入时定）。

## 换 token 的工具：候选与选择

调研于 2026-10-25（GitHub 与 npm 元数据实测）：

- `Link-/gh-token`：`gh` 扩展，也有独立二进制（darwin-arm64、darwin-amd64 等）。子命令 `generate`、`revoke`、`installations`。参数 `--key <pem 路径>`、`--app-id`、`--installation-id`，输出 JSON（含 `token`、`expires_at`、`permissions`）。420 星，最近一次推送 2026-10-19，最新 release v2.0.10（2026-03-25）。LICENSE 文本是 MIT 条款，GitHub 识别为 NOASSERTION。
- `@octokit/auth-app`：官方 octokit 的 npm 库，最新 8.3.1（2026-09-01 更新）。是库不是命令行，要自己写脚本，并要在仓库里加依赖。
- `gagoar/github-app-installation-token`：npm 包加二进制，23 星，最近推送 2026-10-22。
- `kazuki-hanai/gh-create-github-app-token`：`gh` 扩展，同类 `actions/create-github-app-token` 的命令行版，4 星，最近推送 2024-06-17，停更。
- `actions/create-github-app-token`：只能在 GitHub Actions 里用，本机用不了。

选 `Link-/gh-token`。理由：
- 已有现成命令行，一条命令出 token，不用写代码。
- 是 `gh` 扩展，装在 `gh` 自己的目录，不进本仓库的 `package.json` 与 `pnpm-lock.yaml`（仓库里没有 octokit 依赖，不现在加）。
- 维护最活跃，有 release，只收私钥文件路径。

安装（派活方在本机执行，ian 不用跑命令；本票不执行）：`gh extension install Link-/gh-token`。安装后核对 `gh token --help` 与 `gh token generate --help` 的参数名与上面一致：待确认。

## 要换的位置

1. 派活方提交时的 git 作者，单次命令覆盖，不改全局 config：
   - `user.name`：`cairn-bot[bot]`
   - `user.email`：`<APP_USER_ID>+cairn-bot[bot]@users.noreply.github.com`
   - `APP_USER_ID` 的取法：`gh api /users/cairn-bot%5Bbot%5D --jq .id`（`[` `]` 要写成 `%5B` `%5D`）。该接口在 App 建好前返回 404，值：待确认。
   - 用法：`git -c user.name='cairn-bot[bot]' -c user.email='<APP_USER_ID>+cairn-bot[bot]@users.noreply.github.com' commit ...`
2. 推送。token 只在一个子 shell 的变量里，用 git 的环境变量式配置注入 http extraheader（不出现在命令行参数里），子 shell 结束变量即消失：

   ```sh
   (
     TOKEN="$(gh token generate --key ~/.cairn/<pem 文件名> --app-id <APP_ID> --installation-id <INSTALLATION_ID> | jq -r .token)"
     GIT_CONFIG_COUNT=1 \
     GIT_CONFIG_KEY_0=http.https://github.com/.extraheader \
     GIT_CONFIG_VALUE_0="Authorization: Basic $(printf 'x-access-token:%s' "$TOKEN" | base64)" \
     git push origin <branch>
   )
   ```

   - `TOKEN` 不 `export`、不写文件、不 `echo`。
   - 本机 `/usr/bin/jq` 存在（2026-10-25 实测）。
   - 在本机实际推送成功，且推送者显示为 `cairn-bot[bot]`：待确认。
3. 开 PR：`GH_TOKEN` 只放进 `gh pr create` 这条命令的进程环境，值同样当场用 `gh token generate` 换出：

   ```sh
   GH_TOKEN="$(gh token generate --key ~/.cairn/<pem 文件名> --app-id <APP_ID> --installation-id <INSTALLATION_ID> | jq -r .token)" \
   gh pr create --repo xiechimon/cairn --head <branch> ...
   ```

   - 不跑 `gh auth login`、不跑 `gh auth switch`，gh 全局默认账号仍是 xiechimon。
   - `.claude/skills/pr-cairn/SKILL.md` 里写的是 `--head xiechimon:<branch>`。分支推在 `xiechimon/cairn` 本仓，前缀是仓库所有者，仍是 `xiechimon`；实际跑通：待确认。
4. 其它用 gh 或 git 写远端的脚本，凡要以 App 身份跑，都按第 2、3 条在命令前缀里注入：`scripts/cleanup-merged-branches.sh`（`git push origin --delete`、`gh pr list`）。App 对 `xiechimon/cairn` 有 Contents 读写，删远端分支可用。
5. 不用换：
   - `scripts/dispatch-agent.mjs`：只 `spawn` 派给它的命令，不 commit、不 push、不开 PR。
   - `scripts/dispatch-dedupe.mjs`：`gh pr list --repo xiechimon/cairn`、`git ls-remote --heads origin` 只读查重，继续用 xiechimon 的 gh 登录即可。
   - `~/.local/bin/ai-route`（链到 `~/.agents/automation/ai-route/ai-route.py`）：只起 `codex app-server`、pi、grok 子进程，没有 git commit、git push、gh 调用。
   - CI 里的 `GITHUB_TOKEN`：不属于这些身份。
6. 合并、审批、改标签这类需要人身份的操作仍用 xiechimon 的 gh 登录，不走 App token。

## token 的约束

- installation token 一小时过期，每次推送或开 PR 现换，不缓存。
- 不写进文件、不进仓库、不进日志、不进 PR 与 issue 文字；本文也不含任何令牌值。
- 不把 token 或 `.pem` 交给 codex、pi、grok 等 agent 进程：换 token 与推送由派活方在命令前缀里完成。

## 顺序：先让 App 推过 PR，再打开 Code Owners 审核

`.github/CODEOWNERS` 把 `integration/eval/**`、`.claude/hillclimb/**` 和 CODEOWNERS 文件自身的 owner 设为 `@xiechimon`。这些路径合并闸本来就判给人审（`.claude/**`、`.github/**` 在保护清单里；`integration/eval/**` 在可自动合并集之外）。

「Require review from Code Owners」必须在 App 成功推送并开出一个 PR 之后再打开。原因：现在 PR 作者就是 xiechimon，ian 不能批准自己的 PR，而 CODEOWNERS 里 owner 也是 xiechimon，此时打开会让碰这些路径的 PR 永远拿不到有效的 code owner 审核。App 开的 PR，作者是 `cairn-bot[bot]`，ian 才能批准。

步骤顺序：

1. 本票 PR 合并 CODEOWNERS 与本文（不改分支保护）。
2. ian 在 GitHub 网页建 App `cairn-bot`（权限、无 webhook、只装本仓见上），生成私钥放到 `~/.cairn/`，权限 600；在本机装 `gh token` 扩展。
3. 派活方按「要换的位置」改用 App 身份，App 实际推送并开出一个 PR。
4. 之后才在分支保护里打开「Require review from Code Owners」。
