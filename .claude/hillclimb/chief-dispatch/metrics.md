# chief-dispatch 判分口径

被测对象：总管（Chief）对一个用户请求做出的**一个回合**的决策。判据读**环境终态**——
回合结束后隔离库里的行，不读 transcript（对 agent 类应用，transcript 是叙述，环境才是答案）。

## 指标

| id | 类型 | 定义 |
|---|---|---|
| `decision_ok` | binary（主指标） | 该派工的场景派对了 Agent；不该派工的场景确实没派工。见下方逐类规则。 |
| `receipt_ok` | binary | 工作约定第 4 条「派工后点名承接 Agent 的职责语义」——正文里出现被派 Agent 的显示名。不派工的场景只看正文非空。 |

### `decision_ok` 逐类规则

**派工类（`expect.kind = "dispatch"`）**：判 `run_builds` 被调用 **且** 新建 todo 行的
`assignment.build.agentId` 命中期望的 Agent。两个条件缺一不可——只调了工具但派错人、
或只建了 todo 没派工，都算 0。

**不派工类（`expect.kind = "hold"`）**：判 `run_builds` **未**被调用 **且** 该回合有非空正文
且步状态为 `done`。第三个条件是为了堵「无回答 ≠ 否定回答」：一个被截断或被打断的空回合
不得因为「没派工」而被判通过。

## 为什么主指标是「派给谁」而不是「派没派」

`工作约定` 把「措辞→spec→按职责文本选 Agent」定成总管的中心职责。派给谁这一项：
可程序化判定（读 `todo.assignment`，无需裁判）、有天然的正反例（该派 / 不该派）、
且要改的面（系统提示词里的分派规则 + `run_builds` 的 description）便宜可回滚、指标与
改动面直接耦合——正好落在 hillclimb 的三条适用判据上。

## 场景编制（roster）

四个 Agent 用**花名**（阿岚 / 老周 / 小柯 / 铁手），分类信息只存在于 `description` 里。
这是刻意的：显示名若写成「文档专职」这类，模型不读职责文本也能全对，评测会贴天花板，
后续只能冲成本、冲不了质量。

模型分配：老周 → glm-5.3，小柯 → kimi-k3，阿岚 → qwen3.8-max，铁手 → glm-5.3。
四个 Agent 用三个模型，`modelId` 与分类不一一对应，堵住「按模型名猜分类」这条捷径。
（四个 Agent 在评测里**从不被执行**，它们只是标签；真正被调用的是总管。）

## baseline 结果（glm-5.3，36 用例 × 3 reps，2026-09-29）

```
decision_ok  168/176 = 95.5%   95%CI [92.4%, 98.5%]
原有 36 条 100/105 = 95.2%   新增 28 条 68/71 = 95.8%
成本 $9.16   链路失败 16 条（8.3%，全 harness_error，已隔离不计分）
```

**这个评测已经饱和，测不出改进了。** 余量 4.5 个百分点小于底噪 ±7.5 个百分点。

为此做过一轮加难（36 → 64 条：诱饵路径 8 / 跨类别 6 / 症状归属 6 / 难负例 8），
并先在 `工作约定` 里补了三条对应判别规则以保证「可判」。**结果是加难失败**：
新增的 28 条得 95.8%，比原有的 95.2% 还高 0.6 个点。

失败的原因值得记下来：难例之所以难，通常是因为落在类别边界；而为了让边界可判、
两个专家会同判，就得把判别规则写进提示词——**规则一写进去，模型读规则套规则就
又是容易的了**。难度没有转移到边界判断，只是换了一批「读规则做题」。

结论：派发决策这件事本身对该模型不难。规则写清、编制干净的前提下它近乎全对。
这个评测的有效用法不是能力爬坡的尺子，而是**回归门**（改动后路由是否还正确），
以及下面那条真实缺陷的验证器。

### 失败形态

真失败 6 行 / 5 个 case，两类：

