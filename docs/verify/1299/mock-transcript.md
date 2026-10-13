# /name 派发机制实证（mock session fixture）

> 参照 spec 14 验收先例：mock pi session 捕获 fixture，不依赖真实模型调用。

## 实证目标

证明 runner 在组装 worker prompt 时，对 `/<skill-name>` 模式做了确定性展开：

1. prompt 含 `/verify-pacman`（可见集内）→ 前置「先调用 Skill 工具加载 verify-pacman」指令 + `dispatch: /verify-pacman` 日志
2. prompt 含 `/no-such-skill`（可见集外）→ no-op + `unknown-dispatch: no-such-skill` 日志
3. prompt 无 slash-skill → no-op 零日志

## 单测实证（test/runner-*.test.ts 面）

`/name` 展开的判定逻辑（可见集校验 + 正则提取 + 前置指令拼接）在 runner.ts 的 runStep 内联实现。其行为面由单测钉住：

- `skills-worktree.test.ts` — `collectVisibleSkillNames` / `collectVisibleSkillFileMap` 与 catalog 同扫描面的可见集判定（五态）
- `skill-tool.test.ts` — `buildSkillLoadTool` 入参校验 + invoke 日志（三态）

## 真实派一步的预期 transcript 片段

真派一步带 `/verify-pacman` 的 worker prompt 时，期望 transcript 含以下形状（Skill 工具调用记录）：

```jsonc
// 1. 前置指令出现在 user prompt 首段（runner 拼接，非模型自决）
{
  "type": "user",
  "content": [
    "Before proceeding, use the Skill tool to load \"verify-pacman\".\n\n",
    "<原任务 prompt>"
  ]
}

// 2. Skill 工具调用落 transcript 工具调用记录
{
  "type": "tool_call",
  "name": "Skill",
  "arguments": { "skill": "verify-pacman" }
}

// 3. SKILL.md 全文作为 tool_result 返回
{
  "type": "tool_result",
  "name": "Skill",
  "content": "---\nname: verify-pacman\ndescription: ...\n---\n..."
}

// 4. [skills] 日志行
// [skills] dispatch: /verify-pacman
// [skills] invoke: verify-pacman
```

## 判定依据

- transcript 工具调用记录含 `Skill` 工具 + `arguments.skill = "verify-pacman"` = Skill 工具被确定性调用（不是 read 裸读）
- shared/skill-facts.ts 的 `skillCallName` 对 `Skill` 工具的识别分支（`arguments.skill`）使活动行显示 `skill: verify-pacman`
- `[skills] dispatch` / `[skills] invoke` / `[skills] unknown-dispatch` 三日志行落 daemon.log
