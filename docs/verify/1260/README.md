# #1260 总管降级为普通 agent live 验收证据

probe：`drive-1259-1260-binding.mjs`（与 #1259 共用一栈一脚本；栈 =
launch.mjs 隔离实例 + 全新库；零 daemon、零 LLM——chief 回合数据面与真
机器同形，claim 全走真 machine wire）。结果：**27/27 checks PASS**；
证据实物在 `docs/verify/1259/`（两票共用一栈一跑，截图与 JSON 同份）。

## 场景

chief 绑定铺底 agent（归属机 `verify-home-1259`）后，chief 步的去处、槽位、
模型全部读该 agent 的自身配置。

| 腿 | 动作 | 判据（证据文件） |
|---|---|---|
| A4 路由降级 | chief 回合入队 → 别机空手、归属机领到 | `a-claims.json`：chief 步 kind=chief、machineId=home、载荷 modelId=绑定 Agent 自身值（无覆盖槽） |
| B 占槽 | 归属机 maxConcurrent=1 + chief 步在跑 → 再 claim 空手 | result.json `B1`（chief 步占机器槽，满载即排队） |
| F4 抽屉 | 模型行只读（绑定 Agent 自身模型值，无覆盖触发钮） | `f4-chief-drawer.png` + result.json `F4`（`总管主模型` 按钮计数 = 0） |
| F5 设置面 | Agent tab 只读信息卡「模型与归属机跟随绑定 Agent」在位；压缩模型/机器选择器退役 | `f5-chief-settings.png` + result.json `F5` |

亲和三件套（#863/#862 T1/#895）与覆盖槽（model/compactionModel/thinkingLevel）
的退役面 = grep 零命中 + wire 面 400（server `chief-settings.test.ts` 退役槽族
用例；`machine-concurrency-chief.test.ts` 翻转钉占槽语义）。

## 复跑配方

```sh
node .claude/skills/verify-pacman/scripts/launch.mjs
node .claude/skills/verify-pacman/scripts/drive-1259-1260-binding.mjs
node .claude/skills/verify-pacman/scripts/cleanup.mjs
```

## 单元 / e2e 面

- server：`test/chief-demotion.test.ts`（9 条失败方式先行：路由换源/占机器槽/
 占 Agent 槽/无继承/退役槽 wire/sweep 三分支）+ `chief-abandoned-sweep` /
 `machine-pin` / `chief-settings` 翻转重写；`chief-affinity` /
 `chief-model-slot` 随机制退役删除。
- shared：快照重生 = 纯退役槽删除（chief 记录四键 + PATCH 槽 + claim 载荷
 reworkContext）。
- web：`chief-settings.spec.ts` 收编（选择器族测试删、信息卡钉新增）+
 `chief-send-fallback.spec.ts` 随回落链删除。
