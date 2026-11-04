# R15 · Should the first Agent's responsibility have a default value: source evidence from seven ecosystems and the trade-off (t-0198)

> Ticket: the user asked on the board — "When initializing a task, i.e., when initializing the first agent, should there be a default value? Research how other projects handle this at the code level." (t-0198, verbatim from the Herdr thread task brief)
> Nature: decision material, not implementation. **Zero product-code changes, no ticket opened, no `docs/spec/` touched.** The only artifact = this document.
> Code baseline: `origin/main` = `a831032e` (2026-10-05; this branch is that tip). All P-side line numbers were verified line by line on this baseline.
> Evidence execution: this thread did **L-A** itself (Claude Code subagents, including runtime experiments) plus three parallel research threads — **L-B** (CrewAI / AutoGen), **L-C** (OpenAI Agents SDK / LangGraph / Letta), **L-D** (MetaGPT / ChatDev / Dify / Coze / n8n). All four conclusions are embedded in this document; each carries its own repo / path / branch, with no separate raw archive.

## 0. Reading conventions

Three kinds of sources, marked item by item:

- **P** (pacman code) = `path:line`, verified line by line on `a831032e` on 2026-10-05.
- **L-A / L-B / L-C / L-D** (research-thread artifacts) = conclusions embedded in this document, with the evidence verbatim being the code snippets each thread produced.
- **D** (documentation statement) = official docs captured live (Claude Code docs; capture via `agent-reach`'s web channel = Jina Reader).

Four evidence tiers; every conclusion in this document must land on exactly one:

| Tier | Meaning |
|---|---|
| **Source-verified** | Verbatim code / config / binary string, re-checkable |
| **Runtime-measured** | Actually ran locally and observed behavior (not inferred from reading code) |
| **Documentation statement** | Verbatim official docs, not cross-checked against code |
| **No evidence obtained** | Unavailable (closed source / capture failed), stated explicitly, not made up |

---

## 1. Problem restated: which cell is the user asking about

`A default value` is not one action; it is **four placements that can be landed independently, with different costs**. Without splitting them first, the discussion slides into "do others have one".

| # | Placement | Mechanism | Can the user tell it is a default |
|---|---|---|---|
| ① | **schema default** | `z.string().default(...)` / column `DEFAULT` — filled in when the field is absent | No (indistinguishable from a hand-filled value) |
| ② | **creation-surface pre-fill** | a pre-filled text in the create form | Yes (visible in the input, editable) |
| ③ | **first-time seed** | automatically create an agent at bootstrap | Yes (one extra data row) |
| ④ | **consumption-side fallback** | null → some text when read | Depends on the wording |

**pacman today: only ④, and the fallback text is `未设置职责` — a string describing the missing state, injected into the model prompt as if it were the responsibility description itself.** ①②③ are all absent (§2 gives line numbers item by item).

The real question therefore narrows to two sentences:

1. **Would a real default value (①/②/③) improve the chief's dispatch quality?**
2. **If not, should we switch to some other means so that the `not filled in` state is visible at the right moment?**

The criteria are not set by other projects — this repo's discipline is `changes are driven by real usage, not by copying others' spec`, and the reference product displays `未设置职责` in this position, so `adding a default value` is itself a deviation from the reference product (§2.7). The only use of how others do it: **to see whether this problem has a known failure shape elsewhere**.

---

## 2. P-side current-state recheck (code facts)

The current-state description in the task brief is basically correct, but three points need correction/completion: **the create dialog actually has no responsibility field**, **the same null behaves inconsistently across the two consumption surfaces**, and **the write side has empty-string penetration**. One by one.

### 2.1 Field shape: nullable, no default

- Record shape `packages/shared/src/records/agent.ts:100`: `description: z.string().nullable(),` — nullable, no `.default()`. The adjacent comment (:99) states `null shape [inference]`.
- Create body `packages/shared/src/records/agent.ts:125`: `description: z.string().nullish(),` — `nullish` = omittable / possibly `null`, also no default.
- Update body `apps/server/src/routes.ts:256` (`patchAgentBodySchema`): `description: z.string().nullish(),`.

### 2.2 Both creation paths omit the default

- **REST** `apps/server/src/routes.ts:914` (`POST /api/teams/:id/agents`), write row `:925`: `description: body.description ?? null,`.
- **chief tool** `apps/server/src/services/chief-tools.ts:511` (`case 'create_agent'`), write row `:518`: `description: optStr(params, 'description') ?? null,`.
- The corresponding tool declaration `packages/shared/src/protocol/chief-tools.ts:349-361`: the `description` parameter **exists in the schema** (wording `'Responsibility text (injected into every task and used for dispatch).'`), but `required` is only `['displayName']` — **the LLM side is explicitly told this parameter exists and is load-bearing, yet is not required to fill it**.
- The update side follows the same law: REST PATCH `apps/server/src/routes.ts:954` (field list `:970`, null-semantics comment `:978`); chief `update_agent` `apps/server/src/services/chief-tools.ts:534` (`const desc = optStr(params, 'description');` `:544`, written back `:548`).

### 2.3 Reference-product comparison: the create dialog **also has** no responsibility field

- Not mentioned in the task brief, but this is the key background for this repo's behavior. **This repo's create dialog has no responsibility input**: the `apps/web/src/routes/create-agent-dialog.tsx` form has only `名称` (`:114-121`, `dlg-agent-name`) and the two `运行时 / 模型` levels (`:128-150`), no `description` control; `CreateAgentInput` (`:37-41`) also has only `displayName` / `provider` / `modelId`.
- The reference product has the same shape: `docs/research/r2-app-ui-inventory.md:347` records capture 20 = avatar + change / `名称` (placeholder `如 Opus builder`) / warning row / `创建` — **no responsibility field**.
- ⚠️ **One in-repo comment conflicts with the evidence**: `packages/shared/src/records/agent.ts:122-123` writes `create dialog r3 §4: name/responsibility/model`. r3 §4 (`docs/research/r3-protocol-executor.md:179-188`) describes the **Agent detail page's `概览` tab** (avatar / name / **responsibility** / default skill / model / thinking intensity), not the create dialog. That comment mis-records the detail-page field set as the create-dialog field set — a **documentation debt, not a behavior defect** (behavior follows r2 capture 20 and this section's code).
- This yields a conclusion stronger than the task brief's: **`a newly created Agent has an empty responsibility` is not an edge case but this repo's and the reference product's shared default path** — the create surface has nowhere for the user to fill it.

### 2.4 The same null, two consumption surfaces behave oppositely

This is the single most worth-recording item in the recheck.

- **Chief side: literal injection.** `apps/server/src/services/chief.ts:755` (the bound-Agent row)
  `` `绑定 Agent：${agentRow.displayName}（…）。职责：${agentRow.description ?? '未设置职责'}` ``
  and `:768` (the team agents-list row)
  `` `- ${a.displayName}（id: …，模型: …）：${a.description ?? '未设置职责'}` ``
  → the string `未设置职责` enters the chief system prompt **as the responsibility text itself**. Yet the strategy section of the same prompt says `read the agents' responsibility text and choose by weight` — the instruction requires choosing by responsibility, but the field contains `未设置职责`.
- **Worker side: silent omission.** `apps/daemon/src/runner.ts:259-274` (`composeWorkerSystemPrompt`): the first line is `if (description) parts.push(description);` — falsy (null and `''` alike) is simply not injected; the call site at `:531-534` hands the result to `systemPrompt`, returning `undefined` when `parts.length === 0`.
- In other words: **pacman has already answered this question twice, and with opposite answers** — the chief surface chooses `explicitly declare the absence`, the worker surface chooses `treat it as not there`. The worker surface's choice is the correct one (§5.2 explains why the chief surface's is wrong).

