# plan — server: documents.ts diff 行统计误杀 ++/-- 前缀内容行

## Context

- 根因：`apps/server/src/services/documents.ts` 的 `computeUnifiedDiff` 在 hunk 行统计循环给 `startsWith('+')`/`startsWith('-')` 各挂了 `!l.startsWith('+++')`/`!l.startsWith('---')` 排除闸。structuredPatch（jsdiff 9.0.0，catalog pin）的 hunk 行 = 前缀字符（`+`/`-`/空格）+ 原文内容，文件头（`+++`/`---`）只存在于 createPatch 字符串形态、从不进 `hunk.lines`（libesm/patch/create.js 实读：Step 2 剥尾部 `\n`、缺尾换行插 `\ No newline at end of file` 标记）。于是删一条 `---` 分隔线（hunk 行 `----`）漏计 deletions、新增 `++` 开头内容（hunk 行 `+++ …`）漏计 additions。
- 引用面：`computeUnifiedDiff` 全仓仅 documents.ts（定义）与 `apps/web/src/api/mappers.ts`（消费 diff 字段）引用，无专门单测。
- 约束：不装依赖、不跑全量测试；改动只落本 conv 工作树（分支 `pacman/conv-01a12a09-8b21-7c1a-8381-16c80ac1a976`，基点 origin/main）；收尾 commit + push，不开 PR。
- 环境实况：工作树初始无 node_modules；`pnpm exec biome --version` 探测时触发 pnpm verify-deps-before-run 按既有 lockfile 自动物化 node_modules（git status 证实 lockfile/package.json 零改动），pre-commit 的 biome ci / typecheck 闸因此可实跑。

## Changes

- `apps/server/src/services/documents.ts`（唯一代码改动）：删去两个 `+++`/`---` 排除条件，计数只按行首 `+`/`-` 前缀；循环上方补折为两行的注释，说明 structuredPatch hunk 行形态（前缀字符 + 原文内容，不含 `+++`/`---` 文件头——那是 createPatch 字符串形态才有的，故无需排除）。
- plan.md：本文件，四段交接（覆盖旧卡内容）。
- commit：显式路径 `git add apps/server/src/services/documents.ts plan.md`（不带 AGENTS.md 的 runtime 注入改动），两条提交（`plan:` / `server:`），不开 PR，步末 push conv 分支一次。

## Edge cases

- 新增行内容以 `---` 开头（hunk 行 `+---`）：首字符是前缀 `+`，计 addition——修前修后行为一致，非回归点。
- 删除行内容以 `++` 开头（hunk 行 `-++x`）：计 deletion，同上。
- 上下文行（空格前缀）与 `\ No newline at end of file` 标记行（反斜杠开头）：两种逻辑均不计，行为不变。
- hunk header（`@@ -a,b +c,d @@`）本就不在 `h.lines`（单独投影进 header 字段），不受影响。
- commit message 与注释避开 `.husky/banned.txt` 禁词；本卡无票可关，全程不写任何关票关键字。

## Verification

- 红绿对（同脚本 /tmp/verify-doc-diff.mjs，node --experimental-transform-types + .js→.ts remap hook，import 真源码 computeUnifiedDiff）：修前 additions/deletions = 1/1（`----` 与 `+++ fast-forward note` 被排除闸吃掉）；修后 = 2/2；hunk lines 打印实物显示行形态 = 前缀 + 原文，无 `+++`/`---` 文件头。
- jsdiff 9.0.0 源码对照（libesm/patch/create.js L199-207）：确认 hunk 行剥 `\n`、缺尾换行插 `\` 标记、文件头不进 hunk.lines——注释所述形态与库实现一致。
- pre-commit 实跑通过（lockfile 闸 + banned vocab + biome ci + `pnpm -r typecheck`）。
- 收尾：`git status -sb` 显示 conv 分支 ahead ≥ 2、工作树仅剩 AGENTS.md runtime 注入改动；push 后远端分支与本地一致；不开 PR。