1. **名字与 id 不一致**（o01、o02、o06，共 4 行）——四类里最值得追的一条：
   正文从头到尾写对了（「派给运维职责的 [铁手](agent:X)」），但它引用的 X 是
   **前端 Agent 的 id**。名字与 id 对不上。任何读 transcript 的裁判都会给这几条
   打满分，只有读环境终态才露馅。根因大概率是四条 Agent 被
   `composeChiefSystemPrompt` 压成一行 JSON，加上两个 Agent 共用同一个 `modelId`，
   模型在做 id↔名字对应时错位。
2. **该派而未派 / 无正文**（c03 各 1/3、n12 1/3）：前者做完了探测与建任务却没调
   `run_builds`；后者做了 5 次读侧调用但没吐任何正文——按「无回答 ≠ 否定回答」，
   空回合不得因为「没派工」被判通过。

## 已修复：名字/id 错位（2026-09-29）

上面第 1 类失败查实为产品缺陷，已修，并用本评测验证：

- **成因**：`composeChiefSystemPrompt` 把 agents 清单压成一整行 JSON，分派变成
  在密集条目里数位置抄 id。失败呈现系统性「往前错一位」——该派最后一个 Agent
  （铁手），实际派了它前面那个（小柯），而回执正文里名字仍然写对。
  另有一个放大器：helpers 会给每个测试栈 seed 一个集成测试用 Agent
  （`agent-it-1`），它不属于场景编制却出现在清单里，多一个错位机会。
- **修法**：agents 改成一行一个、名字与 id 相邻；场景侧清掉那个遗留 Agent；
  并给 `run_builds` 加 `requireTeamAgent`——不存在的 agentId 抛错经 relay 回到
  模型眼前（此前是静默落库，直到构建跑起来才炸，而用户早已看到「已派工」）。

**验证**（同 9 条用例 × 3 reps，修复前取本轮 baseline 的同批行）：

| | 修复前 | 修复后 |
|---|---|---|
| 9 条合计 | 20/25 = 80% | 27/27 = 100% |
| 其中 ops 相关 7 条 | 15/19 | 21/21 |

若错位率不变（21%），21 次全对的偶然概率约 0.7%。

**注意：本文件上面的 baseline 数字早于这次修复**（`harness_sha` 也已随之失效，
重跑需 `--approve-harness`）。要一份与当前代码一致的基线需重跑全量。

### 计分边界：哪些回合不算分

链路失败**一律落 `errors.jsonl`，绝不计分**。两种实测形态都必须在 runner 里拦掉，
否则失败会集中到某几条用例上，看起来像「模型系统性不会做这件事」：

1. **零 token**：回合根本没跑到模型（延迟整齐卡在 ~30s 的超时特征）。
2. **`step != done`**：模型跑了、也出了话，但步以失败收场。**只看 token 抓不到
   这一种**——有过某条用例 3/3 全是 failed step，被误读成「它系统性地不派工」，
   实际是链路问题。

## 怎么跑

凭据：relay key 取 `CAIRN_EVAL_RELAY_KEY`，缺省回落 `~/.claude/settings.json`
的 `env.ANTHROPIC_AUTH_TOKEN`。relay 地址可用 `CAIRN_EVAL_RELAY_URL` 覆盖。
密钥只在进程内持有，不落盘、不进仓。

```sh
# 全量 baseline（36 用例 × 3 reps，约 $5 / 35 分钟）
pnpm --filter @cairn/integration exec tsx eval/chief-dispatch/run-eval.mts \
  --flow .claude/hillclimb/chief-dispatch --variant baseline --model glm-5.3 --reps 3

# 出报告 → .claude/hillclimb/chief-dispatch/report.html
node integration/eval/chief-dispatch/build-report-lite.mts .claude/hillclimb/chief-dispatch/
```

改动 harness（runner / judgeCase / cases.json / 场景种子 / `chief.ts`）后，
下一次运行会因 `harness_sha` 不符而拒绝——这是刻意的：重跑前先看 diff，
再带 `--approve-harness` 放行。跑挂了直接重跑即可，已完成的 (case,rep) 会跳过。

## 诊断入口

| 脚本 | 用途 |
|---|---|
| `oracle-check.mts` | 判分链自检（oracle 必过 / null 必挂 / misroute 必挂），不花钱 |
| `verify-seed.mts` | 摊开场景裸仓的完整文件树，验种子有没有真进仓，不花钱 |
| `debug-one.mts <flow> <caseId>` | 跑单条用例并打印 roster→agentId 映射、run_builds 实参、todo 落库、正文点名 |