### 2.5 The write side also has a hole: `??` does not catch the empty string

Among the four API write paths, only the UI edit surface normalizes:

- UI save `apps/web/src/routes/agent-detail-page.tsx:841-845`: `const next = draft.trim(); onCommit(next === '' ? null : next);` — **empty string normalized to null**, correct.
- But REST POST (`routes.ts:925`), REST PATCH (`routes.ts:970-979`), chief `create_agent` (`chief-tools.ts:518`), chief `update_agent` (`chief-tools.ts:544-548`) are none of them normalized. `'' ?? null` evaluates to `''` (`??` only catches `null` / `undefined`), so `description: ""` is **written to the database verbatim**.
- Consequence: every `?? '未设置职责'` fallback fails on `''` (`'' ?? x` = `''`); the detail page `apps/web/src/routes/agent-detail-page.tsx:812`, the team page `apps/web/src/routes/team-page.tsx:184`, and the chief prompt `chief.ts:755/768` all render **blank**, losing even the `未设置职责` signal.
- Tier: **source-verified** (derived from reading the code; did not run at runtime to construct the state).
- **This is a constraint on the §5 trade-off**: any `default value` proposal's criterion must cover both `null` and `''`, otherwise the default is still bypassed by the empty string.

### 2.6 Other consumption surfaces (the responsibility-is-load-bearing evidence chain)

| Location | Shape | Empty-value behavior |
|---|---|---|
| `apps/server/src/services/chief.ts:755,768` | chief system prompt | literal `未设置职责` |
| `apps/daemon/src/runner.ts:259-274` | worker-step systemPrompt | the whole block omitted |
| `apps/web/src/api/mappers.ts:879` | `role: a.description ?? null` | `null` |
| `apps/web/src/routes/agent-detail-page.tsx:812` | detail-page responsibility row | `t('未设置职责')` |
| `apps/web/src/routes/team-page.tsx:184` | team-page card subtitle | `t('未设置职责')` |
| `apps/web/src/overlay/use-new-task-surface.ts:286`, `apps/web/src/routes/todo-detail-page.tsx:754` | assign-selector subtitle | `a.role ?? a.model` — **falls back to the model name** (a third fallback wording) |

Three different fallbacks (`未设置职责` / omission / fall back to model name) show this question has never been ruled once, uniformly, in this repo.

### 2.7 Precedent and e2e pinning

- **Precedent (named by the task brief)**: `packages/shared/src/records/agent.ts:64` `export const AGENT_TOOL_DEFAULTS: readonly AgentToolSwitch[] = [AGENT_TOOL_PUSH];` (XMON-84 B4, `推送分支` on by default). Its trade-off logic is written in the `:61-63` comment as **two criteria**: `does not break delivery` (without it a new agent cannot push its working branch → breaks delivery) + `least privilege` (merging into the default branch is a release behavior, not on by default). Existing-row backfill goes through migration `apps/server/drizzle/0018_agent_push_backfill.sql` (`UPDATE agent SET tools = json_insert(...) WHERE NOT EXISTS (...)`).
  **The transferable part of this precedent is not `it gave a default value` but its criterion shape**: a default is added only when `its absence breaks an existing chain`, and the added tier must be an **unambiguous safe value**. §5 measures the responsibility against the same yardstick.
- **bootstrap does not seed**: `apps/server/src/db/seed.ts` only creates the user + team rows (`:29-40`), **zero agents**. The task brief's claim on this is true.
- **The first-use hard gate**: chief not bound → `apps/web/src/chief/chief-drawer.tsx:600` renders `请先为总管选择一个 Agent。` (wording canon `apps/web/src/i18n/en.ts:355`). That is, **the user must first create an agent and bind it before they can use the chief** — `the first agent` has a definite meaning in this repo.
- **e2e already pins the empty state as canon**: `apps/web/e2e/agent-detail.spec.ts:105` asserts `.agent-role-text` text = `未设置职责` (failure-mode number 5, file header `:12`). Therefore **any default-value proposal reds here first** — this is a ready-made instrument for `a change has consequences`.

---

## 3. Horizontal research: how seven ecosystems handle the `responsibility / instruction field` at the code level

Four shape classes: **A required validation** / **B has a default value** / **C nullable + empty-state wording** / **D no field (built-in, hard-coded)**.

### 3.1 Claude Code subagents (A · the most relevant direct precedent) — **L-A**

This is the direct precedent in the user's ecosystem, and the only one of all seven targets that **treats `responsibility` as a routing key and protects it with a hard constraint**. All three evidence lines are in place.

