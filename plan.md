# plan — 修复 documents.ts diff 增删行统计误杀 ++x/--y 前缀行

## Context

- 缺陷位置：`apps/server/src/services/documents.ts` computeUnifiedDiff 的 hunk 行统计循环（规划时点 63-64 行）：
  `if (l.startsWith('+') && !l.startsWith('+++')) additions += 1; else if (l.startsWith('-') && !l.startsWith('---')) deletions += 1;`
  —— +++/--- 文件头排除闸加在了 hunk 层。
- 机制（已从实物源码核实，不靠记忆）：lockfile 钉 `diff@9.0.0`，读 `node_modules/.pnpm/diff@9.0.0/.../libesm/patch/create.js` 的 structuredPatch 实现——hunk.lines 只由三种构造 + 一种注入产生：`' '+entry`（上下文，contextLines）、`'+'+line`（新增）、`'-'+line`（删除）、`'\\ No newline at end of file'`（Step 2 对无尾换行行后插的标记）。+++ / --- 文件头只存在于 serialize 文本层（formatPatch / createTwoFilesPatch 的字符串输出），structured 返回值里文件名/头是独立字段（oldFileName/newFileName/oldHeader/newHeader），**从不进 hunk.lines**。
- 后果：排除闸是死代码，且内容以 `++`/`--` 开头的真实增删行被误判为文件头漏计（内容 `++x` → hunk 行 `+++x` 被 startsWith('+++') 吞掉；`--y` 同理）→ wire 响应 documentDiffSchema 的 files[].additions/deletions 漏报。
- 影响面：该统计模式全仓仅此一处（grep 核实无第二份拷贝）；既有测试 `apps/server/test/chief-reject-diff.test.ts` 只断言 `>= 1`，测不出本缺陷、修复也不破坏它。
- 任务边界（硬）：只改 `apps/server/src/services/documents.ts` 一个文件；改动提交在本工作树 conv 分支（pacman/conv-01a12a17-aa98-73aa-8eb8-92fee791a1d4）；不手动 push（收尾 daemon 自动 commit+push）、不开 PR（本卡无 PR 动作）。工作区另有 AGENTS.md runtime 注入的未提交改动（非本任务所改，不显式 add）。

## Changes

- `apps/server/src/services/documents.ts` 统计循环——删去两个排除条件，仅按 `+`/`-` 前缀计数，紧邻计数处补注释防回归（构建步按内容定位，行号因注释插入会下移）：

  改前：
  ```ts
        if (l.startsWith('+') && !l.startsWith('+++')) additions += 1;
        else if (l.startsWith('-') && !l.startsWith('---')) deletions += 1;
  ```
  改后：
  ```ts
        // structuredPatch 的 hunk 行只有 ' '（上下文）、'+'/'-'（增/删）、'\'（no-newline 标记）
        // 四种前缀；+++/--- 文件头是 patch 文本层元信息、从不进 hunk.lines，勿按其排除。
        if (l.startsWith('+')) additions += 1;
        else if (l.startsWith('-')) deletions += 1;
  ```

  （注释为一条两行换行，要素：四种前缀 + 文件头不在此层；可压一行，要素不减。）
- 其余零改动：`h.lines.map((l) => l)` 浅拷贝、hunk header 投影、file.additions/deletions 聚合、单文件 files 投影与 schema 形状全不变。

## Edge cases

- `'\\ No newline at end of file'` 标记行：`'\'` 前缀不匹配 `+`/`-`，新旧逻辑一致地不计——修复不引入行为变化（探针向量 C 看护）。
- 上下文行（`' '` 前缀）不计；行内容为空时行体至少含 1 字符前缀，`startsWith` 判断安全。
- wire 形状不变：hunks.lines 仍输出带前缀原始行（`+++x` 形态行原样透传），只修计数——web 端 mappers 消费面不受影响。
- 普通行（内容不以 +/- 开头）计数行为零变化，既有测试向量结果不变。
- `corepack pnpm install` 只按既有 lockfile 物化 node_modules，lockfile/package.json 零改动（git status 核证），非依赖变更、不触锁文件闸。
- 规划步已遵守「只写 plan.md」；构建步同样只落 documents.ts 一个文件，probe 脚本进 /tmp 不进仓。

## Verification

- 闸顺序（硬约束）：`corepack pnpm install`（失败则 `node ~/.cache/node/corepack/pnpm/12.5.1/bin/pnpm.mjs install`）→ `pnpm lint`（= biome ci .）→ `pnpm typecheck`（= pnpm -r typecheck）→ 全绿才允许 commit；commit 前 `git status` 证 lockfile/package.json 零改动。
- 红绿对探针（/tmp 脚本不进仓；node `--experimental-transform-types` + 自写 resolve hook 把相对 `.js` 规范重映射 `.ts`，import 真源码 computeUnifiedDiff；`@pacman/shared` exports 直指 src/index.ts 可直接 transform）：
  - 向量 A（新增向）：`computeUnifiedDiff('a\n', '++x\n', 1, 2)` → hunk 行含 `-a` 与 `+++x`。红（改前）：additions=0（`+++x` 漏计）、deletions=1；绿（改后）：additions=1、deletions=1。
  - 向量 B（删除向）：`computeUnifiedDiff('--y\n', 'b\n', 1, 2)` → hunk 行含 `---y` 与 `+b`。红：additions=1、deletions=0；绿：1/1。
  - 向量 C（no-newline 看护）：`computeUnifiedDiff('a', 'b', 1, 2)` → hunk 行含两条 `'\\ No newline at end of file'`。绿：additions=1、deletions=1，标记行不计（修复前后一致）。
  - 红腿须在改前实跑取实物（旧逻辑漏计数的运行时真值），改后同三向量复跑转绿——「机制生效验收:实物判据」；hunk 行具体顺序以实跑为准，断言只锁计数与漏计事实。
- 回归（可选，node_modules 已物化后）：`pnpm --filter @pacman/server exec vitest run test/chief-reject-diff.test.ts` 既有用例不红。
- commit：显式 `git add apps/server/src/services/documents.ts`（禁 `git add -A`，不带 AGENTS.md）；message 用 `server: ...` scope（本卡无票号，不带关票关键字）；commit 后不 push、不开 PR——收尾 daemon 自动 commit+push conv 分支，交付即完成。
