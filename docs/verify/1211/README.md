# #1211 验证证据 — local-repo build 不动用户主检出

改动：删掉 merge 步在用户仓库目录的 `git merge --ff-only`（`landLocalFastForward` / `mergeFfOnly` / shared `WorktreeOps` 槽位一并移除）。落地 = conv 分支 push 回用户仓库 refs/heads；用户主检出的分支/reflog/工作树永不被 pacman 触碰。

## 判据（票面验收 → 证据映射）

- 验收 1（全流程后主检出 reflog/status 零新增）：`after-g2t2-m3b-integration.txt` 失败方式 1-3 —— 真 server + 真 daemon + stub LLM + 真 git 全生命周期，plan/build/review 阶段与 merge 后各对拍一次 `git reflog main` 逐字不变、HEAD 停种子 tip、`status --porcelain` 空、工作树无探针行。
- 验收 2（分支操作只发生在独立 worktree/clone）：`after-daemon-full.txt` 含 `local-executor.test.ts`（基座 clone 落 `<workspacesRoot>/<projectId>/repo`、硬链接面）与 `runner-local.test.ts` 失败方式 2（真 WorkspaceManager 全链，所有 git 写操作作用于基座 clone / conv worktree）。
- 验收 3（勾「合并到默认分支」= 独立 clone 内合并 + push origin，不碰主检出）：`after-g2t2-m3b-integration.txt` 失败方式 3 —— merge 步 done 后用户仓库 `refs/heads/pacman/conv-<id>` = merge checkpoint，用户 main 不动；脏工作区变体（失败方式 4）merge 照常 done 且用户未提交改动原样。
- 验收 4（hosted 回归）：`after-g2t2-m3b-integration.txt` 内 m3b-demo 4/4（runner 收尾共链对照）。

## Before/After

- `before-red-vitest.txt`：改前 HEAD（b909d1dd）上跑新判据 —— 3 红：失败方式 1/7 见 `landLocalFastForward` 被调用；失败方式 2 见用户仓库 HEAD 被从种子 tip ff 推进到 conv tip（即 #1211 报障实锤）。
- `after-green-vitest.txt`：同两文件 17/17 绿（失败方式 2 = 用户仓库 reflog 逐字不变 + conv 分支在位）。
- `after-g2t2-integration.txt` / `after-g2t2-m3b-integration.txt`：integration 全生命周期 2/2、含 hosted 对照 6/6。
- `after-daemon-full.txt`：apps/daemon 全量单测 71 文件 713 用例绿。
- shared 339/339、server `g2t2-executor-wire` 4/4、`pnpm lint` / `pnpm -r typecheck` / `pnpm spec:parse` 全过（终端实测，未另行存档）。