**Source classification**: the frontmatter `description` of `.claude/agents/*.md`.

**① Is the field required — yes, hard required.** Documentation (**D**) verbatim: `Only name and description are required.` (Create custom subagents, `docs.claude.com/en/docs/claude-code/sub-agents`, captured 2026-10-05). The same page's "Subagent files Claude Code skips" section, verbatim:

> *   **A `name` but no `description`**: Claude Code skips the file and writes the reason to the debug log.

**② Is there a default — no.** The built-in subagents' descriptions are all hard-coded in the product (Explore / Plan / general-purpose / claude-code-guide / statusline-setup), no user-side default.

**③ The actual code path for a missing description (source-verified).** Extracted from the local binary `/opt/homebrew/Caskroom/claude-code@latest/2.1.289/claude` (219 MB single-file Mach-O; the JS source is readable after `strings -n 6`):

```js
function bzn(e, n, r, s, g) {
  try {
    let { name: h, description: b } = r;
    if (!h || typeof h !== "string") return null;
    if (h.startsWith("-")) return t(`Agent file ${wy(e)} has invalid name '${wy(h)}': names must not start with '-'`, {level:"error"}), null;
    if (h.normalize("NFKC").includes(":")) return t(`...names must not contain ':'...`, {level:"error"}), null;
    if (mx("agent", r), !b || typeof b !== "string")
      return t(`Agent file ${e} is missing required 'description' in frontmatter`), null;
    ...
```

Note the `return null` — **the parse function abandons this definition**; compared with the two `name` validations, this `t(...)` carries no `{level:"error"}` (a weaker level), but the result is likewise null.

**④ Runtime experiment (runtime-measured; the two creation paths fail in different shapes).** Three frontmatter variants were created locally, and the Agent tool's subagent_type list was read back via nested `claude -p`:

| File | frontmatter | Result |
|---|---|---|
| `alpha-ok.md` | `name` + `description` | **loaded** (`alpha-ok` appears in the list) |
| `beta-nodesc.md` | only `name` | **not loaded** (absent from the list) |
| `gamma-noname.md` | only `description` | **not loaded** (absent from the list) |

Command and read-back (measured output, including built-in comparison):

```
$ cd /tmp/ad3.X2W5jI && claude -p "…list every subagent_type name available in this session…"
alpha-ok, claude, Explore, general-purpose, Plan, statusline-setup
```

The second creation path — the CLI `--agents` JSON — **is a hard failure** (runtime-measured):

```
$ claude --agents '{"nodesc":{"prompt":"You are X."}}' -p "reply with exactly: ok"
Error: Invalid --agents configuration:
nodesc.description: Invalid input: expected string, received undefined
rc=1

$ claude --agents '{"withdesc":{"description":"Use for tests.","prompt":"You are X."}}' -p "..."
ok
rc=0
```

The documentation (**D**) corroborates that path's spec: the `Invalid --agents configuration` section — "the value you passed to `--agents` is invalid, so `claude` exits with code 1 instead of starting the session"; `prompt` may be an empty string, but `description` may not.

**⑤ Why so strict — description is a routing key, not a label.** Documentation verbatim: "Claude uses each subagent's description to decide when to delegate tasks.""Use the Agent tool with specialized agents when the task at hand matches the agent's description." The same page also gives a **cost-awareness** constraint: startup warns when all custom subagents' descriptions together exceed 15,000 tokens — description is resident context, not a free field.

**Summary**: Claude Code takes the **strictest tier** on `the agent's responsibility description` — no default, no seed, no template; missing it means not loaded (file path silently skipped, CLI path hard-fail). Its reasoning is fully isomorphic with pacman's: **this field's job is "being used to pick people"; a fake one is worse than none.**

### 3.2 CrewAI (A) — **L-B**

repo `crewAIInc/crewAI`, branch `main`.

The fields are declared in the parent class (not the `Agent` subclass): `lib/crewai/src/crewai/agents/agent_builder/base_agent.py:256-258`

```python
    role: str = Field(description="Role of the agent")
    goal: str = Field(description="Objective of the agent")
    backstory: str = Field(description="Backstory of the agent")
```

`Field(description=...)` without a default → Pydantic requires it. **And there is one explicit non-empty validator** (`base_agent.py:587-593`):

```python
    @model_validator(mode="after")
    def validate_and_set_attributes(self) -> Self:
        for field in ["role", "goal", "backstory"]:
            if getattr(self, field) is None:
                raise ValueError(f"{field} must be provided either directly or through config")
```

- **required** / **no default** / **does not fill a default** (**source-verified**).
- **Pre-fill happens only in the scaffold**: `crewai create crew <name>` copies `config/agents.yaml` from the template (`lib/cli/src/crewai_cli/create_crew.py:164,177,183`), and the template pre-fills the full role/goal/backstory for the two roles `researcher` / `reporting_analyst` (`lib/cli/src/crewai_cli/templates/crew/config/agents.yaml`). The `flow` template has planner/writer/editor three roles instead.
- **Note the distinction**: the pre-fill happens **in a file generated while the developer is writing code**, not at the runtime user-input surface. This is key to the §5 analogy — see the counter-example critique in the `trade-off` section.

### 3.3 AutoGen (B) — **L-B**

repo `microsoft/autogen`, branch `main`.

- **Correction**: the Python `ConversableAgent` is **no longer on `main`** (under `python/packages/pyautogen/` only the proxy package `__init__.py` remains, and the README says to `pin pyautogen~=0.2.0`). `main` today = `autogen_agentchat.agents.AssistantAgent`.
- **The current `AssistantAgent`** (`python/packages/autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py:734-736`) — **optional + a default string**:

```python
        system_message: (
            str | None
        ) = "You are a helpful AI assistant. Solve tasks using your tools. Reply with TERMINATE when the task has been completed.",
```

The constructor `:766-770`: passing `None` → `self._system_messages = []` (fully turned off); not passing → the sentence above. **Source-verified**.

