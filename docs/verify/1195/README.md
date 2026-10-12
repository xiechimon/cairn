# #1195 产物闸分支偏离——验证证据

机制类改动（闸判定 + wire 字段 + git 原语），实物判据 = 测试输出双向腿：
同一组测试在 `origin/main`（旧码）上红、在本分支上绿。

## 证据文件

| 文件 | 内容 |
| --- | --- |
| `server-gate-before-red.txt` | 旧码（`git worktree add --detach /tmp/pacman-1195-before origin/main`）跑 `artifact-gate.test.ts -t '偏离点名'`：done 载荷带 `workBranchDrift` 也被 zod 剥掉，闸仍回「构建零改动」——`AssertionError: expected '构建零改动' not to be '构建零改动'` |
| `daemon-drift-before-red.txt` | 旧码跑 `runner-branch-drift.test.ts`：6 failed——drift 字段 `expected undefined to deeply equal {expected, actual}`、并集面/探测 head 集全缺席 |
| `daemon-scan-before-red.txt` | 旧码跑 `workspace.test.ts -t 'branchesWithNewCommits'`：6 failed——`TypeError: gitPrim.branchesWithNewCommits is not a function`（真 git 扫描原语不存在） |
| `server-gate-after-green.txt` | 本分支同命令：13/13 绿（含偏离点名三条新测） |
| `daemon-drift-after-green.txt` | 本分支 `runner-branch-drift.test.ts`：12/12 绿 |
| `daemon-scan-after-green.txt` | 本分支 `workspace.test.ts`：24/24 绿（含 6 条真 git 扫描原语测） |
| `shared-note-after-green.txt` | 本分支 shared `work-branch-note.test.ts` + `plan-first-round-prompt.test.ts` + `vocabulary.test.ts`：61/61 绿（注记词表 + 过滤链回归） |
| `e2e-affected-green.txt` | `e2e:affected` 判定的 web e2e 面（`token-gate.spec.ts`）+ 过滤链的 e2e 钉扎（`transcript-user-words.spec.ts`，shared 词表消费面）：E2E_PORT=8432，12/12 绿 |

## 复跑命令

```sh
# before 腿（旧码）
git worktree add --detach /tmp/pacman-1195-before origin/main
cd /tmp/pacman-1195-before && corepack pnpm install
cp <本分支>/apps/server/test/artifact-gate.test.ts apps/server/test/
cp <本分支>/apps/daemon/test/{runner-branch-drift.test.ts,workspace.test.ts} apps/daemon/test/
cd apps/server && pnpm exec vitest run test/artifact-gate.test.ts -t '偏离点名'
cd ../daemon && pnpm exec vitest run test/runner-branch-drift.test.ts
pnpm exec vitest run test/workspace.test.ts -t 'branchesWithNewCommits'

# after 腿（本分支）
pnpm exec vitest run test/artifact-gate.test.ts        # apps/server
pnpm exec vitest run test/runner-branch-drift.test.ts  # apps/daemon
pnpm exec vitest run test/workspace.test.ts            # apps/daemon
pnpm exec vitest run test/work-branch-note.test.ts     # packages/shared
```

## 事故形对号（mea 2026-10-11）

票面事故：agent 自建分支 `dogfood/tracer-1153-*` 交付（commit + push + PR 全绿），
服务端按会话分支计数 `countAhead=0` → `build.errorMessage=构建零改动` → chief
白跑补救回合。本改动后同形的收尾行为由 `runner-branch-drift.test.ts` 失败方式
2（切回形：扫描认领 + PR 按真实 head 回填）与失败方式 3（处处无提交：失败原因
点名分支偏离）钉住；真 git 语义（窗口过滤、邻座 conv 排除的归属分工）由
`workspace.test.ts` 的 `#1195` describe 钉住。