## 已知缺口（如实记录，不掩盖）

1. **截断只能靠征兆判定。** cairn 目前不上报模型的 `finish_reason`，runner 只能用
   「回合正常结束但既无工具调用也无正文」当截断特征。这会把截断和「模型主动不作为」
   混在一起。修法是让 daemon 在 step 事件/transcript 里带上 `stop_reason`（加法改动）。
2. **served-model 断言较弱。** 模型 id 取自 `token_usage.model`，是 cairn 自己记的账，
   不是上游响应回显的——它能发现「daemon 选了别的模型」，发现不了 relay 静默换模型。
3. **relay 不报成本。** `cost_usd` 按 OpenRouter 挂牌价现算，不是账单实测值。
4. **链路失败率约 5%。** 108 回合里 5 条没跑到模型（零 token）或 `fetch failed`。
   已落 errors.jsonl 不计分，但重复跑会缺格。

## relay 可用性（2026-09-29 实测，四类请求各一次）

| 模型 | 应答 | 出工具调用 | 中位延迟 | 结论 |
|---|---|---|---|---|
| `kimi-k3` | 4/4 | 4/4 | 22.1s | 可用 |
| `glm-5.3` | 4/4 | 4/4 | 18.3s | 可用，推理最重 |
| `qwen3.8-max` | 4/4 | 4/4 | 11.6s | 可用 |
| `deepseek-v4-pro` | 2/4 | 1/4 | — | 不稳（502 上游断流） |
| `gpt-5.6-luna` | 0/4 | 0/4 | — | 不可用（relay 未配账号） |
## 成本画像与已落杠杆（2026-09-29）

单回合实测：输入 10,957 · 输出 3,149 · cache 读 87,891 · 工具调用 10.7 次。
成本拆解：**cache 读 43.9%**、输入 29.5%、输出 26.6%。

cache 读是最大项，而它随**往返次数**线性增长（每次工具调用都要把整个上下文
重发一遍）。成本与往返次数的关系实测是十倍跨度（0 次 $0.011 → 20 次 $0.113）。

工具调用分布（176 条 trace / 1881 次）：`docs` 一个占 **64%**（每回合 6.8 次），
而它是单文件读接口。前 5 个工具（docs/bash/create_todo/watch_todos/run_builds）
覆盖 90% 的调用。

### 杠杆①：docs 批量读（已落）

`docs` 的参数由 `path` 改为 `paths: string[]`，一次可读多个文件；逐条读、逐条
记错（不因单条失败整体回退）；单次上限 24 条，超出在应答里显式报 `omitted`。

全场测量（同 64 条用例，改前 3 reps / 改后 1 rep）：

| | 往返 | 输入 tok | 输出 tok | cache 读 | 成本/回合 | decision_ok |
|---|---|---|---|---|---|---|
| 改前 | 10.7 | 10,957 | 3,149 | 87,891 | $0.0520 | 95% (n=176) |
| 改后 | 6.0 | 10,698 | 2,937 | 65,847 | **$0.0450** | 100% (n=61) |
| 变化 | −44% | −2% | −7% | −25% | **−14%** | 无回退 |

**每回合省 14%。** 往返砍掉 44% 而输入几乎没动（往返少了、每趟上下文更长，
两边部分抵消）。

顺带：`harness_paths` 原先漏了工具定义（`packages/shared/src/protocol/chief-tools.ts`）
与执行体（`apps/server/src/services/chief-tools.ts`）——评测测的正是「总管按工具面
做派发」，改工具描述居然不触发重新放行。已补。

### 不可安全执行的杠杆

按「从未被调用」裁工具（33/53 个从未出现，占 62% schema 体积）**不可凭本评测做**：
这 176 条 trace 全来自评测用例，而它们只覆盖「一个用户请求 → 派工决策」，
`create_project`/`connect_repo`/`set_secret`/`merge_builds` 等之所以没出现，是因为
**评测故意不覆盖那些场景**（wake 轮、配置轮不在范围），不等于生产不需要。
裁之前需要真实流量。

