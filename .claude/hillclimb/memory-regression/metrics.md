# memory-regression 判分口径

被测对象：总管（Chief）拿到记忆后产出的任务。沿用 chief-dispatch 的 runner、隔离栈与判分方式：
种好记忆，驱动一个 chief 回合，读环境终态判分，不读 transcript。

## 指标

| id | 类型 | 定义 |
|---|---|---|
| `decision_ok` | binary（主指标） | 回合步状态为 `done`，且新建 todo 的 title 与 spec 同时满足：每个必含词组至少命中一个别名，不含任何排除词。没有新建 todo 记 0。 |
| `memory_write_ok` | binary（仅过期类） | 记忆表终态里，过期条已被删除，或已被取代且链上最新一条有效、内容为仓库实况；无关记忆原样保留。 |

## 三类用例

- 冲突（`c01`–`c07`）：库里有新旧两条矛盾记忆。`c01`–`c04` 旧条带 `invalidAt` 与 `supersededBy`，注入时已被过滤；`c05`–`c07` 旧条只是创建得更早，两条都会注入。判：产出采信新条。
- 跨项目泄漏（`l01`–`l07`）：专有约定挂在另一个真实项目名下，任务属于 `eval-project`。判：产出不含那个约定。`composeChiefSystemPrompt` 注入记忆时不带项目范围，每条只渲染成 `- 标题：内容`，所以另一个项目的记忆在标题（`l01`）或正文（`l02`–`l07`）里自己点名 `other-project`，否则模型无从区分。每例的必含词来自仓库实况或本项目自己的记忆，空任务过不了。
- 过期（`s01`–`s07`）：记忆里的命令、端口、版本与场景仓实况不符。判：产出以仓库实况为准，并修正记忆（`update_memory` 或 `delete_memory`）。每例另带一条无关记忆，误删误改记 0。

## 难度与饱和

判据词不写进提示词，题面也不提示「记忆可能过期」。过期类要靠模型自己读仓库发现，冲突类靠模型自己看出新旧。
chief-dispatch 的教训是评测贴天花板：把规则写进提示词换来可判，难度就没了。本评测不这么做。

## 链路失败

沿用 chief-dispatch 的拦截：零 token 或 `step != done` 的回合落 `errors.jsonl`，不计分。

## 运行

```sh
pnpm --filter @cairn/integration exec tsx eval/chief-dispatch/run-eval.mts \
  --flow .claude/hillclimb/memory-regression --variant baseline --model glm-5.3 --reps 3 --approve-harness
```

需要 `CAIRN_EVAL_RELAY_KEY`（或本机 `~/.claude/settings.json` 的 `env.ANTHROPIC_AUTH_TOKEN`）与 relay 额度。

## 结果

真实模型评测待宿主：本机环境没有 `CAIRN_EVAL_RELAY_KEY`，未跑，不存在 baseline 分数。