- **The `DEFAULT_SYSTEM_MESSAGE` named by the task brief — no evidence obtained**: on `main` that constant is not on `ConversableAgent` (that class is removed); it sits on `CodeExecutorAgent` (`_code_executor_agent.py:421`, verbatim `"You are a Code Execution Agent. Your role is to generate and execute Python code and shell scripts…"`) and several autogen-ext submodules. In the v0.2.x era it sat on `AssistantAgent` (tag `v0.2.40`, `autogen/agentchat/assistant_agent.py:19-30`), while `ConversableAgent` used the inline literal `"You are a helpful AI Assistant."` (same tag, `autogen/agentchat/conversable_agent.py:72`).
- **Template / preset roles**: `AssistantAgent` itself carries **no template role**; the hard-coded role lineup is only in the upper-layer team — MagenticOne (`autogen_ext/teams/magentic_one.py:211-221` fixes the fs/ws/coder/executor four plus the `MAGENTIC_ONE_CODER_SYSTEM_MESSAGE` constant persona).
- **Summary**: **tier B** — the field is optional, but there is a generic default string, and passing `None` is a legitimate "explicitly turn it off".

### 3.4 OpenAI Agents SDK and LangGraph (C) — **L-C**

**OpenAI Agents SDK**, repo `openai/openai-agents-python`, branch `main`:

```python
# src/agents/agent.py (~332)
    instructions: (str | Callable[[RunContextWrapper[TContext], Agent[TContext]], MaybeAwaitable[str]] | None) = None
```

- **optional, default `None`, no seed, no template** (**source-verified**). The docstring is a **recommendation**, not a constraint: `We strongly recommend passing instructions, which is the "system prompt" for the agent.`
- **What happens at runtime when not passed** (`Agent.get_system_prompt`, `:1129`): `instructions is None` → `return None`; the two model channels then **omit the whole system message** — Chat Completions goes through `if system_instructions:` truthiness (`src/agents/models/openai_chatcompletions.py:~629`), Responses goes through `_non_null_or_omit` (`src/agents/models/openai_responses.py:~1035`, `None` → `omit`, not even sending the field in the request).
- **No fallback wording** — same shape as pacman's worker side; **opposite** to pacman's chief side.
- The only constant with wording, `RECOMMENDED_PROMPT_PREFIX` (`src/agents/extensions/handoff_prompt.py`), is an **opt-in helper**; the framework does not inject it automatically.

**LangGraph**, repo `langchain-ai/langgraph`, branch `main` (real path `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py`):

```python
def create_react_agent(model, tools, *, prompt: Prompt | None = None, ...) -> CompiledStateGraph:
```

- **optional, default `None`** (**source-verified**).
- The historically co-existing `state_modifier` **has been deleted** (`search/code` has 0 hits repo-wide; the signature only keeps `**deprecated_kwargs`, and :518-528 only recognizes `config_schema`, reporting `got unexpected keyword arguments` for the rest).
- Behavior when not passed (`_get_prompt_runnable`, `:137`): `prompt is None` → the state's messages are fed to the model as-is, **no system message prefixed**; only passing `str` prefixes `SystemMessage(content=prompt)`.
- **No seed / no template**.

### 3.5 Letta (B + first-time seed) — **L-C**

**Preceding fact**: `letta-ai/letta`'s `main` has only metadata left, with the source moved to `letta-ai/letta-code`; the retired V1 server is on `letta-ai/letta`'s `archive` branch. Evidence gathered from both.

**V1 (`archive`)**:

```python
# letta/constants.py (~105)
DEFAULT_PERSONA = "sam_pov"
DEFAULT_HUMAN = "basic"
# letta/config.py (~48)
    persona: str = DEFAULT_PERSONA
    human: str = DEFAULT_HUMAN
```

- `DEFAULT_PERSONA`'s value is a **file name**, not body text; the body is read by `get_persona_text(name)` (`letta/utils.py:~1008`) from `letta/personas/examples/<name>.txt`. Default `sam_pov.txt`, verbatim opening: `The following is a starter persona, and it can be expanded as the personality develops: I am Sam. …`
- ⚠️ **But the creation chain does not seed the text**: `letta/schemas/block.py:~131` `DEFAULT_BLOCKS = [Human(value=""), Persona(value="")]` — **value is the empty string**; `letta/services/agent_manager.py:370-382` only uses the default blocks **to fill the description, not the value** (comment says `# Inject a description for the default blocks if the user didn't specify them`).
- Tier: **source-verified**; ``whether `DEFAULT_PERSONA` still takes effect on some creation path`` — **no evidence obtained** (the creation chain only reads it into the `LettaConfig.persona` default; no end-to-end call site found).

**Current (`letta-code` `main`)**: **explicit seed, plus a preset-persona directory** (**source-verified**):

```ts
// src/agent/personality-presets.ts
export const PERSONALITY_OPTIONS: PersonalityOption[] = [
  { id: "memo", label: "Letta Code", description: "The memory-first agent" },
  { id: "tutorial", label: "Tutor", ... },
  { id: "blank", label: "Blank", description: "Blank starter — you provide the personality" },
  ...
];
export const DEFAULT_CREATE_AGENT_PERSONALITIES = ["memo", "tutorial", "blank", "linus", "kawaii"] as const;
```

- A new agent goes through `buildPersonalityMemoryBlocks` + `seedPersonalityDefaultMemoryFiles`, writing the persona/human body **into the memory repository and committing it**.
- The generic default persona (`src/agent/prompts/persona.mdx`) verbatim: `I'm a coding assistant, ready to be shaped by how we work together.`
- **The single most worth-copying cell**: the `blank` persona's body (`persona_blank.mdx`) is not blank; it is **an explicit instruction to the model**:

```
This is a blank starter personality. You must ask the user to provide a personality prompt or preference.
```

That is, on the "user hasn't filled it yet" state, Letta **does not write a default text that impersonates a responsibility**, but writes a sentence **telling the model to ask**. This maps directly onto the pacman chief surface's disease in §2.4.

### 3.6 MetaGPT (C empty-string default + D built-in roles hard-coded) — **L-D**

repo `FoundationAgents/MetaGPT`, branch `main`.

```python
# metagpt/roles/role.py
name: str = ""
profile: str = ""
goal: str = ""
constraints: str = ""
desc: str = ""
PREFIX_TEMPLATE = """You are a {profile}, named {name}, your goal is {goal}. """
CONSTRAINT_TEMPLATE = "the constraint is {constraints}. "
```

