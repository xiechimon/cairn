# plan: 修复 dead-class-gate 误报连字符 cva 变体值（#1178 修订轮）

## Context

GitHub issue #1178：dead-class-gate 把带连字符的 cva 变体值（如 `secondary-emphasis`）误判为死类，报假阳性。首轮实现（6f3841f7）教 gate 识别 variant lookup key，闸脚本与纯文本证据均已合入并通过审核核验（3d966ba3 / 7d39f3f6）。

本轮审核发现遗留问题：5f0eeead 把修订版 plan.md 重新提交进分支——plan.md 是 product 的 plan 步每轮写在工作区根的过程交接物，7d39f3f6 删过一次，本轮交接物又被 add 进去。**任何一轮都不应 git add 它。**

## Changes

本轮执行将做两件事：

1. **git rm plan.md 后新提交推送，不改写历史。** 5f0eeead 已推到 origin，因此用追加提交（`chore(1178): drop the lane process file again`）移除该文件，不 rebase / force push。工作区根的 plan.md 本身保留（它是本轮交接物），只清出 git 索引。
2. **推送前自检并在 PR body Verified 段贴证据。** 关键闸命令：`git ls-tree HEAD --name-only | grep -x plan.md` 必须零输出。该命令的空输出将原样贴进 PR body 的 Verified 段，证明分支 tip 上 plan.md 已不存在。

## Edge cases

- **grep -x 的退出码语义**：`grep -x plan.md` 匹配不到时退出码为 1——零输出 + exit 1 是期望态，不是命令失败；自检脚本不要把它当错误。
- **plan.md 每轮重新出现**：product 的 plan 步会在工作区根重写 plan.md，这是预期行为；防线是 add 纪律（永不 `git add plan.md`，也永不 `git add -A`），不是阻止文件存在。若未来某轮又漏进提交，同样以追加提交移除，不改写已推送历史。
- **AGENTS.md 的 230 行未暂存改动**：与本票无关的另一 lane 现场，本轮不 add、不 commit、不丢弃。

## Verification

1. `git rm --cached plan.md` 后 commit：提交内容只有 plan.md 的删除（`git show --stat` 单文件）。
2. `git push origin HEAD` 成功，远程 tip 更新为新提交。
3. 核心自检：`git ls-tree HEAD --name-only | grep -x plan.md` 零输出（贴进 PR body Verified 段）。
4. `git log --oneline` 确认历史是追加式：5f0eeead 仍在链上，未被改写。
5. 已核过的部分（闸脚本修复 6f3841f7、drawio 证据移除 3d966ba3、纯文本证据）不再触碰。
