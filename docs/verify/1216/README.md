# #1216 板面 UI 可靠性三缺陷 —— 验证与证据索引

三条缺陷的永久回归面 = `integration/test/board-trio-e2e.test.ts`（真 web 生产构建 +
真 server + 假机器 wire，零 daemon 零 LLM：chief 编排回合由测试认领后直接
relay `run_builds`，派发时序确定）。本目录是改前/改后成对证据与生产取证。

## 复跑配方

```sh
# after（本分支）：
cd integration && pnpm exec vitest run test/board-trio-e2e.test.ts   # 3/3 PASS

# before（基线 3f571ea6 一次性 worktree，同法起栈）：
git worktree add --detach /tmp/pacman-1216-base 3f571ea6
cp integration/test/board-trio-e2e.test.ts /tmp/pacman-1216-base/integration/test/
# 基线 shared 无 orchestrateThreadTitle 导出：把该 import 换成本地
# `const orchestrateThreadTitle = (seqNum) => \`开始任务 #${seqNum}\`;`
cd /tmp/pacman-1216-base && corepack pnpm install --frozen-lockfile
cd integration && pnpm exec vitest run test/board-trio-e2e.test.ts   # 3/3 FAIL（红在缺陷断言）
```

截图对（同一份库状态：failed 卡 #26 带一条在飞编排回合；两栈共用同一
copy-DB server 8793，web 分跑基线 5276 / 修复 5275）：

```sh
node <worktree>/.claude/verify-run/probe-1216-evidence.mjs   # 只读页面采集，不点 mutation
```

## 判读表

| 场景 | 基线（before） | 修复（after） |
|---|---|---|
| failed 详情，编排回合在飞 | `before-detail-blind.png`：主钮照亮「重跑」，在飞零可见 | `after-detail-inflight.png`：主钮禁用「编排中」 |
| 看板 failed 卡，回合在飞 | `before-board-blind.png`：「重试」照亮 | `after-board-inflight.png`：禁用「编排中」 |
| 详情 id 不存在 | `before-blank-shell.png`：空白壳（root 仅 1994 字节，无解释无出口） | `after-notfound.png`：not-found 面板 + 回看板 |
| 详情查询失败（网络层拒绝） | 同空白壳 | `after-error-state.png`：error 面板 + 重试（放通后自愈） |
| DOM 事实 | `evidence-1216.json` before-* 行（head/card disabled=false、unavailable=null） | 同文件 after-* 行（disabled=true、data-state 齐） |

## 集成测试三条用例与缺陷的对应

1. ① 保存并开始：一次点击落恰好一条编排线程；在飞期间卡面钮禁用「编排中」
   （改前红：卡面是照亮的「开始」，连点即重复线程）；chief 派发后相位
   todo→queued→planning，卡进执行中列——「一次点击即进规划」的机器侧真值。
2. ② failed 重跑：dialog 重跑必落新编排线程 + 主钮翻「编排中」；chief 派发后
   buildHistory 2 条、相位离 failed（改前红：重跑后零可见反馈）。
3. ③ failed 详情可删（更多→删除→确认→server 404→回看板卡消失）；缺失 id 出
   not-found 面板、查询失败出 error 面板 + 重试自愈（改前红：永久空白壳）。

## 回归面

- `m5-web-e2e.test.ts`（主时序脊柱：review/confirm/building 既有按钮行为）3/3 PASS。
- `apps/web` e2e 全量 916：915 PASS + 1 flake（provider-oauth 的 networkidle 超时，
  单独复跑 7/7 PASS，与本票改动面零交叠）。
- 单测：web 480 / server 970 / shared 339 全 PASS；lint、typecheck、spec:parse 全绿。

## 生产取证

`prod-forensics.txt`：2026-10-11 看板试点库只读查询——同卡重复编排线程
（#30 七条 / #32 四条 / #24 两条间隔 13s）= 「点了没反应」连点的量化指纹；
#26 重跑点击零线程 = 详情白屏时入口够不着的同根证据。