- **optional, default empty string**; the mechanism for filling the profile is `_get_prefix()` (**the whole file has no `set_profile` method**; the task brief did not assume this point): `if self.desc: return self.desc` otherwise `PREFIX_TEMPLATE.format(profile=…, name=…, goal=…)`, then appends `CONSTRAINT_TEMPLATE`; in `_process_role_extra`, `self.llm.system_prompt = self._get_prefix()`.
- **Built-in role profiles are hard-coded in the repo** (**source-verified**): `metagpt/roles/product_manager.py`'s `ProductManager` hard-codes `name="Alice"` / `profile="Product Manager"` / `goal=…` / `constraints=…` / `instruction=PRODUCT_MANAGER_INSTRUCTION`; Architect / Engineer / QA Engineer are isomorphic.
- **Summary**: base class is tier C (empty string + template rendering), built-in roles are tier D (hard-coded). **User does not fill = gets a fragmented `You are , named , your goal is .` prompt** — a counter-example: an empty-string default, without a guard, feeds a broken prompt straight into the model.

### 3.7 ChatDev (D built-in hard-coded + first-run assembles a default company) — **L-D**

- The `main` branch **has been rewritten into a workflow/graph system**, the classic `chatdev/` directory no longer exists (`trees` has no hits); the classic implementation is on the `chatdev1.0` branch.
- **`main`**: `entity/configs/node/agent.py`'s `AgentConfig` — `role: str | None = None`, and in `FIELD_SPECS`, `ConfigFieldSpec(name="role", display_name="System Prompt", required=False, …)` → **optional / default None / `required=False`** (**source-verified**).
- Role prompts are written verbatim in `yaml_instance/ChatDev_v1.yaml` (e.g. the Programmer role reuses the common section via `${COMMON_PROMPT}`).
- **Classic version**: role prompts are hard-coded in `CompanyConfig/Default/RoleConfig.json` (`Chief Executive Officer` etc., a set of multi-line string templates per role, containing a `{task}` placeholder).
- **First run auto-assembles a default role set** (**source-verified**, `chatdev1.0/run.py`): `--config` defaults to `"Default"`; when config lookup fails it falls back to `CompanyConfig/Default` — that is, **a preset role company runs even without configuration**.

### 3.8 Dify (C nullable, no pre-fill) — **L-D** (this section is one of the two most critical samples of this research)

repo `langgenius/dify`, branch `main`. **Conclusion: the agent app's instruction has no pre-filled default template; it is empty by default.**

- DB column (`api/models/model.py`): `pre_prompt: Mapped[str | None] = mapped_column(LongText, default=None)` — **default None**.
- The new Agent App's "Agent Soul" (`api/models/agent_config_entities.py`): `class AgentSoulPromptConfig(BaseModel): system_prompt: str = ""` — **default empty string**.
- **No seed on creation** (`api/services/app_service.py::create_app` → `api/constants/model_template.py::default_app_templates`): both the `AppMode.AGENT_CHAT` and `AppMode.AGENT` templates have **no `pre_prompt` key**; a source comment says the AGENT mode's prompt is carried by the bound Agent Soul. For contrast: only the **completion** mode pre-fills `"pre_prompt": "{{query}}"` — **not agent**.
- The backing agent goes through `AgentRosterService.create_backing_agent_for_app(..., initial_soul=initial_agent_soul)`, and `prepare_agent_soul` **only fills the model, not the prompt**; the debug session uses `system_instruction="", system_instruction_tokens=0`.
- **No hard-coded agent default-prompt constant** (`AGENT_INSTRUCTION` / `PRE_PROMPT` do not exist on the agent path). `api/constants/recommended_apps.json` is a template library the user **actively picks**; it is not auto-applied.
- **Summary**: Dify = pure tier C — nullable, empty, no pre-fill, no fallback wording.

### 3.9 n8n (B has a default; the node is pre-filled) — **L-D** (the other critical sample)

repo `n8n-io/n8n`, branch `master`, package `@n8n/nodes-langchain`.

```ts
// packages/@n8n/nodes-langchain/nodes/agents/Agent/agents/ToolsAgent/prompt.ts
export const SYSTEM_MESSAGE = 'You are a helpful assistant';
// .../ToolsAgent/options.ts
{ displayName: 'System Message', name: 'systemMessage', type: 'string', default: SYSTEM_MESSAGE, ... }
// packages/@n8n/nodes-langchain/utils/descriptions.ts
export const promptTypeOptions = { ..., default: 'auto', ... };
export const textInput = { displayName: 'Prompt (User Message)', name: 'text', type: 'string', required: true, default: '', ... };
export const textFromPreviousNode = { ..., required: true, default: '={{ $json.chatInput }}', ... };
```

- **`systemMessage` is optional and has a hard-coded default** `'You are a helpful assistant'`; `text` (the user prompt) declares `required: true` but **carries a default** (`''` or the expression `={{ $json.chatInput }}`); `promptType` defaults to `'auto'`.
- **A new node arrives pre-filled** — it has a value when dragged out, and runs even unmodified.
- The old ConversationalAgent's default `SYSTEM_MESSAGE` is a long text opening with `Assistant is a large language model trained by OpenAI.`.
- **Summary**: n8n = tier B, and is the archetype of the `pre-fill into the form` shape — **same shape as §5's option ②**.

### 3.10 Coze (C nullable + hard-coded outer template) — **L-D**

- **Closed-source SaaS (coze.com / coze.cn): no evidence obtained** — the official docs page captured via Jina Reader only returns navigation and a CAPTCHA hint ("This page maybe requiring CAPTCHA"); the JS-rendered body was not obtained. Do not backfill guesses.
- **Open-source Coze Studio (`coze-dev/coze-studio`, branch `main`): source-verified.** A new agent's persona/prompt is **not pre-filled** (`backend/application/singleagent/create.go::newDefaultSingleAgent` has `Prompt: &bot_common.PromptInfo{}` as an empty struct); but at runtime it is wrapped in a **hard-coded system-prompt template** (`backend/domain/agent/singleagent/internal/agentflow/system_prompt.go`):