### 杠杆②：降思考档位 —— 结构性不通（2026-09-29）

`CAIRN_EVAL_CHIEF_THINKING` 旋钮已加（评测 seed 里一个参数，不动产品代码）。
但 A/B 显示它对 relay 上的模型**无效**：默认档位输出 4,452 token / $0.0636，
`low` 档位输出 5,513 / $0.0657（4 条用例里 3 条输出反而变多，纯跑间噪声）。

机制查实（读 pi 的 `dist/core/model-config.d.ts`）：pi 要把档位下发出去，得靠
模型条目里的 `thinkingFormat`（`zai`/`qwen`/`deepseek`/`openrouter`/…）+ 
`thinkingLevelMap`（档位 → 该 provider 的请求字段）。而 `materializeProvider` 给
自定义端点写的条目只有 `reasoning/input/cost/contextWindow/maxTokens`——
**两个字段都没有**，pi 手里没有可翻译的目标。

**产品含义**：cairn 的自定义端点路径完全没有推理深度控制。对 relay 上的模型，
推理 token 照生成照计费，用户没有任何开关。输出占成本 26.6%，这一块目前不可管理。
要打开它得为每个模型声明 `thinkingFormat`/`thinkingLevelMap`（需逐 provider 的
wire 知识，属 spec 11 的地界）。

`CAIRN_EVAL_CHIEF_THINKING` 保留：对声明了思考能力的模型有效，是评测该有的旋钮。

### 杠杆②补：自定义端点接推理档位 —— 已实现（opt-in），效果未定论（2026-09-29/30）

前一节记的「结构性不通」已解：pi 的 `dist/bundle/chunks/openai-completions-*.js` 里，
只要模型条目 `reasoning: true` 且 compat 探测到 `supportsReasoningEffort`，就会走
通用分支下发 `reasoning_effort`（值经 `thinkingLevelMap` 映射）。我们的 relay 三者
都不匹配，落到 `thinkingFormat:'openai'` + `supportsReasoningEffort:true`。

实现：`CAIRN_CUSTOM_MODEL_REASONING=1` 时，`materializeProvider` 给自定义端点的
模型条目写 `reasoning:true` + 七档映射 + `compat:{supportsDeveloperRole:false}`。
**opt-in 而非默认**：不同后端对 `reasoning_effort` 容忍度不同——实测本 relay 只认
low/high/max，传 `medium` 直接 400，默认打开会让一部分自定义端点整条挂掉。映射只
写该 relay 确认接受的取值（none/low/high/max），并把七档单调折到四档上。
`supportsDeveloperRole:false` 必需：`reasoning:true` 会把系统提示词角色从 system
换成 developer（pi 的 instructionRole 判定），钉住它才保证提示词形态不变。

**wire 证据**（`wire-tap.mts`，把 relay 地址指到本地记录代理）：请求体确实是
`{"reasoning_effort":"low"}`、`systemRole:"system"`、52 工具、maxTokens 16384。

**效果：未定论。** 同 20 条用例配对 A/B（唯一变量 = 开关）：

| 指标 | 开关关 | 开关开+low | 配对差 ±95%CI | 显著 |
|---|---|---|---|---|
| 输出 token | 4,220 | 3,878 | −342 ± 999 | 否 |
| cache 读 | 123,200 | 90,790 | −32,410 ± 72,189 | 否 |
| 往返 | 9.35 | 7.70 | −1.65 ± 3.78 | 否 |
| 成本 | $0.0677 | $0.0577 | −$0.0100 ± $0.0210 | 否 |
| 延迟 | 62.4s | 54.8s | −7.6 ± 11.3 | 否 |
| decision_ok | 18/20 | 19/20 | — | — |

六个指标的点估计**全部**朝好的方向，但 n=20 分辨不了；成本要定论需约 80 条配对。

**一条方法论教训**：单次调用的探针会严重高估效应——探针里 `reasoning_effort=low`
把输出砍到 1/4，真实 agentic 回路里点估计只有 −8%。单发没有工具往返与上下文累积，
不代表真实负载；评估这类字段必须走真实回路。
