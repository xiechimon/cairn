# /name dispatch mechanism evidence (mock session fixture)

> Following the spec 14 acceptance precedent: a mock pi session capture fixture, no real model call involved.

## Evidence goal

Prove that the runner performs a deterministic expansion of the `/<skill-name>` pattern while assembling the worker prompt:

1. the prompt contains `/verify-pacman` (inside the visible set) → the "call the Skill tool to load verify-pacman first" instruction is prepended + a `dispatch: /verify-pacman` log
2. the prompt contains `/no-such-skill` (outside the visible set) → no-op + an `unknown-dispatch: no-such-skill` log
3. the prompt has no slash-skill → no-op, zero logs

## Unit-test evidence (the test/runner-*.test.ts face)

The `/name` expansion's judgment logic (visible-set validation + regex extraction + prepended-instruction composition) is inlined in runner.ts's runStep. Its behavior face is pinned by unit tests:

- `skills-worktree.test.ts` — the visible-set judgment of `collectVisibleSkillNames` / `collectVisibleSkillFileMap` on the same scan surface as the catalog (five states)
- `skill-tool.test.ts` — `buildSkillLoadTool` input validation + invoke logs (three states)

## Expected transcript fragment of a real dispatched step

When a real dispatched step's worker prompt carries `/verify-pacman`, the transcript is expected to contain the following shape (the Skill tool invocation record):

```jsonc
// 1. the prepended instruction appears at the head of the user prompt (runner-composed, not model-decided)
{
  "type": "user",
  "content": [
    "Before proceeding, use the Skill tool to load \"verify-pacman\".\n\n",
    "<original task prompt>"
  ]
}

// 2. Skill 工具调用落 transcript 工具调用记录
{
  "type": "tool_call",
  "name": "Skill",
  "arguments": { "skill": "verify-pacman" }
}

// 3. the SKILL.md full text returned as a tool_result
{
  "type": "tool_result",
  "name": "Skill",
  "content": "---\nname: verify-pacman\ndescription: ...\n---\n..."
}

// 4. the [skills] log lines
// [skills] dispatch: /verify-pacman
// [skills] invoke: verify-pacman
```

## Judgment basis

- the transcript's tool-call record contains the `Skill` tool + `arguments.skill = "verify-pacman"` = the Skill tool was invoked deterministically (not a bare read)
- the `Skill`-tool recognition branch of `skillCallName` in shared/skill-facts.ts (`arguments.skill`) makes the live row display `skill: verify-pacman`
- the three log lines `[skills] dispatch` / `[skills] invoke` / `[skills] unknown-dispatch` land in daemon.log