```
const REACT_SYSTEM_PROMPT_JINJA2 = `
You are {{ agent_name }}, an advanced AI assistant designed to be helpful and professional.
...
----- Start Of Persona -----
{{ persona }}
----- End Of Persona -----
...`
```

- **Summary**: tier C + an outer template. An empty persona does not make the prompt a fragment (there are guardrails and a role frame), but neither does it fabricate a persona on the user's behalf.

### 3.11 Summary

| Project | repo · branch | Field | ① tier | Declaration-site default | ② Creation-surface pre-fill | ③ First-time seed | ④ Built-in template/role | Runtime behavior when omitted |
|---|---|---|---|---|---|---|---|---|
| **Claude Code subagents** | local 2.1.289 binary + docs | frontmatter `description` | **A required** | none | none | none | none (built-in descriptions hard-coded) | file path **not loaded**; `--agents` JSON **rc=1 refuses to start** |
| **CrewAI** | `crewAIInc/crewAI@main` | `role`/`goal`/`backstory` | **A required** | none + non-empty validator | scaffold template `agents.yaml` | none | scaffold-template roles | Pydantic `ValidationError` / `ValueError` |
| **AutoGen** | `microsoft/autogen@main` | `system_message` | **B** | `"You are a helpful AI assistant. …"` | none | none | MagenticOne roster hard-coded | uses the default string; passing `None` = explicitly turned off |
| **OpenAI Agents SDK** | `openai/openai-agents-python@main` | `instructions` | **C** | `None` | none | none | none (`RECOMMENDED_PROMPT_PREFIX` opt-in) | **never sends any system message** |
| **LangGraph** | `langchain-ai/langgraph@main` | `create_react_agent(prompt=)` | **C** | `None` | none | none | none | prefixes no message |
| **Letta (current)** | `letta-ai/letta-code@main` | persona / human blocks | **B + seed** | generic `persona.mdx` body | persona-preset directory (6) | **yes** (written into the memory repo and committed) | `PERSONALITY_OPTIONS` + `persona_*.mdx` | uses the preset body; `blank` persona = `you must ask the user` |
| **Letta V1** | `letta-ai/letta@archive` | `persona` / `human` block | B (config layer) | `DEFAULT_PERSONA="sam_pov"` (**file name**) | template library `personas/examples/*.txt` | creation chain does **not** seed text (`DEFAULT_BLOCKS` value is `""`) | `.txt` template library | see left; whether it takes effect end-to-end **not evidenced** |
| **MetaGPT** | `FoundationAgents/MetaGPT@main` | `profile`/`goal`/`constraints` | **C** | `""` empty string | none | none | built-in roles hard-coded (ProductManager etc.) | the `You are , named , your goal is .` fragment |
| **ChatDev** | `OpenBMB/ChatDev@main` / `chatdev1.0` | `role` | **C** (main) / **D** (classic) | `None` | none | **classic** assembles the `Default` company | `RoleConfig.json` hard-coded | main: no prompt; classic: preset roles |
| **Dify** | `langgenius/dify@main` | `pre_prompt` / Agent Soul `system_prompt` | **C** | `None` / `""` | **none** | none | none (recommended_apps must be actively picked) | empty instruction |
| **n8n** | `n8n-io/n8n@master` | `systemMessage` | **B** | `'You are a helpful assistant'` | **yes** (pre-filled when the node is dragged out) | none | that default string is the fixed template | runs directly with the default string |
| **Coze Studio** | `coze-dev/coze-studio@main` | persona | **C** | empty | none | none | outer hard-coded `REACT_SYSTEM_PROMPT_JINJA2` | empty persona enters the template slot |

**Distribution**: A required 2 / B has a default 4 (AutoGen, n8n, Letta current, Letta V1 config layer) / C nullable 5 (including ChatDev main, MetaGPT base class, Dify, Coze, and OpenAI+LangGraph counted as one) / D built-in hard-coded 1 (ChatDev classic).

**Two cross-project regularities** (not impressions; countable from the table above):

1. **All of the `has a default` tier are "generic assistant" defaults** (`You are a helpful assistant` ×2, `I'm a coding assistant` ×1), **none is a "specific role" default**. Because the framework does not know what your agent does — it can only give an honest empty shell.
2. **The more a project treats the field as a routing key, the more it leans to required or explicitly-absent**: Claude Code (delegates by description) → required; CrewAI (divides work by role) → required + non-empty validation; pacman chief (dispatches by responsibility) falls in the same family, yet stops at tier C, and even **fills the fallback with a string impersonating a responsibility** (§2.4).

---

## 4. Sub-question: does any project special-treat the `first / main agent`?

| Project | Has one? | Evidence |
|---|---|---|
| **CrewAI** | **yes** (the only shape closest to "seeding a default coordinator") | `lib/crewai/src/crewai/crew.py:1531-1555` `_create_manager_agent()`: when `manager_agent` is empty it auto-constructs a manager whose role/goal/backstory come from i18n — `lib/crewai/src/crewai/translations/en.json:2-6` verbatim `"role": "Crew Manager"`, `"goal": "Manage the team to complete the task in the best way possible."`, plus a long backstory. **Source-verified**. Constraint: only when `process=hierarchical` and no `manager_llm`/`manager_agent` passed; a plain sequential crew is not seeded. |
| **ChatDev (classic)** | **yes** | `chatdev1.0/run.py`: `--config` defaults to `"Default"`, fallback `CompanyConfig/Default` when missing — the first run assembles a whole preset-role company (including CEO/CPO). **Source-verified**. |
| **AutoGen** | **partially** | The MagenticOne team fixes the roster at construction (`magentic_one.py:211-221`) and has a "main coordinator" Orchestrator — but its system message was measured to be the **empty string** (`autogen_agentchat/teams/_group_chat/_magentic_one/_prompts.py:3` `ORCHESTRATOR_SYSTEM_MESSAGE = ""`, and no reference found repo-wide by grep); the main agent's persona relies on ledger prompts rather than a regular system message. **Source-verified**. The general mechanism `auto-seed a default coordinator on first run`: **not found**. |
| **Claude Code** | **one cell, but not a "default persona"** | The main-session agent alone has the `initialPrompt` field — documentation (**D**): `Auto-submitted as the first user turn when this agent runs as the main session agent (via --agent or the agent setting)` + "Ignored for plugin subagents". That is, the "main agent" position is indeed special-treated, but what is special-cased is the **automatic first turn message**, not a persona default. |
| **Letta current** | **partially** | `ONBOARDING_PERSONALITIES = ["tutorial"]` — only a new agent with the `tutorial` persona gets an extra seeded onboarding block. **Distinguished by persona preset, not "only for the main agent"**. **Source-verified**. |
| **Letta V1** | **not found** | `server.py` uses dedicated persona texts for sleeptime / voice / group scenarios, but **no "first/main agent" branch**; the `create_agent` main path is isomorphic for all agents. |
| **MetaGPT / ChatDev main / Dify / n8n / Coze / OpenAI SDK / LangGraph** | **not found** | all treat every agent the same. |

**Conclusion**: **`special treatment for the first agent` is a minority in other projects, and all are in the "coordinators of multi-agent collaboration frameworks" context** (CrewAI hierarchical manager, ChatDev default company, AutoGen MagenticOne roster) — what they special-treat is **the coordinator role**, not "the first object created".

This is directly relevant to this repo: **pacman already has a dedicated coordinator entity — the chief**. It is not a member of the agent roster but an independent record + a bound agent (`apps/server/src/services/chief.ts:735-756`; unbound → `chief-drawer.tsx:600` hard gate). So the intuition "the first agent needs special treatment" has its counterpart in this repo **not as "give the first agent a default responsibility" but as the chief binding itself** — this is exactly the origin of §5's option ④, and the source of its cost.

---

## 5. The trade-off for this repo

### 5.1 The four options laid out

Reusing the §2.7 yardstick (the two criteria of `AGENT_TOOL_DEFAULTS`: **does not break delivery** + **least privilege** — a default is added only when "its absence breaks an existing chain" and "the added tier is unambiguous").

**① Keep nullable (status quo)**

- Cost: the default path (create dialog has no responsibility field → §2.3) produces an empty responsibility; `未设置职责` appears in the chief prompt and **is consumed as the responsibility text**; the worker side silently omits it (the two surfaces behave oppositely on the same null, §2.4); the empty string can still bypass every fallback (§2.5).
- Landing points to change: zero.
- Existing rows: untouched.

**② Pre-fill an editable draft when an agent is first created**

Must first be split into two different things, whose costs differ by an order of magnitude:

- **②a placeholder (gray hint text, not persisted)**: only the UI changes. Landing points = `create-agent-dialog.tsx` adds a responsibility input (placeholder gives an example, e.g. `负责后端接口与数据层`) + `CreateAgentInput` gains a field + `POST` carries it. Existing rows untouched, e2e empty-state assertion untouched (not filled → still null). **Minimal cost, and no data fabrication.**
- **②b real pre-fill (persist a default text)**: equals ① + a lie (see 5.2). Landing points same as ②a, but with one extra migration semantics, and the "missing" signal disappears from the chief prompt. **Not recommended**.

**③ Make `description` required**

- Cost: breaks reference-product parity (todos.dev allows empty; r3:187 the team-page card shows `未设置职责`); existing null rows must be migration-backfilled (in the shape of `0018_agent_push_backfill.sql`), and **what value to backfill is itself the question** — inevitably some generic text must be made up; `create-agent-dialog` needs one more field plus a submit gate; `createAgentBodySchema` / `patchAgentBodySchema` / the chief `create_agent` tool schema (`protocol/chief-tools.ts:349-361` must grow from `required:['displayName']` to include description) all change in lockstep; the `apps/web/e2e/agent-detail.spec.ts:105` empty-state canon assertion is voided and rewritten.
- **The strongest counter-example (from L-B)**: CrewAI's required is zero-cost because its `role` is **a constant the developer fills while writing code** — the developer is naming the agent anyway, three more lines are no friction. pacman's responsibility is **the end user's runtime input on the UI** (the create surface today has no input box at all). Required here means erecting a gate in the UI, and **required only guarantees non-empty, not informative** (a user typing "agent" passes anyway). The actual loss in this problem is **semantic absence**, and a formal constraint cannot cure semantic absence.

**④ Only give a default to the `chief-bound agent`**

- Cost: at binding time the agent already exists (§2.3, the create surface has no responsibility field), so writing a default = **going back to change the user's data**; on rebinding one must decide whether to revoke (revoke = change back to null, another write); and the chief-bound agent in pacman is just **an ordinary agent** (memory shared, `chief.ts:735`) — giving it a special default makes it differ in origin from other rows in the same table, so every subsequent criterion must carry a "is this the chief-bound one" branch.
- Existing rows: the binding lives in the `chief` table, backfill needs a join, and "bound before then unbound" rows have no decidable final state.
- The only defensible part: §4 shows "special-treat the coordinator" is indeed aligned with others (CrewAI / ChatDev / AutoGen). But what others special-treat is **the orchestrator role**, and pacman's orchestrator already has a dedicated entity (the chief) and does not need to borrow "the first agent" to carry it.

### 5.2 The trade-off: why `giving a default value` is worse than `leaving it empty` in this repo

This section is this document's core argument, independent of the other-project evidence.

**Responsibility is a routing key in this repo.** Evidence: the chief system prompt's strategy section says `dispatch: read the agents' responsibility text and choose by weight` (around `apps/server/src/services/chief.ts:768`), and r5 §3.3's A/B experiment proves **the responsibility text really participates in dispatch and in the right direction** (a pure-docs task → the docs-responsibility Agent; code involved → the code-responsibility Agent; `docs/research/r5-chief-behavior.md:52-56`).

For a routing key:

- **Empty is a real signal**: the chief sees a candidate explicitly marked `未设置职责`, and can choose `ask the user` or `judge by name/model` — **the decision happens on the model side, and the information is true**.
- **A default value is a plausible-looking fake signal**: if the default is written as `generic assistant`, then **every agent whose responsibility went unfilled looks identical in the dispatch list**. The chief reads it as a real responsibility and picks people by it — dispatch still degrades, but **degrades silently**: the user can no longer tell "I didn't fill it".

**Conclusion 1: for a routing key, `empty` beats `a generic default`, because the former is honest and the latter lies.** This also explains §3.11 regularity 1: every `has a default` tier gives a "generic assistant" shell — the framework dares not fabricate a specific role for the user, only an honest placeholder; and the moment that placeholder is used as a routing basis, it becomes a fake signal exactly like pacman's `未设置职责`.

**Conclusion 2: pacman today has already picked one side on each of its two surfaces — the worker side picked right, the chief side picked wrong.** §2.4: `composeWorkerSystemPrompt` uses `if (description)` to **silently omit** (= truly leaving it empty, same shape as OpenAI Agents SDK / LangGraph), while the chief surface uses `?? '未设置职责'` to **literally inject** (= treating the absent state as a value). **The same null, two opposite surfaces** — this itself is the mark of "never ruled uniformly".

**Conclusion 3: the correct direction is therefore not "add a default value" but change the chief surface from "literal injection" to "explicitly state the absence and give an executable action".** Others have a ready-made, better-than-pacman's-current-fallback shape: **Letta `blank` persona's body is neither blank nor a fake persona but an instruction** — `This is a blank starter personality. You must ask the user to provide a personality prompt or preference.` (§3.5). Isomorphically, what should appear in the chief prompt is not `responsibility: 未设置职责` but `responsibility: not set — before dispatching, clarify via ask_user, do not guess from the name`. **It preserves the "missing" signal while pushing the model from "guess" to "ask".**

### 5.3 Recommendation

**Recommended combination: keep nullable (option ①) + two small changes (both on the consumption side, touching neither schema nor data).**

1. **Change the chief prompt's missing fallback** (both `apps/server/src/services/chief.ts:755` and `:768`): replace `?? '未设置职责'` with an **executable instruction** rather than a status label, turning "not filled" into "go ask" instead of "guess by it". This is the direct landing point of §5.2 conclusion 3.
2. **Add empty-string normalization** (§2.5): normalize `''` to `null` before the four API write paths persist (`description: body.description?.trim() || null` shape), or sink it into a shared-schema `.transform`. **Without this, any fallback wording (including the existing `未设置职责`) can be bypassed by `''` and rendered blank** — this is a hole that exists today and should be fixed regardless of this document's conclusion.

**Plus an optional UI improvement (②a, placeholder)**: add a responsibility input to the create dialog, **placeholder gives an example, not persisted**. It changes no data semantics, only surfaces the field's existence and purpose at the moment the user's attention is most concentrated (creating an agent) — today the create surface doesn't even have this field (§2.3). **This is "helping the user write", not "deciding for the user"**, and does not conflict with 5.2's conclusion.

**Explicitly not recommended**: ②b real pre-fill, ③ required, ④ default only for the chief-bound agent — reasons in 5.1's per-option costs; the core is that they either introduce a fake signal (②b/④) or use a formal constraint to cure semantic absence (③).

### 5.4 Premortem: assuming this recommendation has already failed, the three most likely causes of death

1. **"Changing the wording" has no verifiable criterion → after the change nobody knows whether it helped.**
   The most likely cause of death. The chief's dispatch quality has no offline metric; after changing the fallback wording the only observable is "did dispatch get better", which requires actually running an LLM. **Guardrail**: split this into **two decidable steps** — (a) the prompt no longer contains the five characters `未设置职责` (unit-testable: assert on the assembled prompt string); (b) there exists an e2e/integration case: when an agent with no responsibility is present, the chief turn's output contains an ask_user call (stub-LLM-able; this repo already has a full chief chain with a fake LLM). Without (b), don't start.
2. **The recommendation is read as "do nothing", and then option ③ gets implemented somewhere else in passing.**
   "Keep nullable + change the wording" sounds low-priority and is easily overridden by the next "help me make responsibility required" intuition. **Guardrail**: this document's conclusion must be citable — write 5.2's `empty beats a generic default because a routing key must not lie` as one sentence into `CONTEXT.md`'s agent entry or spec 13, so later arrivals hitting the same intuition have a canonical source to check.
3. **The placeholder (②a) gets implemented as ②b real pre-fill.**
   The difference is only "does the value go along on submit", and it is very easy to slip past during implementation (`CreateAgentInput` gains one field, `onCreate` fills it conveniently → it becomes a default). **Guardrail**: add one e2e — **submit without touching the responsibility input, and the persisted `description` must be `null`** (this assertion also pins the §2.5 empty-string hole at the same time).

### 5.5 Check against this repo's discipline

- This repo's `changes are driven by real usage, not by copying others' spec`: the recommendation in this document is **not** derived from a distribution vote over other projects (A 2 / B 4 / C 5 / D 1, the majority is actually B) but from the single **own fact** "responsibility is a routing key in this repo"; other-project evidence is used only to take counter-samples (MetaGPT's empty-string fragment, Letta blank's correct shape, CrewAI's required not applying to a runtime input surface).
- `adding a default value = a deviation from the reference product`: recommendation ① does not deviate; the two small changes inside the recommendation (chief wording, empty-string normalization) **already differ in origin from the reference product** — the reference product's chief is a black box (r5 §2 black-box approximation), and its dispatch-strategy wording is already a [design] on the replication side, so changing it is not a new deviation. Empty-string normalization is a pure defect fix.

---

## 6. Appendix: items not closed in this document

1. **Coze SaaS's create pre-fill**: **no evidence obtained** (docs page is JS-rendered + CAPTCHA, Jina Reader cannot get the body). The open-source Coze Studio conclusion cannot speak for it.
2. **Whether Letta V1's `DEFAULT_PERSONA="sam_pov"` still takes effect on some creation path**: **no evidence obtained** (the creation chain only reads it into the config default; no end-to-end call site found).
3. **The empty-string penetration (§2.5) only got a read-the-code recheck; the `description: ""` state was not constructed at runtime**. To close the loop one should spin up a verify stack, run one `POST` with `description: ""`, and see whether the detail page renders blank.
4. **The chief's actual dispatch behavior under "missing responsibility"** (does it really degrade into guessing by name, does it really call ask_user): not measured. This is the question guardrail (b) of 5.4 cause-of-death 1 must answer.